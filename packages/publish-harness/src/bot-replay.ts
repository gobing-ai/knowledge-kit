/**
 * Replay: re-run a recorded transcript against a page without publishing (task 0382 R5).
 *
 * Replay is the admission test for codegen — a transcript whose steps no longer resolve exactly one
 * visible node is not evidence, and generating a rail from it would carry the rot forward. The
 * default stops before the submit step: replaying a recording must never publish anything twice.
 *
 * The page is injected. Under `kk bot replay` it is a real headed page under one profile lease; in
 * tests it is a double, because the per-step logic is what the fix has to be right about.
 */

import type { BrowserLauncher } from '@gobing-ai/ts-browser-automation';
import type { BrowserContext, Page } from 'playwright';
import type { BotTranscript, TranscriptStep } from './bot-record';

/** One executed step's observed state. */
export interface ReplayRow {
    /** Transcript step index. */
    step: number;
    kind: TranscriptStep['kind'];
    url: string;
    /** Visible nodes the step's selector resolved to; omitted for steps without a selector. */
    selectorCount?: number;
    /** Editor text length after the step, when the step typed. */
    editorTextLength?: number;
    ok: boolean;
    /** Why the step did not run or did not resolve. */
    detail?: string;
    /** Set when the step was deliberately not executed. */
    skipped?: 'submit';
}

/** Outcome of one replay. */
export interface ReplayResult {
    bot: string;
    rows: ReplayRow[];
    /** True when the run stopped at the submit step instead of executing it. */
    stoppedBeforeSubmit: boolean;
}

/** Options for {@link replayBotSession}. */
export interface ReplayOptions {
    /** Page the steps are replayed on (headed, under the caller's lease). */
    page: Page;
    /** Execute the submit step instead of stopping before it. */
    submit?: boolean;
    /** Text of the click that submits; the last click defaults to it. */
    submitText?: string;
    /** Placeholder character for redacted text, so a length mismatch stays visible. */
    redactionMarker?: string;
    /** Local file a recorded file step re-selects; defaults to the recorded basename. */
    filePath?: string;
    /** Per-step evidence hook, called after a step ran or was skipped. */
    screenshot?: (step: number) => Promise<void>;
    /** How long a step waits for its target to render before counting; default 15 s. */
    stepTimeoutMs?: number;
}

/** The step index replay stops before: the last click, or the one whose text matches `submitText`. */
export function submitStepIndex(transcript: BotTranscript, submitText?: string): number {
    if (submitText !== undefined) {
        const named = transcript.steps.findLastIndex((step) => step.kind === 'click' && step.text === submitText);
        if (named !== -1) return named;
    }
    return transcript.steps.findLastIndex((step) => step.kind === 'click');
}

/** Why a step cannot be replayed, or the selector it needs, or `null` for navigate/response. */
type StepSelector = { selector: string } | { blocked: string } | null;

function selectorOf(step: TranscriptStep): StepSelector {
    if (!('target' in step)) return null;
    // Never pick one of several: an ambiguous step is a finding, and replay compiles the evidence
    // codegen would refuse.
    if ('ambiguous' in step.target) {
        return { blocked: `step ${step.i} is ambiguous (${step.target.candidates.join(' | ')})` };
    }
    return { selector: step.target.selector };
}

/** Narrow a recorded selector to visible nodes; the recorder dropped hidden targets, so replay must too. */
function visibleOnly(selector: string): string {
    return `${selector} >> visible=true`;
}

/**
 * Ancestors that make a rendered node unreachable. X keeps its background composer under
 * `aria-hidden` behind the compose modal, so a visible-only count saw two editors (measured
 * 2026-11-17); the recorder applies the same rule, so both sides agree on what one node means.
 */
const UNREACHABLE = '[aria-hidden="true"], [inert]';

/**
 * Resolve a selector to one `nth=`-pinned selector per visible, reachable node; a locator error is
 * none, never a pass.
 *
 * A live page renders the next control after the previous click, so the count polls until a
 * reachable match exists or the step timeout passes — counting immediately failed steps that were
 * merely early. The wait is on a reachable node, not a visible one: X's aria-hidden background
 * composer is visible while the modal mounts, and waiting on it counted before the modal editor
 * existed (measured 2026-11-17).
 */
async function reachableTargets(page: Page, selector: string, timeoutMs: number): Promise<string[]> {
    const narrowed = visibleOnly(selector);
    const locator = page.locator(narrowed);
    const deadline = Date.now() + timeoutMs;
    try {
        for (;;) {
            const reachable = await locator.evaluateAll(
                (nodes, unreachable) => nodes.map((node) => node.closest(unreachable) === null),
                UNREACHABLE,
            );
            if (reachable.includes(true) || Date.now() >= deadline) {
                return reachable.flatMap((ok, index) => (ok ? [`${narrowed} >> nth=${index}`] : []));
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
    } catch {
        return [];
    }
}

/**
 * Replay every step up to (or through) the submit click, one row per executed step.
 *
 * A step that resolves to anything but exactly one node stops the run: a non-zero `ok` on an
 * unresolved row would let codegen build on a recording that no longer matches the site.
 */
export async function replayBotSession(
    bot: string,
    transcript: BotTranscript,
    options: ReplayOptions,
): Promise<ReplayResult> {
    const marker = options.redactionMarker ?? '•';
    const stopAt = options.submit === true ? -1 : submitStepIndex(transcript, options.submitText);
    const timeoutMs = options.stepTimeoutMs ?? 15_000;
    const rows: ReplayRow[] = [];

    // A recording that started on an already-open page has no navigate step; without this the
    // first click runs against about:blank. A page already on the start URL keeps its state.
    const opensWithNavigate = transcript.steps.find((step) => step.kind !== 'response')?.kind === 'navigate';
    if (!opensWithNavigate && options.page.url() !== transcript.startUrl) {
        await options.page.goto(transcript.startUrl);
    }

    for (const step of transcript.steps) {
        if (step.kind === 'response') continue;
        if (step.i === stopAt) {
            rows.push({
                step: step.i,
                kind: step.kind,
                url: step.url,
                ok: false,
                skipped: 'submit',
                detail: 'stopped before the submit step (pass --submit to replay it)',
            });
            return { bot, rows, stoppedBeforeSubmit: true };
        }

        if (step.kind === 'navigate') {
            await options.page.goto(step.url);
            rows.push({ step: step.i, kind: step.kind, url: step.url, ok: true });
            await options.screenshot?.(step.i);
            continue;
        }

        const target = selectorOf(step);
        if (target === null) {
            rows.push({ step: step.i, kind: step.kind, url: step.url, ok: false, detail: 'step carries no selector' });
            await options.screenshot?.(step.i);
            return { bot, rows, stoppedBeforeSubmit: false };
        }
        if ('blocked' in target) {
            rows.push({ step: step.i, kind: step.kind, url: step.url, ok: false, detail: target.blocked });
            await options.screenshot?.(step.i);
            return { bot, rows, stoppedBeforeSubmit: false };
        }
        const selector = target.selector;
        const targets = await reachableTargets(options.page, selector, timeoutMs);
        const count = targets.length;
        if (count !== 1) {
            rows.push({
                step: step.i,
                kind: step.kind,
                url: step.url,
                selectorCount: count,
                ok: false,
                detail: `selector ${selector} resolved ${count} visible, reachable nodes (expected exactly 1)`,
            });
            await options.screenshot?.(step.i);
            return { bot, rows, stoppedBeforeSubmit: false };
        }

        const resolved = targets[0] as string;
        if (step.kind === 'click') {
            await options.page.click(resolved);
            rows.push({ step: step.i, kind: step.kind, url: step.url, selectorCount: count, ok: true });
            await options.screenshot?.(step.i);
            continue;
        }
        if (step.kind === 'key') {
            await options.page.keyboard.press(step.key);
            rows.push({ step: step.i, kind: step.kind, url: step.url, selectorCount: count, ok: true });
            await options.screenshot?.(step.i);
            continue;
        }
        if (step.kind === 'file') {
            await options.page.setInputFiles(resolved, options.filePath ?? step.fileName);
            rows.push({ step: step.i, kind: step.kind, url: step.url, selectorCount: count, ok: true });
            await options.screenshot?.(step.i);
            continue;
        }

        await options.page.click(resolved);
        const typed = typeof step.text === 'string' ? step.text : marker.repeat(step.text.length);
        await options.page.keyboard.type(typed);
        rows.push({
            step: step.i,
            kind: step.kind,
            url: step.url,
            selectorCount: count,
            editorTextLength: typed.length,
            ok: true,
        });
        await options.screenshot?.(step.i);
    }

    return { bot, rows, stoppedBeforeSubmit: false };
}

/** Options for {@link replayBot}: the transcript plus where the evidence lands. */
export interface ReplayBotOptions {
    /** Execute the submit step instead of stopping before it. */
    submit?: boolean;
    /** Text of the click that submits; the last click defaults to it. */
    submitText?: string;
    /** Directory the per-step evidence is written to; defaults to `.spur/run/bot-replay-<bot>`. */
    outDir?: string;
    /** Bot profile root; default `~/.config/kk/browser-profiles`. */
    root?: string;
    /** Lease root; default `~/.config/kk/browser-leases`. */
    leaseRoot?: string;
    /** Local file a recorded file step re-selects. */
    filePath?: string;
    /** Launcher override; the default borrows this invocation's profile lease. */
    launcher?: BrowserLauncher;
    /** Per-step render wait; see {@link ReplayOptions.stepTimeoutMs}. */
    stepTimeoutMs?: number;
}

/**
 * Replay a transcript against the bot's own saved profile, headed, under one lease (R5).
 *
 * One screenshot per executed step plus `replay.json` are the operator evidence a channel repair
 * cites, so both are written even when the run stops early: a failed step is a finding, not a
 * reason to lose the trail. The lease is released on every path.
 */
export async function replayBot(
    bot: string,
    transcript: BotTranscript,
    options: ReplayBotOptions = {},
): Promise<{ result: ReplayResult; outDir: string; replayPath: string }> {
    const { acquireProfileLease, closeBotContext, createKkBrowserLauncher, openBotPage, resolveBotProfileDir } =
        await import('./browser');
    const { signalSafeRelease } = await import('./browser');
    const { mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
    const fileSystem = createNodeFileSystem();
    const profileDir = resolveBotProfileDir(bot, { root: options.root });
    const outDir = options.outDir ?? join('.spur', 'run', `bot-replay-${bot}`);
    mkdirSync(outDir, { recursive: true });

    // Guard first, then the lease (2026-11-23): a SIGINT landing between the acquire and the
    // handler registration killed the process with the default action and left the lease behind.
    let context: BrowserContext | undefined;
    const leaseRef: { current?: { release(): Promise<void> } } = {};
    const shutdown = signalSafeRelease({
        close: () => closeBotContext(context),
        release: () => leaseRef.current?.release() ?? Promise.resolve(),
    });
    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem }).catch(
        async (error: unknown) => {
            // A refused acquire must not leave the guard's handlers armed (see openBot).
            await shutdown.shutdown();
            throw error;
        },
    );
    leaseRef.current = lease;
    let unpark: (() => void) | undefined;
    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: false });
        unpark = shutdown.park();
        const page = await openBotPage(context);
        const shots: string[] = [];
        const result = await replayBotSession(bot, transcript, {
            page,
            submit: options.submit === true,
            ...(options.submitText === undefined ? {} : { submitText: options.submitText }),
            ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
            ...(options.stepTimeoutMs === undefined ? {} : { stepTimeoutMs: options.stepTimeoutMs }),
            screenshot: async (step) => {
                const path = join(outDir, `${String(step).padStart(2, '0')}.png`);
                await page.screenshot({ path });
                shots.push(path);
            },
        });
        const replayPath = join(outDir, 'replay.json');
        await fileSystem.writeFile(replayPath, `${JSON.stringify({ ...result, screenshots: shots }, null, 2)}\n`);
        return { result, outDir, replayPath };
    } finally {
        await shutdown.shutdown();
        unpark?.();
    }
}
