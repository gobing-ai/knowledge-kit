/**
 * jike-pub — 即刻 (web.okjike.com) dynamic-post publisher (task 0291, Chunk A).
 *
 * Browser controls are pinned to the recovered extension v0.1.55 source (read-only evidence,
 * `.spur/memory/evidence/publish-ready-0288-0297-20261014-01/source/platforms/jike.js`, windows
 * 59–99 / 204–250 / 300–385); each selector cites its line, and anything the source does not
 * ground is marked provisional. Live-only: 即刻 has no evidenced persistent draft flow, so an
 * absent or non-public `publishStatus` refuses before any browser opens (ADR-022).
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

/** Site-owned target slug; also the profile channel key. */
const TARGET = 'jike';
/** Home entry. Grounded: jike.js:1 header — 「即刻（web.okjike.com）动态填充适配器」. */
export const JIKE_HOME_URL = 'https://web.okjike.com';
/**
 * Login/passport redirect marker. **Provisional**: the extension runs inside an already-open
 * logged-in tab and only guesses 「可能未登录」 when the composer is missing (jike.js:309); no
 * redirect URL is source-grounded. The composer probe below carries the real gate.
 */
export const JIKE_LOGIN_URL_RE = /(passport\.okjike\.com|\/login)/;

/** Declared operations (ADR-029 dispatch): the dynamic-post flow only. */
export const JIKE_OPERATIONS = ['post'] as const;
export type JikeOperation = (typeof JIKE_OPERATIONS)[number];

/**
 * The composer form is the media scope (jike.js:335 `editor.closest("form")`); `:has` pins it to
 * the form that actually holds the editable composer, not a feed card.
 */
const COMPOSER_FORM_SCOPE = 'form:has(div[contenteditable="true"])';

/**
 * Post-composer selectors. **Grounded on jike.js** (extension v0.1.55):
 * - composer `form div[contenteditable="true"]` (jike.js:307);
 * - topic input `input[placeholder='未选择圈子']` (jike.js:207);
 * - send: the first `button` whose text includes 发送 (jike.js:368-370), waited-while-disabled
 *   up to 10×3s (jike.js:371-373).
 *
 * **Provisional**: `fileInput` — the source fills media via paste events (jike.js:264-274), so no
 * `input[type="file"]` exists in the evidence; the refine (2026-10-14) directs native setInputFiles
 * on the composer-scoped input, and an absent input is a loud refusal, not a text-only submit.
 * Also provisional: the source only ever fills an *already-open* composer inside the live tab, so
 * "the composer is reachable straight from the home page" is an assumption the live checks must
 * confirm; a missing composer is a loud typed refusal, never a silent no-op.
 */
export const JIKE_POST_SELECTORS = {
    composer: ['form div[contenteditable="true"]'],
    topicInput: ["input[placeholder='未选择圈子']"],
    fileInput: [`${COMPOSER_FORM_SCOPE} input[type="file"]`],
    // The source queries 发送 page-wide (jike.js:372-374); scoped to the composer form per the
    // 0291 design so a like/share 发送 control elsewhere on the page can never win (0291 review P3).
    send: [`${COMPOSER_FORM_SCOPE} button:has-text("发送")`],
} as const;

/** Failure toast words — grounded jike.js:65. */
const FAILURE_TOAST_RE = /发送失败|发布失败|发送出错|重试/;
/** Success toast words — grounded jike.js:66. */
const SUCCESS_TOAST_RE = /发送成功|发布成功|已发布/;
/** Toast/notice containers — grounded jike.js:61-63. */
const TOAST_CONTAINERS = '[role="alert"], [role="status"], [class*="toast" i], [class*="message" i]';
/** Post-link href shapes — grounded jike.js:46-48 (baseline before submit, jike.js:373). */
const POST_LINK_SELECTOR = 'a[href*="/originalPost/"], a[href*="/post/"]';
/** Source-observed adapter cap for one post's media (jike.js:246, 329-331); excess is refused, not sliced. */
const MAX_IMAGES = 9;
/**
 * Image extensions this channel accepts. **Provisional**: the source itself accepts any `image/*`
 * MIME (jike.js:323-325); the explicit set follows the weibo-pub peer until a live run pins more.
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const JIKE_LOGIN_INSTRUCTION = 'bun plugins/publishings/jike-pub/src/profile-check.ts login';
/** Body excerpt length compared on readback and on the fresh-post-link signal. */
const EXCERPT_CHARS = 30;

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

/** Whitespace-insensitive comparison: the contenteditable editor normalizes runs of spaces/newlines. */
function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
}

function excerpt(text: string): string {
    return normalizeText(text).slice(0, EXCERPT_CHARS);
}

/**
 * Resolves the requested operation. An undeclared value is refused by name, before any transport —
 * and therefore before any browser — is resolved.
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: JikeOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    if (typeof raw !== 'string' || !(JIKE_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for jike: expected one of ${JIKE_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as JikeOperation };
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
            error: `unsupported driver '${bounded(raw)}' for jike: expected one of script (the jike-pub browser flow has no agent path)`,
        };
    }
    return { driver: 'script' };
}

/**
 * Jike-owned readiness predicate: no login redirect and the site-owned composer reachable. Shared
 * by the publish preflight and the operator profile CLI, so both apply one gate. The login-redirect
 * regex is provisional (see `JIKE_LOGIN_URL_RE`); the composer carries the real gate.
 */
export const isJikeAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (JIKE_LOGIN_URL_RE.test(page.url())) return false;
    return (await trySelectors(page, JIKE_POST_SELECTORS.composer, { visible: false })).found;
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The publish preflight
 * never forwards `checkHeadedOnly`: it is the operator CLI's setting, and a refusal must never
 * escalate to a headed window on its own.
 */
export const JIKE_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: JIKE_HOME_URL,
    isAuthenticated: isJikeAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};

/**
 * Resolves the optional image attachments (`options.images ?? metadata.images`) without uploading:
 * Chunk A validates the payload — an array of existing local image files, at most 9 (the source's
 * observed adapter cap, jike.js:246, 329-331; excess is refused, not sliced) — and Chunk B performs
 * the upload at the named seam. The extension set is a provisional peer-parity narrowing (see
 * `IMAGE_EXTS`), not a platform limit.
 */
async function resolveImages(
    options?: Record<string, unknown>,
    content?: Content,
): Promise<{ paths: string[] } | { error: string }> {
    const raw = options?.images ?? content?.metadata?.images;
    if (raw === undefined) return { paths: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.images must be an array of local image paths, got '${bounded(raw)}'` };
    }
    if (raw.length > MAX_IMAGES) {
        return {
            error: `metadata.images requests ${raw.length} images, over the source-observed jike cap of ${MAX_IMAGES} (jike.js:329-331); refusing rather than truncating`,
        };
    }
    const paths: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.images entries must be non-empty local image paths, got '${bounded(entry)}'` };
        }
        if (!IMAGE_EXTS.has(extname(entry).toLowerCase())) {
            return { error: `metadata.images entry must be one of ${[...IMAGE_EXTS].join(', ')}, got '${entry}'` };
        }
        if (!(await createNodeFileSystem().exists(entry))) {
            return { error: `metadata.images file does not exist: '${entry}'` };
        }
        paths.push(entry);
    }
    return { paths };
}

/**
 * Resolves the optional exact circle/topic name (`options.topic ?? metadata.topic`): optional, but
 * present must be a non-empty string (refine 2026-10-14 — the chip match is exact text, so a
 * whitespace-only value is refused, not guessed). Trimmed like the source (jike.js:213).
 */
function resolveTopic(options?: Record<string, unknown>, content?: Content): { topic?: string; error?: string } {
    const raw = options?.topic ?? content?.metadata?.topic;
    if (raw === undefined) return {};
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `metadata.topic must be a non-empty exact circle name, got '${bounded(raw)}'` };
    }
    return { topic: raw.trim() };
}

/**
 * Jike browser transport on the shared rails (ADR-027): a headless session preflight, one headed
 * flow, and success only from an observed signal. `post` is live-only (ADR-022): it refuses
 * without `publishStatus: public` because 即刻 has no evidenced persistent draft flow.
 */
export class JikeBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: JikeOperation;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: JikeOperation = 'post',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a live dynamic post.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed site signal.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // Refusal order (all pre-browser): driver → publishStatus → body text → images → topic →
        // session preflight. (The operation is resolved and refused in `resolveOperation` before
        // any transport exists.)
        if (this.driver !== 'script') {
            return fail(
                `unsupported driver '${bounded(this.driver)}' for jike: expected one of script (the jike-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested === undefined || requested === 'draft') {
            return fail(
                `jike has no evidenced draft flow: publishStatus ${requested === undefined ? 'is absent' : "'draft'"} refuses before the browser — set publishStatus: public to publish live`,
            );
        }
        if (requested !== 'public') {
            return fail(`unknown publishStatus '${bounded(requested)}' for jike: only 'public' publishes`);
        }
        const text = payload.content.body.trim();
        if (text.length === 0) {
            return fail(
                'jike dynamic requires non-empty Content.body text (the composer has no independent title field, jike.js:312-315)',
            );
        }
        const images = await resolveImages(payload.options, payload.content);
        if ('error' in images) return fail(images.error);
        const topic = resolveTopic(payload.options, payload.content);
        if (topic.error !== undefined) return fail(topic.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(JIKE_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                `${TARGET} session preflight refused — run: ${JIKE_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: JIKE_HOME_URL,
                    isAuthenticated: isJikeAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runPostFlow(page, text, topic.topic, images.paths, profileDir),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                needsLogin(error)
                    ? `${TARGET} session failed — run: ${JIKE_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The dynamic-post flow: fill → readback → topic chip → image upload → baselines → submit →
     * confirmation (topics before images per the Chunk B contract; the source orders media first,
     * jike.js:320-363). Success only from a fresh strong signal (jike.js:59-79): a success toast,
     * or a new `/originalPost/|/post/` link whose card read back the body. The source's weak
     * signals (editor cleared, composer closed — jike.js:81-85) alone never report success.
     */
    private async runPostFlow(
        page: Page,
        text: string,
        topic: string | undefined,
        images: readonly string[],
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: this.operation, driver: this.driver, publishStatus: 'public', profileDir };

        // Composer. A missing composer is the typed stage failure — the source reads it as a
        // logged-out session (「可能未登录」, jike.js:309).
        let composerSelector: string;
        try {
            composerSelector = await resolveSelector(page, JIKE_POST_SELECTORS.composer, {
                timeoutMs: this.stepTimeoutMs,
                label: 'jike composer',
            });
        } catch {
            return stageFail(
                `jike composer not found on ${JIKE_HOME_URL} (session may be logged out) — run: ${JIKE_LOGIN_INSTRUCTION}`,
                'composer',
                metadata,
            );
        }
        await page.locator(composerSelector).first().fill(text);

        // Readback before anything else: a field the editor dropped must never be submitted
        // (source waits out the paste readback, jike.js:316-319).
        const readback = await this.requireReadback(page, composerSelector, text);
        if (!readback.ok) return stageFail(readback.error, 'text-readback', metadata);

        // Topic chip: exact committed match only — a lookalike or first-item chip never substitutes
        // (refine 2026-10-14), so any miss refuses before send.
        if (topic !== undefined) {
            const chip = await this.commitTopic(page, topic);
            if (!chip.ok) return stageFail(chip.error, 'topic-commit', metadata);
        }

        // Image uploads: caller order, confirmed landed; a failed or unconfirmed upload refuses
        // before submit — never a silent text-only post while images were requested.
        if (images.length > 0) {
            const uploaded = await this.uploadImages(page, images);
            if (!uploaded.ok) return stageFail(uploaded.error, 'image-upload', metadata);
        }

        // Baselines before submit: only fresh toast and fresh post-link signals can confirm
        // (beforeLinks grounded jike.js:373; toast baselining per the shared strong-baseline rule).
        const toastsBefore = new Set(await this.readToasts(page));
        const beforeLinks = await this.readPostLinks(page);

        // Send. Grounded: first `button` whose text includes 发送 (jike.js:368-370), waited-while-
        // disabled (jike.js:371-373; the 10×3s wait becomes the step timeout here).
        const sendSelector = await resolveSelector(page, JIKE_POST_SELECTORS.send, {
            timeoutMs: this.stepTimeoutMs,
            label: 'jike 发送 button',
        });
        const send = page.locator(sendSelector).first();
        const enabled = await expectOutcome(async () => ((await send.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'jike 发送 button enabled',
        });
        if (!enabled.ok)
            return stageFail(`jike 发送 button never became clickable — ${enabled.error}`, 'send-enabled', metadata);
        await send.click();

        // Confirmation (source timeout 30s, jike.js:375-377): a failure toast fails fast; otherwise
        // the fresh post link is preferred so the Result can carry the created post's url/id, with
        // the fresh success toast as the remaining strong receipt.
        const confirmed = await expectOutcome(() => this.probeConfirmation(page, text, beforeLinks, toastsBefore), {
            timeoutMs: this.stepTimeoutMs,
            label: 'jike publish confirmation',
        });
        if (!confirmed.ok) {
            return stageFail(`jike publish not confirmed — ${confirmed.error}`, 'confirmation', metadata);
        }
        if (confirmed.evidence.startsWith('failure-toast: ')) {
            return stageFail(
                `jike send failed — site reported: ${confirmed.evidence.slice('failure-toast: '.length)}`,
                'failure-toast',
                metadata,
            );
        }
        const url = confirmed.evidence.startsWith('post-url: ')
            ? confirmed.evidence.slice('post-url: '.length)
            : undefined;
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(url === undefined ? {} : { id: postIdFrom(url), url }),
            message: `jike dynamic published live in profile ${profileDir}${url === undefined ? ' (success-toast receipt; no post URL read back)' : ''}`,
            metadata,
        });
    }

    /** Polls until the editor shows the submitted text; a field the editor dropped is a refusal. */
    private async requireReadback(
        page: Page,
        selector: string,
        expected: string,
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        const wanted = excerpt(expected);
        return expectOutcome(
            async () => {
                const current = normalizeText(String(await page.evaluate(editorTextScript(selector))));
                if (wanted.length === 0 || !current.includes(wanted)) return null;
                return current.slice(0, 60);
            },
            { timeoutMs: this.stepTimeoutMs, label: 'jike composer text readback' },
        );
    }

    /**
     * Commits the requested topic chip or refuses: opens the circle input (jike.js:207-208), fills
     * it (native fill replaces the source's manual change/input dispatch, jike.js:209-211), then
     * polls for an exact-text chip inside `div[name="topic"] div[tabindex="0"]` (jike.js:219-225).
     * The source's first-item and structural-traversal fallbacks (jike.js:226-247) are deliberately
     * not ported (refine 2026-10-14): an unconfirmed circle refuses the submit.
     */
    private async commitTopic(
        page: Page,
        topic: string,
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const inputSelector = await resolveSelector(page, JIKE_POST_SELECTORS.topicInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'jike topic input',
            });
            const input = page.locator(inputSelector).first();
            await input.click(); // opens the circle dropdown (jike.js:208)
            await input.fill(topic);
            const committed = await expectOutcome(
                async () => {
                    const hit = String(await page.evaluate(commitTopicScript(topic))).trim();
                    return hit.length > 0 ? hit : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'jike topic chip exact match' },
            );
            if (!committed.ok) {
                return {
                    ok: false,
                    error: `jike did not offer an exact circle chip 「${bounded(topic)}」 (div[name="topic"], jike.js:219-225); refusing to submit without the requested circle`,
                };
            }
            return { ok: true, evidence: committed.evidence };
        } catch (error) {
            return { ok: false, error: `jike topic commit failed — ${errorMessage(error)}` };
        }
    }

    /**
     * Uploads the caller-ordered images through the composer-scoped file input and confirms they
     * landed. The input is provisional (see `JIKE_POST_SELECTORS`), so an absent input is a typed
     * refusal, never a text-only submit. Landing uses the source's own predicate: the
     * composer-scope media-node count must rise by the uploaded count (jike.js:46-52, 287-291),
     * after the 正在上传 progress status settles (jike.js:277-286).
     */
    private async uploadImages(
        page: Page,
        images: readonly string[],
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const before = Number(await page.evaluate(mediaEvidenceScript()));
            // uploadFile (harness) covers one file; page.setInputFiles(paths) carries caller order
            // for several (refine 2026-10-14: native helpers, no vendor clipboard bridge).
            const [first] = images;
            const inputSelector = JIKE_POST_SELECTORS.fileInput[0];
            if (images.length === 1 && first !== undefined) {
                await uploadFile(page, inputSelector, first, { timeoutMs: this.stepTimeoutMs });
            } else {
                await page.setInputFiles(inputSelector, [...images]);
            }
            const settled = await expectOutcome(
                async () =>
                    String(await page.evaluate(uploadingStatusScript())).length > 0 ? null : 'uploads settled',
                { timeoutMs: this.stepTimeoutMs, label: 'jike image upload settle (正在上传)' },
            );
            if (!settled.ok) return { ok: false, error: `jike image upload did not settle — ${settled.error}` };
            // Source pins this preview wait to 5s @ 250ms (jike.js:288-291); mirrored, not the step timeout.
            const confirmed = await expectOutcome(
                async () => {
                    const count = Number(await page.evaluate(mediaEvidenceScript()));
                    return count >= before + images.length ? `media nodes ${before} → ${count}` : null;
                },
                { timeoutMs: 5_000, pollMs: 250, label: 'jike image preview evidence' },
            );
            if (!confirmed.ok) {
                return {
                    ok: false,
                    error: `jike composer preview never reached ${before + images.length} media nodes (baseline ${before}) for ${images.length} uploaded image(s)`,
                };
            }
            return { ok: true, evidence: confirmed.evidence };
        } catch (error) {
            return { ok: false, error: `jike image upload failed — ${errorMessage(error)}` };
        }
    }

    /** Visible toast texts (grounded containers, jike.js:61-63), used as the pre-send baseline. */
    private async readToasts(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(toastTextsScript()));
    }

    /** A toast carrying `pattern` that was not already on screen before the send. */
    private async findFreshToast(page: Page, pattern: RegExp, before: ReadonlySet<string>): Promise<string | null> {
        return (await this.readToasts(page)).find((text) => !before.has(text) && pattern.test(text)) ?? null;
    }

    /** Post-link hrefs currently on the page — the submit-time baseline (grounded jike.js:373). */
    private async readPostLinks(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(postLinksScript()));
    }

    /**
     * One confirmation probe per poll: failure toast (grounded words, jike.js:65) fails fast;
     * otherwise a fresh `/originalPost/|/post/` link whose card contains the body excerpt
     * (grounded jike.js:68-79) or a fresh success toast (jike.js:66-67).
     */
    private async probeConfirmation(
        page: Page,
        text: string,
        beforeLinks: readonly string[],
        toastsBefore: ReadonlySet<string>,
    ): Promise<string | null> {
        const failure = await this.findFreshToast(page, FAILURE_TOAST_RE, toastsBefore);
        if (failure !== null) return `failure-toast: ${failure}`;
        const link = String(await page.evaluate(freshPostLinkScript(beforeLinks, excerpt(text)))).trim();
        if (link.length > 0) return `post-url: ${link}`;
        const success = await this.findFreshToast(page, SUCCESS_TOAST_RE, toastsBefore);
        return success === null ? null : `success-toast: ${success}`;
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

/** Post id from an observed jike post URL (href shapes grounded jike.js:46-48; extraction is derived). */
function postIdFrom(url: string): string | undefined {
    return /\/(?:originalPost|post)\/([A-Za-z0-9_-]+)/.exec(url)?.[1];
}

/** Reads the composer's text back (`textContent` — the grounded control is a contenteditable div). */
function editorTextScript(selector: string): string {
    return `(() => { // kk-jike-editor-text
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.textContent ?? '').trim();
})()`;
}

/**
 * Exact-match commit of the requested circle chip — the strict path of the source's selectTopic
 * (jike.js:219-225): click the one chip whose trimmed text equals the request. `''` means "not
 * offered" (container missing or no exact chip); the first-item and structural-traversal fallbacks
 * (jike.js:226-247) are intentionally absent (refine 2026-10-14).
 */
function commitTopicScript(topic: string): string {
    return `(() => { // kk-jike-topic-commit
    const wanted = ${JSON.stringify(topic)};
    const container = document.querySelector('div[name="topic"]');
    if (container === null) return '';
    for (const item of container.querySelectorAll('div[tabindex="0"]')) {
        const text = (item.textContent || '').trim();
        if (text === wanted) { item.click(); return text; }
    }
    return '';
})()`;
}

/**
 * Media-node count inside the composer form scope — the source's landed-preview predicate
 * (`mediaEvidenceCount`, jike.js:46-52) with its scope choice (`editor.closest("form") ||
 * document`, jike.js:335); the preview-confirmed comparison is jike.js:287-291.
 */
function mediaEvidenceScript(): string {
    return `(() => { // kk-jike-media-evidence
    const scope = document.querySelector('${COMPOSER_FORM_SCOPE}') || document;
    return scope.querySelectorAll('img[src], video[src], video source[src], [style*="background-image"]').length;
})()`;
}

/** The site's upload-progress status text; `''` when settled — waited out before submit (jike.js:277-286). */
function uploadingStatusScript(): string {
    return `(() => { // kk-jike-uploading-status
    const uploading = Array.from(document.querySelectorAll('div[role="status"]')).find(
        (el) => (el.textContent || '').includes('正在上传'),
    );
    return uploading === null ? '' : (uploading.textContent || '').trim();
})()`;
}

/** Visible toast texts, used as the pre-send baseline and as the fresh-signal read (jike.js:61-63). */
function toastTextsScript(): string {
    return `(() => { // kk-jike-toasts
    const nodes = document.querySelectorAll('${TOAST_CONTAINERS}');
    const texts = [];
    for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text.length > 0) texts.push(text);
    }
    return JSON.stringify(texts);
})()`;
}

/** All post-link hrefs on the page, for the submit-time baseline (grounded jike.js:46-48, 373). */
function postLinksScript(): string {
    return `(() => { // kk-jike-post-links
    return JSON.stringify(Array.from(document.querySelectorAll('${POST_LINK_SELECTOR}')).map((a) => a.href).filter(Boolean));
})()`;
}

/**
 * The first post link that was not on the page before the send and whose containing card read back
 * the body excerpt (grounded probe jike.js:68-79). `''` means "no signal yet".
 */
function freshPostLinkScript(before: readonly string[], wanted: string): string {
    return `(() => { // kk-jike-fresh-post-link
    const seen = new Set(${JSON.stringify(before)});
    const wanted = ${JSON.stringify(wanted)};
    if (wanted === '') return '';
    for (const anchor of document.querySelectorAll('${POST_LINK_SELECTOR}')) {
        if (seen.has(anchor.href)) continue;
        const card = anchor.closest('article, section, li, div');
        const cardText = (card === null ? '' : card.textContent || '').replace(/\\s+/g, '');
        if (cardText.includes(wanted)) return anchor.href;
    }
    return '';
})()`;
}

/**
 * Resolves the channel transport: the publish-harness fake under
 * `KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake` (offline, no profile, no browser), otherwise the real
 * Jike browser transport.
 * @param operation - Resolved operation (`post`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: JikeOperation = 'post',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new JikeBrowserTransport(operation, driver);
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
        echoError(`jike-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
