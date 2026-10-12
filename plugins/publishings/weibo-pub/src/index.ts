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
    /**
     * Feed cards on the mobile feed are `a[href*="/detail/"]` / `a[href*="/status/"]`; the desktop
     * shape (`a._time_*` → `weibo.com/<uid>/<mblogid>`) is kept as a fallback. A post is usually
     * observed through the composer page's own navigation first (see `mobileStatusUrl`).
     */
    feedCard: ['a[href*="/detail/"]', 'a[href*="/status/"]', 'a[class*="_time_"]'],
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
    publish: ['button:has-text("发布")', 'button:has-text("发表")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
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

/** Body excerpt length compared on readback and on the fresh-post signal. */
const EXCERPT_CHARS = 30;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error: boundedDetail(error) });
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
    return normalizeText(text).slice(0, EXCERPT_CHARS);
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
 * Resolves and validates the optional cover: `options.coverPath` wins over
 * `metadata.coverImage`, and a given cover must be an absolute path to an existing
 * `.png|.jpg|.jpeg|.webp` file — a bad cover is refused before any browser opens (R2).
 */
async function resolveCover(
    options: Record<string, unknown> | undefined,
    content: Content,
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
    const ext = extname(raw).toLowerCase();
    if (!POST_IMAGE_EXTS.has(ext)) {
        return {
            error: `image must be one of .png, .jpg, .jpeg, .webp, .gif, .bmp (Weibo's accepted set), got '${raw}'`,
        };
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
    /** One bounded post-flow refresh while waiting for the new card to render. */
    private reloadedForPost = false;

    constructor(
        operation: WeiboOperation = 'post',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
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
            return fail(
                `unsupported operation '${bounded(this.operation)}' for weibo: expected one of ${WEIBO_OPERATIONS.join(', ')}`,
            );
        }
        if (this.driver !== 'script') {
            return fail(
                `unsupported driver '${bounded(this.driver)}' for weibo: expected one of script (the weibo-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(`unknown publishStatus '${bounded(requested)}' (expected absent, 'draft' or 'public')`);
        }
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        if (this.operation === 'post' && publishStatus !== 'public') {
            return fail('weibo post has no draft; set publishStatus: public');
        }
        const text = payload.content.body.trim() || payload.content.title?.trim() || '';
        if (this.operation === 'post' && text.length === 0) {
            return fail('weibo post requires Content.body or Content.title');
        }
        const cover = await resolveCover(payload.options, payload.content);
        if (cover !== undefined && 'error' in cover) return fail(cover.error);
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
            return fail(`${TARGET} session preflight refused — run: ${LOGIN_INSTRUCTION} — detail: ${session.detail}`);
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
            const fileInputSelector = await resolveSelector(page, WEIBO_ARTICLE_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'article cover file input',
            });
            const baseline = await this.countImages(page, bodySelector);
            await uploadFile(page, fileInputSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
            // A requested cover needs a fresh observed attachment, not a successful upload call.
            const attached = await expectOutcome(() => this.probeCoverAttached(page, bodySelector, baseline), {
                timeoutMs: this.stepTimeoutMs,
                label: 'weibo article cover attachment',
            });
            if (!attached.ok) return fail(attached.error);
        }

        // Read the composer back before the save/publish control: a field the editor dropped must
        // never become a saved draft or a live article (R4).
        const titleReadback = await this.requireReadback(page, titleSelector, title, 'article title readback');
        if (!titleReadback.ok) return fail(titleReadback.error);
        const bodyReadback = await this.requireReadback(page, bodySelector, content.body, 'article body readback');
        if (!bodyReadback.ok) return fail(bodyReadback.error);

        const editorUrl = page.url();
        const toastsBefore = await this.readToasts(page);

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
        const live = await expectOutcome(() => this.probeArticleLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `weibo article publish '${publishSelector}'`,
        });
        if (!live.ok) return fail(live.error);
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
     * The home-composer flow: fill → readback → `发送`, then require a **new** feed card whose text
     * carries the submitted excerpt. Only reached for `publishStatus: public` (R3, R4).
     */
    private async runPostFlow(page: Page, text: string, profileDir: string, coverPath?: string): Promise<Result> {
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
        }

        // Snapshot the feed and the toasts before the send: an existing card is never this run's
        // outcome (R4), and a fresh toast is the site's own reason when the send is rejected
        // (measured 2026-10-12: a rejected send produced no card and no captured reason).
        const existingCards = await this.readFeedCards(page);
        const toastsBefore = await this.readToasts(page);
        const sendSelector = await resolveSelector(page, WEIBO_POST_SELECTORS.send, {
            timeoutMs: this.stepTimeoutMs,
            label: 'post 发送 control',
        });
        await page.locator(sendSelector).first().click();
        const live = await expectOutcome(() => this.probePostLive(page, existingCards, text), {
            timeoutMs: this.stepTimeoutMs,
            label: `weibo post '${sendSelector}'`,
        });
        if (!live.ok) {
            // Diagnosis-first (R5, 0246): a silent send must leave its own explanation behind —
            // composer length before/after, any dialog/modal that appeared, any fresh toast — so the
            // next operator never has to re-run a write to learn why.
            return fail(`${live.error} [${await this.postDiagnostics(page, composerSelector, text, toastsBefore)}]`);
        }
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: statusIdFrom(live.evidence),
            url: live.evidence,
            message: `${TARGET} post published live in profile ${profileDir}`,
            metadata,
        });
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

    private async probeCoverAttached(page: Page, selector: string, baseline: number): Promise<string | null> {
        const count = await this.countImages(page, selector);
        return count > baseline ? `cover-attached (${count} images)` : null;
    }

    /** Visible toast texts before a save, so an already-visible toast cannot satisfy the draft rail. */
    private async readToasts(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(toastTextsScript()));
    }

    /** Feed-card hrefs before a send, so a pre-existing card cannot satisfy the post rail. */
    private async readFeedCards(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(feedCardHrefsScript()));
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

    /** A toast carrying a save/success word that was not already on screen before the click. */
    private async probeFreshToast(page: Page, toastsBefore: readonly string[]): Promise<string | null> {
        const before = new Set(toastsBefore);
        const now = await this.readToasts(page);
        return now.find((text) => !before.has(text) && /保存|草稿|成功/.test(text)) ?? null;
    }

    /** Live article evidence: the browser left the editor for a published article URL. */
    private async probeArticleLive(page: Page): Promise<string | null> {
        return liveArticleUrl(page.url());
    }

    /**
     * Post evidence: a feed-card href that appeared after the send and whose **card** carries the
     * excerpt. Measured 2026-10-12: the matched link's own text is the timestamp, so the excerpt is
     * read from the card container (see {@link cardTextScript}); if the live feed has not inserted
     * the new card yet, one bounded reload refreshes it.
     */
    private async probePostLive(page: Page, existingCards: readonly string[], text: string): Promise<string | null> {
        // The mobile composer navigates to the new status on success — that URL *is* the outcome.
        const landed = mobileStatusUrl(page.url());
        if (landed !== null) return landed;
        const before = new Set(existingCards);
        const wanted = excerpt(text);
        const fresh = (await this.readFeedCards(page)).filter((card) => !before.has(card));
        for (const card of fresh) {
            if (await this.cardCarries(page, card, wanted)) return card;
        }
        if (!this.reloadedForPost && fresh.length === 0) {
            // The composer sits at the top of the timeline, but Weibo may only render the new card
            // after a refresh. One reload per run keeps the probe bounded.
            this.reloadedForPost = true;
            await page.reload({ timeout: this.stepTimeoutMs }).catch(() => undefined);
        }
        return null;
    }

    /** True when the card's own text carries the submitted excerpt (whitespace-insensitive). */
    private async cardCarries(page: Page, href: string, wanted: string): Promise<boolean> {
        if (wanted.length === 0) return true;
        const text = normalizeText(String(await page.evaluate(cardTextScript(href))));
        return text.includes(wanted);
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
 * Mobile-status evidence: on `m.weibo.cn` a successful post lands on `/detail/<id>` or
 * `/status/<id>` — the URL itself carries the new status id, so it is the strongest signal the mobile
 * route can give. Measured 2026-10-12 (0246, `docs/design/weibo-ui-discovery.md` §2b).
 */
function mobileStatusUrl(url: string): string | null {
    return /m\.weibo\.cn\/(?:detail|status)\/[A-Za-z0-9]+/.test(url) ? url : null;
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

/** Counts rendered images in the editor's nearest container, for the cover baseline. */
function coverCountScript(selector: string): string {
    return `(() => { // kk-weibo-cover
    const anchor = document.querySelector(${JSON.stringify(selector)});
    const scope = anchor === null ? document.body : anchor.closest('form, section, article, main') || document.body;
    return String(scope.querySelectorAll('img[src]').length);
})()`;
}

/** Visible toast texts, used as the pre-save baseline and as the fresh-signal read. */
function toastTextsScript(): string {
    return `(() => { // kk-weibo-toasts
    const nodes = document.querySelectorAll('[class*="toast" i], [class*="Toast"], [class*="message" i], [role="alert"]');
    const texts = [];
    for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text.length > 0) texts.push(text);
    }
    return JSON.stringify(texts);
})()`;
}

/** Feed-card hrefs, used as the pre-send baseline and as the fresh-signal read. */
function feedCardHrefsScript(): string {
    return `(() => { // kk-weibo-feed
    const hrefs = [];
    for (const link of document.querySelectorAll(${JSON.stringify(WEIBO_POST_SELECTORS.feedCard.join(', '))})) {
        if (link.href) hrefs.push(link.href);
    }
    return JSON.stringify(hrefs);
})()`;
}

/**
 * The card's own **container** text, for the submitted-excerpt comparison. Measured 2026-10-12: the
 * card link itself is the timestamp anchor (`a._time_*`, text "3小时前"), so the excerpt lives in the
 * nearest ancestor that holds the card.
 */
function cardTextScript(href: string): string {
    return `(() => { // kk-weibo-card-text
    for (const link of document.querySelectorAll(${JSON.stringify(WEIBO_POST_SELECTORS.feedCard.join(', '))})) {
        if (link.href !== ${JSON.stringify(href)}) continue;
        const card = link.closest('article, [class*="card"], [class*="Card"], div[class*="Feed"]') || link.parentElement;
        const scope = card === null ? link : card;
        return (scope.textContent || '').trim();
    }
    return '';
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
