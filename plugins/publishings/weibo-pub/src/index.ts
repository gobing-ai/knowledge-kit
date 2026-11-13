import { dirname, extname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    FakeBrowserTransport,
    type PublishTransport,
    type PublishTransportPayload,
    trySelectors,
} from '@gobing-ai/publish-harness';
import {
    type ChannelBrowserConfig,
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    pasteHtml,
    resolveChannelProfileDir,
    resolveSelector,
    uploadFile,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type IsAuthenticatedPredicate,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { Page } from 'playwright';

/** Site-owned target slug; also the profile channel key (`WEIBO_PROFILE_DIR`). */
const TARGET = 'weibo';
/** Weibo home: the post composer page and the readiness page for a session check. */
export const WEIBO_HOME_URL = 'https://weibo.com';
/**
 * 头条文章 editor entry. **Measured 2026-10-12** (task 0246): this route still redirects to
 * `https://weibo.com/` for an account **without the 头条文章 entitlement** — the throwaway account
 * used for the live walk had none (no 文章/写文章 entry in the creator centre either), so the article
 * leg stays entitlement-gated. See `docs/design/weibo-ui-discovery.md`.
 */
export const WEIBO_ARTICLE_URL = 'https://card.weibo.com/article/v3/editor';
/**
 * Post composer entry. **Measured 2026-10-12** (task 0246, `docs/design/weibo-ui-discovery.md` §2b):
 * the mobile web composer is the route this channel posts through. It is a plain server-rendered page —
 * one real `<textarea>`, one `a.m-send-btn` — where the desktop React app's 发送 click produced no
 * submission at all (the draft stayed in the composer, no toast, no card, twice), and it accepts an
 * image through `input[type="file"]` natively, which an episode announcement needs.
 */
export const WEIBO_MOBILE_COMPOSE_URL = 'https://m.weibo.cn/compose/';
/** Login and passport redirects: while the browser sits on one, the composer never renders. */
export const LOGIN_URL_RE = /(passport\.weibo\.com|\/login)/;

/** Declared operations (ADR-029 dispatch): a home-feed post and a 头条文章 article. */
export const WEIBO_OPERATIONS = ['post', 'article'] as const;
export type WeiboOperation = (typeof WEIBO_OPERATIONS)[number];

/**
 * Post-composer selectors, ordered fallbacks. **Measured live 2026-10-12** (task 0246, throwaway
 * account, `docs/design/weibo-ui-discovery.md`): the composer is a real `<textarea>` whose
 * placeholder is "有什么新鲜事想分享给大家？" (class `_input_*`) and the send control is
 * `button` "发送" (classes `woo-button-main woo-button-flat woo-button-primary …`).
 *
 * `send` deliberately keeps every fallback constrained to its own 发送 text: the measured
 * `woo-button-primary` class is ALSO on the account's 管理 button, so a bare class fallback would
 * click the wrong control.
 */
export const WEIBO_POST_SELECTORS = {
    composer: ['textarea[placeholder*="分享新鲜事"]', 'textarea[placeholder*="新鲜事"]', 'textarea'],
    /**
     * Send control: measured as `a.m-send-btn` (text 发送) on the mobile composer. The 发送-text
     * constraint is kept on every fallback so a bare class can never match a different control.
     */
    send: ['a.m-send-btn', 'a:has-text("发送")', 'button:has-text("发送")'],
    /** Post image: the mobile composer's `input[type="file"]`, accept `image/gif,jpeg,webp,jpg,png,bmp`. */
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
} as const;

/**
 * 头条文章 editor selectors, ordered fallbacks. **Not measured live**: task 0246's throwaway account
 * lacks the 头条文章 entitlement, so the editor never rendered (measured redirects, no draft
 * control). They stay provisional ladders that fail closed — a missing control is a loud refusal,
 * never a silent no-op — and `docs/design/weibo-ui-discovery.md` records exactly what was measured.
 */
export const WEIBO_ARTICLE_SELECTORS = {
    title: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]', 'input[class*="title"]'],
    body: [
        'div[contenteditable="true"][class*="editor"]',
        '.ProseMirror',
        'div[contenteditable="true"]',
        'iframe[class*="editor"]',
    ],
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    saveDraft: ['button:has-text("保存草稿")', 'a:has-text("保存草稿")'],
    // The v5 editor has NO 发布 button on the article page: its live rail is the bottom 下一步
    // (publish settings → confirmation), measured 2026-11-12. 发布/发表 stay first for the older
    // editor that had them, and for the confirmation dialog's own button.
    publish: ['button:has-text("发布")', 'button:has-text("发表")', 'button:has-text("下一步")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
/**
 * The cover rail uploads + renders a library image in the publish-settings panel; 30s measured too
 * tight on the 2026-11-12 daily article ("no outcome observed within 30000ms", nothing saved).
 */
const COVER_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const LOGIN_INSTRUCTION = 'bun plugins/publishings/weibo-pub/src/profile-check.ts login';
/**
 * Image extensions this channel accepts — the mobile composer's measured `accept` list
 * (`image/gif,image/jpeg,image/webp,image/jpg,image/png,image/bmp`), which is also what the
 * open-platform `pic` parameter takes.
 */
const POST_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
/**
 * One-image cap. Weibo documents the open-platform `pic` upload as under 5 MB
 * (<https://open.weibo.com/wiki/2/statuses/share>); the same Content must be portable between the
 * browser and API routes, so the stricter documented bound is the channel's bound.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The 头条文章 cover keeps the x-pub peer's narrower set (0244 R2); only `post` widened (0246 R9). */
const ARTICLE_COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/** Body excerpt length compared on readback and on the fresh-post signal. */
const EXCERPT_CHARS = 30;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error: boundedDetail(error) });
}

/**
 * A refusal/failure before the composer was saved or published: nothing reached the channel, so a
 * bounded retry is safe. The reserved marker is what `apps/cli/src/itc-publish.ts` reads; without
 * it the receipt is `effect: unknown` and `--retry` skips the row forever (2026-11-12).
 */
function refuse(error: string): Result {
    return ResultSchema.parse({
        ok: false,
        target: TARGET,
        error: boundedDetail(error),
        metadata: { itcDelivery: { schemaVersion: 1, effect: 'none' } },
    });
}

/** One short line, bounded: no DOM dump, cookie, token or stack ever reaches the Result (E91-D6). */
function boundedDetail(detail: string): string {
    return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** A bounded, single-line rendering of an operator-supplied value for a refusal message. */
function bounded(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
    return String(value).replace(/\s+/g, ' ').slice(0, 100);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Whitespace-insensitive comparison: editors normalize runs of spaces and newlines. */
function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
}

function excerpt(text: string): string {
    return normalizeText(text.replace(/^[#>*`\-\s]+/gm, '')).slice(0, EXCERPT_CHARS);
}

/**
 * Resolves the requested operation. An undeclared value is refused by name, before any transport —
 * and therefore before any browser — is resolved (R8).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: WeiboOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    if (typeof raw !== 'string' || !(WEIBO_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for weibo: expected one of ${WEIBO_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as WeiboOperation };
}

/**
 * Resolves the driver from `options.driver ?? 'script'`. This channel ships one driver and no
 * `agent` path, so anything else — including a wrong type — is refused by name before a transport
 * is built (R8).
 * @param options - Per-call publish options (`driver`).
 * @returns The resolved driver, or the refusal message.
 */
function resolveDriver(
    options?: Record<string, unknown>,
): { driver: BrowserDriver; error?: undefined } | { driver?: undefined; error: string } {
    const raw = options?.driver ?? 'script';
    if (raw !== 'script') {
        return {
            error: `unsupported driver '${bounded(raw)}' for weibo: expected one of script (the weibo-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Weibo-owned readiness predicate: no login redirect and either the home composer or the 头条文章
 * editor reachable. Shared by the publish preflight and the operator profile CLI, so both apply one
 * gate (R6, R7). Both surfaces are accepted because the preflight always opens the home page while
 * the article flow's post-goto confirmation opens the editor.
 */
export const isWeiboAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (LOGIN_URL_RE.test(page.url())) return false;
    if ((await trySelectors(page, WEIBO_POST_SELECTORS.composer, { visible: false })).found) return true;
    return (await trySelectors(page, WEIBO_ARTICLE_SELECTORS.title, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The publish preflight
 * never forwards `checkHeadedOnly`: it is the operator CLI's setting, and a refusal must never
 * escalate to a headed window on its own (R6).
 */
export const WEIBO_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: WEIBO_HOME_URL,
    isAuthenticated: isWeiboAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};

/**
 * Resolves and validates the optional image: `options.coverPath` wins over a single `options.images`
 * entry and `metadata.coverImage`. It must be an absolute path to an existing file of the
 * operation's accepted set (article `.png|.jpg|.jpeg|.webp`, post adds `.gif|.bmp`) within 5 MB —
 * a bad image is refused before any browser opens (R2, R9).
 */
async function resolveCover(
    options: Record<string, unknown> | undefined,
    content: Content,
    operation: string,
): Promise<{ path: string } | { error: string } | undefined> {
    const list = options?.images;
    if (Array.isArray(list) && list.length > 1) {
        return { error: `only one image is supported, got ${list.length} — weibo-pub posts one image` };
    }
    const single = Array.isArray(list) && list.length === 1 ? list[0] : undefined;
    const raw = options?.coverPath ?? single ?? content.metadata?.coverImage;
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `image path must be a non-empty local file path, got '${bounded(raw)}'` };
    }
    if (!isAbsolute(raw)) {
        return { error: `image path must be an absolute path, got '${raw}'` };
    }
    const accepted = operation === 'article' ? ARTICLE_COVER_EXTS : POST_IMAGE_EXTS;
    if (!accepted.has(extname(raw).toLowerCase())) {
        return { error: `image must be one of ${[...accepted].join(', ')} (Weibo's accepted set), got '${raw}'` };
    }
    if (!(await createNodeFileSystem().exists(raw))) {
        return { error: `image file does not exist: '${raw}'` };
    }
    const size = Bun.file(raw).size;
    if (size > MAX_IMAGE_BYTES) {
        return {
            error: `image is ${Math.round(size / 1024 / 1024)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB weibo limit: ${raw}`,
        };
    }
    return { path: raw };
}

/**
 * Weibo browser transport on the shared rails (ADR-027): a headless session preflight, one headed
 * flow, and success only from an observed signal (E91-D5/D6). `post` refuses without
 * `publishStatus: public` because the home composer has no draft; `article` saves a draft by
 * default and clicks a live control only for `public`.
 */
export class WeiboBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: WeiboOperation;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    private readonly coverTimeoutMs: number;
    constructor(
        operation: WeiboOperation = 'post',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number; coverTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        // Explicit seam (tests pin a small value); production keeps the longer cover budget.
        this.coverTimeoutMs = deps.coverTimeoutMs ?? COVER_TIMEOUT_MS;
    }

    /**
     * Publishes one Content: `article` (draft by default) or `post` (live only).
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed site signal.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // Refusal order (all pre-browser, R8/R5/R3): operation → driver → publishStatus value →
        // post-without-public → post text → cover → session preflight.
        if (!(WEIBO_OPERATIONS as readonly string[]).includes(this.operation)) {
            return refuse(
                `unsupported operation '${bounded(this.operation)}' for weibo: expected one of ${WEIBO_OPERATIONS.join(', ')}`,
            );
        }
        if (this.driver !== 'script') {
            return refuse(
                `unsupported driver '${bounded(this.driver)}' for weibo: expected one of script (the weibo-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return refuse(`unknown publishStatus '${bounded(requested)}' (expected absent, 'draft' or 'public')`);
        }
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        if (this.operation === 'post' && publishStatus !== 'public') {
            return refuse('weibo post has no draft; set publishStatus: public');
        }
        const text = payload.content.body.trim() || payload.content.title?.trim() || '';
        if (this.operation === 'post' && text.length === 0) {
            return refuse('weibo post requires Content.body or Content.title');
        }
        const cover = await resolveCover(payload.options, payload.content, this.operation);
        if (cover !== undefined && 'error' in cover) return refuse(cover.error);
        // An episode announcement carries its cover: `post` accepts exactly one image (R9, 0246).

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal (R6).
        const session = await checkChannelSession(WEIBO_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return refuse(
                `${TARGET} session preflight refused — run: ${LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: this.operation === 'article' ? WEIBO_ARTICLE_URL : WEIBO_MOBILE_COMPOSE_URL,
                    isAuthenticated: isWeiboAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.operation === 'article'
                        ? this.runArticleFlow(page, payload.content, publishStatus, cover?.path, profileDir)
                        : this.runPostFlow(page, text, profileDir, cover?.path),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                needsLogin(error) ? `${TARGET} session failed — run: ${LOGIN_INSTRUCTION} — detail: ${detail}` : detail,
            );
        }
    }

    /**
     * The 头条文章 flow: title → body paste → optional cover → readback → `保存草稿` (default) or
     * `发布`. Success only from a fresh signal: a new saved toast or a changed draft URL for a
     * draft, a published article URL for a live run (R2, R4).
     */
    private async runArticleFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: 'article', driver: this.driver, publishStatus, profileDir };
        const title = content.title ?? 'Untitled';

        const blank = await page.evaluate(ensureArticleDraftScript());
        if (blank !== true) {
            return refuse(
                'weibo article editor never reset to a blank draft — the auto-restored draft still carries a title or a cover, so filling and cover-attaching would land on the wrong article; open the editor, start 写文章, then retry',
            );
        }
        const editorUrl = page.url();
        const toastsBefore = await this.readToasts(page);

        const titleSelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.title, {
            timeoutMs: this.stepTimeoutMs,
            label: 'article title input',
        });
        await page.locator(titleSelector).first().fill(title);

        const bodySelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.body, {
            timeoutMs: this.stepTimeoutMs,
            label: 'article body editor',
        });
        // 头条文章 is rich text: the body goes in as rendered HTML through the shared paste (E91-D4).
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });

        if (coverPath !== undefined) {
            const baseline = await this.countImages(page, bodySelector);
            const preAttached = (await trySelectors(page, WEIBO_ARTICLE_SELECTORS.fileInput, { visible: false })).found;
            if (!preAttached) {
                await page.evaluate(openCoverLibraryScript());
                // The modal is the only place the library upload happens. Without it the file input
                // below would be the BODY image input, and the upload would land in the article text.
                const modal = await expectOutcome(
                    async () =>
                        String(await page.evaluate('() => document.querySelectorAll(".n-modal").length')) !== '0'
                            ? 'open'
                            : null,
                    { timeoutMs: 15_000, label: 'weibo cover modal' },
                );
                if (!modal.ok) return refuse(`weibo cover modal never opened (no .n-modal after 15s)`);
            }
            const fileInputSelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'article cover file input',
            });
            await uploadFile(page, fileInputSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
            if (!preAttached) {
                await page.evaluate(confirmCoverModalScript());
            }
            // A requested cover needs a fresh observed attachment, not a successful upload call.
            const attached = await expectOutcome(
                () =>
                    // Cover settles in the v5 publish-settings panel (.cover-preview) — outside the
                    // body editor scope the body-image count probes, so accept the panel preview too.
                    this.probeCoverAttached(page, bodySelector, baseline),
                {
                    timeoutMs: this.coverTimeoutMs,
                    label: 'weibo article cover attachment',
                },
            );
            if (!attached.ok) {
                // Diagnosable failure: the cover rail is DOM-fragile, and a silent 60s timeout is
                // what made the 2026-11-12 loss hard to read. `KK_WEIBO_DEBUG_DIR` writes the page
                // state beside the receipt; it is off in production.
                await this.dumpDebug(page, 'cover-failure');
                return refuse(attached.error);
            }
        }

        // Read the composer back before the save/publish control: a field the editor dropped must
        // never become a saved draft or a live article (R4).
        const titleReadback = await this.requireReadback(page, titleSelector, title, 'article title readback');
        if (!titleReadback.ok) return refuse(titleReadback.error);
        const bodyReadback = await this.requireReadback(page, bodySelector, content.body, 'article body readback');
        if (!bodyReadback.ok) return refuse(bodyReadback.error);

        if (publishStatus === 'draft') {
            const saveSelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.saveDraft, {
                timeoutMs: this.stepTimeoutMs,
                label: 'article 保存草稿 control',
            });
            await page.locator(saveSelector).first().click();
            const draft = await expectOutcome(() => this.probeDraft(page, editorUrl, toastsBefore), {
                timeoutMs: this.stepTimeoutMs,
                label: `weibo article draft '${saveSelector}'`,
            });
            if (!draft.ok) return fail(draft.error);
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                url: draft.evidence,
                message: `${TARGET} article draft saved (unpublished) in profile ${profileDir}`,
                metadata,
            });
        }

        const publishSelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.publish, {
            timeoutMs: this.stepTimeoutMs,
            label: 'article publish control',
        });
        await page.locator(publishSelector).first().click();
        // 下一步 opens the publish confirmation; its own 发布/发表 is the irreversible click. The
        // dialog is optional (an editor that publishes straight from the toolbar has none), so the
        // script returns 'none' there and the live-URL probe below stays the authority.
        await expectOutcome(
            async () => (String(await page.evaluate(confirmPublishScript())) === 'clicked' ? 'clicked' : null),
            { timeoutMs: 5_000, label: 'weibo publish confirmation' },
        );
        const live = await expectOutcome(() => this.probeArticleLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `weibo article publish '${publishSelector}'`,
        });
        if (!live.ok) {
            await this.dumpDebug(page, 'publish-failure');
            return fail(live.error);
        }
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: statusIdFrom(live.evidence),
            url: live.evidence,
            message: `${TARGET} article published live in profile ${profileDir}`,
            metadata,
        });
    }

    /**
     * The mobile-composer flow: fill → readback → optional one image → submit through the page's own
     * mobile API; success is the returned status id. Only reached for `publishStatus: public` (R3, R4).
     */
    private async runPostFlow(page: Page, text: string, profileDir: string, coverPath?: string): Promise<Result> {
        let picId = '';
        const metadata = { operation: 'post', driver: this.driver, publishStatus: 'public', profileDir };

        const composerSelector = await resolveSelector(page, WEIBO_POST_SELECTORS.composer, {
            timeoutMs: this.stepTimeoutMs,
            label: 'post composer',
        });
        await page.locator(composerSelector).first().fill(text);
        const readback = await this.requireReadback(page, composerSelector, text, 'post composer readback');
        if (!readback.ok) return fail(readback.error);

        // The announcement's cover: one image, uploaded through the composer's own input, with a
        // fresh observed attachment before the send (R9, 0246) — the same rail `article` uses.
        if (coverPath !== undefined) {
            const fileInputSelector = await resolveSelector(page, WEIBO_POST_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'post image input',
            });
            const baseline = await this.countImages(page, composerSelector);
            await uploadFile(page, fileInputSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
            const attached = await expectOutcome(() => this.probeCoverAttached(page, composerSelector, baseline), {
                timeoutMs: this.stepTimeoutMs,
                label: 'weibo post image attachment',
            });
            if (!attached.ok) return fail(attached.error);
            // The API submit needs the uploaded image's id. Until that source is measured, an image
            // whose id cannot be read is refused rather than posted as a text-only status while
            // claiming an image (R9 is fail-closed like every other rail).
            picId = String(await page.evaluate(picIdScript())).trim();
            if (picId.length === 0) {
                return fail(
                    'weibo image uploaded but its id could not be read from the composer — refusing to post a text-only status while claiming an image',
                );
            }
        }

        // Submit the way the web app itself does. Measured 2026-10-12 (0246): both the desktop and the
        // mobile 发送 anchors are JS-bound with no href, and a synthetic click produced no request at
        // all (the draft stayed in the composer, no toast, no card, three attempts). The mobile page's
        // own API answers this session — `GET /api/config` → `{ok:1,data:{login:true,st,uid}}` — so the
        // browser process posts through it, with the session, the `st` token and the ids taken from the
        // page. Same request the page issues, no app registration, no synthetic click to lose.
        const toastsBefore = await this.readToasts(page);
        const submitted = await this.submitViaMobileApi(page, text, picId);
        if (!submitted.ok)
            return fail(
                `${submitted.error} [${await this.postDiagnostics(page, composerSelector, text, toastsBefore)}]`,
            );
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: submitted.id,
            url: `https://m.weibo.cn/detail/${submitted.id}`,
            message: `${TARGET} post published live in profile ${profileDir}`,
            metadata,
        });
    }

    /**
     * Posts through the page's own mobile API (`POST /api/statuses/update`) with the page's `st`
     * token, and returns the created status id. A response without an id is a refusal carrying the
     * site's own bounded error text — never a success.
     */
    private async submitViaMobileApi(
        page: Page,
        text: string,
        picId?: string,
    ): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
        const raw = await page
            .evaluate(apiSubmitScript(text, picId ?? ''))
            .catch((error: unknown) => `eval-failed: ${String(error)}`);
        const parsed = parseApiSubmit(raw);
        if (parsed.id === undefined) {
            return { ok: false, error: `weibo mobile api refused the post: ${parsed.detail}` };
        }
        return { ok: true, id: parsed.id };
    }

    /** Polls until the field shows the submitted text; a field the editor dropped is a refusal. */
    private async requireReadback(
        page: Page,
        selector: string,
        expected: string,
        label: string,
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        const wanted = excerpt(expected);
        return expectOutcome(
            async () => {
                const current = normalizeText(String(await page.evaluate(readbackScript(selector))));
                if (wanted.length === 0 || !current.includes(wanted)) return null;
                return current.slice(0, 60);
            },
            { timeoutMs: this.stepTimeoutMs, label: `weibo ${label}` },
        );
    }

    /** Baseline count of rendered images near the editor, for the fresh cover-attachment signal. */
    private async countImages(page: Page, selector: string): Promise<number> {
        const value = Number(await page.evaluate(coverCountScript(selector)));
        return Number.isFinite(value) ? value : 0;
    }

    /** Opt-in failure evidence for the DOM-fragile rails (`KK_WEIBO_DEBUG_DIR`); never on by default. */
    private async dumpDebug(page: Page, label: string): Promise<void> {
        const dir = process.env.KK_WEIBO_DEBUG_DIR;
        if (dir === undefined || dir.trim() === '') return;
        try {
            const fs = createNodeFileSystem();
            await fs.ensureDir(dir);
            const state = await page.evaluate(`(() => ({
                url: location.href,
                modals: document.querySelectorAll('.n-modal').length,
                coverEmpty: document.querySelectorAll('div.cover-empty, [class*="cover-empty"]').length,
                coverPreview: document.querySelectorAll('.cover-preview').length,
                coverImg: document.querySelectorAll('img.cover-img').length,
                previews: document.querySelectorAll('.n-image-preview-container').length,
                dialog: (document.querySelector('.n-modal')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 300),
                buttons: [...document.querySelectorAll('.n-modal button, section button')].slice(0, 30).map((b) => (b.textContent ?? '').trim()),
            }))()`);
            await fs.writeFile(`${dir}/${label}.json`, `${String(state)}\n`);
            await page.screenshot({ path: `${dir}/${label}.png` });
        } catch {
            // Diagnostics must never change the publication result.
        }
    }

    private async probeCoverAttached(page: Page, selector: string, baseline: number): Promise<string | null> {
        const count = await this.countImages(page, selector);
        if (count > baseline) return `cover-attached (${count} images)`;
        // The v5 editor routes a modal-picked cover into the publish-settings panel
        // (.cover-preview / img.cover-img) — outside the body scope, so the body count never moves.
        const preview = Number(
            await page.evaluate(
                `() => document.querySelectorAll('section:not(:has(.n-modal)) .cover-preview, .cover-preview, img.cover-img').length`,
            ),
        );
        return Number.isFinite(preview) && preview > 0 ? `cover-attached (cover-preview x${preview})` : null;
    }

    /** Visible toast texts before a save, so an already-visible toast cannot satisfy the draft rail. */
    private async readToasts(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(toastTextsScript()));
    }

    /**
     * Draft evidence: a toast that was not visible before the save, or a URL that left the editor
     * entry and carries a draft/article id. The editor URL alone is never success (R4).
     */
    private async probeDraft(page: Page, editorUrl: string, toastsBefore: readonly string[]): Promise<string | null> {
        return (await this.probeFreshToast(page, toastsBefore)) ?? probeDraftUrl(page.url(), editorUrl);
    }

    /**
     * One bounded line of what the page shows after a failed send (R5): the composer's length change,
     * the first visible dialog/modal/verification text, and any fresh toast. Never page HTML.
     */
    private async postDiagnostics(
        page: Page,
        composerSelector: string,
        text: string,
        toastsBefore: readonly string[],
    ): Promise<string> {
        const now = String(await page.evaluate(readbackScript(composerSelector))).length;
        const parts = [`composer ${[...text].length}->${now}`];
        const dialog = String(await page.evaluate(dialogTextScript())).trim();
        if (dialog.length > 0) parts.push(`dialog: ${dialog}`);
        const toast = (await this.readToasts(page)).find((entry) => !new Set(toastsBefore).has(entry));
        if (toast !== undefined) parts.push(`site said: ${toast}`);
        return parts.join('; ');
    }

    /** A toast or v5 draft-list item carrying a save/success/timestamp signal not on screen before the flow. */
    private async probeFreshToast(page: Page, toastsBefore: readonly string[]): Promise<string | null> {
        const before = new Set(toastsBefore);
        const now = await this.readToasts(page);
        const hit = now.find(
            (text) => !before.has(text) && /保存|草稿|成功|\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text),
        );
        if (hit === undefined) return null;
        return /#\/draft\/\d+/.test(page.url()) ? page.url() : hit;
    }

    /** Live article evidence: the browser left the editor for a published article URL. */
    private async probeArticleLive(page: Page): Promise<string | null> {
        return liveArticleUrl(page.url());
    }
}

/** Session failures whose one-liner must name the recovery command. */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

/** Parses a JSON string array from a page probe, tolerating anything else as "no snapshot". */
function parseStringArray(raw: unknown): readonly string[] {
    try {
        const parsed: unknown = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
}

/** Extracts a Weibo status/article/draft id from an observed URL, when it carries one. */
function statusIdFrom(url: string): string | undefined {
    const explicit = /(?:\/status\/|\/detail\/|\/show\?id=|draft_id=)([A-Za-z0-9]+)/.exec(url);
    if (explicit?.[1] !== undefined) return explicit[1];
    // The desktop status form is `weibo.com/<uid>/<status-key>`; the trailing segment is the id.
    return /^[^?#]*\/([A-Za-z0-9]{6,})(?:[?#]|$)/.exec(url)?.[1];
}

/**
 * A URL that proves a 头条文章 article went live: Weibo's `ttarticle` show page, or an article
 * detail URL. The editor entry URL never matches (R4).
 */
function liveArticleUrl(url: string): string | null {
    return /(?:\/ttarticle\/p\/show\?id=|\/article\/(?:show|detail)\/)[A-Za-z0-9]+/.test(url) ? url : null;
}

/**
 * Clicks the publish confirmation's own 发布/发表 (the v5 editor's 下一步 opens it). Returns
 * `'clicked'` or `'none'`; a JS click is used because the dialog's overlay intercepts pointer
 * events (measured 2026-11-12).
 */
function confirmPublishScript(): string {
    return `(() => { // kk-weibo-confirm-publish
    const buttons = [...document.querySelectorAll('.n-modal button, .n-dialog button, [role="dialog"] button')];
    const btn = buttons.find((b) => /^(发布|发表)$/.test((b.textContent ?? '').trim()) && !b.disabled);
    if (!btn) return 'none';
    btn.click();
    return 'clicked';
})()`;
}

/**
 * The page-context submit: same form-encoded request the mobile web app issues, with the page's own
 * `st` token and session cookies. Returns a JSON string so the caller parses a bounded payload.
 */
function apiSubmitScript(text: string, picId: string): string {
    return `(async () => { // kk-weibo-submit
    const cfg = (window.config || {});
    const form = new URLSearchParams({ content: ${JSON.stringify(text)}, st: String(cfg.st || '') });
    ${picId === '' ? '' : `form.set('pic_id', ${JSON.stringify(picId)});`}
    let response;
    try {
        response = await fetch('https://m.weibo.cn/api/statuses/update', {
            method: 'POST',
            credentials: 'include',
            // The app's own XHR carries these two; m.weibo.cn's write endpoint distinguishes a
            // page-originated request from a bare one (measured 2026-10-12).
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'X-Requested-With': 'XMLHttpRequest',
                Referer: 'https://m.weibo.cn/compose/',
            },
            body: form.toString(),
        });
    } catch (error) {
        return JSON.stringify({ status: 0, detail: 'no HTTP response was received: ' + String(error).slice(0, 80) });
    }
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    const data = (body && body.data) || {};
    const id = String(data.id ?? data.idstr ?? '');
    const detail = id !== '' ? '' : JSON.stringify(body ?? {}).replace(/s+/g, ' ').slice(0, 160);
    return JSON.stringify({ status: response.status, id: id, detail: detail });
})()`;
}

/** Parses the page-context submit result into an id or a bounded failure detail. */
/**
 * Parses the page-context submit result into an id or a bounded failure detail. When the site's own
 * refusal payload is present it is rendered as `HTTP <status> errno <code>: <msg> (<action>: <url>)`
 * — measured 2026-10-12: a flagged account answers `errno 200001 账号异常` with an activation link,
 * which is the operator's next action and must not be hidden inside a raw JSON blob.
 */
function parseApiSubmit(raw: unknown): { id?: string; detail: string } {
    try {
        const parsed = JSON.parse(String(raw)) as { status?: number; id?: string; detail?: string };
        if (typeof parsed.id === 'string' && parsed.id.length > 0) return { id: parsed.id, detail: '' };
        const status = parsed.status === undefined ? 'no status' : `HTTP ${parsed.status}`;
        if (parsed.detail === undefined || parsed.detail.length === 0) return { detail: status };
        const site = parseSiteRefusal(parsed.detail);
        return { detail: site === undefined ? `${status}: ${parsed.detail}` : `${status} ${site}` };
    } catch {
        return { detail: String(raw).slice(0, 160) };
    }
}

/** Renders Weibo's own refusal payload (`errno`/`msg`/activation link) as one bounded phrase. */
function parseSiteRefusal(detail: string): string | undefined {
    try {
        const body = JSON.parse(detail) as {
            errno?: unknown;
            msg?: unknown;
            title?: unknown;
            btn?: { text?: unknown; url?: unknown };
        };
        const msg = typeof body.msg === 'string' ? body.msg.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const errno = body.errno === undefined ? '' : `errno ${String(body.errno)}`;
        const action = typeof body.btn?.url === 'string' ? ` (${String(body.btn.text ?? 'fix')}: ${body.btn.url})` : '';
        const text = msg.length > 0 ? msg : title;
        if (text.length === 0) return undefined;
        return `${errno.length > 0 ? `${errno}: ` : ''}${text}${action}`;
    } catch {
        return undefined;
    }
}

/** The uploaded image's id, if the composer exposes one; '' means "not readable" (fail closed). */
function picIdScript(): string {
    return `(() => { // kk-weibo-picid
    const cfg = (window.config || {});
    const candidates = [cfg.pic_id, cfg.picId, (window.$render_data || {}).pic_id];
    for (const value of candidates) {
        if (typeof value === 'string' && value.length > 0) return value;
    }
    const img = document.querySelector('img[src*="sinaimg"]');
    return img === null ? '' : '';
})()`;
}

/** The first visible dialog/modal/verification text on the page, bounded; '' when none. */
function dialogTextScript(): string {
    return `(() => { // kk-weibo-dialog
    const nodes = document.querySelectorAll('[role="dialog"], [class*="dialog" i], [class*="modal" i], [class*="verify" i], [class*="captcha" i]');
    for (const node of nodes) {
        const text = (node.textContent || '').replace(/s+/g, ' ').trim();
        if (text.length > 0) return text.slice(0, 120);
    }
    return '';
})()`;
}

/** A draft URL: left the editor entry and carries a draft/article id. */
function probeDraftUrl(url: string, editorUrl: string): string | null {
    if (url === editorUrl) return null;
    return /(?:draft|article|editor)[^\d]*(\d{4,})/.test(url) ? url : null;
}

/** Reads `value` first (inputs) then `textContent` (contenteditable), trimmed. */
function readbackScript(selector: string): string {
    return `(() => { // kk-weibo-readback
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return '';
    const value = el.value !== undefined && el.value !== null ? el.value : el.textContent;
    return (value === undefined || value === null ? '' : String(value)).trim();
})()`;
}

/** Counts rendered images in the editor's nearest container (excluding modal portals), for the cover baseline. */
function coverCountScript(selector: string): string {
    return `(() => { // kk-weibo-cover
    const anchor = document.querySelector(${JSON.stringify(selector)});
    const scope = anchor === null ? document.body : anchor.closest('form, section, article, main') || document.body;
    return String(Array.from(scope.querySelectorAll('img[src]')).filter((el) => !el.closest('.n-modal')).length);
})()`;
}

/** Ensures the v5 article editor has an active, blank draft pane before filling title/body. */
function ensureArticleDraftScript(): string {
    return `(async () => { // kk-weibo-draft-init
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const spin = () => document.querySelectorAll('.wb-editor-spin').length > 0;
    const titleEl = () => document.querySelector('input[placeholder*="标题"], textarea[placeholder*="标题"]');
    const titleVal = () => (titleEl() && titleEl().value ? String(titleEl().value).trim() : '');
    const hasCover = () => document.querySelectorAll('.cover-preview, img.cover-img').length > 0;
    const isBlank = () => titleVal().length === 0 && !hasCover();
    if (spin() || !isBlank()) {
        let clicked = false;
        for (const btn of document.querySelectorAll('button')) {
            const t = (btn.textContent || '').trim();
            if (t === '写文章' || t.includes('创作一篇新文章')) {
                btn.click();
                clicked = true;
                break;
            }
        }
        if (!clicked) return false;
        await sleep(600);
        for (let i = 0; i < 15 && spin(); i += 1) await sleep(200);
        // The editor auto-restores the last draft (often one a failed run left with a cover). Wait
        // for the blank pane, and report the failure instead of filling the old draft: a cover the
        // restored draft already carries would satisfy the attachment probe on the WRONG image.
        for (let i = 0; i < 40 && !isBlank(); i += 1) await sleep(250);
        if (!isBlank()) return false;
    }
    return true;
})()`;
}

/** Opens the v5 cover modal (`div.cover-empty`) and switches to the `图片库` tab so `input[type="file"]` mounts. */
function openCoverLibraryScript(): string {
    return `(async () => { // kk-weibo-open-cover
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let coverEmpty = null;
    for (let i = 0; i < 15; i += 1) {
        coverEmpty = document.querySelector('div.cover-empty, [class*="cover-empty"]');
        if (coverEmpty) break;
        await sleep(200);
    }
    if (coverEmpty instanceof HTMLElement) coverEmpty.click();
    for (let i = 0; i < 15 && !document.querySelector('.n-modal'); i += 1) await sleep(200);
    for (const tab of document.querySelectorAll('.n-modal .n-tabs-tab')) {
        if ((tab.textContent || '').trim() === '图片库' && tab instanceof HTMLElement) {
            tab.click();
        }
    }
    for (let i = 0; i < 30 && !document.querySelector('input[type="file"]'); i += 1) await sleep(200);
    // The 图片库 tab lazy-loads (upload button + items mount ~5-8s after the tab click; the fixed
    // 3s window could race it, and a raced tab leaves fileInputs=0 → no cover attachment).
    for (let i = 0; i < 40; i += 1) {
        if (document.querySelector('.n-modal img, .n-modal input[type="file"]')) break;
        await sleep(250);
    }
    return true;
})()`;
}

/** Selects the uploaded image in the v5 `.n-modal` library, advances through crop (`下一步` → `确定`), and waits for the modal to close. */
function confirmCoverModalScript(): string {
    return `(async () => { // kk-weibo-confirm-cover
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!document.querySelector('.n-modal')) return true;
    await sleep(1500);
    // Pick the LAST library image: the 图片库 grid lists newest uploads last, and the first
    // <img> in the dialog is the 手机传图 QR art, not a selectable item (2026-11-12: clicking it left
    // 下一步 with nothing selected, so the cover never attached).
    let item = null;
    for (let i = 0; i < 25; i += 1) {
        const items = Array.from(document.querySelectorAll('.n-modal .image-item'));
        const imgs = Array.from(document.querySelectorAll('.n-modal img[src]')).filter(
            (img) => !img.closest('[class*="qrcode"], [class*="mobile"], [class*="upload"]'),
        );
        item = items.at(-1) ?? imgs.at(-1) ?? null;
        if (item) break;
        await sleep(200);
    }
    if (item instanceof HTMLElement && !item.classList.contains('is-selected')) {
        item.click();
        await sleep(800);
    }
    for (let i = 0; i < 15; i += 1) {
        const nextBtn = Array.from(document.querySelectorAll('.n-modal button')).find(
            (b) => (b.textContent || '').trim() === '下一步' && !b.disabled,
        );
        if (nextBtn) {
            nextBtn.click();
            break;
        }
        await sleep(200);
    }
    // The 下一步 opens the 图片裁剪 crop modal (上一步/确定), which takes several seconds to
    // render — poll for it before clicking, then wait for the whole modal chain to close.
    for (let i = 0; i < 40 && !Array.from(document.querySelectorAll('.n-modal button')).find((b) => (b.textContent || '').trim() === '确定'); i += 1) {
        await sleep(250);
    }
    for (let i = 0; i < 15; i += 1) {
        const okBtn = Array.from(document.querySelectorAll('.n-modal button')).find(
            (b) => (b.textContent || '').trim() === '确定' && !b.disabled,
        );
        if (okBtn) {
            okBtn.click();
            break;
        }
        await sleep(200);
    }
    for (let i = 0; i < 25 && document.querySelector('.n-modal'); i += 1) {
        await sleep(200);
    }
    return true;
})()`;
}

/** Visible toast texts and v5 draft sidebar items, used as the pre-save baseline and as the fresh-signal read. */
function toastTextsScript(): string {
    return `(() => { // kk-weibo-toasts
    const nodes = document.querySelectorAll('[class*="toast" i], [class*="Toast"], [class*="message" i], [role="alert"], .list-item');
    const texts = [];
    for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text.length > 0) texts.push(text);
    }
    return JSON.stringify(texts);
})()`;
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * Weibo browser transport (R9).
 * @param operation - Resolved operation (`post` or `article`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: WeiboOperation = 'post',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new WeiboBrowserTransport(operation, driver);
}

/** Writes the Result to `--out`, creating its directory when the caller named a nested path. */
async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

/**
 * The plugin's `--in/--out` contract: validate the Content, resolve **and refuse** the operation and
 * the driver before any transport exists, then publish through the injected or configured transport.
 * @param inputPath - Path to the Content JSON.
 * @param outputPath - Path the Result JSON is written to, on success and on refusal.
 * @param transport - Optional transport injection for tests and offline runs.
 */
export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport?: PublishTransport,
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    let content: Content;
    let options: Record<string, unknown> | undefined;
    try {
        const raw = JSON.parse(await createNodeFileSystem().readFile(inputPath)) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
        if (raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null) {
            options = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = boundedDetail(`Invalid Content input: ${errorMessage(error)}`);
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(mode.error));
        throw new Error(mode.error);
    }
    const driverMode = resolveDriver(options);
    if (driverMode.error !== undefined) {
        await writePublishResult(outputPath, fail(driverMode.error));
        throw new Error(driverMode.error);
    }
    const resolved = transport ?? getPublishTransport(mode.operation, driverMode.driver);
    const result = ResultSchema.parse(await resolved.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

/**
 * CLI entry point: `--in <content.json> --out <result.json>`.
 * @returns Process exit code (0 published, 1 refused or invalid arguments).
 */
export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${errorMessage(error)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }
    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`weibo-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
