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
    DEFAULT_SIGNAL_CONTAINERS,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    pasteHtml,
    readScopedSignal,
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
 * The live entry to the InfoQ editor (measured 2026-10-06, tasks 0201 + 0191): the home page's
 * 写点什么 write button SPA-routes to `/draft/<id>`, where the draft already exists server-side.
 * The former `https://xie.infoq.cn/write` constant is dead — it renders an empty shell even
 * authenticated, with no editor and no login redirect.
 */
export const HOME_URL = 'https://xie.infoq.cn/';
/** The editor URL the entry flow lands on; the captured group is the server-side draft id. */
export const DRAFT_URL_RE = /\/draft\/(\d+)/;
/**
 * Login/SSO URLs that mean "not authenticated" — the editor never renders behind them. The SSO
 * domain moved from account.infoq.cn to account.geekbang.org (measured, task 0201). The home page
 * renders logged-out content without redirecting, so this regex is only the fast arm of the
 * readiness predicate below.
 */
export const LOGIN_URL_RE = /(account\.infoq\.cn|account\.geekbang\.org|\/login)/;

/**
 * Selectors measured against the live authenticated console (2026-10-06, tasks 0201 + 0191);
 * each list is tried in order. Measured absent and therefore removed: the summary field (the
 * console has no 摘要 input, so `metadata.summary` is not representable on InfoQ) and the draft
 * button (the editor autosaves — the save signal is the 已保存 indicator, not a click). `live`
 * is the 发布 control, a `div`: InfoQ submit goes to editorial review, the site has no
 * self-publish control.
 */
export const SELECTORS = {
    writeEntry: ['div.write-btn'],
    noticeDismiss: ['text=知道了'],
    title: ['input[placeholder="请输入标题"]', 'input[placeholder*="标题"]'],
    body: ['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]'],
    live: ['div.submit-btn'],
} as const;

/**
 * Per-step wait. Lower bound: the measured autosave indicator appears within ~6 s of content
 * entry (docs/design/infoq-ui-discovery.md:41, 0201 walk), so the window must cover the slow end
 * of that latency plus hydration; 30 s is the 5× margin. Unit tests override this for fakes that
 * resolve instantly.
 */
const STEP_TIMEOUT_MS = 30_000;

/**
 * Read-only session check budget, independent of {@link STEP_TIMEOUT_MS}: headed hydration of
 * the logged-in home has a slow tail (2.5-35 s measured on the operator profile, 0191 dogfood),
 * so one 30 s step window is not enough for the check.
 */
const CHECK_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 180_000;
/** Operator recovery command every session failure names — never a cookie, page HTML or stack. */
const LOGIN_INSTRUCTION = 'bun plugins/publishings/infoq-pub/src/profile-check.ts login';
/**
 * The draft-saved signal (measured, task 0201; re-walked 0191): the editor autosaves and shows
 * the 已保存 indicator — read only from the page's notification containers, never the article
 * body (residual 0195).
 */
const DRAFT_SAVED_TEXTS = ['已保存'];

/**
 * Signal containers for this channel: the shared toast/notice defaults plus the editor header's
 * persistent save indicator (`div.save-status`, measured 0191 re-dogfood — InfoQ now renders
 * `已保存 <timestamp>` there instead of a toast). Class-scoped, so the 0195 body false-positive
 * risk does not apply.
 */
const SIGNAL_CONTAINERS: readonly string[] = [...DEFAULT_SIGNAL_CONTAINERS, '[class*="save-status" i]'];
const LIVE_TOASTS = ['提交成功', '审核'];
/**
 * Page-side scan behind {@link isAuthenticated}: is a control labelled exactly 登录 visible?
 * Exact leaf text, because feed articles can carry the substring 登录 without the session being
 * logged out.
 */
const LOGGED_OUT_MARKER_SCRIPT = `(() => {
    for (const node of document.querySelectorAll('body *')) {
        if (node.children.length > 0) continue;
        if ((node.textContent ?? '').trim() !== '登录') continue;
        if (typeof node.checkVisibility === 'function' ? !node.checkVisibility() : node.getClientRects().length === 0) continue;
        return true;
    }
    return false;
})()`;

/**
 * InfoQ-owned readiness predicate: the home page has hydrated to the write entry and no 登录
 * control is visible (the logged-out marker). Shared by the publish preflight and the
 * profile-session CLI (R1, R5). Hydration gates the marker read: until the home chrome renders,
 * the 登录 control has not attached yet and a logged-out page false-reads logged-in (0201).
 */
export const isAuthenticated: IsAuthenticatedPredicate = async (page) =>
    !LOGIN_URL_RE.test(page.url()) &&
    (await trySelectors(page, SELECTORS.writeEntry, { visible: false })).found &&
    !(await page.evaluate(LOGGED_OUT_MARKER_SCRIPT));

/** Site-owned config for the shared session check and operator CLI (0183). */
export const CONFIG: ChannelBrowserConfig = {
    channel: CHANNEL,
    homeUrl: HOME_URL,
    isAuthenticated,
    loginTimeoutMs: LOGIN_TIMEOUT_MS,
    // The WAF 451s every headless load, so the profile-check CLI must not waste its first
    // pass headlessly either (measured 0201, re-confirmed 0191).
    checkHeadedOnly: true,
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
/**
 * The draft/live outcome, read only from the page's notification containers (residual 0195): an
 * unscoped `:text(...)` match also hits the article body this flow pasted a few steps earlier, so
 * a body containing `保存成功` reported a draft that was never saved.
 */
async function readToast(page: Page, texts: readonly string[]): Promise<string | null> {
    return readScopedSignal(page, texts, SIGNAL_CONTAINERS);
}

/**
 * Declared modes (ADR-029 dispatch; task 0205 R2): InfoQ's only console flow is the draft path; 提交 (editorial review) is live-only and not a mode. An unknown operation is refused by
 * name before a profile is resolved or a browser opens.
 */
export const INFOQ_OPERATIONS = ['draft'] as const;
export type InfoqOperation = (typeof INFOQ_OPERATIONS)[number];

/** Exit-early resolution of the requested operation; a default Content without one resolves to `draft`. */
export function resolveOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: InfoqOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation;
    if (raw === undefined) return { operation: 'draft' };
    if (typeof raw !== 'string' || !(INFOQ_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${String(raw)}' for infoq: expected one of ${INFOQ_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as InfoqOperation };
}

export class InfoqBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    private readonly checkTimeoutMs: number;

    constructor(
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number; checkTimeoutMs?: number } = {},
    ) {
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.checkTimeoutMs = deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(`unsupported driver '${this.driver}' for ${TARGET}`);
        }
        const mode = resolveOperation(payload.options, payload.content);
        if (mode.error !== undefined) return fail(mode.error);
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(`unknown publishStatus '${String(requested)}' (expected absent, 'draft' or 'public')`);
        }
        const publishStatus = requested === 'public' ? 'public' : 'draft';
        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CHANNEL, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never reach the editor
        // flow, so the read-only session check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(CONFIG, {
            profileDir,
            launcher: this.launcher,
            // InfoQ's WAF serves HTTP 451 to every headless page load (measured 0201, re-confirmed
            // 0191), so the check runs headed only — a headless pass is a guaranteed 30 s burn
            // that shortens the headed budget below the measured hydration tail. A
            // missing/expired profile still refuses before any flow opens (ADR-025 shape).
            headedOnly: true,
            timeoutMs: this.checkTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(`${CHANNEL} session preflight refused: ${session.detail} — run: ${LOGIN_INSTRUCTION}`);
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: HOME_URL,
                    isAuthenticated,
                    // Headed by default — InfoQ's WAF 451s every headless load (measured 0201,
                    // re-confirmed 0191; see the preflight comment); `options.headless === true`
                    // is an explicit opt-in that will fail loudly against that wall.
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
     * The site-owned editor flow (measured 0201 + 0191): home 写点什么 → the server-side draft
     * `/draft/<id>` → title → ProseMirror paste → autosave indicator. There is no draft click:
     * the entry itself created the draft, and the save is proven by the observed 已保存 signal.
     * The submit control is touched only for `publishStatus === 'public'`. Every outcome comes
     * from an `expectOutcome` probe, so a step without an observed signal is never a success
     * (E91-D6).
     */
    private async runEditorFlow(
        page: Page,
        content: Content,
        publishStatus: 'draft' | 'public',
        profileDir: string,
    ): Promise<Result> {
        const metadata = { driver: this.driver, publishStatus, profileDir };

        const entrySelector = await findSelector(page, SELECTORS.writeEntry, 'write entry', this.stepTimeoutMs);
        await page.locator(entrySelector).first().click();
        const entered = await waitUntil(() => Promise.resolve(DRAFT_URL_RE.test(page.url())), this.stepTimeoutMs);
        if (!entered) {
            throw new Error(
                `infoq editor entry: still on '${page.url()}' — no /draft/<id> within ${this.stepTimeoutMs}ms`,
            );
        }
        // The draft id exists before any content is typed: the entry itself created the draft.
        const id = DRAFT_URL_RE.exec(page.url())?.[1];
        await dismissNoticeModal(page, this.stepTimeoutMs);

        const titleSelector = await findSelector(page, SELECTORS.title, 'title input', this.stepTimeoutMs);
        await page
            .locator(titleSelector)
            .first()
            .fill(content.title ?? '');

        // No summary step: the measured console has no summary field (see SELECTORS).

        const bodySelector = await findSelector(page, SELECTORS.body, 'body editor', this.stepTimeoutMs);
        await pasteHtml(page, bodySelector, markdownToHtml(content.body), { timeoutMs: this.stepTimeoutMs });
        // pasteHtml sets innerHTML without an input event, so ProseMirror's autosave may not see
        // the change; dispatch one so the 已保存 indicator actually fires (measured 0191 probe:
        // the indicator appeared only after a real input event reached the editor).
        // String script: this plugin's tsconfig has no DOM lib, so the callback must not be TS.
        await page
            .evaluate(
                '(selector) => { const editor = document.querySelector(selector); editor && editor.dispatchEvent(new InputEvent("input", { bubbles: true })); }',
                bodySelector,
            )
            .catch(() => {});

        // Signal = the autosave 已保存 indicator, measured within ~6 s of paste (0201 walk);
        // the 30 s default window is the 5× margin (see STEP_TIMEOUT_MS).
        const draft = await expectOutcome(() => readToast(page, DRAFT_SAVED_TEXTS), {
            timeoutMs: this.stepTimeoutMs,
            label: 'infoq draft autosave',
        });
        if (!draft.ok) return fail(draft.error);

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
        // Captured at the click, not at the entry: the entry already moved the URL to
        // /draft/<id>, and an entry-time baseline would read that move as the submit's outcome.
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
 * The feature-notice modal overlays the editor and swallows click/fill events (measured 0201);
 * it is not always shown, so dismissal is a guarded no-op when absent.
 */
async function dismissNoticeModal(page: Page, timeoutMs: number): Promise<void> {
    const modal = page.locator(SELECTORS.noticeDismiss[0]).first();
    try {
        if ((await modal.count()) > 0) await modal.click({ timeout: Math.min(timeoutMs, 5_000) });
    } catch {
        // A modal that vanished between the count and the click needs no dismissal.
    }
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
