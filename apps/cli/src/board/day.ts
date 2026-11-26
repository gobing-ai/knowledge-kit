import { basename, dirname, join, resolve } from 'node:path';
import type {
    AttentionItem,
    BoardDiagnostic,
    DailyActionLine,
    DailyDigest,
    DayAttempt,
    DayGeneration,
    DayNodeDuration,
    DaySafety,
    DayStatus,
    DaySummary,
    DayWindow,
    NewsBundleEvidence,
} from '@gobing-ai/kk-board/contracts';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { PublishWindowSchema } from '../publish-core';
import { parseActionLog } from './action-plane';
import { DAY_PATTERN, recipeOf } from './actions';
import { BOARD_RUNS_REL, readCaptureRecord } from './capture';
import { observeRelative } from './collect';
import { bundleEvidence, publishingEvidence } from './news';

/**
 * The day-centric Daily AI Voice projection (G83, task 0439 —
 * docs/design/daily-voice-ops-console.md §1–§3).
 *
 * One day is one episode: the `kk-news-generate` work directory `<works>/kk-news-generate/<day>/`
 * joins the day's generation attempts, its per-window publish evidence and the safety verdict. The
 * Board's Today/History tabs and `kk news digest` all consume this one function, so the console and
 * the CLI cannot disagree.
 *
 * Every read is file-backed and contained to the day directory; a figure the run did not record
 * stays `unknown` with its reason and is never rendered as zero or as success (R12).
 */

/** What the projection needs: the project root (capture records), a filesystem seam, the works root. */
export interface DayContext {
    projectPath: string;
    fs: FileSystem;
    /** The configured works root; defaults to `<projectPath>/.works` (the compiled layout). */
    worksDir?: string;
    /**
     * Whether the guarded action plane is enabled (`board.actions.enabled`). The digest carries it so
     * the console renders recipes-only, with an explicit reason, when the plane is off.
     */
    actionsEnabled?: boolean;
}

/** A day the projection could not find; the path it looked up is the whole answer. */
export interface DayNotFound {
    notFound: true;
    lookedUp: string;
}

/** The windows a day can publish into (the frozen `PublishWindowSchema` vocabulary). */
const PUBLISH_WINDOWS: readonly string[] = PublishWindowSchema.options;

/** The launch statuses a receipt's `status` may carry; anything else reads as `unknown`. */
const KNOWN_LAUNCH_STATUSES = ['running', 'done', 'failed', 'refused', 'no-content'] as const;

/** Bounded text budget for one attention message. */
const MAX_MESSAGE = 240;

/** `listDays` never reads more than this many days per call (a 31-day month). */
export const MAX_DAY_RANGE = 31;

const MAX_DURATIONS = 64;

/**
 * The diagnostic for a day whose receive-side evidence is missing or unreadable.
 *
 * Free text from a report is bounded and never used as a path.
 */
function bounded(value: string, cap = MAX_MESSAGE): string {
    const text = value.trim().replace(/\s+/g, ' ');
    return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function parseJsonOrNull(text: string | undefined): Record<string, unknown> | null {
    if (text === undefined) return null;
    try {
        return asRecord(JSON.parse(text));
    } catch {
        return null;
    }
}

/** The works root a context resolves to. */
export function worksRootOf(ctx: DayContext): string {
    return ctx.worksDir ?? join(ctx.projectPath, '.works');
}

/** The absolute directory of one day. */
export function dayDirOf(ctx: DayContext, day: string): string {
    return join(worksRootOf(ctx), 'kk-news-generate', day);
}

/** True when `day` is a `YYYYMMDD` key. */
export function isDayKey(day: string): boolean {
    return DAY_PATTERN.test(day);
}

/** The recorded launch receipt fields this projection reads; nothing else is surfaced. */
interface LaunchReceipt {
    runId: string | null;
    status: string | null;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
}

function parseReceipt(text: string | undefined): LaunchReceipt | null {
    const record = parseJsonOrNull(text);
    if (record === null) return null;
    const exitCode = record.exitCode;
    return {
        runId: stringOrNull(record.runId),
        status: stringOrNull(record.status),
        exitCode: typeof exitCode === 'number' ? exitCode : null,
        startedAt: stringOrNull(record.startedAt),
        finishedAt: stringOrNull(record.finishedAt),
    };
}

/** Recorded step durations from `step-timing.json` (one JSON object per line). */
function parseDurations(text: string | undefined): { durations: DayNodeDuration[]; openStep: string | null } {
    if (text === undefined) return { durations: [], openStep: null };
    const rows: DayNodeDuration[] = [];
    let openStep: string | null = null;
    for (const line of text.split('\n')) {
        if (line.trim() === '' || rows.length >= MAX_DURATIONS) continue;
        const record = parseJsonOrNull(line);
        const step = stringOrNull(record?.step);
        const startedAt = stringOrNull(record?.startedAt);
        const endedAt = stringOrNull(record?.endedAt);
        if (step === null || startedAt === null) continue;
        // A step that recorded its start without its end is where the run stopped: it is the
        // only node the day's own evidence can name for a resume.
        if (endedAt === null) {
            openStep = step;
            continue;
        }
        const elapsedMs = Date.parse(endedAt) - Date.parse(startedAt);
        rows.push({ step, startedAt, endedAt, durationMs: Number.isFinite(elapsedMs) ? elapsedMs : null });
    }
    return { durations: rows, openStep };
}

/** True when a recorded workspace path names this day's `kk-news-generate` directory. */
function isDayWorkspace(record: { workspacePath: string }, dir: string, day: string): boolean {
    if (resolve(record.workspacePath) === resolve(dir)) return true;
    return basename(record.workspacePath) === day && basename(dirname(record.workspacePath)) === 'kk-news-generate';
}

/**
 * Every captured `kk-news-generate` attempt, grouped by its day directory, oldest first.
 *
 * The capture record is the only authority for "this run belongs to that day": a run whose
 * workspace is elsewhere is not this day's attempt, whatever its run id looks like.
 */
async function captureIndex(ctx: DayContext): Promise<Map<string, DayAttempt[]>> {
    const index = new Map<string, DayAttempt[]>();
    const runsDir = join(ctx.projectPath, BOARD_RUNS_REL);
    if (!(await ctx.fs.exists(runsDir))) return index;
    let names: string[];
    try {
        names = (await ctx.fs.readDir(runsDir)).filter((name) => name.endsWith('.json')).sort();
    } catch {
        return index;
    }
    for (const name of names) {
        const record = await readCaptureRecord(ctx.fs, ctx.projectPath, name.slice(0, -'.json'.length));
        if (record === null || record.workflow !== 'kk-news-generate') continue;
        const key = resolve(record.workspacePath);
        const list = index.get(key) ?? [];
        list.push({ runId: record.runId, capturedAt: record.capturedAt, status: null });
        index.set(key, list);
    }
    for (const list of index.values()) list.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    return index;
}

/** The attempts captured for one day directory, looking past a symlinked works root. */
function attemptsFor(index: Map<string, DayAttempt[]>, dir: string, day: string): DayAttempt[] {
    const direct = index.get(resolve(dir));
    if (direct !== undefined) return direct;
    for (const [key, list] of index) {
        if (isDayWorkspace({ workspacePath: key }, dir, day)) return list;
    }
    return [];
}

/** The confidence levels a judge verdict may record; anything else is not usable evidence. */
const JUDGE_CONFIDENCE = ['HIGH', 'MEDIUM', 'LOW'] as const;

/**
 * The safety evidence: the decision (the verdict that gates publishing) and the judge's verdict.
 *
 * A judge verdict is surfaced only when it names a confidence from the frozen enum: an unlabelled or
 * unrecognized confidence is not evidence, and reading it as one is exactly the silent-judge gap the
 * confidence contract exists to close.
 */
async function safetyOf(
    fs: FileSystem,
    dir: string,
    day: string,
    bundle: NewsBundleEvidence | null,
    diagnostics: BoardDiagnostic[],
): Promise<{ safety: DaySafety; source: string | null }> {
    const rel = '4-safety-variants';
    let names: string[];
    try {
        names = (await fs.readDir(join(dir, rel))).sort();
    } catch {
        // No safety directory at all: the bundle's own safety card is the only recorded word, and
        // its absence is an explicit unknown rather than an implicit pass.
        return {
            safety: { verdict: bundle?.safety ?? null, judge: null, unknownReason: 'no-safety-evidence' },
            source: bundle?.safety == null ? null : 'bundle.json',
        };
    }
    const decisionName = names.find((name) => name.startsWith(day) && name.endsWith('safety-verdict.decision'));
    const judgeName = names.find((name) => name.endsWith('safety-judge_verdict.json'));
    const decision =
        decisionName === undefined
            ? null
            : parseJsonOrNull((await observeRelative(fs, dir, `${rel}/${decisionName}`, 'json')).text);
    const judge =
        judgeName === undefined
            ? null
            : parseJsonOrNull((await observeRelative(fs, dir, `${rel}/${judgeName}`, 'json')).text);
    const judgeConfidence = stringOrNull(judge?.confidence);
    const judgeIsUsable =
        judgeConfidence !== null && JUDGE_CONFIDENCE.includes(judgeConfidence as (typeof JUDGE_CONFIDENCE)[number]);
    if (judge !== null && !judgeIsUsable) {
        diagnostics.push({
            code: 'board.day.judge-confidence-unverified',
            message: 'The recorded safety judge verdict carries no recognized confidence; it is not surfaced.',
        });
    }
    if (decisionName !== undefined && decision === null) {
        diagnostics.push({
            code: 'board.day.safety-invalid',
            message: 'The recorded safety decision is malformed; the verdict reads as unknown.',
        });
    }
    return {
        safety: {
            verdict: stringOrNull(decision?.value) ?? bundle?.safety ?? null,
            judge: judgeIsUsable ? stringOrNull(judge?.verdict) : null,
            unknownReason: decision !== null || bundle?.safety != null ? null : 'no-safety-decision',
        },
        source: decisionName !== undefined ? `${rel}/${decisionName}` : bundle?.safety == null ? null : 'bundle.json',
    };
}

/** One window's launch receipt: its run id and the status the launcher recorded. */
async function windowLaunch(
    fs: FileSystem,
    dir: string,
    window: string,
    planPresent: boolean,
): Promise<Pick<DayWindow, 'runId' | 'launchStatus' | 'unknownReason'>> {
    const rel = `4-publish/schedule-receipt.${window}.json`;
    const observation = await observeRelative(fs, dir, rel, 'json');
    if (observation.state !== 'present') {
        // A plan without a launch receipt is the unbound case (R6): unknown, never "not run"
        // (which would claim the window was deliberately skipped) and never a success.
        return planPresent
            ? { runId: null, launchStatus: 'unknown', unknownReason: 'no-launch-receipt' }
            : { runId: null, launchStatus: 'not-run', unknownReason: null };
    }
    const receipt = parseReceipt(observation.text);
    if (receipt === null || receipt.status === null) {
        return { runId: receipt?.runId ?? null, launchStatus: 'unknown', unknownReason: 'launch-receipt-invalid' };
    }
    const known = KNOWN_LAUNCH_STATUSES.includes(receipt.status as (typeof KNOWN_LAUNCH_STATUSES)[number]);
    return {
        runId: receipt.runId,
        launchStatus: known ? (receipt.status as DayWindow['launchStatus']) : 'unknown',
        unknownReason: known ? null : 'unrecognized-launch-status',
    };
}

/** The day key of the local calendar day, for the window-slot rule. */
function todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

/** Build the attention list from the closed rule set (design §2). */
function attentionItems(input: {
    day: string;
    launch: LaunchReceipt | null;
    failedNode: string | null;
    reportLine: string | null;
    windows: readonly DayWindow[];
    safety: DaySafety;
}): AttentionItem[] {
    const items: AttentionItem[] = [];
    const { day, launch, windows, safety } = input;
    const runId = launch?.runId ?? null;

    if (launch?.status === 'failed') {
        const node = input.failedNode;
        const params = node === null || runId === null ? null : { node, runId };
        const recipe = params === null ? null : recipeOf('generate-from-node', `resume from ${node}`, params);
        items.push({
            severity: 'error',
            kind: 'generation-failed',
            subject: node ?? 'generation',
            message:
                node === null
                    ? `The generation run failed${launch.exitCode === null ? '' : ` (exit ${launch.exitCode})`}, but no step recorded where it stopped; the recipe needs a node from the run's own report.`
                    : `The generation run failed at '${node}'${launch.exitCode === null ? '' : ` (exit ${launch.exitCode})`}.`,
            evidence: 'schedule-receipt.json',
            recipes: recipe === null ? [] : [recipe],
        });
    }

    if (launch?.status === 'no-content') {
        items.push({
            severity: 'warn',
            kind: 'generation-refused',
            subject: 'generation',
            message: input.reportLine ?? 'The generation run recorded no content for this day.',
            evidence: 'run-report.summary.txt',
            // A refusal is a content-side decision (floor, QC, empty pool): no step re-render
            // undoes it, so the item carries no recipe rather than an argv that cannot help.
            recipes: [],
        });
    }

    const dayIsPast = day < todayKey();
    for (const window of windows) {
        const planPath = `4-publish/plan.${window.window}.json`;
        if (window.launchStatus === 'not-run' && dayIsPast) {
            const recipe = recipeOf('publish-window', `dry-run ${window.window}`, {
                day,
                window: window.window,
                dummy: 'true',
            });
            items.push({
                severity: 'warn',
                kind: 'window-not-run',
                subject: window.window,
                message: `The '${window.window}' window recorded no plan and no launch receipt, and its slot has passed.`,
                evidence: planPath,
                recipes: recipe === null ? [] : [recipe],
            });
        }
        const mismatched = Object.entries(window.provenance)
            .filter(([, value]) => value === false)
            .map(([key]) => key.replace('Match', ''));
        if (mismatched.length > 0) {
            items.push({
                severity: 'warn',
                kind: 'provenance-mismatch',
                subject: window.window,
                message: `The '${window.window}' publish plan fails its identity checks (${mismatched.join(', ')}); its rows are surfaced, not trusted.`,
                evidence: planPath,
                recipes: [],
            });
        }
        const failed = window.targets.filter((target) => target.status === 'failed');
        if (failed.length > 0) {
            const plugins = [...new Set(failed.map((target) => (target.target ?? target.id).split('.')[0] ?? ''))];
            const channels = plugins.filter((plugin) => plugin !== '').join(',');
            const recipe =
                channels === ''
                    ? recipeOf('publish-retry', `retry ${window.window}`, { day, window: window.window })
                    : recipeOf('publish-retry', `retry ${failed.length} failed target(s)`, {
                          day,
                          window: window.window,
                          channels,
                      });
            const blocked = failed.filter((target) => target.effect === 'none');
            items.push({
                severity: blocked.length > 0 ? 'error' : 'warn',
                kind: 'target-failed',
                subject: window.window,
                message: `${failed.length} target(s) failed in '${window.window}' (${failed
                    .map((target) => `${target.id}: ${target.error ?? target.status}`)
                    .join('; ')}).`,
                evidence: failed[0]?.evidence.receipt ?? planPath,
                recipes: recipe === null ? [] : [recipe],
            });
        }
    }

    if (safety.verdict !== null && safety.verdict !== 'pass') {
        const recipe =
            runId === null ? null : recipeOf('generate-from-node', 're-run the safety node', { node: 'safety', runId });
        items.push({
            severity: 'warn',
            kind: 'safety-flag',
            subject: 'safety',
            message: `The recorded safety verdict is '${safety.verdict}'${safety.judge === null ? '' : ` (judge ${safety.judge})`}; publishing is held until it is resolved.`,
            evidence: '4-safety-variants',
            recipes: recipe === null ? [] : [recipe],
        });
    } else if (safety.judge === 'FAIL') {
        items.push({
            severity: 'warn',
            kind: 'safety-flag',
            subject: 'safety',
            message: 'The safety judge recorded FAIL while the decision reads pass; reconcile before publishing.',
            evidence: '4-safety-variants',
            recipes: [],
        });
    }
    return items;
}

/** The severity order the attention list is sorted by. */
const SEVERITY_RANK: Record<AttentionItem['severity'], number> = { error: 0, warn: 1, info: 2 };

/** The worst-of day status (design §2), from the recorded evidence only. */
function worstOf(input: {
    windows: readonly DayWindow[];
    launch: LaunchReceipt | null;
    attention: readonly AttentionItem[];
    hasEvidence: boolean;
}): DayStatus {
    const { windows, launch, attention, hasEvidence } = input;
    const running = launch?.status === 'running' || windows.some((window) => window.launchStatus === 'running');
    if (running) return 'running';
    const blockedTarget = windows.some((window) =>
        window.targets.some((target) => target.status === 'failed' && target.effect === 'none'),
    );
    if (launch?.status === 'failed' || blockedTarget) return 'failed';
    if (!hasEvidence) return 'unknown';
    if (attention.length > 0) return 'attention';
    return 'ok';
}

/** Project one day whose directory and capture records are already resolved. */
async function projectKnownDay(
    ctx: DayContext,
    day: string,
    dir: string,
    attempts: DayAttempt[],
    actionsEnabled: boolean,
): Promise<DailyDigest | DayNotFound> {
    const { fs } = ctx;
    const diagnostics: BoardDiagnostic[] = [];
    const sources: Record<string, string> = {};
    const seen = new Set<string>();
    const read = async (relative: string, kind: 'text' | 'json') => {
        const observation = await observeRelative(fs, dir, relative, kind);
        if (observation.state === 'present') seen.add(relative);
        return observation;
    };

    const receiptObservation = await read('schedule-receipt.json', 'json');
    const launch = receiptObservation.state === 'present' ? parseReceipt(receiptObservation.text) : null;
    if (receiptObservation.state === 'present') {
        sources['generation.launch'] = 'schedule-receipt.json';
        if (launch === null) {
            diagnostics.push({
                code: 'board.day.receipt-invalid',
                message: 'The recorded launch receipt is malformed; the generation figures read as unknown.',
            });
        }
    }

    const current = attempts[attempts.length - 1] ?? null;
    if (launch?.runId !== null && launch?.runId !== undefined && current !== null && launch.runId !== current.runId) {
        diagnostics.push({
            code: 'board.day.receipt-stale',
            message: `The launch receipt names run '${launch.runId}', not the captured attempt '${current.runId}'.`,
        });
    }
    if (current !== null) sources['generation.attempts'] = `${BOARD_RUNS_REL}/${current.runId}.json`;

    const bundleObservation = await read('bundle.json', 'json');
    const bundleParsed = bundleEvidence(bundleObservation.text, bundleObservation.state === 'present');
    if (bundleParsed.invalid) {
        diagnostics.push({
            code: 'board.day.bundle-invalid',
            message: 'The recorded bundle is malformed; its identity is reported as unknown.',
        });
    }
    if (bundleParsed.bundle !== null) sources['generation.bundle'] = 'bundle.json';

    const timingObservation = await read('step-timing.json', 'text');
    const timings = parseDurations(timingObservation.text);
    const durations = timings.durations;
    if (durations.length > 0) sources['generation.durations'] = 'step-timing.json';

    const actionLogObservation = await read('actions.jsonl', 'text');
    const actionLines: DailyActionLine[] = parseActionLog(actionLogObservation.text);
    if (actionLines.length > 0) sources.actions = 'actions.jsonl';

    const reportObservation = await read('run-report.summary.txt', 'text');
    const reportLine =
        reportObservation.text === undefined ? null : bounded(reportObservation.text.split('\n')[0] ?? '');

    const publishing = await publishingEvidence({
        runId: current?.runId ?? launch?.runId ?? day,
        stamp: day,
        markerOwned: true,
        bundle: bundleParsed.bundle,
        readWorkspaceFile: read,
        pushDiagnostic: (diagnostic) => {
            if (diagnostics.length < 16) diagnostics.push(diagnostic);
        },
    });

    const windows: DayWindow[] = [];
    for (const window of PUBLISH_WINDOWS) {
        const recorded = publishing.windows.find((group) => group.window === window);
        const launched = await windowLaunch(fs, dir, window, seen.has(`4-publish/plan.${window}.json`));
        if (seen.has(`4-publish/plan.${window}.json`)) sources[`windows.${window}`] = `4-publish/plan.${window}.json`;
        if (launched.runId !== null) sources[`windows.${window}.launch`] = `4-publish/schedule-receipt.${window}.json`;
        windows.push({
            window,
            runId: launched.runId,
            launchStatus: launched.launchStatus,
            unknownReason: launched.unknownReason,
            recordedStatus: recorded?.recordedStatus ?? null,
            provenance: recorded?.provenance ?? {
                dateMatch: null,
                bundleMatch: null,
                parentMatch: null,
                digestMatch: null,
            },
            targets: recorded?.targets ?? [],
        });
    }

    const safetyRead = await safetyOf(fs, dir, day, bundleParsed.bundle, diagnostics);
    if (safetyRead.source !== null) sources.safety = safetyRead.source;

    // A failed run leaves its last step open: that step is the only node the day's own evidence
    // can name, and naming a wrong node would offer a resume that cannot work.
    const openStep = launch?.status === 'failed' ? timings.openStep : null;

    // Severity first (error → warn → info), so the Today tab's list needs no client-side sort; the
    // rule order stays a stable tie-break inside one severity.
    const attention = attentionItems({
        day,
        launch,
        failedNode: openStep,
        reportLine,
        windows,
        safety: safetyRead.safety,
    }).sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]);

    const unknownReason = launch === null ? 'no-launch-receipt' : null;

    const generation: DayGeneration = {
        runId: current?.runId ?? launch?.runId ?? null,
        launchStatus: launch?.status ?? null,
        exitCode: launch?.exitCode ?? null,
        startedAt: launch?.startedAt ?? null,
        finishedAt: launch?.finishedAt ?? null,
        outcome: bundleParsed.bundle !== null ? 'episode' : (launch?.status ?? null),
        attempts: attempts.map((attempt) => ({
            ...attempt,
            status: launch?.runId === attempt.runId ? launch.status : attempt.status,
        })),
        bundle: bundleParsed.bundle,
        durations,
        unknownReason,
    };

    const hasEvidence =
        launch !== null ||
        windows.some((window) => window.launchStatus !== 'not-run') ||
        safetyRead.safety.verdict !== null;

    return {
        schemaVersion: 1,
        day,
        status: worstOf({ windows, launch, attention, hasEvidence }),
        generation,
        windows,
        safety: safetyRead.safety,
        attention,
        actions: { enabled: actionsEnabled, lines: actionLines },
        sources,
        diagnostics,
    };
}

/**
 * Project one day into the shared digest.
 *
 * Returns {@link DayNotFound} (with the exact directory it looked up) rather than an empty digest
 * when the day has no directory at all.
 */
export async function projectDay(ctx: DayContext, day: string): Promise<DailyDigest | DayNotFound> {
    const dir = dayDirOf(ctx, day);
    if (!isDayKey(day) || !(await ctx.fs.exists(dir))) return { notFound: true, lookedUp: dir };
    return projectKnownDay(ctx, day, dir, attemptsFor(await captureIndex(ctx), dir, day), ctx.actionsEnabled === true);
}

/** Every day directory recorded in the works root, newest first. */
async function dayDirs(ctx: DayContext): Promise<string[]> {
    try {
        return (await ctx.fs.readDir(join(worksRootOf(ctx), 'kk-news-generate')))
            .filter((name) => isDayKey(name))
            .sort()
            .reverse();
    } catch {
        return [];
    }
}

/**
 * The bounded day list behind the History view.
 *
 * Reads at most {@link MAX_DAY_RANGE} days inside `[from, until]`, newest first; a malformed bound
 * or an inverted range yields an empty list rather than an unbounded scan.
 */
export async function listDays(ctx: DayContext, from: string, until: string): Promise<DaySummary[]> {
    if (!isDayKey(from) || !isDayKey(until) || from > until) return [];
    const days = (await dayDirs(ctx)).filter((day) => day >= from && day <= until).slice(0, MAX_DAY_RANGE);
    const index = await captureIndex(ctx);
    const summaries: DaySummary[] = [];
    for (const day of days) {
        const dir = dayDirOf(ctx, day);
        const digest = await projectKnownDay(ctx, day, dir, attemptsFor(index, dir, day), ctx.actionsEnabled === true);
        if ('notFound' in digest) continue;
        summaries.push({
            day,
            status: digest.status,
            runId: digest.generation.runId,
            windows: digest.windows.map((window) => ({ window: window.window, launchStatus: window.launchStatus })),
            durations: digest.generation.durations,
        });
    }
    return summaries;
}
