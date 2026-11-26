import type {
    AttentionItem,
    DailyActionLine,
    DailyDigest,
    DayNodeDuration,
    DayStatus,
    DaySummary,
    Recipe,
} from '../contracts';
import type { StateTone } from './evidence';

/**
 * The day-centric console's view model (G83, task 0440 —
 * docs/design/daily-voice-ops-console.md §4–§5).
 *
 * Pure functions over `DailyDigest` / `DaySummary`: tab identity, the hash that carries the selected
 * day, Today/History facts, the per-node duration trend and recipe rendering. The module renders
 * what these return; no status is recomputed client-side and no unknown is ever rendered as a zero.
 */

/** The console's tab ids, in strip order. */
export const CONSOLE_TABS = ['today', 'generation', 'publishing', 'history', 'actions'] as const;

/** One console tab id. */
export type ConsoleTab = (typeof CONSOLE_TABS)[number];

/** The visible label of each tab, in strip order. */
export const CONSOLE_TAB_LABELS: Record<ConsoleTab, string> = {
    today: 'Today',
    generation: 'Generation',
    publishing: 'Publishing',
    history: 'History',
    actions: 'Actions log',
};

/** The History view's default window, in days (the reader caps a range at 31). */
export const HISTORY_DEFAULT_DAYS = 14;

/** What the URL hash carries: the reading day and the open tab. */
export interface ConsoleLocation {
    day: string | null;
    tab: ConsoleTab;
}

/** True when `day` is a `YYYYMMDD` key (the reader's own day domain). */
export function isDayKey(day: string): boolean {
    return /^\d{8}$/.test(day);
}

/**
 * Parse the module hash (`#day=YYYYMMDD&tab=history`).
 *
 * An unknown tab falls back to `today` and a malformed day to `null` — the hash is operator-editable,
 * so it is validated, never trusted.
 */
export function parseConsoleHash(hash: string): ConsoleLocation {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(raw);
    const day = params.get('day');
    const tab = params.get('tab');
    return {
        day: day !== null && isDayKey(day) ? day : null,
        tab: tab !== null && (CONSOLE_TABS as readonly string[]).includes(tab) ? (tab as ConsoleTab) : 'today',
    };
}

/** The hash one location deep-links to. */
export function consoleHash(day: string | null, tab: ConsoleTab): string {
    const params = new URLSearchParams();
    if (day !== null && isDayKey(day)) params.set('day', day);
    params.set('tab', tab);
    return `#${params.toString()}`;
}

/** The day status word and the kit tone it renders with. */
export function dayStatusWord(status: DayStatus): { word: string; tone: StateTone } {
    const words: Record<DayStatus, string> = {
        ok: 'all clear',
        attention: 'needs attention',
        failed: 'failed',
        running: 'running',
        unknown: 'unknown',
    };
    const tones: Record<DayStatus, StateTone> = {
        ok: 'success',
        attention: 'warn',
        failed: 'error',
        running: 'info',
        unknown: 'neutral',
    };
    return { word: words[status], tone: tones[status] };
}

/** One label/value fact row; `null` renders as the explicit unknown, never as an empty cell. */
export interface DayFact {
    label: string;
    value: string;
    tone: StateTone;
}

/** The unknown word for a figure the day never recorded, with its reason when one is supplied. */
function unknownWord(reason: string | null): string {
    return reason === null ? 'unknown' : `unknown (${reason})`;
}

/** The Today tab's generation card: what ran, how it ended and which bundle it froze. */
export function generationFacts(digest: DailyDigest): DayFact[] {
    const generation = digest.generation;
    const status = dayStatusWord(digest.status);
    return [
        { label: 'day status', value: status.word, tone: status.tone },
        {
            label: 'run',
            value: generation.runId ?? unknownWord(generation.unknownReason),
            tone: generation.runId === null ? 'warn' : 'neutral',
        },
        {
            label: 'launch',
            value: generation.launchStatus ?? unknownWord(generation.unknownReason),
            tone: generation.launchStatus === 'done' ? 'success' : generation.launchStatus === null ? 'warn' : 'info',
        },
        {
            label: 'outcome',
            value: generation.outcome ?? unknownWord(generation.unknownReason),
            tone: generation.outcome === 'episode' ? 'success' : generation.outcome === null ? 'warn' : 'info',
        },
        {
            label: 'bundle',
            value:
                generation.bundle === null
                    ? 'unknown'
                    : `${generation.bundle.identity} · ${generation.bundle.title ?? 'untitled'}`,
            tone: generation.bundle === null ? 'warn' : 'neutral',
        },
        {
            label: 'safety',
            value:
                digest.safety.verdict === null
                    ? unknownWord(digest.safety.unknownReason)
                    : `${digest.safety.verdict}${digest.safety.judge === null ? '' : ` (judge ${digest.safety.judge})`}`,
            tone: digest.safety.verdict === 'pass' ? 'success' : digest.safety.verdict === null ? 'warn' : 'error',
        },
        {
            label: 'attempts',
            value:
                generation.attempts.length === 0
                    ? unknownWord('no-capture-record')
                    : String(generation.attempts.length),
            tone: generation.attempts.length === 0 ? 'warn' : 'neutral',
        },
    ];
}

/** One publish target row of the window strip, ready to render. */
export interface ConsoleTargetRow {
    id: string;
    target: string;
    status: string;
    effect: string;
    error: string;
    evidence: string;
}

/** One publish window of the Today strip: launch state, recorded outcome and its targets. */
export interface ConsoleWindowRow {
    window: string;
    label: string;
    launch: string;
    tone: StateTone;
    recorded: string;
    unknownReason: string | null;
    targets: ConsoleTargetRow[];
}

/** Display label for a window id (`overseas-rss` → `Overseas rss`) without inventing a schedule. */
function windowLabel(window: string): string {
    const words = window.replace(/[-_]/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The window strip: one row per publish window the day could have, `not-run` included. */
export function windowRows(digest: DailyDigest): ConsoleWindowRow[] {
    return digest.windows.map((window) => {
        const tone: StateTone =
            window.launchStatus === 'done'
                ? 'success'
                : window.launchStatus === 'failed'
                  ? 'error'
                  : window.launchStatus === 'running'
                    ? 'info'
                    : window.launchStatus === 'not-run'
                      ? 'neutral'
                      : 'warn';
        return {
            window: window.window,
            label: windowLabel(window.window),
            launch: window.launchStatus,
            tone,
            recorded: window.recordedStatus ?? 'unknown',
            unknownReason: window.unknownReason,
            targets: window.targets.map((target) => ({
                id: target.id,
                target: target.target ?? target.id.split('.')[0] ?? target.id,
                status: target.status,
                effect: target.effect ?? 'unknown',
                error: target.error ?? '',
                evidence: target.evidence.receipt ?? target.evidence.plan,
            })),
        };
    });
}

/** One Actions-log row: what was asked, what ran, and how it ended. */
export interface ActionLogRow {
    ts: string;
    kind: string;
    /** `preview` | `launched` | `exited` (with an exit code) | `refused`. */
    word: string;
    tone: StateTone;
    argv: string;
    runId: string | null;
    exit: number | null;
    refusal: string | null;
}

/**
 * The Actions log rows for the day.
 *
 * A line is preview, launch or exit when it has a `result`, and a refusal otherwise; the tone
 * follows the exit code so a non-zero child is visibly red rather than merely recorded.
 */
export function actionLogRows(digest: DailyDigest): ActionLogRow[] {
    return [...digest.actions.lines].reverse().map((line: DailyActionLine) => {
        const word =
            line.refusal !== undefined && line.refusal !== null
                ? `refused: ${line.refusal}`
                : line.result === 'preview'
                  ? 'preview'
                  : line.result === 'launched'
                    ? 'launched'
                    : line.exit === null
                      ? (line.result ?? 'recorded')
                      : `exit ${line.exit}`;
        const tone: StateTone =
            line.refusal !== undefined && line.refusal !== null
                ? 'warn'
                : line.exit !== null && line.exit !== 0
                  ? 'error'
                  : line.result === 'launched'
                    ? 'info'
                    : 'success';
        return {
            ts: line.ts,
            kind: line.kind,
            word,
            tone,
            argv: recipeText(line.argv),
            runId: line.runId,
            exit: line.exit,
            refusal: line.refusal ?? null,
        };
    });
}

/** Whether the console may offer a launch button at all (the plane's own switch). */
export function actionPlaneEnabled(digest: DailyDigest): boolean {
    return digest.actions.enabled;
}

/** One attention row, ordered by the reader's severity order and carrying its recipes. */
export interface AttentionRow {
    severity: AttentionItem['severity'];
    tone: StateTone;
    kind: string;
    subject: string;
    message: string;
    evidence: string | null;
    recipes: Recipe[];
}

const SEVERITY_TONE: Record<AttentionItem['severity'], StateTone> = {
    error: 'error',
    warn: 'warn',
    info: 'info',
};

/**
 * The Today tab's attention list.
 *
 * The projection already sorts by severity; this only maps tones and keeps the order, so the
 * console never disagrees with `kk news digest` about what comes first.
 */
export function attentionRows(digest: DailyDigest): AttentionRow[] {
    return digest.attention.map((item) => ({
        severity: item.severity,
        tone: SEVERITY_TONE[item.severity],
        kind: item.kind,
        subject: item.subject,
        message: item.message,
        evidence: item.evidence,
        recipes: item.recipes,
    }));
}

/**
 * One recipe as shell-safe copyable text.
 *
 * Arguments are POSIX-quoted only when they need it, so the common case stays byte-identical to the
 * resolved argv (`kk news publish --retry`), which is the format `kk news digest` prints.
 */
export function recipeText(argv: readonly string[]): string {
    return argv.map(quoteArg).join(' ');
}

/** POSIX-quote one argument; a plain token passes through unchanged. */
export function quoteArg(argument: string): string {
    if (argument !== '' && /^[A-Za-z0-9_./:=@%+,-]+$/.test(argument)) return argument;
    return `'${argument.replace(/'/g, `'\\''`)}'`;
}

/** One History row: the day, its health and its window outcomes. */
export interface HistoryRow {
    day: string;
    status: DayStatus;
    word: string;
    tone: StateTone;
    runId: string | null;
    windows: { window: string; launch: string; tone: StateTone }[];
    /** Total recorded generation time, or null when the day recorded no durations. */
    totalMs: number | null;
}

/** The History view's per-day rows, newest first (the order `listDays` answers). */
export function historyRows(days: readonly DaySummary[]): HistoryRow[] {
    return days.map((day) => {
        const status = dayStatusWord(day.status);
        const durations = day.durations.filter((duration) => duration.durationMs !== null);
        return {
            day: day.day,
            status: day.status,
            word: status.word,
            tone: status.tone,
            runId: day.runId,
            windows: day.windows.map((window) => ({
                window: window.window,
                launch: window.launchStatus,
                tone:
                    window.launchStatus === 'done'
                        ? 'success'
                        : window.launchStatus === 'failed'
                          ? 'error'
                          : window.launchStatus === 'not-run'
                            ? 'neutral'
                            : 'warn',
            })),
            totalMs:
                durations.length === 0
                    ? null
                    : durations.reduce((total, duration) => total + (duration.durationMs ?? 0), 0),
        };
    });
}

/** One point of the per-node duration trend: the day, and that step's duration when it recorded one. */
export interface DurationTrendPoint {
    day: string;
    ms: number | null;
}

/** One step's series across the listed days, oldest first. */
export interface DurationTrend {
    step: string;
    points: DurationTrendPoint[];
    /** The newest recorded duration for the step, or null when a day never recorded one. */
    latestMs: number | null;
}

/**
 * The per-node duration trend over the listed days.
 *
 * A step a day did not record keeps a `null` point (a gap), so the series never implies a zero
 * duration for a day that simply did not run the step.
 */
export function durationTrend(days: readonly DaySummary[]): DurationTrend[] {
    const ordered = [...days].sort((left, right) => left.day.localeCompare(right.day));
    const steps = new Set<string>();
    for (const day of ordered) for (const duration of day.durations) steps.add(duration.step);
    return [...steps].sort().map((step) => {
        const points = ordered.map((day) => {
            const match: DayNodeDuration | undefined = day.durations.find((duration) => duration.step === step);
            return { day: day.day, ms: match?.durationMs ?? null };
        });
        const recorded = points.filter((point) => point.ms !== null);
        return { step, points, latestMs: recorded.length === 0 ? null : (recorded[recorded.length - 1]?.ms ?? null) };
    });
}

/** Format a duration for display; a missing duration is the explicit unknown, never `0s`. */
export function formatDuration(ms: number | null): string {
    if (ms === null) return 'unknown';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
}

/** The day range the History tab requests: `days` back from `anchor` (default 14, below the cap). */
export function historyRange(anchor: string, days: number = HISTORY_DEFAULT_DAYS): { from: string; until: string } {
    const until = isDayKey(anchor) ? anchor : new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const date = new Date(Number(until.slice(0, 4)), Number(until.slice(4, 6)) - 1, Number(until.slice(6, 8)));
    date.setDate(date.getDate() - (Math.max(1, days) - 1));
    const from = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return { from: from <= until ? from : until, until };
}
