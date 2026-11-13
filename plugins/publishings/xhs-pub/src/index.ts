import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeBrowserTransport,
    type PublishTransport,
    type PublishTransportPayload,
    trySelectors,
} from '@gobing-ai/publish-harness';
import {
    checkChannelSession,
    createShadowFinder,
    kkBrowserLauncher,
    resolveChannelProfileDir,
    type ShadowCdpSession,
} from '@gobing-ai/publish-harness/browser';
import type { BrowserLauncher } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { type AutomationGuard, createAutomationGuard } from './automation-guard';
import { readDraftBaseline, runMode } from './flow';
import { type ModeInput, PUBLISH_URL, resolveXhsOperation, TARGET, validateModeInput, XHS_OPERATIONS } from './modes';
import {
    type OpenedPage,
    type OpenPage,
    type ShadowProbe,
    STEP_TIMEOUT_MS,
    waitUntil,
    wrapPlaywrightPage,
    type XhsPage,
} from './page';

/**
 * The xhs publish CHANNEL (ADR-029): one plugin, four mode `operations`.
 *
 * This module owns what is channel-level — the profile dir, the session readiness gate and its
 * ADR-025 automation guard, the ADR-029 operation dispatch and pre-browser validation, the
 * browser launch seam and the `Content → Result` mapping. The modes themselves (entry, artifacts,
 * selectors, save/publish flow) live in `./modes` and `./flow`.
 */

export const CHANNEL = 'xhs';
export { PUBLISH_URL };
export const LOGIN_TIMEOUT_MS = 120_000;
/** Bounded readiness inside the single headed visit; interactive login has its own longer wait. */
export const PREFLIGHT_TIMEOUT_MS = 90_000;
/** The console drops a submit click that lands while the note is still settling (live run 2026-09-25). */
const SUBMIT_SETTLE_MS = 2_500;
const SUBMIT_ATTEMPTS = 3;

/**
 * Login/UI gate. The creator console renders its mode tab bar only for an authenticated session,
 * and it opens on 上传视频 — which is why every operation enters its own mode explicitly instead of
 * assuming the console's landing mode.
 */
const AUTH_GATE = ['div.creator-tab', 'text=上传图文'];

export {
    MODE_LIMITS,
    type ModeInput,
    type ModeLimits,
    validatePublishInput,
    XHS_OPERATIONS,
    type XhsOperation,
} from './modes';
export type { OpenedPage, OpenPage, ShadowControl, ShadowProbe, XhsLocator, XhsPage } from './page';
export { CREATOR_TAB_BAR, CREATOR_TAB_COUNT, clickCreatorTab, creatorTabSelector, wrapPlaywrightPage } from './page';

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

/**
 * A refusal before this run composed or saved any note. The send loop records a plain failure as
 * `effect: unknown`, which makes a bounded `--retry` refuse it forever; a pre-save refusal is
 * genuinely effect-free, so it carries the reserved marker instead (2026-11-12 daily window).
 */
function refuse(error: string): Result {
    return ResultSchema.parse({
        ok: false,
        target: TARGET,
        error,
        metadata: { itcDelivery: { schemaVersion: 1, effect: 'none' } },
    });
}

/** One operation of a visit: its own Content and the mode input validated before any browser work. */
interface VisitOperation {
    content: Content;
    input: ModeInput;
}

/**
 * A follow-up operation of a visit: planned, or refused with the reason it never reached the console.
 * A refused follow-up is reported as its own failed Result entry — it can never fail the note the
 * visit was opened for (ADR-025 amendment 2026-10-09).
 */
type VisitFollowUp = { content: Content; operation: string; input: ModeInput } | { operation: string; error: string };

interface VisitPlan {
    /** The requested operation, resolved and validated exactly as before task 0236. */
    primary: VisitOperation;
    /** The primary Content's `metadata.followUps`, in declared order. */
    followUps: VisitFollowUp[];
}

/**
 * Plan a visit (ADR-025 amendment 2026-10-09, task 0236 option A): the requested operation plus the
 * follow-ups the caller attached to the primary Content's `metadata.followUps`. One headed visit may
 * compose several notes under ONE cap entry — the cap still counts visits, not notes.
 *
 * The primary is planned as it always was: an unplannable primary is a `fail` and no browser opens.
 * A follow-up that cannot be planned (not a Content, an undeclared operation, a missing or unreadable
 * artifact) is refused here, before any console work, and reported as its own entry instead. A
 * `metadata.followUps` that is not an array is a caller error, so it fails loud before any browser.
 */
async function planVisit(
    primary: VisitOperation,
    content: Content,
): Promise<{ plan: VisitPlan; error?: undefined } | { plan?: undefined; error: string }> {
    const raw = content.metadata?.followUps;
    if (raw === undefined) return { plan: { primary, followUps: [] } };
    if (!Array.isArray(raw)) {
        return {
            error: `followUps validation: Content.metadata.followUps must be an array of Content objects, got ${typeof raw}`,
        };
    }
    const followUps: VisitFollowUp[] = [];
    // A follow-up rides the primary's visit, so it publishes the way the primary does unless the
    // caller states a mode of its own. The 2026-11-11 repair hit the other default: a live 发播客
    // beside a silently DRAFTED 上传图文.
    const primaryStatus = content.metadata?.publishStatus;
    for (const [index, entry] of raw.entries()) {
        const label = `followUps[${index}]`;
        const parsed = ContentSchema.safeParse(entry);
        if (!parsed.success) {
            followUps.push({ operation: label, error: `${label} is not a Content object` });
            continue;
        }
        const operation = typeof parsed.data.metadata?.operation === 'string' ? parsed.data.metadata.operation : label;
        const requested = resolveXhsOperation(undefined, parsed.data);
        if (requested.error !== undefined) {
            followUps.push({ operation, error: requested.error });
            continue;
        }
        const followUpContent: Content =
            parsed.data.metadata?.publishStatus === undefined && primaryStatus !== undefined
                ? { ...parsed.data, metadata: { ...(parsed.data.metadata ?? {}), publishStatus: primaryStatus } }
                : parsed.data;
        const validation = await validateModeInput(requested.operation, followUpContent);
        if (validation.error !== undefined) {
            followUps.push({ operation, error: validation.error });
            continue;
        }
        followUps.push({ content: followUpContent, operation: requested.operation, input: validation.input });
    }
    return { plan: { primary, followUps } };
}

/** CDP is Chromium-only; when unavailable the submit step fails loud instead of guessing. */
export async function createShadowProbe(
    context: { newCDPSession?(page: unknown): Promise<ShadowCdpSession> },
    page: unknown,
): Promise<ShadowProbe | undefined> {
    // The closed-shadow walk itself lives in the shared harness (ADR-029 rail); this stays a
    // plugin-shaped adapter so the page wrapper's contract is unchanged.
    const find = await createShadowFinder(context, page);
    return find === undefined ? undefined : { findControl: (labels) => find(labels) };
}

/**
 * XHS-owned readiness predicate: the mode tab bar renders only for an authenticated creator
 * console. Shared by the publish login gate and the profile-session capability
 * (src/profile-check.ts) so both spell the authentication signal exactly once.
 */
export async function isXhsConsoleReady(page: XhsPage): Promise<boolean> {
    return trySelectors(page, AUTH_GATE).then((r) => r.found);
}

/**
 * Production launcher: the harness kk launcher (0214; full-Chromium channel + stealth). Named so the
 * migration is provable offline — tests assert this binding, never launch a real browser.
 */
export const defaultLauncher = kkBrowserLauncher.launch;

/**
 * Build the default page opener. The launcher is injected so the seam (page wrapping, shadow
 * probe wiring, context close, launch-failure message) is testable without launching a browser;
 * production uses the harness `kkBrowserLauncher` (@gobing-ai/publish-harness/browser, 0214).
 */
export function makeDefaultOpenPage(
    launch: (options: { profileDir: string; headless: boolean }) => Promise<unknown> = defaultLauncher,
): OpenPage {
    return async (profileDir) => {
        let context: unknown;
        try {
            context = await launch({ profileDir, headless: false });
        } catch (error) {
            throw new Error(
                `browser launch: ${error instanceof Error ? error.message : String(error)} — install with: bunx playwright install chromium`,
            );
        }
        const ctx = context as {
            pages(): unknown[];
            newPage(): Promise<unknown>;
            close(): Promise<void>;
            newCDPSession?(page: unknown): Promise<ShadowCdpSession>;
        };
        try {
            const raw = ctx.pages()[0] ?? (await ctx.newPage());
            const shadow = await createShadowProbe(ctx, raw);
            return { page: wrapPlaywrightPage(raw, shadow), close: () => ctx.close() };
        } catch (error) {
            await ctx.close();
            throw error;
        }
    };
}

/** Default seam: persistent Chromium on the channel profile, headed for first login. */
export const defaultOpenPage: OpenPage = makeDefaultOpenPage();

/** Explicit session verdict: only an observed authenticated console is `verified`. */
export interface ProfileSessionCheck {
    status: 'verified' | 'refused';
    profileDir: string;
    /** Verdict evidence: what was observed, or the explicit refusal reason. */
    detail: string;
}

export interface SessionCheckOptions {
    profileDir: string;
    timeoutMs?: number;
    launcher?: BrowserLauncher;
    /** Compatibility option; XHS session probes always run headed. */
    headedOnly?: boolean;
}

/** The explicit `check --headed` probe; ordinary checks read bot metadata without a browser. */
export async function checkXhsProfileSession(opts: SessionCheckOptions): Promise<ProfileSessionCheck> {
    return checkChannelSession(
        {
            channel: CHANNEL,
            homeUrl: PUBLISH_URL,
            isAuthenticated: (page) => isXhsConsoleReady(wrapPlaywrightPage(page)),
        },
        {
            profileDir: opts.profileDir,
            launcher: opts.launcher,
            timeoutMs: opts.timeoutMs ?? PREFLIGHT_TIMEOUT_MS,
            headedOnly: true,
        },
    );
}

export class XhsBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriverName;
    private readonly readinessTimeoutMs: number;
    private readonly stepTimeoutMs: number;
    private readonly submitSettleMs: number;
    private readonly submitAttempts: number;
    private readonly openPage: OpenPage;
    private readonly automation: AutomationGuard;

    constructor(
        driver: BrowserDriverName = 'script',
        opts?: {
            loginTimeoutMs?: number;
            stepTimeoutMs?: number;
            submitSettleMs?: number;
            submitAttempts?: number;
            openPage?: OpenPage;
            /** ADR-025 automation-risk guard; defaults to the real 2h-capped state file. */
            automation?: AutomationGuard;
        },
    ) {
        this.driver = driver;
        this.readinessTimeoutMs = Math.min(opts?.loginTimeoutMs ?? PREFLIGHT_TIMEOUT_MS, PREFLIGHT_TIMEOUT_MS);
        this.stepTimeoutMs = opts?.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.submitSettleMs = opts?.submitSettleMs ?? SUBMIT_SETTLE_MS;
        this.submitAttempts = opts?.submitAttempts ?? SUBMIT_ATTEMPTS;
        this.openPage = opts?.openPage ?? defaultOpenPage;
        this.automation = opts?.automation ?? createAutomationGuard();
    }

    /**
     * Publish through the console. Everything that can be decided without a browser is decided
     * first (driver, operation, artifacts, limits, publishStatus, budget), so an
     * impossible or misrouted run never opens — let alone touches — a real console.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return refuse(
                `unsupported driver '${this.driver}' for ${TARGET}: the console modes (${XHS_OPERATIONS.join(', ')}) require the script driver (Playwright setInputFiles)`,
            );
        }
        // ADR-029 dispatch: an undeclared operation is refused by name before a browser is launched
        // or a profile is resolved, so a misrouted run cannot open a session it will not use.
        const requested = resolveXhsOperation(payload.options, payload.content);
        if (requested.error !== undefined) return refuse(requested.error);
        const operation = requested.operation;

        // Mode validation: missing artifact, over-limit field, or an unknown publishStatus all fail
        // here, naming what is missing and the mode's limit.
        const validation = await validateModeInput(operation, payload.content);
        if (validation.error !== undefined) return refuse(validation.error);
        const input: ModeInput = validation.input;

        // ADR-025 amendment (2026-10-09, task 0236 option A): one visit may compose more than one
        // note. The follow-ups ride the primary Content's `metadata.followUps` and are planned here,
        // with the primary, before any browser work.
        const visited = await planVisit({ content: payload.content, input }, payload.content);
        if (visited.error !== undefined) return refuse(visited.error);
        const visit = visited.plan;

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(CHANNEL, override);

        // ADR-025 automation guard runs before the single headed visit.
        // 1. Frequency cap: the operator's platform warning makes a repeated console visit an
        //    account-level risk, not merely a failed run. The cap counts VISITS: one allow/record
        //    per visit covers every note the visit composes.
        const cap = this.automation.allow('publish');
        if (!cap.allowed) return refuse(`automation cap: ${cap.reason}`);

        let opened: OpenedPage;
        try {
            opened = await this.openPage(profileDir);
        } catch (error) {
            return refuse(error instanceof Error ? error.message : String(error));
        }
        // A readiness refusal still costs a visit; recovery uses the uncapped `kk bot login xhs`.
        // Record only after the opener succeeds: a failed browser launch made no console visit.
        this.automation.record('publish');
        const { page, close } = opened;
        try {
            // The visit's own Result is the primary operation's: a failed primary ends the visit, as
            // it always did, and only a primary that stood reports its follow-ups.
            const primary = await this.runStep(visit.primary.input, visit.primary.content, page, profileDir);
            if (!primary.ok || visit.followUps.length === 0) return primary;
            // One Result entry per operation, in declared order; a refused and a failed follow-up
            // are the same kind of entry, and neither can fail the note the visit was opened for.
            const followUps: Result[] = [];
            for (const followUp of visit.followUps) {
                const step =
                    'error' in followUp
                        ? fail(`follow-up (${followUp.operation}): ${followUp.error}`)
                        : await this.runStep(followUp.input, followUp.content, page, profileDir);
                // Every entry names the operation it was planned under — a failed or refused one too,
                // so the caller can tell which note fell; the step's own metadata wins.
                followUps.push(
                    ResultSchema.parse({ ...step, metadata: { operation: followUp.operation, ...step.metadata } }),
                );
            }
            return ResultSchema.parse({ ...primary, metadata: { ...primary.metadata, followUps } });
        } finally {
            await close();
        }
    }

    /**
     * Run one operation of the visit in the page the visit already opened. Every step enters the
     * console from its landing view: the primary needs the login gate and the pre-entry draft
     * baseline, and a follow-up needs both again — the previous note's editor replaces the header,
     * and the baseline must be read before THIS note's mode is entered.
     *
     * A step never throws: its failure is that operation's own `ok:false` Result, which is what keeps
     * a failed follow-up from failing the visit (ADR-025 amendment 2026-10-09).
     */
    private async runStep(input: ModeInput, content: Content, page: XhsPage, profileDir: string): Promise<Result> {
        try {
            const started = Date.now();
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const ready = async (): Promise<boolean> => {
                    await page.goto(PUBLISH_URL, { timeout: this.readinessTimeoutMs });
                    return waitUntil(
                        () => isXhsConsoleReady(page),
                        Math.max(0, this.readinessTimeoutMs - (Date.now() - started)),
                        Math.min(500, this.readinessTimeoutMs),
                    );
                };
                const gated = await Promise.race([
                    ready(),
                    new Promise<boolean>((resolve) => {
                        timer = setTimeout(() => resolve(false), this.readinessTimeoutMs);
                    }),
                ]);
                if (!gated) throw new Error(`no authenticated console after ${this.readinessTimeoutMs}ms`);
            } catch (error) {
                return refuse(
                    `session readiness refused: ${error instanceof Error ? error.message : String(error)} in ${profileDir} — run kk bot login xhs`,
                );
            } finally {
                clearTimeout(timer);
            }

            const publishStatus = content.metadata?.publishStatus === 'public' ? 'public' : 'draft';
            // The draft counter and any save timestamps exist only on the landing view, so the
            // baseline is captured before the mode is entered (the editor replaces the header).
            const draftBaseline =
                publishStatus === 'draft' ? await readDraftBaseline(page) : { count: null, stamps: [] };

            return await runMode(input, {
                page,
                content,
                publishStatus,
                profileDir,
                driver: this.driver,
                stepTimeoutMs: this.stepTimeoutMs,
                submitSettleMs: this.submitSettleMs,
                submitAttempts: this.submitAttempts,
                draftBaseline,
            });
        } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
        }
    }
}

type BrowserDriverName = 'script' | 'agent';

export function getPublishTransport(driver: BrowserDriverName = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport(driver);
    }
    return new XhsBrowserTransport(driver);
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
        echoError(`xhs-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
