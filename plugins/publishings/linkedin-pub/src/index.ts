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
        // Measured 2026-11-20: `text="Start a post"` resolves to the inner text node's element, and
        // clicking THAT does not open the composer (the run then timed out in the composer stage and
        // reported "composer did not open … selector drift"). The has-text forms hit the clickable
        // ancestor; the text form stays last for the previous UI.
        'button:has-text("Start a post")',
        'div[role="button"]:has-text("Start a post")',
        'text="Start a post"',
        'button.share-box-feed-entry__trigger',
        'button[aria-label*="Start a post" i]',
    ],
    composer: [
        // Measured 2026-11-20: the editor IS the ProseMirror element (`div[role=textbox]
        // [contenteditable=true].tiptap.ProseMirror`), not a descendant of it.
        'div.ProseMirror[contenteditable="true"]',
        'div[role="textbox"][contenteditable="true"]',
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
        // Measured 2026-11-20: a plain `<button>` whose text is exactly Post, inside a composer that
        // carries NO dialog role — the dialog-scoped forms below could never match.
        'button:text-is("Post")',
        'div[role="button"]:text-is("Post")',
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
/** Best-effort async OG link-preview unfurl wait (measured 2026-11-21: ~1s live). */
const LINK_PREVIEW_TIMEOUT_MS = 10_000;

const STEP_TIMEOUT_MS = 30_000;
/**
 * Default budget for the read-only session preflight. The harness subtracts a print margin and a
 * launch reserve from whatever it is given, so the 30 s STEP_TIMEOUT_MS became an ~18 s pass — and on
 * 2026-11-24 that was short enough that a freshly signed-in profile reported "not confirmed", after
 * which LinkedIn cleared `li_at` and the sign-in was lost. 90 s covers a cold headed feed load.
 * An explicit `stepTimeoutMs` dep overrides it, so tests and callers that tune the step budget also
 * tune the preflight.
 */
const PREFLIGHT_TIMEOUT_MS = 90_000;
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
 * LinkedIn's session ticket. The readiness predicate only sees the rendered page, so a profile can
 * pass it and still carry no session at all — the measured 2026-11-24 shape was `li_at` at 0 rows
 * (`select count(*) from cookies where name='li_at'`) after two separate operator sign-ins. Name
 * only: this module never reads, logs or returns the value.
 */
export const LINKEDIN_AUTH_COOKIE = 'li_at';

/** The cookie facts this assertion reads — everything but the value. */
export interface StoredCookie {
    name: string;
    value?: string;
    /** Seconds since the epoch; Playwright reports a session cookie as `-1`. */
    expires?: number;
}

/**
 * `true` when the jar holds a usable {@link LINKEDIN_AUTH_COOKIE} (0436 R4). A non-empty value that
 * has not expired is the whole test: an expired or empty ticket cannot authenticate anything, so
 * reporting a login from it would leave exactly the profile every later check calls "expired".
 */
export function hasLinkedinAuthCookie(cookies: readonly StoredCookie[], nowMs: number = Date.now()): boolean {
    return cookies.some(
        (cookie) =>
            cookie.name === LINKEDIN_AUTH_COOKIE &&
            (cookie.value ?? '') !== '' &&
            (cookie.expires === undefined || cookie.expires <= 0 || cookie.expires * 1000 > nowMs),
    );
}

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
    // Headless with a SIGNED-IN profile lands on the login wall (measured 2026-11-24: `check`
    // refused in 68 s while `check --headed` verified on the same profile, and the same pair of
    // launches repeated after two operator sign-ins). A headless preflight pass is therefore a
    // guaranteed burn, and the post flow is headed anyway — so the preflight probes headed, the
    // same shape medium-pub carries for its Cloudflare interstitial.
    checkHeadedOnly: true,
    // This channel has no `storageState` artifact — the profile's own cookie store is the session —
    // so the hook is used as the post-login ASSERTION instead of a capture: a sign-in the page
    // predicate accepted but that stored no auth ticket fails here, at the login that produced it,
    // rather than silently leaving a profile every later `check` refuses (0436 R4). A hook throw
    // already fails the verb and suppresses the `verified` verdict, so the bot parent promotes
    // nothing. No cookie name/value pair is ever logged: the message names the cookie only.
    sessionState: {
        onAuthenticated: async ({ context }) => {
            const cookies = await context.cookies(LINKEDIN_HOME_URL).catch(() => [] as StoredCookie[]);
            if (hasLinkedinAuthCookie(cookies)) return;
            throw new Error(
                `the sign-in stored no ${LINKEDIN_AUTH_COOKIE} session cookie in this profile, so no session was ` +
                    `saved — confirm the browser shows your own feed after signing in, then run ${LINKEDIN_LOGIN_INSTRUCTION} again`,
            );
        },
    },
};

/**
 * Resolves the optional single image (`options.images ?? metadata.images ?? metadata.coverImage`)
 * without uploading: a payload of at most one existing local image file, so a bad path is a fast
 * pre-browser refusal (0328 R1 "text plus one image").
 */
async function resolveImages(
    options?: Record<string, unknown>,
    content?: Content,
): Promise<{ paths: string[] } | { error: string }> {
    const rawImages = options?.images ?? content?.metadata?.images;
    const raw =
        rawImages !== undefined
            ? rawImages
            : content?.metadata?.coverImage !== undefined
              ? [content.metadata.coverImage]
              : undefined;
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
    private readonly preflightTimeoutMs: number;
    constructor(
        operation: LinkedinOperation = 'post',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.preflightTimeoutMs = deps.stepTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;
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
            // Headed, not headless: see LINKEDIN_CONFIG.checkHeadedOnly (measured 2026-11-24).
            headedOnly: LINKEDIN_CONFIG.checkHeadedOnly === true,
            timeoutMs: this.preflightTimeoutMs,
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
        // The share box is a React target that can be clicked before the feed finishes hydrating
        // (measured 2026-11-20: one run opened the composer, the next did not with the same session),
        // so the click is retried once against a freshly resolved trigger before failing.
        let composerSelector: string;
        try {
            composerSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.composer, {
                timeoutMs: Math.min(this.stepTimeoutMs, 15_000),
                label: 'linkedin composer',
            });
        } catch {
            const retryTrigger = await resolveSelector(page, LINKEDIN_POST_SELECTORS.shareTrigger, {
                timeoutMs: 10_000,
                label: 'linkedin share box retry',
            }).catch(() => null);
            if (retryTrigger !== null)
                await page
                    .locator(retryTrigger)
                    .first()
                    .click()
                    .catch(() => {});
            composerSelector = await resolveSelector(page, LINKEDIN_POST_SELECTORS.composer, {
                timeoutMs: this.stepTimeoutMs,
                label: 'linkedin composer (after retry)',
            }).catch(() => '');
        }
        if (composerSelector === '') {
            return stageFail(
                `linkedin composer did not open after the share box, twice (selector drift) — run: ${LINKEDIN_LOGIN_INSTRUCTION}`,
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
        // silent text-only post while an image was requested. When posting a URL with no image,
        // wait briefly (best-effort) for LinkedIn to finish attaching the async OG link-preview card.
        const [image] = images;
        if (image !== undefined) {
            const uploaded = await this.uploadImage(page, image);
            if (!uploaded.ok) return stageFail(uploaded.error, 'image-upload', metadata);
        } else {
            await this.waitForLinkPreview(page, composerSelector, text);
        }

        // Baselines before submit: only fresh toast and fresh post-link signals can confirm.
        const toastsBefore = new Set(await this.readToasts(page));
        const beforeLinks = await this.readPostLinks(page);

        // Send: the Post control inside the share dialog.
        // Prefer the role engine. The composer's Post is a plain `<button>Post</button>` that is
        // visible and enabled in the captured state (2026-11-20 screenshot) while every CSS form in
        // the list failed to resolve — the same class of miss the threads rail hit with `text-is`
        // against a styled label. `getByRole` names the control as the user sees it; the composer's
        // Post is the LAST match because the feed's own Post entry point sits above it.
        const roleEngine = page as unknown as {
            getByRole?: (
                role: string,
                options: { name: string; exact: boolean },
            ) => { count(): Promise<number>; last(): { click(options?: { timeout?: number }): Promise<unknown> } };
        };
        const rolePost = roleEngine.getByRole?.('button', { name: 'Post', exact: true });
        const roleCount = rolePost === undefined ? 0 : await rolePost.count().catch(() => 0);
        const sendSelector =
            roleCount > 0
                ? 'role:Post'
                : await resolveSelector(page, LINKEDIN_POST_SELECTORS.send, {
                      timeoutMs: this.stepTimeoutMs,
                      label: 'linkedin Post button',
                  }).catch(async (error: unknown) => {
                      // The composer is a plain overlay (no dialog role), so a selector list that matches only
                      // inside `[role="dialog"]` reads as "not attached" while Post is plainly on screen. Report
                      // what the composer actually holds — and whether it is still open — instead of the list.
                      const state = await page
                          .evaluate(`(() => {
                    const editor = document.querySelector('div.ProseMirror[contenteditable="true"], div[role="textbox"][contenteditable="true"]');
                    const buttons = [...document.querySelectorAll('button, div[role="button"]')]
                        .filter((n) => n.offsetWidth > 0)
                        .map((n) => (n.getAttribute('aria-label') || n.textContent || '').replace(/\\s+/g, ' ').trim())
                        .filter(Boolean).slice(-12);
                    return JSON.stringify({
                        composerOpen: editor !== null,
                        textLen: (editor?.textContent || '').trim().length,
                        buttons,
                    });
                })()`)
                          .catch(() => null);
                      // A screenshot is the only way to see WHICH overlay is covering Post when the DOM
                      // reports the composer open and the typed text present (2026-11-20: media step).
                      const shot = await page
                          .screenshot({ path: `/tmp/kk-linkedin-send-${Date.now()}.png` })
                          .then((buffer: unknown) =>
                              typeof buffer === 'string' ? buffer : `/tmp/kk-linkedin-send.png`,
                          )
                          .catch(() => null);
                      await page.screenshot({ path: '/tmp/kk-linkedin-send-latest.png' }).catch(() => null);
                      throw new Error(
                          `${String((error as Error)?.message ?? error)}${state ? ` — composer ${state}` : ''}${shot ? ` — screenshot /tmp/kk-linkedin-send-latest.png` : ''}`,
                      );
                  });
        const send = sendSelector === 'role:Post' ? null : page.locator(sendSelector).first();
        const enabled = await expectOutcome(
            async () => {
                if (rolePost !== undefined && sendSelector === 'role:Post') {
                    return (await rolePost.count()) > 0 ? 'enabled' : null;
                }
                return send !== null && (await send.isEnabled()) ? 'enabled' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'linkedin Post button enabled' },
        );
        if (!enabled.ok)
            return stageFail(
                `linkedin Post button never became clickable — ${enabled.error}`,
                'send-enabled',
                metadata,
            );
        if (rolePost !== undefined && sendSelector === 'role:Post') {
            await rolePost.last().click({ timeout: this.stepTimeoutMs });
        } else if (send !== null) {
            await send.click();
        }

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
            const mediaNext = (
                page as unknown as {
                    getByRole?: (
                        role: 'button',
                        opts: { name: RegExp },
                    ) => {
                        count(): Promise<number>;
                        first(): { click(opts?: { timeout?: number }): Promise<unknown> };
                    };
                }
            ).getByRole?.('button', { name: /^(?:Next|Done)$/i });
            if (mediaNext !== undefined && (await mediaNext.count()) > 0) {
                await mediaNext.first().click({ timeout: this.stepTimeoutMs });
                await expectOutcome(async () => ((await mediaNext.count()) === 0 ? 'media editor closed' : null), {
                    timeoutMs: Math.min(this.stepTimeoutMs, 10_000),
                    label: 'linkedin media editor close',
                });
            }
            return { ok: true, evidence: confirmed.evidence };
        } catch (error) {
            return { ok: false, error: `linkedin image upload failed — ${errorMessage(error)}` };
        }
    }

    /** Best-effort wait for LinkedIn's async OG card fetch when posting a URL without an image. */
    private async waitForLinkPreview(page: Page, composerSelector: string, text: string): Promise<void> {
        const host = extractUrlHost(text);
        if (host === null) return;
        await expectOutcome(
            async () => {
                const hit = String(
                    await page.evaluate(linkPreviewScript(composerSelector, host)).catch(() => ''),
                ).trim();
                return hit.length > 0 ? 'link preview attached' : null;
            },
            {
                timeoutMs: Math.min(this.stepTimeoutMs, LINK_PREVIEW_TIMEOUT_MS),
                pollMs: PREVIEW_POLL_MS,
                label: 'linkedin link preview',
            },
        );
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
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter((n) => n.offsetWidth > 0);
    const scope = dialogs.length > 0 ? dialogs[dialogs.length - 1] : document;
    return scope.querySelectorAll('img[src], video[src], video source[src], [style*="background-image"]').length;
})()`;
}

/** Extracts a lowercase hostname from the first HTTP(S) URL in post text, if parseable. */
function extractUrlHost(text: string): string | null {
    const match = /https?:\/\/[^\s)>"'<>]+/i.exec(text);
    if (!match) return null;
    const cleaned = match[0].replace(/[.,;:!?。，；！？]+$/, '');
    try {
        return new URL(cleaned).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Detects an asynchronously attached OG preview card inside the share composer without matching
 * text inside the editor itself (`img[src*="articleshare"]` or a leaf node displaying the URL host).
 */
function linkPreviewScript(composerSelector: string, host: string): string {
    return `(() => { // kk-linkedin-link-preview
    const editor = document.querySelector(${JSON.stringify(composerSelector)});
    if (!editor) return '';
    let scope = editor.parentElement;
    while (scope && scope.parentElement && scope !== document.body) {
        if ([...scope.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Post')) break;
        scope = scope.parentElement;
    }
    scope = scope || editor.closest('[role="dialog"]') || document.body;
    if (scope.querySelector('img[src*="articleshare"]')) return '1';
    const hostLower = ${JSON.stringify(host)};
    for (const node of scope.querySelectorAll('*')) {
        if (editor.contains(node) || node.contains(editor)) continue;
        if (node.children.length === 0 && (node.textContent || '').toLowerCase().includes(hostLower)) {
            return '1';
        }
    }
    return '';
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
