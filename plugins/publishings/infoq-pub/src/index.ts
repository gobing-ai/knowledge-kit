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
    waitUntil,
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

/** Channel slug: names the Result target and resolves the `INFOQ_PROFILE_DIR` tier. */
export const CHANNEL = 'infoq';
const TARGET = 'infoq';
/**
 * InfoQ's write page. The wt seed tries `/write`, `/write/article/new` and `/article/create`
 * (`infoq-playwright.ts:545-547`); the operator dogfood re-measures this one.
 */
export const EDITOR_URL = 'https://xie.infoq.cn/write';
/** Login/SSO URLs that mean "not authenticated" — the editor never renders behind them. */
export const LOGIN_URL_RE = /(account\.infoq\.cn|\/login)/;

/**
 * Selectors measured against the InfoQ editor (wt seed `infoq-playwright.ts:26-62`); each list is
 * tried in order and the operator dogfood re-measures them. `live` is `提交`, InfoQ's submit for
 * editorial review — the site has no self-publish control.
 */
export const SELECTORS = {
    title: ['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'],
    summary: ['input[placeholder*="摘要"]', 'textarea[placeholder*="摘要"]', 'input[name="summary"]'],
    body: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]'],
    draft: ['button:has-text("保存草稿")'],
    live: ['button:has-text("提交")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, page HTML or stack. */
const LOGIN_INSTRUCTION = 'bun plugins/publishings/infoq-pub/src/profile-check.ts login';
/** A saved draft lands on a URL carrying its article id; a query-string move is not a signal. */
const DRAFT_URL_ID_RE = /\/(\d{4,}|[0-9a-f]{16,})(?:\/|$|\?)/;
const DRAFT_TOASTS = ['保存成功', '已保存'];
const LIVE_TOASTS = ['提交成功', '审核'];

/**
 * InfoQ-owned readiness predicate: the editor is reachable (no SSO redirect) and the title field
 * is attached. Shared by the publish preflight and the profile-session CLI (R1, R5).
 */
export const isAuthenticated: IsAuthenticatedPredicate = async (page) =>
    !LOGIN_URL_RE.test(page.url()) && (await trySelectors(page, SELECTORS.title, { visible: false })).found;

/** Site-owned config for the shared session check and operator CLI (0183). */
export const CONFIG: ChannelBrowserConfig = {
    channel: CHANNEL,
    homeUrl: EDITOR_URL,
    isAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
};

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

/**
 * First candidate selector with an attached match, polled to the deadline. Attachment — not
 * visibility — is the readiness signal here: InfoQ keeps the editor's inputs attached behind a
 * collapsing layout, and the shared `trySelectors` filters on visibility by default.
 */
async function findSelector(
    page: Page,
    selectors: readonly string[],
    what: string,
    timeoutMs: number,
): Promise<string> {
    const found: { selector: string | null } = { selector: null };
    const attached = await waitUntil(async () => {
        const result = await trySelectors(page, selectors, { visible: false });
        found.selector = result.selector;
        return result.found && result.selector !== null;
    }, timeoutMs);
    const selector = found.selector;
    if (!attached || selector === null) {
        throw new Error(`${what}: ${selectors.join(' | ')} not attached within ${timeoutMs}ms`);
    }
    return selector;
}

/**
 * Text of the first visible toast among `texts`, or null. `:text(…)` matches on a substring, so
 * the element's own text is returned rather than the candidate literal.
 */
async function readToast(page: Page, texts: readonly string[]): Promise<string | null> {
    for (const text of texts) {
        const locator = page.locator(`:text("${text}")`).first();
        if ((await locator.count().catch(() => 0)) === 0) continue;
        if (!(await locator.isVisible().catch(() => false))) continue;
        const observed = (await locator.textContent().catch(() => null))?.trim();
        return observed !== undefined && observed.length > 0 ? observed : text;
    }
    return null;
}

export class InfoqBrowserTransport implements PublishTransport {
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
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CHANNEL, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed
        // visit, so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${CHANNEL} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`);
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: EDITOR_URL,
                    isAuthenticated,
                    // Headed by default (sites bot-wall headless loads); the headless preflight
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
     * The site-owned editor flow: title → optional summary → ProseMirror paste → draft control,
     * plus the submit control only for `publishStatus === 'public'`. Every outcome comes from an
     * `expectOutcome` probe, so a click without an observed signal is never a success (E91-D6).
     */
    private async runEditorFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        profileDir: string,
    ): Promise<Result> {
        const metadata = { driver: this.driver, publishStatus, profileDir };

        const titleSelector = await findSelector(page, SELECTORS.title, 'title input', this.stepTimeoutMs);
        await page
            .locator(titleSelector)
            .first()
            .fill(content.title ?? '');

        const summary = content.metadata?.summary;
        if (typeof summary === 'string' && summary.length > 0) {
            const summarySelector = await findSelector(page, SELECTORS.summary, 'summary input', this.stepTimeoutMs);
            await page.locator(summarySelector).first().fill(summary);
        }

        const bodySelector = await findSelector(page, SELECTORS.body, 'body editor', this.stepTimeoutMs);
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });

        const urlBeforeSave = page.url();
        const draftSelector = await findSelector(page, SELECTORS.draft, 'draft control', this.stepTimeoutMs);
        await page.locator(draftSelector).first().click();

        const draft = await expectOutcome(() => probeDraft(page, urlBeforeSave), {
            timeoutMs: this.stepTimeoutMs,
            label: `infoq draft save '${draftSelector}'`,
        });
        if (!draft.ok) return fail(draft.error);
        // The probe only returns a URL that moved and carried an id, so a capture exists exactly
        // for that branch; a toast text carries none.
        const id = DRAFT_URL_ID_RE.exec(draft.evidence)?.[1];

        if (publishStatus === 'draft') {
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(id === undefined ? {} : { id }),
                url: page.url(),
                message: `${TARGET} draft saved (unpublished) in profile ${profileDir}`,
                metadata,
            });
        }

        const liveSelector = await findSelector(page, SELECTORS.live, 'submit control', this.stepTimeoutMs);
        // Captured at the click, not at the draft: the draft run already moved the URL, and a
        // pre-draft baseline would read that move as the submit's own outcome.
        const urlBeforeSubmit = page.url();
        await page.locator(liveSelector).first().click();
        const live = await expectOutcome(() => probeLive(page, urlBeforeSubmit), {
            timeoutMs: this.stepTimeoutMs,
            label: `infoq submit '${liveSelector}'`,
        });
        if (!live.ok) return fail(live.error);

        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url: page.url(),
            message: `${TARGET} submitted for InfoQ editorial review`,
            metadata,
        });
    }
}

/**
 * Draft evidence (E91-D6): the editor URL moved onto an article id, or a visible save toast.
 * A URL that merely gained a query parameter is not evidence of a saved draft.
 */
async function probeDraft(page: Page, urlBeforeSave: string): Promise<string | null> {
    const url = page.url();
    if (url !== urlBeforeSave && DRAFT_URL_ID_RE.test(url)) return url;
    return readToast(page, DRAFT_TOASTS);
}

/** Live evidence: a visible submit toast, or a URL that moved off the URL the draft run left. */
async function probeLive(page: Page, urlBeforeSave: string): Promise<string | null> {
    const toast = await readToast(page, LIVE_TOASTS);
    if (toast !== null) return toast;
    const url = page.url();
    return url === urlBeforeSave ? null : url;
}

export function getPublishTransport(driver: BrowserDriver = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport('script');
    }
    return new InfoqBrowserTransport(driver);
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
        echoError(`infoq-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
