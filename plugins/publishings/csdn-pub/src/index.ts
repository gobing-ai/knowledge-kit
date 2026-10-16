/**
 * csdn-pub — CSDN (blog.csdn.net / mp.csdn.net) Markdown-article publisher (task 0292).
 *
 * The live editor flow in `runArticleFlow`: a read-only capability probe, native title/body fill
 * with strict readback, then the status branch — public runs open the publish modal for tag/category
 * exact commits, cover upload and a scoped public submit confirmed only by a fresh persisted receipt;
 * draft runs (publishStatus absent or 'draft', the frozen default) enter that modal only to commit the
 * requested fields and then choose only the top-level 保存草稿 action (`DRAFT_SAVE_SELECTORS`),
 * confirmed only by a fresh draft id — never the vendor's status-blind signed saveArticle API
 * (csdn.js:183-248).
 *
 * Evidence: the recovered extension adapter
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/csdn.js` is an
 * **API** adapter (saveArticle, csdn.js:183-248) — it pins the field semantics cited below but
 * contains **no DOM selectors** and its vendor signing credentials, OBS protocol and fixed
 * 经验分享 tag (csdn.js:32-41, 206) are deliberately NOT ported. DOM evidence is the current
 * public editor bundle (https://editor.csdn.net/md/ → app.chunk.3e8e17a6.js, observed 2026-10-14,
 * task 0292 Design); selectors the bundle evidence does not pin are marked **Provisional** and
 * fail loud when absent.
 *
 * publishStatus contract (task 0292 review fix): absent defaults to 'draft', 'draft' saves a draft
 * through the top-level 保存草稿 control, 'public' publishes live; any other value refuses before
 * any browser opens. The API adapter's save and publish are one status-blind call (csdn.js:13-14),
 * so the browser receipt — never the API — is the only confirmation on either leg.
 */
import { dirname, extname } from 'node:path';
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

/** Site-owned target slug; also the profile channel key (`CSDN_PROFILE_DIR`). */
const TARGET = 'csdn';
/** Home entry. Grounded: csdn.js:1 header — 「CSDN（blog.csdn.net / mp.csdn.net）文章发布适配器」. */
export const CSDN_HOME_URL = 'https://blog.csdn.net';
/**
 * Markdown editor entry. Grounded: the task 0292 Design fetched it 2026-10-14
 * (https://editor.csdn.net/md/ → app.chunk.3e8e17a6.js); the article flow composes here, not on
 * the blog home. The headless session check also uses this page so the readiness predicate below
 * observes one strong site-owned gate (the grounded title input), the weibo-pub multi-surface
 * pattern narrowed to the one surface this channel composes on.
 */
export const CSDN_EDITOR_URL = 'https://editor.csdn.net/md/';
/**
 * Login/passport redirect marker. **Provisional**: csdn.js runs inside an already-authenticated
 * tab and never observes a redirect URL; passport.csdn.net is CSDN's known SSO host. The editor
 * readiness predicate below carries the real gate.
 */
export const CSDN_LOGIN_URL_RE = /(passport\.csdn\.net|\/login)/;

/** Declared operations (ADR-029 dispatch): the source handles article only (csdn.js:249). */
export const CSDN_OPERATIONS = ['article'] as const;
export type CsdnOperation = (typeof CSDN_OPERATIONS)[number];

/**
 * Article-editor selectors, ordered fallbacks. Field semantics are grounded on csdn.js (cited per
 * key); CSS values are the 2026-10-14 editor-bundle observations from the task 0292 Design, with
 * anything that evidence does not pin marked **Provisional** — a missing control is a loud typed
 * refusal, never a silent no-op.
 */
export const CSDN_ARTICLE_SELECTORS = {
    /**
     * Editor-page readiness scope. **Provisional**: BEM parent `.article-bar` of the grounded
     * title classes below; the flow activates `titleDisplay` first (task 0292 Design) before the
     * title input is editable.
     */
    composer: ['.article-bar', '.editor__wrapper'],
    /**
     * Title-display activator. **Grounded** (2026-10-14 editor bundle, task 0292 Design): the
     * title input is not editable until this display is clicked.
     */
    titleDisplay: ['.article-bar__title-display'],
    /**
     * Title input. **Grounded** (2026-10-14 editor bundle, task 0292 Design). Title is the
     * article's primary field (vendor bounded it to 100 chars, csdn.js:202).
     */
    titleInput: ['input.article-bar__title--input[placeholder*="文章标题"]'],
    /**
     * Markdown body editor. **Grounded** (2026-10-14 editor bundle, task 0292 Design): a
     * cledit-managed `pre`, not CodeMirror — Chunk B must use real keyboard/paste events, not
     * DOM innerHTML assignment. Body is its own saved field (csdn.js:204-205).
     */
    bodyEditor: ['pre.editor__inner.markdown-highlighting'],
    /**
     * Publish-modal tag input, scoped to the modal. **Provisional** inner node: the bundle
     * evidence pins the modal scope and the 文章标签 label but not the input itself. Tags must be
     * committed as the requested exact names — the vendor's fixed 经验分享 tag (csdn.js:206, 257)
     * is never substituted.
     */
    tagInput: [
        '.modal__publish-article input[placeholder*="标签"]',
        '.modal__publish-article :text("文章标签") ~ input',
    ],
    /**
     * Publish-modal category control, scoped to the modal. **Provisional** inner node (same
     * grounding as `tagInput`). Categories must be exact-match choices — the vendor silently sent
     * empty categories (csdn.js:207), which is precisely the silent fallback this channel refuses.
     */
    categoryControl: [
        '.modal__publish-article input[placeholder*="分类"]',
        '.modal__publish-article :text("分类专栏") ~ input',
    ],
    /**
     * The modal's final public submit. **Provisional** exact node: the bundle evidence places the
     * final public submit inside the 发布文章 modal (never its draft-labeled actions) but does not
     * pin the button. Success needs a fresh published receipt — the API returns success without an
     * observable final status (csdn.js:13-18), so the UI receipt is the only evidence.
     */
    publishButton: ['.modal__publish-article button:has-text("发布")'],
    /**
     * The publish-modal entry in the editor chrome. **Provisional** exact node: the bundle
     * evidence pins the 发布文章 modal itself (`.modal__publish-article`, task 0292 Design) but not
     * the button that opens it; absent entry is a loud refusal, never a modal guess.
     */
    publishOpen: ['button:has-text("发布文章")'],
    /**
     * Cover file input, scoped to the publish modal. **Provisional** node: the bundle evidence
     * pins the 封面 label inside `.modal__publish-article` (task 0292 Design) but not the input.
     * The vendor's OBS direct-upload protocol and signing keys (csdn.js:32-41) are never used
     * here — an absent input is a typed refusal, not a clipboard or API bridge.
     */
    coverInput: ['.modal__publish-article input[type="file"]'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const CSDN_LOGIN_INSTRUCTION = 'bun plugins/publishings/csdn-pub/src/profile-check.ts login';
/**
 * Category cap: the observed CSDN publish-modal UI allows at most three 分类专栏 (2026-10-14
 * editor bundle, task 0292 Design); excess is refused, not sliced.
 */
const MAX_CATEGORIES = 3;
/** Cover extensions (frozen payload rules: an existing local PNG/JPEG/WebP file; single slot per csdn.js:223). */
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
/**
 * Persisted article-receipt URL shapes. `mp_blog/creation/editor/<id>` is grounded — the
 * extension's own post-save redirect target carrying the persisted article id (csdn.js:340);
 * `/article/details/<id>` is the public article page shape, **Provisional** (the API adapter
 * never visits the public page). Only shapes in this list count as receipts.
 */
const RECEIPT_URL_RES = [/mp\.csdn\.net\/mp_blog\/creation\/editor\/\d+/, /\/article\/details\/\d+/];
/**
 * Persisted draft-receipt URL shapes (draft leg only): the public receipt shapes plus the editor
 * URL gaining an `articleId` param (the frozen draft save's fresh id gain, task 0292 Design). Only
 * an id-bearing URL confirms a draft save — a toast-only or otherwise idless state never does.
 */
const DRAFT_RECEIPT_URL_RES = [/editor\.csdn\.net\/md\/\?[^\s]*articleId=\d+/, ...RECEIPT_URL_RES];
/**
 * The draft save control (frozen task 0292 Design): the editor's top-level
 * `button.button-save[data-title="保存草稿"]`. A draft run activates only this draft-labeled
 * action — after modal field prep it still never clicks the modal's final public submit — and the
 * vendor's signed status-blind saveArticle API (csdn.js:183-248) is never called.
 */
export const DRAFT_SAVE_SELECTORS: readonly string[] = ['button.button-save[data-title="保存草稿"]'];
/** Success toast words. **Provisional**: csdn.js is an API adapter and never reads a site toast; the words mirror its success vocabulary (csdn.js:242, 339). */
const SUCCESS_TOAST_RE = /发布成功|文章保存成功/;
/** Failure toast words. **Provisional**, same grounding (csdn.js:245); a fresh failure toast fails fast. */
const FAILURE_TOAST_RE = /发布失败|文章保存失败|上传失败/;
/** Toast containers. **Provisional** (csdn.js never reads one); jike-pub's probe shape. */
const TOAST_CONTAINERS = '[role="alert"], [role="status"], [class*="toast" i], [class*="message" i]';

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error: boundedDetail(error) });
}

/** A browser-stage failure: `ok: false` with `stage` (and optional evidence) in the Result metadata. */
function stageFail(error: string, stage: string, metadata: Record<string, unknown>, evidence?: string): Result {
    return ResultSchema.parse({
        ok: false,
        target: TARGET,
        error: boundedDetail(error),
        metadata: { ...metadata, stage, ...(evidence === undefined ? {} : { evidence: boundedDetail(evidence) }) },
    });
}

/** One short line, bounded: no DOM dump, cookie, token or stack ever reaches the Result. */
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

/**
 * Resolves the requested operation. An undeclared value is refused by name, before any transport —
 * and therefore before any browser — is resolved (the source handles article only, csdn.js:249-255).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: CsdnOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'article';
    if (typeof raw !== 'string' || !(CSDN_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for csdn: expected one of ${CSDN_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as CsdnOperation };
}

/**
 * Resolves the driver from `options.driver ?? 'script'`. This channel ships one driver and no
 * `agent` path, so anything else — including a wrong type — is refused by name before a transport
 * is built.
 * @param options - Per-call publish options (`driver`).
 * @returns The resolved driver, or the refusal message.
 */
function resolveDriver(
    options?: Record<string, unknown>,
): { driver: BrowserDriver; error?: undefined } | { driver?: undefined; error: string } {
    const raw = options?.driver ?? 'script';
    if (raw !== 'script') {
        return {
            error: `unsupported driver '${bounded(raw)}' for csdn: expected one of script (the csdn-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Shape-check for optional exact-name lists (`metadata.tags` / `metadata.categories`): an array of
 * non-empty names, refused — never sliced or guessed — when wrong-typed, empty-entry-ed, or (for
 * categories) over the observed modal cap. Exact chip matching against the publish modal happens
 * in the Chunk B flow; this gate only keeps wrong shapes from reaching a browser.
 */
function resolveNameList(
    field: 'tags' | 'categories',
    raw: unknown,
    max?: number,
): { names: string[] } | { error: string } {
    if (raw === undefined) return { names: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.${field} must be an array of non-empty exact names, got '${bounded(raw)}'` };
    }
    if (max !== undefined && raw.length > max) {
        return {
            error: `metadata.${field} requests ${raw.length} entries, over the observed CSDN publish-modal limit of ${max}; refusing rather than truncating`,
        };
    }
    const names: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.${field} entries must be non-empty exact names, got '${bounded(entry)}'` };
        }
        names.push(entry.trim());
    }
    return { names };
}

/**
 * Resolves the optional cover (`options.coverPath ?? metadata.coverPath`) without uploading:
 * Chunk A validates the payload — a non-empty local PNG/JPEG/WebP path (frozen payload rules;
 * the vendor model has a single cover slot, csdn.js:223) — and Chunk B performs the upload at the
 * named seam. No size cap is asserted: no dated primary source states one for this channel.
 */
async function resolveCover(
    options?: Record<string, unknown>,
    content?: Content,
): Promise<{ path?: string; error?: string }> {
    const raw = options?.coverPath ?? content?.metadata?.coverPath;
    if (raw === undefined) return {};
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `metadata.coverPath must be a non-empty local image path, got '${bounded(raw)}'` };
    }
    const path = raw.trim();
    if (!COVER_EXTS.has(extname(path).toLowerCase())) {
        return {
            error: `metadata.coverPath must be one of ${[...COVER_EXTS].join(', ')} (PNG/JPEG/WebP), got '${path}'`,
        };
    }
    if (!(await createNodeFileSystem().exists(path))) {
        return { error: `metadata.coverPath file does not exist: '${path}'` };
    }
    return { path };
}

/**
 * Csdn-owned readiness predicate: no login redirect and the site-owned Markdown editor reachable
 * (the grounded title input). Shared by the publish preflight and the operator profile CLI, so
 * both apply one gate. The login-redirect regex is provisional (see `CSDN_LOGIN_URL_RE`); the
 * title-input probe carries the real gate.
 */
export const isCsdnAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (CSDN_LOGIN_URL_RE.test(page.url())) return false;
    return (await trySelectors(page, CSDN_ARTICLE_SELECTORS.titleInput, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The check opens the
 * editor entry (see `CSDN_EDITOR_URL`). The publish preflight never forwards `checkHeadedOnly`:
 * it is the operator CLI's setting, and a refusal must never escalate to a headed window on its own.
 */
export const CSDN_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: CSDN_EDITOR_URL,
    isAuthenticated: isCsdnAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};

/**
 * CSDN browser transport on the shared rails (ADR-027): a headless session preflight, one headed
 * flow, and success only from an observed persisted receipt. publishStatus absent or 'draft' takes
 * the draft leg (top-level 保存草稿, `DRAFT_SAVE_SELECTORS`); 'public' publishes live; any other
 * value refuses before the browser.
 */
export class CsdnBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: CsdnOperation;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: CsdnOperation = 'article',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a live CSDN Markdown article.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed site receipt.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // Refusal order (all pre-browser): driver → publishStatus → title → body → tags →
        // categories → cover → session preflight. (The operation is resolved and refused in
        // `resolveOperation` before any transport exists.)
        if (this.driver !== 'script') {
            return fail(
                `unsupported driver '${bounded(this.driver)}' for csdn: expected one of script (the csdn-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(
                `unknown publishStatus '${bounded(requested)}' for csdn: expected 'public', 'draft' or absent (absent defaults to draft)`,
            );
        }
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                'csdn article requires a non-empty Content.title (the Markdown editor has an independent title field)',
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                'csdn article requires non-empty Content.body Markdown (the article body is its own saved field, csdn.js:204-205)',
            );
        }
        const tags = resolveNameList('tags', payload.options?.tags ?? payload.content.metadata?.tags);
        if ('error' in tags) return fail(tags.error);
        const categories = resolveNameList(
            'categories',
            payload.options?.categories ?? payload.content.metadata?.categories,
            MAX_CATEGORIES,
        );
        if ('error' in categories) return fail(categories.error);
        const cover = await resolveCover(payload.options, payload.content);
        if (cover.error !== undefined) return fail(cover.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(CSDN_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                `${TARGET} session preflight refused — run: ${CSDN_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: CSDN_EDITOR_URL,
                    isAuthenticated: isCsdnAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runArticleFlow(
                        page,
                        title,
                        tags.names,
                        categories.names,
                        cover.path,
                        body,
                        profileDir,
                        publishStatus,
                    ),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                needsLogin(error)
                    ? `${TARGET} session failed — run: ${CSDN_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The live article flow on the already-navigated editor page (`CSDN_EDITOR_URL`): read-only
     * capability probe → title/body fill with strict readback → status branch. Public runs:
     * publish-modal tag/category exact commits, cover upload, baselines, scoped public submit,
     * fresh persisted receipt. Draft runs (absent or 'draft' publishStatus) enter the modal only
     * to commit requested fields, then activate only the top-level 保存草稿 action and confirm a
     * fresh draft id — the modal's final public submit is never clicked and the vendor's
     * status-blind signed saveArticle API (csdn.js:183-248) is never called.
     */
    private async runArticleFlow(
        page: Page,
        title: string,
        tags: readonly string[],
        categories: readonly string[],
        coverPath: string | undefined,
        body: string,
        profileDir: string,
        publishStatus: 'draft' | 'public',
    ): Promise<Result> {
        const metadata = { operation: this.operation, driver: this.driver, publishStatus, profileDir };

        // Read-only capability probe: visibility only — nothing is typed, uploaded or submitted,
        // so a refusal here can never leave a half-filled form behind. The grounded pair must be
        // visible (else the page is wrong or logged out); provisional controls are only recorded,
        // since the publish modal is closed at probe time by design.
        let probe: EditorProbe;
        try {
            probe = await this.probeEditor(page);
        } catch (error) {
            return stageFail(
                `csdn editor controls not found on ${CSDN_EDITOR_URL} — run: ${CSDN_LOGIN_INSTRUCTION} — detail: ${errorMessage(error)}`,
                'editor-readiness',
                metadata,
            );
        }
        if (!probe.grounded.titleInput || !probe.grounded.bodyEditor) {
            return stageFail(
                `csdn grounded editor controls found but not visible on ${CSDN_EDITOR_URL} — run: ${CSDN_LOGIN_INSTRUCTION}`,
                'editor-readiness',
                metadata,
                `grounded visible: ${JSON.stringify(probe.grounded)}; provisional visible: ${JSON.stringify(probe.provisional)}`,
            );
        }
        const flowMetadata = { ...metadata, probe };

        // Title: activate the display first (task 0292 Design — the title input is not editable
        // until clicked), native fill, then strict readback of the input's value property; the
        // title is the article's primary field, vendor-bounded to 100 chars (csdn.js:202).
        try {
            const displaySelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.titleDisplay, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn title display',
            });
            await page.locator(displaySelector).first().click();
            const titleSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.titleInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn title input',
            });
            await page.locator(titleSelector).first().fill(title);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(inputValueScript(titleSelector)))) === normalizeText(title)
                        ? 'title read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'csdn title readback' },
            );
            if (!readback.ok)
                return stageFail(
                    `csdn title readback failed — the editor did not retain the requested title — ${readback.error}`,
                    'title-readback',
                    flowMetadata,
                );
        } catch (error) {
            return stageFail(`csdn title fill failed — ${errorMessage(error)}`, 'title-readback', flowMetadata);
        }

        // Body: Playwright fill() dispatches real input events on the cledit-managed pre (task
        // 0292 Design forbids innerHTML assignment); the body is its own saved field
        // (csdn.js:204-205), so a dropped body must refuse before anything is submitted.
        try {
            const bodySelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.bodyEditor, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn Markdown body editor',
            });
            await page.locator(bodySelector).first().fill(body);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(editorTextScript(bodySelector)))) === normalizeText(body)
                        ? 'body read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'csdn body readback' },
            );
            if (!readback.ok)
                return stageFail(
                    `csdn body readback failed — the editor did not retain the requested Markdown — ${readback.error}`,
                    'body-readback',
                    flowMetadata,
                );
        } catch (error) {
            return stageFail(`csdn body fill failed — ${errorMessage(error)}`, 'body-readback', flowMetadata);
        }

        // The publish modal carries tags/categories/cover and the final submit (task 0292 Design:
        // `.modal__publish-article`); it opens only through the scoped 发布文章 entry — the entry
        // node is provisional (see `publishOpen`), so absence refuses before any field is touched.
        // A draft run enters it only to commit requested fields (its submit is never clicked); with
        // nothing requested the modal is never opened at all.
        const needsFieldPrep = tags.length > 0 || categories.length > 0 || coverPath !== undefined;
        if (publishStatus === 'public' || needsFieldPrep) {
            try {
                const openSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.publishOpen, {
                    timeoutMs: this.stepTimeoutMs,
                    label: 'csdn 发布文章 entry',
                });
                await page.locator(openSelector).first().click();
            } catch (error) {
                return stageFail(
                    `csdn publish-modal entry not found — ${errorMessage(error)}`,
                    'publish-open',
                    flowMetadata,
                );
            }
        }

        // Tags: exact committed chips only — the vendor's fixed 经验分享 tag (csdn.js:206) is never
        // substituted, and an unconfirmed tag refuses the submit.
        if (tags.length > 0) {
            const committed = await this.commitTags(page, tags);
            if (!committed.ok) return stageFail(committed.error, 'tag-commit', flowMetadata);
        }

        // Categories: exact options only — the vendor silently sent empty categories (csdn.js:207),
        // which is precisely the silent fallback this channel refuses.
        if (categories.length > 0) {
            const selected = await this.selectCategories(page, categories);
            if (!selected.ok) return stageFail(selected.error, 'category-select', flowMetadata);
        }

        // Cover: the single cover slot (csdn.js:223) is filled through the real file input; an
        // unconfirmed upload refuses before submit (never a text-only publish).
        if (coverPath !== undefined) {
            const uploaded = await this.uploadCover(page, coverPath);
            if (!uploaded.ok) return stageFail(uploaded.error, 'cover-upload', flowMetadata);
        }

        // Draft leg: only the top-level draft-labeled action, never the modal's public submit.
        if (publishStatus === 'draft') return this.saveDraft(page, flowMetadata, profileDir);

        // Baselines before submit: only a receipt that was not on screen before the click can
        // confirm (fresh-signal rule; URL shapes grounded csdn.js:340) — stale or absent never passes.
        const toastsBefore = new Set(await this.readToasts(page));
        const beforeReceipts = new Set(await this.readReceiptUrls(page));

        // Submit: the modal's final public submit. Wait enabled first — a disabled control is a
        // state the site owns, not something to click through.
        const publishSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.publishButton, {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn 发布 button',
        });
        const publish = page.locator(publishSelector).first();
        const enabled = await expectOutcome(async () => ((await publish.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn 发布 button enabled',
        });
        if (!enabled.ok)
            return stageFail(
                `csdn 发布 button never became clickable — ${enabled.error}`,
                'send-enabled',
                flowMetadata,
            );
        await publish.click();

        // Confirmation: a failure toast fails fast; otherwise a fresh persisted receipt (article
        // URL or fresh success toast). Stale/absent carries the on-screen receipt snapshot —
        // never "editor cleared", which alone is not a receipt (task 0292 Design).
        const confirmed = await expectOutcome(() => this.probeConfirmation(page, beforeReceipts, toastsBefore), {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn publish confirmation',
        });
        if (!confirmed.ok) {
            return stageFail(
                'csdn publish not confirmed — no fresh persisted receipt appeared',
                'confirmation',
                flowMetadata,
                await this.receiptSnapshot(page),
            );
        }
        if (confirmed.evidence.startsWith('failure-toast: ')) {
            return stageFail(
                `csdn publish failed — site reported: ${confirmed.evidence.slice('failure-toast: '.length)}`,
                'failure-toast',
                flowMetadata,
            );
        }
        const url = confirmed.evidence.startsWith('article-url: ')
            ? confirmed.evidence.slice('article-url: '.length)
            : undefined;
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(url === undefined ? {} : { id: articleIdFrom(url), url }),
            message: `csdn article published live in profile ${profileDir}${url === undefined ? ' (success-toast receipt; no article URL read back)' : ''}`,
            metadata: flowMetadata,
        });
    }

    /**
     * Read-only visibility probe. The grounded pair (`titleInput`/`bodyEditor`, 2026-10-14 editor
     * bundle) must attach, and its visibility is asserted by the caller; the provisional controls
     * (`composer`, modal fields, submit) are only recorded — the modal is closed at probe time by
     * design, so their absence is expected, never a refusal.
     */
    private async probeEditor(page: Page): Promise<EditorProbe> {
        const grounded: Record<string, boolean> = {};
        for (const key of ['titleInput', 'bodyEditor'] as const) {
            const selector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS[key], {
                timeoutMs: this.stepTimeoutMs,
                label: `csdn ${key}`,
            });
            grounded[key] = (
                await trySelectors(page, [selector], { visible: true, timeout: this.stepTimeoutMs })
            ).found;
        }
        const provisional: Record<string, boolean> = {};
        for (const key of ['composer', 'tagInput', 'categoryControl', 'coverInput', 'publishButton'] as const) {
            // Short visibility probe: these live in the publish modal, which is closed here.
            provisional[key] = (
                await trySelectors(page, [...CSDN_ARTICLE_SELECTORS[key]], { visible: true, timeout: 2_000 })
            ).found;
        }
        return { grounded, provisional };
    }

    /**
     * Commits each requested tag and verifies the exact chip in the modal (task 0292 R2). The
     * input node and Enter-commit gesture are **Provisional** (see `tagInput`); no fuzzy or
     * first-item chip fallback — an unverified tag refuses the submit.
     */
    private async commitTags(
        page: Page,
        tags: readonly string[],
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const inputSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.tagInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn tag input',
            });
            const input = page.locator(inputSelector).first();
            await input.click();
            const committed: string[] = [];
            for (const tag of tags) {
                await input.fill(tag);
                await input.press('Enter');
                const chip = await expectOutcome(
                    async () => {
                        const hit = String(await page.evaluate(modalExactTextScript(tag))).trim();
                        return hit.length > 0 ? hit : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: `csdn tag chip 「${bounded(tag)}」 exact match` },
                );
                if (!chip.ok) {
                    return {
                        ok: false,
                        error: `csdn did not show a committed tag chip 「${bounded(tag)}」 in .modal__publish-article; refusing to submit without the requested tags`,
                    };
                }
                committed.push(tag);
            }
            return { ok: true, evidence: `${committed.length} tag chip(s) verified` };
        } catch (error) {
            return { ok: false, error: `csdn tag commit failed — ${errorMessage(error)}` };
        }
    }

    /**
     * Selects each requested category by exact option text and verifies it persisted in the
     * control's value. Option nodes and the persisted readback are **Provisional** (see
     * `categoryControl`); no substituted or empty category ever passes (csdn.js:207).
     */
    private async selectCategories(
        page: Page,
        categories: readonly string[],
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const controlSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.categoryControl, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn category control',
            });
            const control = page.locator(controlSelector).first();
            const selected: string[] = [];
            for (const category of categories) {
                await control.click(); // opens the category dropdown
                const clicked = await expectOutcome(
                    async () => String(await page.evaluate(clickExactTextScript(category))).trim(),
                    {
                        timeoutMs: this.stepTimeoutMs,
                        label: `csdn category option 「${bounded(category)}」 exact match`,
                    },
                );
                if (!clicked.ok) {
                    return {
                        ok: false,
                        error: `csdn did not offer a category option 「${bounded(category)}」; refusing to submit with a substituted or empty category (csdn.js:207)`,
                    };
                }
                const persisted = await expectOutcome(
                    async () =>
                        normalizeText(String(await page.evaluate(inputValueScript(controlSelector)))) ===
                        normalizeText(category)
                            ? 'category persisted'
                            : null,
                    { timeoutMs: this.stepTimeoutMs, label: 'csdn category persisted readback' },
                );
                if (!persisted.ok) {
                    return {
                        ok: false,
                        error: `csdn category 「${bounded(category)}」 did not persist in the category control; refusing to submit`,
                    };
                }
                selected.push(category);
            }
            return { ok: true, evidence: `${selected.length} category selection(s) persisted` };
        } catch (error) {
            return { ok: false, error: `csdn category select failed — ${errorMessage(error)}` };
        }
    }

    /**
     * Uploads the cover through the modal-scoped file input (harness `uploadFile`/setInputFiles —
     * Playwright's CDP path, no clipboard bridge) and waits for the upload to settle plus fresh
     * preview evidence. The input and preview nodes are **Provisional** (see `coverInput`); the
     * vendor's OBS direct-upload protocol and signing keys (csdn.js:32-41) are never used.
     */
    private async uploadCover(
        page: Page,
        coverPath: string,
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const before = Number(await page.evaluate(modalMediaCountScript()));
            const inputSelector = await resolveSelector(page, CSDN_ARTICLE_SELECTORS.coverInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'csdn cover file input',
            });
            await uploadFile(page, inputSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
            const settled = await expectOutcome(
                async () =>
                    String(await page.evaluate(modalUploadingStatusScript())).length > 0
                        ? null
                        : 'cover upload settled',
                { timeoutMs: this.stepTimeoutMs, label: 'csdn cover upload settle' },
            );
            if (!settled.ok) return { ok: false, error: `csdn cover upload did not settle — ${settled.error}` };
            const preview = await expectOutcome(
                async () => {
                    const count = Number(await page.evaluate(modalMediaCountScript()));
                    return count > before ? `modal media ${before} → ${count}` : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'csdn cover preview evidence' },
            );
            if (!preview.ok) {
                return {
                    ok: false,
                    error: `csdn cover preview never appeared after upload (baseline ${before} media nodes in .modal__publish-article)`,
                };
            }
            return { ok: true, evidence: preview.evidence };
        } catch (error) {
            return { ok: false, error: `csdn cover upload failed — ${errorMessage(error)}` };
        }
    }

    /** Visible toast texts (provisional containers, see `TOAST_CONTAINERS`) — the pre-send baseline. */
    private async readToasts(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(toastTextsScript()));
    }

    /** A toast carrying `pattern` that was not already on screen before the submit. */
    private async findFreshToast(page: Page, pattern: RegExp, before: ReadonlySet<string>): Promise<string | null> {
        return (await this.readToasts(page)).find((text) => !before.has(text) && pattern.test(text)) ?? null;
    }

    /** Receipt-shaped URLs currently on screen (location + anchors) — the submit-time baseline. */
    private async readReceiptUrls(
        page: Page,
        patterns: readonly RegExp[] = RECEIPT_URL_RES,
    ): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(receiptUrlsScript(patterns)));
    }

    /** One confirmation probe per poll: failure toast fails fast; then fresh receipt URL; then fresh success toast. */
    private async probeConfirmation(
        page: Page,
        beforeReceipts: ReadonlySet<string>,
        toastsBefore: ReadonlySet<string>,
    ): Promise<string | null> {
        const failure = await this.findFreshToast(page, FAILURE_TOAST_RE, toastsBefore);
        if (failure !== null) return `failure-toast: ${failure}`;
        const url = (await this.readReceiptUrls(page)).find((candidate) => !beforeReceipts.has(candidate));
        if (url !== undefined) return `article-url: ${url}`;
        const success = await this.findFreshToast(page, SUCCESS_TOAST_RE, toastsBefore);
        return success === null ? null : `success-toast: ${success}`;
    }

    /** Bounded on-screen snapshot for an unconfirmed submit — no DOM dump, ever. */
    private async receiptSnapshot(page: Page): Promise<string> {
        const receipts = await this.readReceiptUrls(page);
        const toasts = await this.readToasts(page);
        return `still on ${page.url()}; ${receipts.length} receipt-shaped url(s), ${toasts.length} toast(s) on screen`;
    }

    /**
     * The draft save leg (frozen task 0292 Design): activate only the top-level 保存草稿 control
     * (`DRAFT_SAVE_SELECTORS`) — never the modal's final public submit, never the vendor's signed
     * status-blind saveArticle API (csdn.js:183-248). Confirmation is only a FRESH persisted draft
     * receipt (the editor URL gaining an `articleId` param, or the mp_blog editor shape) that was
     * not on screen before the click; stale toasts and toast-only idless states never confirm.
     */
    private async saveDraft(page: Page, metadata: Record<string, unknown>, profileDir: string): Promise<Result> {
        const selector = await resolveSelector(page, DRAFT_SAVE_SELECTORS, {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn 保存草稿 button',
        });
        const button = page.locator(selector).first();
        const enabled = await expectOutcome(async () => ((await button.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn 保存草稿 button enabled',
        });
        if (!enabled.ok)
            return stageFail(
                `csdn 保存草稿 button never became clickable — ${enabled.error}`,
                'draft-enabled',
                metadata,
            );
        // Baselines before the click: only a receipt absent beforehand can confirm (fresh-signal rule).
        const toastsBefore = new Set(await this.readToasts(page));
        const beforeReceipts = new Set(await this.readReceiptUrls(page, DRAFT_RECEIPT_URL_RES));
        await button.click();
        const confirmed = await expectOutcome(() => this.probeDraftConfirmation(page, beforeReceipts, toastsBefore), {
            timeoutMs: this.stepTimeoutMs,
            label: 'csdn draft save confirmation',
        });
        if (!confirmed.ok) {
            return stageFail(
                'csdn draft save not confirmed — no fresh draft id appeared',
                'draft-save',
                metadata,
                await this.receiptSnapshot(page),
            );
        }
        if (confirmed.evidence.startsWith('failure-toast: ')) {
            return stageFail(
                `csdn draft save failed — site reported: ${confirmed.evidence.slice('failure-toast: '.length)}`,
                'failure-toast',
                metadata,
            );
        }
        const url = confirmed.evidence.slice('draft-url: '.length);
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            id: articleIdFrom(url),
            url,
            message: `csdn draft saved in profile ${profileDir}`,
            metadata,
        });
    }

    /** One draft-confirmation probe: failure toast fails fast; then a fresh id-bearing draft URL. */
    private async probeDraftConfirmation(
        page: Page,
        beforeReceipts: ReadonlySet<string>,
        toastsBefore: ReadonlySet<string>,
    ): Promise<string | null> {
        const failure = await this.findFreshToast(page, FAILURE_TOAST_RE, toastsBefore);
        if (failure !== null) return `failure-toast: ${failure}`;
        // No success-toast acceptance: a toast without an article id is exactly the idless state
        // the frozen draft contract rejects.
        const url = (await this.readReceiptUrls(page, DRAFT_RECEIPT_URL_RES)).find((c) => !beforeReceipts.has(c));
        return url === undefined ? null : `draft-url: ${url}`;
    }
}

/** Session failures whose one-liner must name the recovery command. */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

/** Probe observation for the Result metadata: which grounded/provisional controls were visible. */
interface EditorProbe {
    grounded: Record<string, boolean>;
    provisional: Record<string, boolean>;
}

/** Whitespace-insensitive comparison: cledit/editor normalizations must not fail a strict readback. */
function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
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

/** Article id from an observed receipt URL (shapes: csdn.js:340 grounded; `/article/details/` provisional). */
function articleIdFrom(url: string): string | undefined {
    return /(?:creation\/editor\/|article\/details\/|articleId=)(\d+)/.exec(url)?.[1];
}

/** Input `value` property readback (title input, category control — both are inputs). */
function inputValueScript(selector: string): string {
    return `(() => { // kk-csdn-input-value
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.value ?? '');
})()`;
}

/** Editor pre `textContent` readback (the cledit-managed body, csdn.js:204-205 field semantics). */
function editorTextScript(selector: string): string {
    return `(() => { // kk-csdn-editor-text
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.textContent ?? '');
})()`;
}

/**
 * Exact-text match inside the publish modal (tag chips): only childless elements count, so an
 * input's value or a container wrapping several chips never reads as a committed chip. The chip
 * node is **Provisional** (bundle evidence pins the 文章标签 label, not the chip); `''` = not offered.
 */
function modalExactTextScript(wanted: string): string {
    return `(() => { // kk-csdn-modal-exact-text
    const wanted = ${JSON.stringify(wanted)};
    const modal = document.querySelector('.modal__publish-article');
    if (modal === null) return '';
    for (const el of modal.querySelectorAll('*')) {
        if (el.childElementCount > 0) continue;
        if ((el.textContent || '').trim() === wanted) return wanted;
    }
    return '';
})()`;
}

/**
 * Clicks the one category option whose trimmed text equals `wanted`. Options may render in the
 * modal or a body-level dropdown layer — page chrome (`.article-bar`, `.editor__wrapper`) is
 * excluded so sidebar lists and the flow's own title/body can never satisfy the match. Both the
 * option node and the layer scope are **Provisional** (bundle evidence pins 分类专栏 only); `''` =
 * not offered, and no first-item or fuzzy fallback (the vendor's silent empty category,
 * csdn.js:207, is the fallback this refuses).
 */
function clickExactTextScript(wanted: string): string {
    return `(() => { // kk-csdn-category-exact-click
    const wanted = ${JSON.stringify(wanted)};
    const scopes = [];
    const modal = document.querySelector('.modal__publish-article');
    if (modal !== null) scopes.push(modal);
    for (const layer of document.querySelectorAll('[class*="popper" i], [class*="dropdown" i]')) {
        if (layer.closest('.article-bar, .editor__wrapper, .modal__publish-article') === null) scopes.push(layer);
    }
    for (const scope of scopes) {
        for (const el of scope.querySelectorAll('*')) {
            if (el.childElementCount > 0) continue;
            if ((el.textContent || '').trim() === wanted) { el.click(); return wanted; }
        }
    }
    return '';
})()`;
}

/**
 * Media-node count inside the publish modal (img with src or a background-image style) — the
 * cover preview evidence scope; jike-pub's landed-preview predicate rescoped to the modal. The
 * preview node is **Provisional** (bundle evidence pins the 封面 label, not the preview).
 */
function modalMediaCountScript(): string {
    return `(() => { // kk-csdn-modal-media-count
    const modal = document.querySelector('.modal__publish-article');
    if (modal === null) return 0;
    return modal.querySelectorAll('img[src], [style*="background-image"]').length;
})()`;
}

/** The modal's upload-progress leaf text; `''` when settled. **Provisional** progress wording. */
function modalUploadingStatusScript(): string {
    return `(() => { // kk-csdn-modal-uploading-status
    const modal = document.querySelector('.modal__publish-article');
    if (modal === null) return '';
    const uploading = Array.from(modal.querySelectorAll('*')).find(
        (el) => el.childElementCount === 0 && (el.textContent || '').includes('上传中'),
    );
    return uploading === undefined ? '' : (uploading.textContent || '').trim();
})()`;
}

/** Visible toast texts — the pre-submit baseline and the fresh-signal read (provisional containers). */
function toastTextsScript(): string {
    return `(() => { // kk-csdn-toasts
    const nodes = document.querySelectorAll('${TOAST_CONTAINERS}');
    const texts = [];
    for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text.length > 0) texts.push(text);
    }
    return JSON.stringify(texts);
})()`;
}

/** Receipt-shaped URLs on screen (location + anchors) — the submit-time baseline and fresh read. */
function receiptUrlsScript(patterns: readonly RegExp[]): string {
    return `(() => { // kk-csdn-receipt-urls
    const patterns = [${patterns.map((re) => re.toString()).join(', ')}];
    const matches = (url) => patterns.some((re) => re.test(url));
    const urls = [];
    if (matches(location.href)) urls.push(location.href);
    for (const a of document.querySelectorAll('a[href]')) {
        if (matches(a.href) && !urls.includes(a.href)) urls.push(a.href);
    }
    return JSON.stringify(urls);
})()`;
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * CSDN browser transport.
 * @param operation - Resolved operation (`article`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: CsdnOperation = 'article',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new CsdnBrowserTransport(operation, driver);
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
        echoError(`csdn-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
