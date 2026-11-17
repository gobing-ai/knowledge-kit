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

/** Count the visible nodes a selector resolves to; a locator error is `0`, never a pass. */
async function visibleCount(page: Page, selector: string): Promise<number> {
    try {
        return await page.locator(selector).count();
    } catch {
        return 0;
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
    const rows: ReplayRow[] = [];

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
        const count = await visibleCount(options.page, selector);
        if (count !== 1) {
            rows.push({
                step: step.i,
                kind: step.kind,
                url: step.url,
                selectorCount: count,
                ok: false,
                detail: `selector ${selector} resolved ${count} visible nodes (expected exactly 1)`,
            });
            await options.screenshot?.(step.i);
            return { bot, rows, stoppedBeforeSubmit: false };
        }

        if (step.kind === 'click') {
            await options.page.click(selector);
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
            await options.page.setInputFiles(selector, options.filePath ?? step.fileName);
            rows.push({ step: step.i, kind: step.kind, url: step.url, selectorCount: count, ok: true });
            await options.screenshot?.(step.i);
            continue;
        }

        await options.page.click(selector);
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
    const { mkdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
    const fileSystem = createNodeFileSystem();
    const profileDir = resolveBotProfileDir(bot, { root: options.root });
    const outDir = options.outDir ?? join('.spur', 'run', `bot-replay-${bot}`);
    mkdirSync(outDir, { recursive: true });

    const lease = await acquireProfileLease(profileDir, { leaseRoot: options.leaseRoot, fileSystem });
    let context: BrowserContext | undefined;
    try {
        const launcher =
            options.launcher ??
            createKkBrowserLauncher(
                undefined,
                { lease, physicalProfileDir: profileDir },
                { leaseRoot: options.leaseRoot, fileSystem },
            );
        context = await launcher.launch({ profileDir, headless: false });
        const page = await openBotPage(context);
        const shots: string[] = [];
        const result = await replayBotSession(bot, transcript, {
            page,
            submit: options.submit === true,
            ...(options.submitText === undefined ? {} : { submitText: options.submitText }),
            ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
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
        await closeBotContext(context);
        await lease.release();
    }
}
