import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeFileCliTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
} from '@gobing-ai/publish-harness';
import { waitUntil } from '@gobing-ai/publish-harness/browser';
import { BrowserProfileMissingError, openPersistentBrowser } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { BrowserContext, Cookie, Page } from 'playwright';
import { markdownToWechatHtml, readDraftBaseline, runMode } from './flow';
import {
    CONSOLE_HOME_FRAGMENT,
    CONSOLE_URL,
    readConsoleToken,
    resolveWechatmpOperation,
    TARGET,
    validateModeInput,
    WECHATMP_OPERATIONS,
} from './modes';
import { type OpenConsole, type OpenedConsole, STEP_TIMEOUT_MS, wrapPlaywrightContext } from './page';

/**
 * The wechatmp publish CHANNEL (ADR-029, ADR-026): one plugin, four mode `operations`.
 *
 * This module owns what is channel-level — the profile dir, the session preflight (ADR-026: the
 * preflight plus the draft default ARE the automation guard, so no ADR-025 cap is ported), the
 * ADR-029 operation dispatch and pre-browser validation, the browser launch seam and the
 * `Content → Result` mapping. The modes themselves (entry, artifacts, selectors, save/publish flow)
 * live in `./modes`, `./flow` and `./enrich`.
 */

export const CHANNEL = TARGET;
export type { ModeInput, WechatmpOperation } from './modes';
export type { OpenConsole, OpenedConsole, WechatLocator, WechatPage } from './page';
export { wrapPlaywrightPage } from './page';
export { CONSOLE_URL, markdownToWechatHtml, runMode, WECHATMP_OPERATIONS };

/** Console readiness deadline: the headless-visit scale, not the 180s interactive login wait. */
const CONSOLE_READY_TIMEOUT_MS = 30_000;
/** Settle before the save click: the editor must have registered the paste before it can be saved. */
const SUBMIT_SETTLE_MS = 1_500;
/** The observed-draft-signal window after a save click (the pre-ADR-029 toast deadline was 15s). */
const DRAFT_SIGNAL_TIMEOUT_MS = 15_000;
/** The save click is retried — the console can drop one that lands while the editor is settling. */
const SUBMIT_ATTEMPTS = 2;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

/** Console home readiness: an authenticated route carries the session token (discovery §1/§9-W9). */
export function isConsoleReady(page: { url(): string }): boolean {
    return readConsoleToken(page.url()) !== undefined || page.url().includes(CONSOLE_HOME_FRAGMENT);
}

/**
 * The recorded login signal for this channel (ADR-026): an authenticated session lands on
 * `/cgi-bin/home`. Body text is unusable — `登录` also appears on a live console, which
 * false-negatived a successful login (W9) — so the URL is the only safe read.
 */
export function isWechatLoggedIn(page: { url(): string }): boolean {
    return page.url().includes(CONSOLE_HOME_FRAGMENT);
}

export type SessionCheck = (profileDir: string) => Promise<void>;

/** Cookies captured at login time — mp.weixin.qq.com grant cookies do not survive a Chromium restart
 * (the store drops them despite 4-day expiries), but the server session does, so we re-inject. */
export function storageStatePath(profileDir: string): string {
    return `${profileDir}/storage-state.json`;
}

/** Headless session preflight: throws (incl. BrowserProfileMissingError) when the profile cannot drive the console. */
export async function checkWechatSession(profileDir: string): Promise<void> {
    const { page, context } = await openWithState(profileDir, true);
    try {
        await pollLogin(page);
    } finally {
        await context.close();
    }
}

async function pollLogin(page: Page): Promise<void> {
    const ready = await waitUntil(() => Promise.resolve(isConsoleReady(page)), CONSOLE_READY_TIMEOUT_MS, 1000);
    if (ready) return;
    throw new Error(
        `Authentication was not confirmed within ${CONSOLE_READY_TIMEOUT_MS}ms — the saved session state has ` +
            'likely expired: re-run `bun src/profile-check.ts login` to sign in again.',
    );
}

/** Launch, inject the saved login cookies, and land on the console. Caller owns closing the context. */
async function openWithState(profileDir: string, headless: boolean): Promise<{ page: Page; context: BrowserContext }> {
    const context = await openPersistentBrowser({ profileDir, headless });
    try {
        const stateFile = storageStatePath(profileDir);
        let state:
            | { cookies?: Cookie[]; origins?: { origin?: string; localStorage?: { name: string; value: string }[] }[] }
            | undefined;
        try {
            state = JSON.parse(await createNodeFileSystem().readFile(stateFile));
        } catch {
            state = undefined; // absent or corrupt session state — reported below
        }
        const cookies = state?.cookies;
        if (!cookies || cookies.length === 0) {
            throw new BrowserProfileMissingError(
                `no saved console session state (${stateFile}) — run \`bun src/profile-check.ts login\` once`,
            );
        }
        await context.addCookies(cookies);
        const page = context.pages()[0] ?? (await context.newPage());
        // `addCookies` alone is NOT the session: the captured state also carries localStorage for
        // mp.weixin.qq.com (its `origins` half), and discarding it lands the console on its login page
        // even though every cookie was accepted — observed live 2026-10-05, where `check` reported OK
        // while the flow sat on a QR page. Replay each origin's storage before the console navigation.
        const origins = state?.origins ?? [];
        for (const entry of origins) {
            const items = entry.localStorage ?? [];
            if (entry.origin === undefined || entry.origin.length === 0 || items.length === 0) continue;
            await page.goto(entry.origin).catch(() => undefined);
            await page
                .evaluate(
                    // A string expression, not a callback: this plugin's tsconfig has no DOM lib.
                    '(pairs) => { for (const pair of pairs) { window.localStorage.setItem(pair.name, pair.value); } }',
                    items,
                )
                .catch(() => undefined);
        }
        await page.goto(CONSOLE_URL);
        return { page, context };
    } catch (error: unknown) {
        await context.close();
        throw error;
    }
}

/**
 * Default launcher: the console home wrapped as the `OpenConsole` seam (entry page + the sibling
 * pages a creation-type click opens). Headless works end-to-end for the draft flow (probed
 * 2026-09-29), so no window is popped — the preflight is what keeps a sessionless run from even
 * trying.
 */
async function defaultOpenConsole(profileDir: string): Promise<OpenedConsole> {
    const { page, context } = await openWithState(profileDir, true);
    return wrapPlaywrightContext(context, page);
}

type BrowserDriverName = 'script' | 'agent';

export interface WechatmpTransportOptions {
    /** ADR-029 dispatch: the console modes need the Playwright script driver. */
    driver?: BrowserDriverName;
    openPage?: OpenConsole;
    checkSession?: SessionCheck;
    /** Deadline for the console to read ready after launch (default 30s). */
    consoleReadyTimeoutMs?: number;
    stepTimeoutMs?: number;
    submitSettleMs?: number;
    /** How long an observed draft signal is waited for after a save click (default 15s). */
    draftTimeoutMs?: number;
    submitAttempts?: number;
}

export class WechatmpBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    readonly driver: BrowserDriverName;
    private readonly openPage: OpenConsole;
    private readonly checkSession: SessionCheck;
    private readonly consoleReadyTimeoutMs: number;
    private readonly stepTimeoutMs: number;
    private readonly submitSettleMs: number;
    private readonly draftTimeoutMs: number;
    private readonly submitAttempts: number;

    constructor(options: WechatmpTransportOptions = {}) {
        this.driver = options.driver ?? 'script';
        this.openPage = options.openPage ?? defaultOpenConsole;
        this.checkSession = options.checkSession ?? ((profileDir) => checkWechatSession(profileDir));
        this.consoleReadyTimeoutMs = options.consoleReadyTimeoutMs ?? CONSOLE_READY_TIMEOUT_MS;
        this.stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.submitSettleMs = options.submitSettleMs ?? SUBMIT_SETTLE_MS;
        this.draftTimeoutMs = options.draftTimeoutMs ?? DRAFT_SIGNAL_TIMEOUT_MS;
        this.submitAttempts = options.submitAttempts ?? SUBMIT_ATTEMPTS;
    }

    /**
     * Publish through the console. Everything decidable without a browser is decided first (driver,
     * operation, artifacts, field limits, publishStatus, session), so an impossible or misrouted run
     * never opens — let alone touches — a real console.
     */
    async publish(payload: PublishTransportPayload): Promise<Result> {
        const { content, options } = payload;
        if (this.driver !== 'script') {
            return fail(
                `unsupported driver '${this.driver}' for ${TARGET}: the console modes (${WECHATMP_OPERATIONS.join(', ')}) require the script driver (Playwright setInputFiles)`,
            );
        }
        // ADR-029 dispatch: an undeclared operation is refused by name before a browser is launched
        // or a profile is resolved, so a misrouted run cannot open a session it will not use.
        const requested = resolveWechatmpOperation(options, content);
        if (requested.error !== undefined) return fail(requested.error);

        // Mode validation: a missing artifact (which the 视频/播客 media modal would otherwise hide
        // the save bar for), an over-limit field or an unknown publishStatus all fail here.
        const validation = await validateModeInput(requested.operation, content);
        if (validation.error !== undefined) return fail(validation.error);

        const profileDir = resolveBrowserProfileDir(TARGET, process.env.WECHATMP_PROFILE_DIR);
        const publishStatus = content.metadata?.publishStatus === 'public' ? 'public' : 'draft';

        // ADR-026 rail: a headless preflight refuses a sessionless run fast, so no console visit is
        // ever attempted with a dead session (and the draft default is this channel's guard).
        try {
            await this.checkSession(profileDir);
        } catch (error: unknown) {
            const why =
                error instanceof BrowserProfileMissingError
                    ? 'no saved console profile — log in once via `bun src/profile-check.ts login`'
                    : `console session preflight failed (${error instanceof Error ? error.message : String(error)})`;
            // Non-blocking contract (mirrors xhs-pub): a sessionless run refuses fast and stays
            // draftless — it must never open a login wall inside an unattended run.
            return fail(`${TARGET}-pub: ${why}`);
        }

        let opened: OpenedConsole;
        try {
            opened = await this.openPage(profileDir);
        } catch (error: unknown) {
            return fail(error instanceof Error ? error.message : String(error));
        }
        try {
            const ready = await waitUntil(
                () => Promise.resolve(isConsoleReady(opened.page)),
                this.consoleReadyTimeoutMs,
            );
            if (!ready) {
                return fail(
                    `no authenticated ${TARGET} console within ${this.consoleReadyTimeoutMs}ms — the preflight passed but the console did not report a session route (profile ${profileDir})`,
                );
            }
            // The 草稿箱 baseline is read before the editor opens: MP auto-saves continuously, so a
            // row that already carried a stamp says nothing about this run's save (discovery §5.1).
            const title = typeof content.title === 'string' ? content.title.trim() : '';
            const draftBaseline =
                publishStatus === 'draft' ? await readDraftBaseline(opened.page, title) : { stamp: null };

            return await runMode(validation.input, {
                entry: opened.page,
                pages: opened.pages,
                newPage: opened.newPage,
                content,
                publishStatus,
                profileDir,
                driver: this.driver,
                stepTimeoutMs: this.stepTimeoutMs,
                submitSettleMs: this.submitSettleMs,
                draftTimeoutMs: this.draftTimeoutMs,
                submitAttempts: this.submitAttempts,
                draftBaseline,
            });
        } catch (error: unknown) {
            return fail(error instanceof Error ? error.message : String(error));
        } finally {
            await opened.close();
        }
    }
}

export function getPublishTransport(driver: BrowserDriverName = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeFileCliTransport();
    return new WechatmpBrowserTransport({ driver });
}

/**
 * `--in`/`--out` IO. A top-level `options` object in the input file is forwarded, which is how a
 * caller selects the ADR-029 operation (`options.operation`) without touching `Content`.
 */
export async function processPublishIO(inPath: string, outPath: string, transport?: PublishTransport): Promise<void> {
    const fs = createNodeFileSystem();
    const raw = JSON.parse(await fs.readFile(inPath)) as Record<string, unknown>;
    const content: Content = ContentSchema.parse(raw);
    const provided = raw.options;
    const options =
        provided !== undefined && typeof provided === 'object' && provided !== null && !Array.isArray(provided)
            ? { target: TARGET, ...(provided as Record<string, unknown>) }
            : { target: TARGET };
    const result = await (transport ?? getPublishTransport()).publish({ content, options });
    await fs.writeFile(outPath, JSON.stringify(ResultSchema.parse(result), null, 2));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const { values } = parseArgs({
        argv,
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in <content.json> --out <result.json>');
        return 1;
    }
    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`wechatmp-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
