/**
 * linkedin-pub — LinkedIn feed-post publisher (task 0328).
 *
 * Browser controls follow the jike-pub live-only shape: one headless session preflight, one headed
 * flow, and success only from an observed site signal. Every selector and signal regex below is
 * **provisional** — never yet measured against a live logged-in LinkedIn session — so the
 * operator's live gate (0328 plan step 5: login, then one manual post) must re-measure them before
 * any live flip; each stage fails loud by name when a selector has drifted. Live-only: LinkedIn's
 * drafts are not addressable, so an absent or `draft` `publishStatus` refuses before any browser
 * opens (0328 R1).
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

/** Site-owned target slug; also the profile channel key (`browser-profiles/linkedin`, ADR-042). */
const TARGET = 'linkedin';
/** Home entry: the feed, where the share box and the fresh posts live. */
export const LINKEDIN_HOME_URL = 'https://www.linkedin.com/feed/';
/**
 * Login/redirect markers. **Provisional**: LinkedIn shows an `/authwall` interstitial for logged-out
 * feed visits and `/checkpoint` for challenge flows; no redirect URL is source-grounded yet. The
 * composer probe below carries the real gate.
 */
export const LINKEDIN_LOGIN_URL_RE = /(\/authwall|\/login|\/checkpoint)/;

/** Declared operations (ADR-029 dispatch): the feed-post flow only. */
export const LINKEDIN_OPERATIONS = ['post'] as const;
export type LinkedinOperation = (typeof LINKEDIN_OPERATIONS)[number];

/**
 * LinkedIn's own hard cap on one feed post: 3000 characters. Counted in code points; overlong text
 * is refused, never truncated (the social-write stage's backstop is the only truncation, 0327 R3).
 */
export const MAX_TEXT_CHARS = 3000;
/** One image per post (0328 R1 "text plus one image"); excess is refused, not sliced. */
const MAX_IMAGES = 1;
/**
 * Image extensions this channel accepts. **Provisional**: the peer-parity set (jike-pub), not a
 * measured LinkedIn limit; the live gate must confirm.
 */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/**
 * Post-composer selectors. **All provisional** — LinkedIn's share box, the modal editor, the file
 * input and the Post control are named from the publicly known DOM, never measured live:
 * - share box trigger on the feed (the "Start a post" button);
 * - the modal's rich-text editor;
 * - the composer-scoped file input (visible only once the modal is open);
 * - the Post submit control inside the same dialog.
 * A drifted selector is a loud typed refusal at its stage, never a silent skip or a text-only post.
 */
export const LINKEDIN_POST_SELECTORS = {
    // 2026-11-16 live measurement of the redesigned feed: the share trigger is a classless div and the
    // share surface is NOT a `[role="dialog"]`, so controls are page-scoped by text, with the old
    // class-based ladder kept as a fallback for accounts still on the previous UI.
    shareTrigger: [
        'text="Start a post"',
        'button.share-box-feed-entry__trigger',
        'button[aria-label*="Start a post" i]',
    ],
    composer: [
        '.tiptap.ProseMirror div[role="textbox"]',
        'div[role="textbox"].tiptap',
        '.tiptap.ProseMirror',
        '[role="dialog"] div[role="textbox"]',
        'div.editor-content[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
    ],
    mediaButton: [
        'button[aria-label="Media"]',
        'button[aria-label*="Media" i]',
        '[role="dialog"] button[aria-label*="Media" i]',
    ],
    fileInput: ['input[type="file"][accept*="image"]', 'input[type="file"]', '[role="dialog"] input[type="file"]'],
    send: [
        'button:text-is("Post")',
        '[role="dialog"] button:text-is("Post")',
        '[role="dialog"] button.share-actions__primary-action',
    ],
} as const;

/** Failure toast words. **Provisional** (LinkedIn's artdeco toast wording). */
const FAILURE_TOAST_RE = /post failed|couldn't post|something went wrong/i;
/** Success toast words. **Provisional** ("Post successful"). */
const SUCCESS_TOAST_RE = /post successful/i;
/** Toast/notice containers — artdeco toasts. **Provisional**. */
const TOAST_CONTAINERS = '[role="alert"], [role="status"], [class*="toast" i]';
/** Fresh-post href shapes — the activity permalink LinkedIn inserts into the feed. **Provisional**. */
const POST_LINK_SELECTOR = 'a[href*="/feed/update/"], a[href*="/posts/"]';
/** Image upload preview wait: source-pinned 5s @ 250ms like the jike peer, not the step timeout. */
const PREVIEW_TIMEOUT_MS = 5_000;
const PREVIEW_POLL_MS = 250;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const LINKEDIN_LOGIN_INSTRUCTION = 'bun plugins/publishings/linkedin-pub/src/profile-check.ts login';
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
 * Resolves the requested operation and refuses unknown names before any transport — and therefore
 * before any browser — is resolved (0328 R1: `options.operation ?? content.metadata.operation`).
 * @param options - Per-call publish options (`operation`).
 * @param content - Content whose `metadata.operation` is the fallback source.
 * @returns The resolved operation, or the refusal message.
 */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: LinkedinOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    if (typeof raw !== 'string' || !(LINKEDIN_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${bounded(raw)}' for linkedin: expected one of ${LINKEDIN_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as LinkedinOperation };
}

/**
 * Resolves the driver from `options.driver ?? 'script'`. This channel ships one driver and no
 * `agent` path, so anything else — including a wrong type — is refused by name before a transport
 * is built.
 */
function resolveDriver(options?: Record<string, unknown>): BrowserDriver | { error: string } {
    const raw = options?.driver ?? 'script';
    if (raw !== 'script') {
        return { error: `unsupported driver '${bounded(raw)}' for linkedin: expected one of script` };
    }
    return 'script';
}

/**
 * LinkedIn-owned readiness predicate: no login redirect and the share box reachable. Shared by the
 * publish preflight and the operator profile CLI, so both apply one gate (0328 R2). The
 * login-redirect regex is provisional (see `LINKEDIN_LOGIN_URL_RE`); the share box carries the real
 * gate — a drifted selector fails the probe loud.
 */
export const isLinkedinAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (LINKEDIN_LOGIN_URL_RE.test(page.url())) return false;
    if ((await trySelectors(page, LINKEDIN_POST_SELECTORS.shareTrigger.slice(1), { visible: false })).found) {
        return true;
    }
    try {
        return (await page.getByText('Start a post', { exact: true }).count()) > 0;
    } catch {
        return false;
    }
};

/**
 * Site-owned config for the shared session check and operator CLI (ADR-032). The publish preflight
 * never forwards a headed fallback: it is the operator CLI's setting, and a refusal must never
 * escalate to a headed window on its own.
 */
export const LINKEDIN_CONFIG: ChannelBrowserConfig = {
    channel: TARGET,
    homeUrl: LINKEDIN_HOME_URL,
    isAuthenticated: isLinkedinAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
};

/**
 * Resolves the optional single image (`options.images ?? metadata.images`) without uploading:
 * a payload of at most one existing local image file, so a bad path is a fast pre-browser refusal
 * (0328 R1 "text plus one image").
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
            error: `metadata.images requests ${raw.length} images, over the LinkedIn cap of ${MAX_IMAGES} image per post; refusing rather than truncating`,
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
 * LinkedIn browser transport on the shared rails (ADR-027): a headless session preflight, one
 * headed flow, and success only from an observed signal. Live-only (0328 R1): `publishStatus` must
 * be `public` — LinkedIn's drafts are not addressable, so absent and `draft` refuse before the
 * browser.
 */
export class LinkedinBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: LinkedinOperation;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: LinkedinOperation = 'post',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a live feed post.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed site signal.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // Refusal order (all pre-browser): driver → publishStatus → body text → images → session
        // preflight. (The operation is resolved and refused in `resolveOperation` before any
        // transport exists.)
        if (this.driver !== 'script') {
            return fail(`unsupported driver '${bounded(this.driver)}' for linkedin: expected one of script`);
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested === undefined || requested === 'draft') {
            return fail(
                `linkedin has no draft mode: publishStatus ${requested === undefined ? 'is absent' : "'draft'"} refuses before the browser — LinkedIn drafts are not addressable, set publishStatus: public to publish live`,
            );
        }
        if (requested !== 'public') {
            return fail(`unknown publishStatus '${bounded(requested)}' for linkedin: only 'public' publishes`);
        }
        const text = payload.content.body.trim();
        if (text.length === 0) {
            return fail('linkedin post requires non-empty Content.body text (the composer has no title field)');
        }
        const length = [...text].length;
        if (length > MAX_TEXT_CHARS) {
            return fail(
                `linkedin post text is ${length} code points, over the ${MAX_TEXT_CHARS}-character limit: linkedin-pub never truncates`,
            );
        }
        const images = await resolveImages(payload.options, payload.content);
        if ('error' in images) return fail(images.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(LINKEDIN_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                `${TARGET} session preflight refused — run: ${LINKEDIN_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: LINKEDIN_HOME_URL,
                    isAuthenticated: isLinkedinAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runPostFlow(page, text, images.paths, profileDir),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                needsLogin(error)
                    ? `${TARGET} session failed — run: ${LINKEDIN_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The feed-post flow: share box → modal editor fill → readback → image upload → baselines →
     * Post → confirmation. Success only from a fresh strong signal: a fresh post link whose card
     * read back the body, or a fresh success toast. Weak signals (editor cleared, modal closed)
     * alone never report success, and every stage failure is typed so a drifted selector is loud.
     */
    private async runPostFlow(
        page: Page,
        text: string,
        images: readonly string[],
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: this.operation, driver: this.driver, publishStatus: 'public', profileDir };

        // Share box. A missing trigger is the typed stage failure — the page never reached the
        // composer (logged-out feed or selector drift).
        let triggerSelector: string;
        try {
            triggerSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.shareTrigger, {
                timeoutMs: this.stepTimeoutMs,
                label: 'linkedin share box',
            });
        } catch {
            return stageFail(
                `linkedin share box not found on ${LINKEDIN_HOME_URL} (session may be logged out, or the selector drifted) — run: ${LINKEDIN_LOGIN_INSTRUCTION}`,
                'share-trigger',
                metadata,
            );
        }
        await page.locator(triggerSelector).first().click();

        // Modal editor. A missing editor after the click is the same loud typed refusal family.
        let composerSelector: string;
        try {
            composerSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.composer, {
                timeoutMs: this.stepTimeoutMs,
                label: 'linkedin composer',
            });
        } catch {
            return stageFail(
                `linkedin composer did not open after the share box (selector drift) — run: ${LINKEDIN_LOGIN_INSTRUCTION}`,
                'composer',
                metadata,
            );
        }
        const composer = page.locator(composerSelector).first();
        if (typeof composer.pressSequentially === 'function') {
            // tiptap/ProseMirror (measured 2026-11-16): `fill()` writes the DOM without the editor's
            // state, so the footer Post control never renders. Type real key events — the same trap
            // as X's Draft.js. A page stub without pressSequentially keeps the fill path.
            await composer.click();
            await composer.pressSequentially(text, { delay: 3 });
        } else {
            await composer.fill(text);
        }

        // Readback before anything else: a field the editor dropped must never be submitted.
        const readback = await this.requireReadback(page, composerSelector, text);
        if (!readback.ok) return stageFail(readback.error, 'text-readback', metadata);

        // Image upload: confirmed landed; an unconfirmed upload refuses before submit — never a
        // silent text-only post while an image was requested.
        const [image] = images;
        if (image !== undefined) {
            const uploaded = await this.uploadImage(page, image);
            if (!uploaded.ok) return stageFail(uploaded.error, 'image-upload', metadata);
        }

        // Baselines before submit: only fresh toast and fresh post-link signals can confirm.
        const toastsBefore = new Set(await this.readToasts(page));
        const beforeLinks = await this.readPostLinks(page);

        // Send: the Post control inside the share dialog.
        const sendSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.send, {
            timeoutMs: this.stepTimeoutMs,
            label: 'linkedin Post button',
        });
        const send = page.locator(sendSelector).first();
        const enabled = await expectOutcome(async () => ((await send.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'linkedin Post button enabled',
        });
        if (!enabled.ok)
            return stageFail(
                `linkedin Post button never became clickable — ${enabled.error}`,
                'send-enabled',
                metadata,
            );
        await send.click();

        // Confirmation: a failure toast fails fast; otherwise the fresh post link is preferred so
        // the Result can carry the created post's url/id, with the fresh success toast as the
        // remaining strong receipt.
        const confirmed = await expectOutcome(() => this.probeConfirmation(page, text, beforeLinks, toastsBefore), {
            timeoutMs: this.stepTimeoutMs,
            label: 'linkedin publish confirmation',
        });
        if (!confirmed.ok) {
            return stageFail(`linkedin publish not confirmed — ${confirmed.error}`, 'confirmation', metadata);
        }
        if (confirmed.evidence.startsWith('failure-toast: ')) {
            return stageFail(
                `linkedin send failed — site reported: ${confirmed.evidence.slice('failure-toast: '.length)}`,
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
            message: `linkedin post published live in profile ${profileDir}${url === undefined ? ' (success-toast receipt; no post URL read back)' : ''}`,
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
            { timeoutMs: this.stepTimeoutMs, label: 'linkedin composer text readback' },
        );
    }

    /**
     * Uploads the one requested image through the composer-scoped file input and confirms it
     * landed. The input is provisional (see `LINKEDIN_POST_SELECTORS`), so an absent input is a
     * typed refusal, never a text-only submit; landing is the dialog's media-node count rising by
     * one after the upload.
     */
    private async uploadImage(
        page: Page,
        image: string,
    ): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
        try {
            const media = await trySelectors(page, LINKEDIN_POST_SELECTORS.mediaButton);
            if (media.found) {
                await page
                    .locator(media.selector ?? LINKEDIN_POST_SELECTORS.mediaButton[0])
                    .first()
                    .click();
            }
            const inputSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'linkedin file input',
            });
            const before = Number(await page.evaluate(mediaEvidenceScript()));
            await uploadFile(page, inputSelector, image, { timeoutMs: this.stepTimeoutMs });
            const confirmed = await expectOutcome(
                async () => {
                    const count = Number(await page.evaluate(mediaEvidenceScript()));
                    return count >= before + 1 ? `media nodes ${before} → ${count}` : null;
                },
                { timeoutMs: PREVIEW_TIMEOUT_MS, pollMs: PREVIEW_POLL_MS, label: 'linkedin image preview evidence' },
            );
            if (!confirmed.ok) {
                return {
                    ok: false,
                    error: `linkedin composer preview never reached ${before + 1} media nodes (baseline ${before}) for the uploaded image`,
                };
            }
            return { ok: true, evidence: confirmed.evidence };
        } catch (error) {
            return { ok: false, error: `linkedin image upload failed — ${errorMessage(error)}` };
        }
    }

    /** Visible toast texts (provisional containers), used as the pre-send baseline. */
    private async readToasts(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(toastTextsScript()));
    }

    /** A toast carrying `pattern` that was not already on screen before the send. */
    private async findFreshToast(page: Page, pattern: RegExp, before: ReadonlySet<string>): Promise<string | null> {
        return (await this.readToasts(page)).find((text) => !before.has(text) && pattern.test(text)) ?? null;
    }

    /** Post-link hrefs currently on the page — the submit-time baseline. */
    private async readPostLinks(page: Page): Promise<readonly string[]> {
        return parseStringArray(await page.evaluate(postLinksScript()));
    }

    /**
     * One confirmation probe per poll: failure toast fails fast; otherwise a fresh post link whose
     * card contains the body excerpt, or a fresh success toast.
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

/** Post id from an observed LinkedIn post URL (activity id; extraction is provisional). */
function postIdFrom(url: string): string | undefined {
    return /activity[:_-](\d{6,})/i.exec(url)?.[1];
}

/** Reads the composer's text back (`textContent` — the grounded control is a contenteditable div). */
function editorTextScript(selector: string): string {
    return `(() => { // kk-linkedin-editor-text
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.textContent ?? '').trim();
})()`;
}

/**
 * Media-node count inside the share dialog — the landed-preview predicate; the dialog scope is
 * provisional (the composer renders in a `[role="dialog"]` layer).
 */
function mediaEvidenceScript(): string {
    return `(() => { // kk-linkedin-media-evidence
    const scope = document.querySelector('[role="dialog"]') || document;
    return scope.querySelectorAll('img[src], video[src], video source[src], [style*="background-image"]').length;
})()`;
}

/** Visible toast texts, used as the pre-send baseline and as the fresh-signal read (provisional). */
function toastTextsScript(): string {
    return `(() => { // kk-linkedin-toasts
    const nodes = document.querySelectorAll('${TOAST_CONTAINERS}');
    const texts = [];
    for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text.length > 0) texts.push(text);
    }
    return JSON.stringify(texts);
})()`;
}

/** All post-link hrefs on the page, for the submit-time baseline. */
function postLinksScript(): string {
    return `(() => { // kk-linkedin-post-links
    return JSON.stringify(Array.from(document.querySelectorAll('${POST_LINK_SELECTOR}')).map((a) => a.href).filter(Boolean));
})()`;
}

/**
 * The first post link that was not on the page before the send and whose containing card read back
 * the body excerpt. `''` means "no signal yet".
 */
function freshPostLinkScript(before: readonly string[], wanted: string): string {
    return `(() => { // kk-linkedin-fresh-post-link
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
 * LinkedIn browser transport.
 * @param operation - Resolved operation (`post`).
 * @param driver - Resolved driver; only `script` is declared.
 * @returns The publish transport for this channel.
 */
export function getPublishTransport(
    operation: LinkedinOperation = 'post',
    driver: BrowserDriver = 'script',
): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeBrowserTransport('script');
    return new LinkedinBrowserTransport(operation, driver);
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
    if (typeof driverMode !== 'string') {
        await writePublishResult(outputPath, fail(driverMode.error));
        throw new Error(driverMode.error);
    }
    const resolved = transport ?? getPublishTransport(mode.operation, driverMode);
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
        echoError(`Invalid arguments: ${error instanceof Error ? error.message : String(error)}`);
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
        echoError(`linkedin-pub failed: ${boundedDetail(errorMessage(error))}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
