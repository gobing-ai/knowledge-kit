import { dirname } from 'node:path';
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
    markdownToHtml,
    pasteHtml,
    resolveChannelProfileDir,
    resolveSelector,
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

/** Channel slug: names the Result target and resolves the `SUBSTACK_PROFILE_DIR` tier. */
export const CHANNEL = 'substack';
const TARGET = 'substack';
/** Login/account URLs that mean "not authenticated" — the editor never renders behind them. */
export const LOGIN_URL_RE = /(\/sign-in|substack\.com\/account\/login)/;

/**
 * Selectors seeded from the wt script (`substack-playwright.ts:84-136`); each list is tried in
 * order and the operator dogfood (0193) re-measures them. `send` is Substack's
 * `Send to everyone now` — it emails every subscriber — so both live controls (E91-D5) are
 * reached only from the `public` branch, after the draft branch has already returned.
 */
export const SELECTORS = {
    title: ['[data-testid="title-input"]', 'textarea[placeholder="Title"]', 'input[placeholder="Title"]'],
    subtitle: ['[data-testid="subtitle-input"]', 'textarea[placeholder="Add a subtitle..."]'],
    body: ['.ProseMirror[contenteditable="true"]'],
    continue: ['[data-testid="continue-button"]', 'button:has-text("Continue")'],
    send: [
        '[data-testid="publish-button"]',
        'button:has-text("Send to everyone now")',
        'button:has-text("Publish now")',
    ],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, page HTML or stack. */
const LOGIN_INSTRUCTION = 'bun plugins/publishings/substack-pub/src/profile-check.ts login';
/** Substack autosaves and rewrites the editor URL onto `/publish/post/<id>`, the whole draft signal. */
const DRAFT_URL_RE = /\/publish\/post\/(\d+)/;
/** A live post lands on `/p/<slug>`; the publish queue is `/publish/posts/published`. */
const LIVE_URL_RE = /\/p\/[^/?#]+|\/publish\/posts\/published/;
/** Both places the publication URL can come from, named as one thing in every refusal. */
const PUBLICATION_URL_SOURCES = 'SUBSTACK_PUBLICATION_URL (or --publication <url>)';

/**
 * The publication's new-post editor: `${base}/publish/post/new`, where the base is the
 * publication URL without its trailing `/` or `/publish` (seed `substack-playwright.ts:237-244`).
 */
export function editorUrl(publicationUrl: string): string {
    const base = publicationUrl
        .trim()
        .replace(/\/$/, '')
        .replace(/\/publish$/, '');
    return `${base}/publish/post/new`;
}

/**
 * Resolves and validates the run's publication URL (R1, R5): `explicit` — a transport
 * `options.publicationUrl` or the CLI's `--publication` — wins over `SUBSTACK_PUBLICATION_URL`,
 * and a blank explicit value stays blank rather than falling through to the environment. Returns
 * the failure message naming both sources when the tier is unset or is not an `https:` URL, so a
 * publish run and a profile CLI refuse a bad URL identically, before any browser opens.
 */
export function resolvePublicationUrl(explicit?: string): { url: string } | { error: string } {
    const trimmed = (explicit ?? process.env.SUBSTACK_PUBLICATION_URL)?.trim() ?? '';
    if (trimmed.length === 0) {
        return { error: `substack publication URL is required: set ${PUBLICATION_URL_SOURCES}` };
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return { error: `substack publication URL is not a URL: '${trimmed}' — set ${PUBLICATION_URL_SOURCES}` };
    }
    if (parsed.protocol !== 'https:') {
        return { error: `substack publication URL must be https:, got '${trimmed}' — set ${PUBLICATION_URL_SOURCES}` };
    }
    // Nested editor paths are rejected (residual 0197): `…/publish/posts` used to pass validation
    // and then be mangled by `editorUrl` (`…/publish/posts/publish/post/new`), so a misconfigured
    // run reported an expired session instead of a configuration error. A trailing `/publish` is
    // accepted and stripped by `editorUrl` — that is the documented shape.
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    if (trimmedPath.length > 0 && trimmedPath !== '/publish') {
        return {
            error: `substack publication URL must be the publication root, optionally with a trailing /publish (e.g. https://name.substack.com), got '${trimmed}' — set ${PUBLICATION_URL_SOURCES}`,
        };
    }
    return { url: trimmed };
}

/**
 * Substack-owned readiness predicate: the editor is reachable (no login redirect) and the title
 * field is attached. Shared by the publish preflight and the profile-session CLI (R1, R5).
 */
export const isAuthenticated: IsAuthenticatedPredicate = async (page) =>
    !LOGIN_URL_RE.test(page.url()) && (await trySelectors(page, SELECTORS.title, { visible: false })).found;

/** Site-owned config for the shared session check and operator CLI (0183). */
export function channelConfig(publicationUrl: string): ChannelBrowserConfig {
    return {
        channel: CHANNEL,
        homeUrl: editorUrl(publicationUrl),
        isAuthenticated,
        loginTimeoutMs: LOGIN_TIMEOUT_MS,
    };
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Session failures whose one-liner must name the recovery command (R5). */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

export class SubstackBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly launcher?: BrowserLauncher;
    private readonly stepTimeoutMs: number;

    constructor(driver: BrowserDriver = 'script', deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {}) {
        this.driver = driver;
        this.launcher = deps.launcher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(`unsupported driver '${this.driver}' for ${TARGET}`);
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(`unknown publishStatus '${String(requested)}' (expected absent, 'draft' or 'public')`);
        }
        // Pre-validation, before any browser opens: the editor URL is publication-scoped, so an
        // unset or non-https publication URL has no safe default to fall back to (R1).
        const requestedUrl =
            typeof payload.options?.publicationUrl === 'string' ? payload.options.publicationUrl : undefined;
        const publication = resolvePublicationUrl(requestedUrl);
        if ('error' in publication) return fail(publication.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CHANNEL, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed
        // visit, so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(channelConfig(publication.url), {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${CHANNEL} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`);
        }

        const publishStatus = requested === 'public' ? 'public' : 'draft';
        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: editorUrl(publication.url),
                    isAuthenticated,
                    // Headed by default (Substack bot-walls headless loads); the headless preflight
                    // above is the unattended pass, `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is
                    // a bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runEditorFlow(page, payload.content, publishStatus, profileDir),
            );
        } catch (error) {
            const hint = needsLogin(error) ? ` — run: ${LOGIN_INSTRUCTION}` : '';
            return fail(`${errorMessage(error)}${hint}`);
        }
    }

    /**
     * The site-owned editor flow: title → optional subtitle → ProseMirror HTML paste → the draft
     * signal, then — for a live run only — `Continue` → `Send to everyone now` → the live signal.
     * Substack autosaves the draft, so the draft needs no button click and both outcomes come
     * from an `expectOutcome` probe (E91-D6): a wait without an observed signal is never a success.
     */
    private async runEditorFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        profileDir: string,
    ): Promise<Result> {
        const metadata = { driver: this.driver, publishStatus, profileDir };

        const titleSelector = await resolveSelector(page, SELECTORS.title, {
            timeoutMs: this.stepTimeoutMs,
            label: 'title input',
        });
        await page
            .locator(titleSelector)
            .first()
            .fill(content.title ?? '');

        const subtitle = content.metadata?.subtitle;
        if (typeof subtitle === 'string' && subtitle.length > 0) {
            const subtitleSelector = await resolveSelector(page, SELECTORS.subtitle, {
                timeoutMs: this.stepTimeoutMs,
                label: 'subtitle input',
            });
            await page.locator(subtitleSelector).first().fill(subtitle);
        }

        const bodySelector = await resolveSelector(page, SELECTORS.body, {
            timeoutMs: this.stepTimeoutMs,
            label: 'body editor',
        });
        // Substack's editor is ProseMirror rich text: the body goes in as rendered HTML through the
        // shared paste, never as plain markdown text (E91-D4).
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });

        const draft = await expectOutcome(() => probeDraft(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `substack draft signal in '${bodySelector}'`,
        });
        if (!draft.ok) return fail(draft.error);

        // The probe only ever returns a `/publish/post/<id>` URL, so this capture always resolves.
        const id = DRAFT_URL_RE.exec(draft.evidence)?.[1];
        if (publishStatus === 'draft') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(id === undefined ? {} : { id }),
                url: draft.evidence,
                message: `${TARGET} draft saved (unpublished) in profile ${profileDir}`,
                metadata,
            });
        }

        const continueSelector = await resolveSelector(page, SELECTORS.continue, {
            timeoutMs: this.stepTimeoutMs,
            label: 'continue control',
        });
        await page.locator(continueSelector).first().click();
        const sendSelector = await resolveSelector(page, SELECTORS.send, {
            timeoutMs: this.stepTimeoutMs,
            label: 'send control',
        });
        await page.locator(sendSelector).first().click();
        const live = await expectOutcome(() => probeLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `substack publish '${sendSelector}'`,
        });
        if (!live.ok) return fail(live.error);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: live.evidence,
            message: `${TARGET} published live in profile ${profileDir}`,
            metadata,
        });
    }
}

/** Draft evidence is URL-only by design: Substack's autosave rewrites `/publish/post/new`. */
async function probeDraft(page: Page): Promise<string | null> {
    const url = page.url();
    return DRAFT_URL_RE.test(url) ? url : null;
}

/** Live evidence is URL-only too: `/p/<slug>` (the published post) or the publish queue. */
async function probeLive(page: Page): Promise<string | null> {
    const url = page.url();
    return LIVE_URL_RE.test(url) ? url : null;
}

export function getPublishTransport(driver: BrowserDriver = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport('script');
    }
    return new SubstackBrowserTransport(driver);
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
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
    const result = ResultSchema.parse(await transport.publish({ content, options }));
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
        echoError(`substack-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
