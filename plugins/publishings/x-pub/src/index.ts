import { createHmac, randomBytes } from 'node:crypto';
import { dirname, extname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    FakeBrowserTransport,
    FakeFileCliTransport,
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

/** Per-request timeout (ms) for the X API call — Bun's `fetch` has no default deadline (R5). */
const REQUEST_TIMEOUT_MS = 120_000;

const TARGET = 'x';
const TWEETS_URL = 'https://api.twitter.com/2/tweets';
const TOKEN_ENVS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'] as const;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function percentEncode(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** OAuth 1.0a user-context header for POST /2/tweets (JSON body is not signed). */
export function oauth1Header(opts: {
    method: string;
    url: string;
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
    nonce?: string;
    timestamp?: string;
}): string {
    const nonce = opts.nonce ?? randomBytes(16).toString('hex');
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000).toString();
    const params: Record<string, string> = {
        oauth_consumer_key: opts.consumerKey,
        oauth_nonce: nonce,
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: timestamp,
        oauth_token: opts.token,
        oauth_version: '1.0',
    };
    const baseParams = Object.keys(params)
        .sort()
        .map((key) => `${percentEncode(key)}=${percentEncode(params[key] ?? '')}`)
        .join('&');
    const base = [opts.method.toUpperCase(), percentEncode(opts.url), percentEncode(baseParams)].join('&');
    const signingKey = `${percentEncode(opts.consumerSecret)}&${percentEncode(opts.tokenSecret)}`;
    params.oauth_signature = createHmac('sha1', signingKey).update(base).digest('base64');
    const header = Object.keys(params)
        .sort()
        .map((key) => `${percentEncode(key)}="${percentEncode(params[key] ?? '')}"`)
        .join(', ');
    return `OAuth ${header}`;
}

/**
 * Declared modes (ADR-029 dispatch): `post` (API v2 transport) and `article` (browser composer).
 * An unknown operation is refused by name before any transport — and therefore before any
 * browser — is resolved (task 0205 R2).
 */
export const X_OPERATIONS = ['post', 'article'] as const;
export type XOperation = (typeof X_OPERATIONS)[number];

export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: XOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation ?? 'post';
    if (typeof raw !== 'string' || !(X_OPERATIONS as readonly string[]).includes(raw)) {
        return { error: `unsupported operation '${String(raw)}' for x: expected one of ${X_OPERATIONS.join(', ')}` };
    }
    return { operation: raw as XOperation };
}

export class XPostApiTransport implements PublishTransport {
    public readonly kind = 'file-cli';

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // 0330 R2: the post API publishes immediately — there is no draft. Intercept before the
        // credential lookup so a planned draft never touches X, and fail closed on unknown modes.
        const requestedStatus = payload.content.metadata?.publishStatus;
        if (requestedStatus === 'draft') {
            return fail(
                'x post has no draft: the post API publishes immediately — plan this target dummy/off or launch it live',
            );
        }
        if (requestedStatus !== undefined && requestedStatus !== 'public') {
            return fail(`unknown publishStatus '${String(requestedStatus)}' (expected absent, 'draft' or 'public')`);
        }
        const missing = TOKEN_ENVS.filter((key) => {
            const value = process.env[key];
            return !value || value.trim().length === 0;
        });
        if (missing.length > 0) {
            return fail(
                `${missing.join(', ')} environment variable${missing.length > 1 ? 's are' : ' is'} required: X developer user-context credentials. post does not fall back to a browser (X Automation Rules).`,
            );
        }
        const text = payload.content.body.trim() || payload.content.title?.trim() || '';
        if (text.length === 0) {
            return fail('X post requires Content.body or Content.title');
        }
        try {
            const authorization = oauth1Header({
                method: 'POST',
                url: TWEETS_URL,
                consumerKey: process.env.X_API_KEY ?? '',
                consumerSecret: process.env.X_API_SECRET ?? '',
                token: process.env.X_ACCESS_TOKEN ?? '',
                tokenSecret: process.env.X_ACCESS_TOKEN_SECRET ?? '',
            });
            const response = await fetch(TWEETS_URL, {
                method: 'POST',
                headers: {
                    Authorization: authorization,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ text: text.slice(0, 280) }),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                const errorText = (await response.text()).slice(0, 1000);
                return fail(
                    `X POST /2/tweets failed (HTTP ${response.status}): ${errorText.trim() || response.statusText}`,
                );
            }
            const json = (await response.json()) as { data?: { id?: unknown; text?: unknown } };
            if (typeof json.data?.id !== 'string') {
                return fail('X POST /2/tweets response missing data.id');
            }
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                id: json.data.id,
                url: `https://x.com/i/web/status/${json.data.id}`,
                message: 'Posted via X API v2',
                metadata: { operation: 'post' },
            });
        } catch (err: unknown) {
            return fail(`X post transport error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

/** Channel slug for the article browser session: resolves the `X_PROFILE_DIR` tier (unchanged). */
export const ARTICLE_CHANNEL = 'x';
/** X's Articles composer; the preflight and the editor visit both open it. */
export const X_ARTICLES_URL = 'https://x.com/compose/articles';
/** The draft signal: the editor URL X renders once the article exists — the only draft evidence. */
export const ARTICLE_EDIT_RE = /\/compose\/articles\/edit\/(\d+)/;
/** Login/redirect URLs that mean "not authenticated" — the composer never renders behind them. */
export const LOGIN_URL_RE = /(\/i\/flow\/login|\/login)/;

/**
 * Selectors seeded from the wt script (`x-article-playwright.ts:143-187`); each list is tried in
 * order. Measured live 2026-10-07 (0194): `write` candidate 1 and body candidate 1 hit; the title
 * is a two-step interaction — the `twitter-article-title` div is a collapsed display that mounts
 * the real `textarea[placeholder="Add a title"]` on click (handled in `runArticleFlow`); the
 * paste into the Draft.js container and the `/compose/articles/edit/<id>` signal were both
 * verified. `addPhotos` (`button[aria-label*="Add photos" i]`, "Add photos or video") is present
 * but is NOT clicked in the flow: opening the picker detaches the fileInput's handler and swallows
 * the set file (see the cover leg in `runArticleFlow`). The seed's `tweetButton`/`Tweet` candidates are dropped: they belong to the tweet
 * composer, and clicking one would post a tweet.
 */
export const ARTICLE_SELECTORS = {
    write: ['[data-testid="empty_state_button_text"]', 'button:has-text("Write")', '[aria-label*="Write" i]'],
    title: ['textarea[placeholder="Add a title"]', '[data-testid="twitter-article-title"]'],
    body: ['.DraftEditor-editorContainer [contenteditable="true"]', 'div[role="textbox"]'],
    addPhotos: ['[data-testid="addPhotoButton"]', 'button[aria-label*="Add photos" i]'],
    fileInput: ['[data-testid="fileInput"]', 'input[type="file"][accept*="image"]'],
    publish: ['[data-testid="publishButton"]', 'button:has-text("Publish")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, token, page HTML or stack. */
const LOGIN_INSTRUCTION = 'bun plugins/publishings/x-pub/src/profile-check.ts login';
/** A live article lands on a URL carrying the article id; the composer URL is `/edit/`. */
const LIVE_URL_ID_RE = /\/articles?\/(\d+)/;
/** Cover extensions accepted from `options.coverPath` / `metadata.coverImage` (R2). */
const COVER_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * X-owned readiness predicate: no login redirect and the article composer reachable (the write
 * control or the title field attached). Shared by the publish preflight and the profile CLI (R1, R5).
 */
export const isArticleAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (LOGIN_URL_RE.test(page.url())) return false;
    if ((await trySelectors(page, ARTICLE_SELECTORS.write, { visible: false })).found) return true;
    return (await trySelectors(page, ARTICLE_SELECTORS.title, { visible: false })).found;
};

/** Site-owned config for the shared session check and operator CLI (0183). */
export const ARTICLE_CONFIG: ChannelBrowserConfig = {
    channel: ARTICLE_CHANNEL,
    homeUrl: X_ARTICLES_URL,
    isAuthenticated: isArticleAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    // X login-walls headless article loads (measured 0216: the headless pass refuses even on a live
    // profile), so the default headless-first + headed-fallback spends two deadlines per check and
    // blows kk's 30s probe-kill (spawn SIGTERM → error instead of refused). One headed pass, like
    // infoq's WAF, keeps the probe inside the budget.
    checkHeadedOnly: true,
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Session failures whose one-liner must name the recovery command (R5). */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

/**
 * Resolves and validates the optional cover (R2): `options.coverPath` wins over
 * `metadata.coverImage`, and a given cover must be an absolute path to an existing
 * `.png|.jpg|.jpeg|.webp` file. Returns the failure message otherwise, so a bad cover is refused
 * **before** any browser opens.
 */
async function resolveCover(
    options: Record<string, unknown> | undefined,
    content: Content,
): Promise<{ path: string } | { error: string } | undefined> {
    const raw = options?.coverPath ?? content.metadata?.coverImage;
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `cover path must be a non-empty local file path, got '${String(raw)}'` };
    }
    if (!isAbsolute(raw)) {
        return { error: `cover path must be an absolute path, got '${raw}'` };
    }
    if (!COVER_EXTS.has(extname(raw).toLowerCase())) {
        return { error: `cover path must be a .png, .jpg, .jpeg or .webp file, got '${raw}'` };
    }
    if (!(await createNodeFileSystem().exists(raw))) {
        return { error: `cover file does not exist: '${raw}'` };
    }
    return { path: raw };
}

export class XArticleBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;

    constructor(driver: BrowserDriver = 'script', deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {}) {
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(`unsupported driver '${this.driver}' for x article`);
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(`unknown publishStatus '${String(requested)}' (expected absent, 'draft' or 'public')`);
        }
        // Pre-validation, before any browser opens: a given cover must be a usable local image (R2),
        // so a bad path is a fast refusal rather than a half-built draft.
        const cover = await resolveCover(payload.options, payload.content);
        if (cover !== undefined && 'error' in cover) return fail(cover.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(ARTICLE_CHANNEL, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed
        // visit, so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(ARTICLE_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${TARGET} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`);
        }

        const publishStatus = requested === 'public' ? 'public' : 'draft';
        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: X_ARTICLES_URL,
                    isAuthenticated: isArticleAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass,
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is
                    // a bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runArticleFlow(page, payload.content, publishStatus, cover?.path, profileDir),
            );
        } catch (error) {
            const hint = needsLogin(error) ? ` — run: ${LOGIN_INSTRUCTION}` : '';
            return fail(`${errorMessage(error)}${hint}`);
        }
    }

    /**
     * The site-owned composer flow: write → title → Draft.js HTML paste → optional cover → the
     * draft signal, then — for a live run only — the publish control and the live signal. Success
     * only from an `expectOutcome` probe (E91-D6): a wait without an observed signal is never a
     * success, and a draft run never clicks the publish control (E91-D5).
     */
    private async runArticleFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = { operation: 'article', driver: this.driver, publishStatus, profileDir };

        const writeSelector = await resolveSelector(page, ARTICLE_SELECTORS.write, {
            timeoutMs: this.stepTimeoutMs,
            label: 'write control',
        });
        await page.locator(writeSelector).first().click();

        // X collapses the title into a display div (`[data-testid="twitter-article-title"]`, text
        // `(Needs title)`); the real `textarea[placeholder="Add a title"]` is only mounted after
        // that div is clicked (measured live 2026-10-07, 0194). So: fill the textarea when it is
        // already attached, otherwise click the display div and fill the textarea it mounts.
        const titleInput = ARTICLE_SELECTORS.title[0];
        if ((await page.locator(titleInput).first().count()) === 0) {
            await page.locator(ARTICLE_SELECTORS.title[1]).first().click({ timeout: this.stepTimeoutMs });
        }
        const titleSelector = await resolveSelector(page, [titleInput], {
            timeoutMs: this.stepTimeoutMs,
            label: 'title input',
        });
        await page
            .locator(titleSelector)
            .first()
            .fill(content.title ?? 'Untitled');

        const bodySelector = await resolveSelector(page, ARTICLE_SELECTORS.body, {
            timeoutMs: this.stepTimeoutMs,
            label: 'body editor',
        });
        // X's article editor is Draft.js rich text: the body goes in as rendered HTML through the
        // shared paste, never as plain markdown text (E91-D4).
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });

        if (coverPath !== undefined) {
            // The base `fileInput` handles a set file directly: X itself opens an "Edit media" crop
            // dialog, and the cover attaches only when that dialog is confirmed with Apply.
            // Clicking the add-photos picker first detaches that handler — a file set while the
            // picker is open uploads nothing (measured live 2026-10-07, 0194). So: set the file,
            // click Apply, and require the cover image to render (E91-D6: observed outcome only).
            const fileInputSelector = await resolveSelector(page, ARTICLE_SELECTORS.fileInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'cover file input',
            });
            await uploadFile(page, fileInputSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
            // The crop dialog renders two identical "Edit media" layers; click the visible Apply.
            await page
                .locator('[role="dialog"] button:has-text("Apply") >> visible=true')
                .first()
                .click({ timeout: this.stepTimeoutMs });
            const attached = await expectOutcome(
                async () =>
                    (await page.evaluate(coverAttachedScript())) === true ? 'cover image rendered in composer' : null,
                { timeoutMs: this.stepTimeoutMs, label: 'cover attachment' },
            );
            if (!attached.ok) return fail(attached.error);
        }

        const draft = await expectOutcome(() => probeDraft(page), {
            timeoutMs: this.stepTimeoutMs,
            label: 'x article draft',
        });
        if (!draft.ok) return fail(draft.error);

        // The probe only ever returns a `/compose/articles/edit/<id>` URL, so this always resolves.
        const id = ARTICLE_EDIT_RE.exec(draft.evidence)?.[1];
        if (publishStatus === 'draft') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(id === undefined ? {} : { id }),
                url: draft.evidence,
                message: `${TARGET} article draft saved (unpublished) in profile ${profileDir}`,
                metadata,
            });
        }

        const publishSelector = await resolveSelector(page, ARTICLE_SELECTORS.publish, {
            timeoutMs: this.stepTimeoutMs,
            label: 'publish control',
        });
        await page.locator(publishSelector).first().click();
        const live = await expectOutcome(() => probeLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `x article publish '${publishSelector}'`,
        });
        if (!live.ok) return fail(live.error);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: live.evidence,
            message: `${TARGET} article published live in profile ${profileDir}`,
            metadata,
        });
    }
}

/** Draft evidence is URL-only by design: X autosaves the composer onto `/edit/<id>`. */
async function probeDraft(page: Page): Promise<string | null> {
    const url = page.url();
    return ARTICLE_EDIT_RE.test(url) ? url : null;
}

/** DOM probe script: true once a non-avatar twimg image — the just-attached cover — is rendered. */
function coverAttachedScript(): string {
    return `[...document.querySelectorAll('img[src*="twimg"]')].some((img) => !/profile_images/.test(img.src ?? ''))`;
}

/** Live evidence is URL-only too: a published article URL that left the `/edit/` composer. */
async function probeLive(page: Page): Promise<string | null> {
    const url = page.url();
    return !ARTICLE_EDIT_RE.test(url) && LIVE_URL_ID_RE.test(url) ? url : null;
}

export function getPublishTransport(operation: 'post' | 'article' = 'post'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return operation === 'article' ? new FakeBrowserTransport('script') : new FakeFileCliTransport();
    }
    return operation === 'article' ? new XArticleBrowserTransport() : new XPostApiTransport();
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

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
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const mode = resolveOperation(options, content);
    if (mode.error !== undefined) {
        await writePublishResult(outputPath, fail(mode.error));
        throw new Error(mode.error);
    }
    const operation = mode.operation;
    const resolved = transport ?? getPublishTransport(operation);
    const result = ResultSchema.parse(await resolved.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

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
        echoError(`x-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
