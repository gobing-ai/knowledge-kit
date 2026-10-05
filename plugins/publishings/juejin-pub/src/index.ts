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
    fillCodeMirror,
    resolveChannelProfileDir,
    resolveSelector,
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

/** Channel slug: names the Result target and resolves the `JUEJIN_PROFILE_DIR` tier. */
export const CHANNEL = 'juejin';
const TARGET = 'juejin';
/** Juejin's new-draft editor — the seeded URL the operator dogfood re-measures (R1). */
export const EDITOR_URL = 'https://juejin.cn/editor/drafts/new?v=2';
/** Login/SSO URLs that mean "not authenticated" — the editor never renders behind them. */
export const LOGIN_URL_RE = /(\/login|passport\.juejin\.cn)/;

/**
 * Selectors measured against the Juejin editor (wt seed `juejin-playwright.ts:26-62`); each list is
 * tried in order and the operator dogfood re-measures them. `publish` opens the live popup and
 * `confirm` publishes it — both live-only (E91-D5).
 */
export const SELECTORS = {
    title: ['input.title-input', 'input[placeholder*="标题"]'],
    body: ['.bytemd-editor .CodeMirror', '.CodeMirror', '.cm-editor'],
    publish: ['button:has-text("发布")'],
    category: '.category-list .item',
    tagInput: '.tag-input input',
    confirm: ['button:has-text("确定并发布")'],
} as const;

const STEP_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Juejin autosaves the draft on input: the design's window before the one manual save key press. */
const AUTOSAVE_TIMEOUT_MS = 5_000;
const SAVE_KEY = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';
/** Operator recovery command every session failure names — never a cookie, page HTML or stack. */
const LOGIN_INSTRUCTION = 'bun plugins/publishings/juejin-pub/src/profile-check.ts login';
/** A saved draft lands on `/editor/drafts/<id>`; a live publish on `/post/<id>` or `/published/<id>`. */
const DRAFT_URL_RE = /\/editor\/drafts\/(\d+)/;
const LIVE_SIGNAL_RE = /juejin\.cn\/(post|published)\//;
const LIVE_URL_ID_RE = /juejin\.cn\/(?:post|published)\/(\d+)/;
const DRAFT_TOASTS = ['保存成功'];
const LIVE_TOASTS = ['发布成功'];

/**
 * Juejin-owned readiness predicate: the editor is reachable (no login redirect) and the title field
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

/** Validated live-run inputs: the publish popup cannot confirm without both (R4). */
interface LiveInputs {
    category: string;
    tags: string[];
}

/**
 * One run shape: a draft run needs nothing beyond the content, a live run carries the validated
 * popup inputs — so "live without a category or tags" is not a representable state.
 */
type EditorRun =
    | { publishStatus: 'draft'; profileDir: string }
    | { publishStatus: 'public'; live: LiveInputs; profileDir: string };

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
 * `确定并发布` needs a category and at least one tag, so a live run names the missing field instead
 * of opening a browser it cannot finish in. Returns the validated inputs, or the failure message.
 */
function liveInputs(content: Content): LiveInputs | string {
    const category = content.metadata?.category;
    if (typeof category !== 'string' || category.trim().length === 0) {
        return 'live publish requires content.metadata.category (a Juejin category name)';
    }
    const raw = content.metadata?.tags;
    const tags = Array.isArray(raw)
        ? raw.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        : [];
    // An absent, empty or partly unusable tag list is named as the missing field rather than
    // silently trimmed down to the tags that happened to parse.
    if (!Array.isArray(raw) || tags.length === 0 || tags.length !== raw.length) {
        return 'live publish requires content.metadata.tags (at least one non-empty tag)';
    }
    return { category: category.trim(), tags };
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

export class JuejinBrowserTransport implements PublishTransport {
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
        // Live pre-validation, before any browser opens: the popup's two prerequisites (R4).
        let live: LiveInputs | undefined;
        if (requested === 'public') {
            const inputs = liveInputs(payload.content);
            if (typeof inputs === 'string') return fail(inputs);
            live = inputs;
        }
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

        const run: EditorRun =
            live === undefined ? { publishStatus: 'draft', profileDir } : { publishStatus: 'public', live, profileDir };
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
                async ({ page }) => this.runEditorFlow(page, payload.content, run),
            );
        } catch (error) {
            const hint = needsLogin(error) ? ` — run: ${LOGIN_INSTRUCTION}` : '';
            return fail(`${errorMessage(error)}${hint}`);
        }
    }

    /**
     * The site-owned editor flow: title → markdown body → draft signal, then — for a live run only
     * — `发布` → category → tags → `确定并发布` → live signal. Every outcome comes from an
     * `expectOutcome` probe, so a wait or a click without an observed signal is never a success
     * (E91-D6), and a draft run never touches a live control (E91-D5).
     */
    private async runEditorFlow(page: Page, content: Content, run: EditorRun): Promise<Result> {
        const metadata = { driver: this.driver, publishStatus: run.publishStatus, profileDir: run.profileDir };

        const titleSelector = await resolveSelector(page, SELECTORS.title, {
            timeoutMs: this.stepTimeoutMs,
            label: 'title input',
        });
        await page
            .locator(titleSelector)
            .first()
            .fill(content.title ?? '');

        const bodySelector = await resolveSelector(page, SELECTORS.body, {
            timeoutMs: this.stepTimeoutMs,
            label: 'body editor',
        });
        // bytemd is CodeMirror over markdown: the body goes in as markdown, never as HTML (E91-D4).
        await fillCodeMirror(page, bodySelector, content.body, { timeoutMs: this.stepTimeoutMs });

        // Draft evidence (E91-D6): the autosave gets its window, then the manual save key is pressed
        // once when the page showed nothing. Success still needs the observed signal.
        const autosaveMs = Math.min(AUTOSAVE_TIMEOUT_MS, this.stepTimeoutMs);
        if (!(await waitUntil(async () => (await probeDraft(page)) !== null, autosaveMs))) {
            await page.keyboard.press(SAVE_KEY);
        }
        const draft = await expectOutcome(() => probeDraft(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `juejin draft save in '${bodySelector}'`,
        });
        if (!draft.ok) return fail(draft.error);

        if (run.publishStatus === 'draft') {
            const url = page.url();
            const id = idFromUrl(url);
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(id === undefined ? {} : { id }),
                url,
                message: `${TARGET} draft saved (unpublished) in profile ${run.profileDir}`,
                metadata,
            });
        }

        const publishSelector = await resolveSelector(page, SELECTORS.publish, {
            timeoutMs: this.stepTimeoutMs,
            label: 'publish control',
        });
        await page.locator(publishSelector).first().click();
        await fillPublishPopup(page, run.live, this.stepTimeoutMs);

        const confirmSelector = await resolveSelector(page, SELECTORS.confirm, {
            timeoutMs: this.stepTimeoutMs,
            label: 'confirm control',
        });
        await page.locator(confirmSelector).first().click();
        const live = await expectOutcome(() => probeLive(page), {
            timeoutMs: this.stepTimeoutMs,
            label: `juejin publish '${confirmSelector}'`,
        });
        if (!live.ok) return fail(live.error);

        const url = page.url();
        const id = idFromUrl(url);
        return ResultSchema.parse({
            ok: true,
            target: TARGET,
            ...(id === undefined ? {} : { id }),
            url,
            message: `${TARGET} published live in profile ${run.profileDir}`,
            metadata,
        });
    }
}

/**
 * Live popup (E91-D5): the category item whose text is exactly `metadata.category`, then every tag
 * typed into the tag input with `Enter`. Runs only on the `public` path — `发布` opens this popup.
 */
async function fillPublishPopup(page: Page, live: LiveInputs, timeoutMs: number): Promise<void> {
    await resolveSelector(page, [SELECTORS.category], { timeoutMs, label: 'category list' });
    const items = page.locator(SELECTORS.category);
    const total = await items.count();
    let picked = false;
    for (let index = 0; index < total; index += 1) {
        const item = items.nth(index);
        if (((await item.textContent()) ?? '').trim() === live.category) {
            await item.click();
            picked = true;
            break;
        }
    }
    if (!picked) {
        throw new Error(`category '${live.category}': no '${SELECTORS.category}' item matched its exact text`);
    }

    const tagSelector = await resolveSelector(page, [SELECTORS.tagInput], { timeoutMs, label: 'tag input' });
    for (const tag of live.tags) {
        const input = page.locator(tagSelector).first();
        await input.fill(tag);
        await input.press('Enter');
    }
}

/** The article id the observed URL carries: `/editor/drafts/<id>` (draft) or `/post/<id>` (live). */
function idFromUrl(url: string): string | undefined {
    return DRAFT_URL_RE.exec(url)?.[1] ?? LIVE_URL_ID_RE.exec(url)?.[1];
}

/** Draft evidence (E91-D6): the editor URL moved onto a draft id, or a visible `保存成功` toast. */
async function probeDraft(page: Page): Promise<string | null> {
    const url = page.url();
    if (DRAFT_URL_RE.test(url)) return url;
    return readToast(page, DRAFT_TOASTS);
}

/** Live evidence (E91-D6): a `/post/`- or `/published/`-shaped URL, or a visible `发布成功` toast. */
async function probeLive(page: Page): Promise<string | null> {
    const url = page.url();
    if (LIVE_SIGNAL_RE.test(url)) return url;
    return readToast(page, LIVE_TOASTS);
}

export function getPublishTransport(driver: BrowserDriver = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport('script');
    }
    return new JuejinBrowserTransport(driver);
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
        echoError(`juejin-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
