import type { RunResults } from '../contracts';
import type { ResultFact } from '../shared/collect';
import { formatElapsed, formatTimestamp } from '../shared/format';
import type { RunListRow } from '../shared/run-selection';

/**
 * The Daily AI Voice module's read-only view model.
 *
 * Pure projection of the reader's `RunResults.summary` bag into render rows, so the entry stays a
 * thin component. Absent evidence is an explicit availability, never an invented zero — the reader
 * never fabricates a value and the view never fills one in.
 */

/** The semantic publish outcome of one channel, independent of engine execution status. */
export type ChannelOutcome = 'live' | 'draft' | 'skipped' | 'error' | 'pending' | 'unavailable';

/** The content-judge confidence levels the daily safety gate accepts (`HIGH` | `MEDIUM` | `LOW`). */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** The three recognized confidence levels, in strength order. */
export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

/** One channel row. */
export interface DailyChannelView {
    channel: string;
    label: string;
    outcome: ChannelOutcome;
    /** Operator-facing outcome text. */
    state: string;
    /** A validated public link, or null. */
    url: string | null;
    detail: string | null;
}

/** One DAG node row. */
export interface DailyProgressNodeView {
    id: string;
    status: string;
    attempts: number;
    timing: string;
}

/** The recorded DAG progress. */
export interface DailyProgressView {
    nodes: DailyProgressNodeView[];
    edges: { from: string; to: string }[] | null;
    edgesKnown: boolean;
    childRunId: string | null;
}

/** Channel counts for the Summary tab. */
export interface DailyChannelCounts {
    live: number;
    draft: number;
    failed: number;
    skipped: number;
}

/** The narrowed daily summary. */
export interface DailySummaryView {
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    articleTitle: string | null;
    channels: DailyChannelView[];
    quality: { overallScore: number | null; passed: boolean | null; criticalIssues: string[] } | null;
    safety: { verdict: string | null; confidence: ConfidenceLevel | null } | null;
    progress: DailyProgressView | null;
    counts: DailyChannelCounts;
    /** False when the reader sent no counts bag — the counts rows then state the gap, never 0. */
    countsRecorded: boolean;
}

const CHANNEL_OUTCOME_LABELS: Record<ChannelOutcome, string> = {
    live: 'Live',
    draft: 'Draft',
    skipped: 'Skipped',
    error: 'Failed',
    pending: 'Not yet recorded',
    unavailable: 'Unavailable',
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

/** True when `value` is one of the six channel outcomes. */
export function isChannelOutcome(value: unknown): value is ChannelOutcome {
    return (
        value === 'live' ||
        value === 'draft' ||
        value === 'skipped' ||
        value === 'error' ||
        value === 'pending' ||
        value === 'unavailable'
    );
}

/**
 * True when `value` is one of the three recognized confidence levels. An out-of-vocabulary value is
 * reported as unknown, never echoed as a confidence.
 */
export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
    return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}

/** Narrow one channel entry from the summary bag, dropping a malformed row. */
function channelView(value: unknown): DailyChannelView | null {
    const record = asRecord(value);
    if (record === null || typeof record.channel !== 'string' || !isChannelOutcome(record.outcome)) return null;
    return {
        channel: record.channel,
        label: asString(record.label) ?? record.channel,
        outcome: record.outcome,
        state: CHANNEL_OUTCOME_LABELS[record.outcome],
        url: asString(record.url),
        detail: asString(record.detail),
    };
}

/** Narrow one DAG node entry, dropping a malformed row. */
function nodeView(value: unknown): DailyProgressNodeView | null {
    const record = asRecord(value);
    if (record === null || typeof record.id !== 'string') return null;
    return {
        id: record.id,
        status: asString(record.status) ?? 'unknown',
        attempts: asNumber(record.attempts) ?? 0,
        timing: asString(record.timing) ?? 'timing unknown',
    };
}

/** Narrow the recorded progress bag. */
function progressView(value: unknown): DailyProgressView | null {
    const record = asRecord(value);
    if (record === null) return null;
    const edges = Array.isArray(record.edges)
        ? record.edges
              .map((edge) => asRecord(edge))
              .filter((edge): edge is Record<string, unknown> => edge !== null)
              .map((edge) => ({ from: String(edge.from ?? ''), to: String(edge.to ?? '') }))
        : null;
    return {
        nodes: Array.isArray(record.nodes)
            ? record.nodes.map(nodeView).filter((node): node is DailyProgressNodeView => node !== null)
            : [],
        edges,
        edgesKnown: record.edgesKnown === true,
        childRunId: asString(record.childRunId),
    };
}

/** Narrow the reader's `summary` bag into the Daily projection without inventing values. */
export function dailySummary(results: RunResults): DailySummaryView {
    const raw = results.summary ?? {};
    const counts = asRecord(raw.counts);
    const quality = asRecord(raw.quality);
    const safety = asRecord(raw.safety);
    return {
        status: asString(raw.status),
        startedAt: asString(raw.startedAt),
        completedAt: asString(raw.completedAt),
        outcome: asString(raw.outcome),
        articleTitle: asString(raw.articleTitle),
        channels: Array.isArray(raw.channels)
            ? raw.channels.map(channelView).filter((channel): channel is DailyChannelView => channel !== null)
            : [],
        quality:
            quality === null
                ? null
                : {
                      overallScore: asNumber(quality.overallScore),
                      passed: asBool(quality.passed),
                      criticalIssues: Array.isArray(quality.criticalIssues)
                          ? quality.criticalIssues.filter((issue): issue is string => typeof issue === 'string')
                          : [],
                  },
        safety:
            safety === null
                ? null
                : {
                      verdict: asString(safety.verdict),
                      confidence: isConfidenceLevel(safety.confidence) ? safety.confidence : null,
                  },
        progress: progressView(raw.progress),
        counts: {
            live: asNumber(counts?.live) ?? 0,
            draft: asNumber(counts?.draft) ?? 0,
            failed: asNumber(counts?.failed) ?? 0,
            skipped: asNumber(counts?.skipped) ?? 0,
        },
        countsRecorded: counts !== null,
    };
}

function count(value: number | null): string {
    return value === null ? 'unavailable' : String(value);
}

/**
 * The Summary tab's fact rows: execution status kept apart from result outcome, with every unknown
 * explicit and channel counts that never read a partial run as fully successful.
 */
export function dailySummaryFacts(results: RunResults, now: number): ResultFact[] {
    const summary = dailySummary(results);
    const available = results.artifacts.filter((artifact) => artifact.availability === 'available').length;
    const facts: ResultFact[] = [
        {
            label: 'Execution status',
            value: summary.status ?? 'unavailable',
            availability: summary.status === null ? 'unverified' : 'available',
        },
        {
            label: 'Result outcome',
            value: summary.outcome ?? 'unavailable',
            availability: summary.outcome === null ? 'unverified' : 'available',
        },
        {
            label: 'Result availability',
            value: `${available}/${results.artifacts.length} artifacts available`,
            availability: results.availability,
        },
        {
            label: 'Started',
            value: formatTimestamp(summary.startedAt),
            availability: summary.startedAt === null ? 'unverified' : 'available',
        },
        {
            label: 'Elapsed',
            value: formatElapsed(summary.startedAt, now),
            availability: summary.startedAt === null ? 'unverified' : 'available',
        },
        {
            label: 'Channels live / draft',
            value: summary.countsRecorded
                ? `${summary.counts.live} live, ${summary.counts.draft} draft`
                : 'not recorded',
            availability: summary.countsRecorded ? 'available' : 'unverified',
        },
        {
            label: 'Channels failed / skipped',
            value: summary.countsRecorded
                ? `${summary.counts.failed} failed, ${summary.counts.skipped} skipped`
                : 'not recorded',
            availability: !summary.countsRecorded ? 'unverified' : summary.counts.failed > 0 ? 'missing' : 'available',
        },
        {
            label: 'Article',
            value: summary.articleTitle ?? 'unavailable',
            availability: summary.articleTitle === null ? 'unverified' : 'available',
        },
        {
            label: 'Audio QC score',
            value: count(summary.quality?.overallScore ?? null),
            availability: summary.quality === null ? 'unverified' : 'available',
        },
        {
            label: 'Content safety verdict',
            value: summary.safety?.verdict ?? 'not recorded',
            availability: summary.safety === null ? 'unverified' : 'available',
        },
        {
            label: 'Safety confidence',
            value: summary.safety?.confidence ?? 'not recorded',
            availability: summary.safety?.confidence == null ? 'unverified' : 'available',
        },
    ];
    return facts;
}

/* ------------------------------------------------------------------------------------------------
 * G82/0320 — the episode funnel view and the supply-context interval.
 *
 * The funnel is artifact-backed: counts, minutes and the gate come from the narrowed
 * `summary.funnel` bag with their evidence ids; unknown stays unknown, never 0. The supply panel's
 * interval is CONFIGURED context: `[startedAt − captured window, startedAt)` — the extract ladder
 * bounds are not persisted, so the effective extraction window is explicitly unknown.
 * ---------------------------------------------------------------------------------------------- */

/** One operator exclusion reason rendered on the funnel panel (bounded rule + matched text). */
export interface DailyFunnelExclusionView {
    rule: string;
    matched: string;
}

/** The evidenced gate that closed a no-content run; `unknown` means no artifact proved one. */
export type DailyFunnelGateView =
    | 'episode-duration'
    | 'script'
    | 'qc-floor'
    | 'empty-pool'
    | 'qc-empty'
    | 'unknown'
    | null;

/** The narrowed funnel row, mirroring the contract without trusting it. */
export interface DailyFunnelView {
    poolCount: number | null;
    annotatedCount: number | null;
    qcRejectedCount: number | null;
    topicKeptCount: number | null;
    dedupKeptCount: number | null;
    plannedCount: number | null;
    estimatedMinutes: number | null;
    measuredMinutes: number | null;
    minMinutes: number | null;
    maxMinutes: number | null;
    gate: DailyFunnelGateView;
    gateName: string;
    exclusions: DailyFunnelExclusionView[];
    /** Field name → fixed manifest artifact id (or `captured-settings`), for the evidence chips. */
    evidence: Record<string, string>;
    /** Gate/shape diagnostics the projection recorded (mismatch, truncation, contradiction). */
    diagnostics: { code: string; message: string }[];
}

const GATE_NAMES: Record<Exclude<DailyFunnelGateView, null>, string> = {
    'episode-duration': 'Duration floor refusal',
    script: 'Script refusal',
    'qc-floor': 'QC floor refusal',
    'empty-pool': 'Empty pool',
    'qc-empty': 'QC emptied the pool',
    unknown: 'unknown — no gate proven',
};

function isFunnelGate(value: unknown): value is Exclude<DailyFunnelGateView, null> {
    return (
        value === 'episode-duration' ||
        value === 'script' ||
        value === 'qc-floor' ||
        value === 'empty-pool' ||
        value === 'qc-empty' ||
        value === 'unknown'
    );
}

/** Narrow the `summary.funnel` bag; a malformed funnel degrades to an all-unknown row. */
export function funnelView(value: unknown): DailyFunnelView {
    const record = asRecord(value);
    const gate = isFunnelGate(record?.gate) ? record.gate : null;
    return {
        poolCount: asNumber(record?.poolCount),
        annotatedCount: asNumber(record?.annotatedCount),
        qcRejectedCount: asNumber(record?.qcRejectedCount),
        topicKeptCount: asNumber(record?.topicKeptCount),
        dedupKeptCount: asNumber(record?.dedupKeptCount),
        plannedCount: asNumber(record?.plannedCount),
        estimatedMinutes: asNumber(record?.estimatedMinutes),
        measuredMinutes: asNumber(record?.measuredMinutes),
        minMinutes: asNumber(record?.minMinutes),
        maxMinutes: asNumber(record?.maxMinutes),
        gate,
        gateName: gate === null ? 'not applicable — a content run has no gate' : GATE_NAMES[gate],
        exclusions: Array.isArray(record?.exclusions)
            ? record.exclusions
                  .map((entry) => {
                      const row = asRecord(entry);
                      return row === null || typeof row.rule !== 'string'
                          ? null
                          : { rule: row.rule, matched: typeof row.matched === 'string' ? row.matched : '' };
                  })
                  .filter((row): row is DailyFunnelExclusionView => row !== null)
            : [],
        evidence:
            record === null
                ? {}
                : Object.fromEntries(
                      Object.entries(record.evidence ?? {}).filter(
                          (entry): entry is [string, string] => typeof entry[1] === 'string',
                      ),
                  ),
        diagnostics: Array.isArray(record?.diagnostics)
            ? record.diagnostics
                  .map((entry) => {
                      const row = asRecord(entry);
                      return row === null ? null : { code: String(row.code ?? ''), message: String(row.message ?? '') };
                  })
                  .filter((row): row is { code: string; message: string } => row !== null)
            : [],
    };
}

const WINDOW_UNITS: Record<'s' | 'm' | 'h' | 'd', number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
};

/**
 * `window` as milliseconds, mirroring `kk store extract --window` (`<n>s|m|h|d`). A unitless,
 * zero or malformed value is NOT defaulted — it yields null so the panel renders unknown.
 */
export function parseWindowMs(raw: string | null | undefined): number | null {
    if (raw === null || raw === undefined) return null;
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    if (match === null) return null;
    const [, amountText, unitText] = match;
    const unit = unitText === 's' || unitText === 'm' || unitText === 'h' || unitText === 'd' ? unitText : null;
    if (amountText === undefined || unit === null) return null;
    const milliseconds = Number(amountText) * WINDOW_UNITS[unit];
    return milliseconds > 0 ? milliseconds : null;
}

/** The configured supply interval: half-open `[startedAt − window, startedAt)`. */
export interface DailySupplyContext {
    windowMs: number;
    fromMs: number;
    untilMs: number;
    fromLabel: string;
    untilLabel: string;
}

/**
 * The supply panel's configured context from the CAPTURED window setting and the run's own
 * `startedAt` (server clock). Unknown input → null: the panel then renders the gap instead of
 * issuing a query whose bounds nobody captured.
 */
export function supplyContextOf(
    windowSetting: string | null | undefined,
    startedAt: string | null | undefined,
): DailySupplyContext | null {
    const windowMs = parseWindowMs(windowSetting);
    const started = startedAt === null || startedAt === undefined ? null : Date.parse(startedAt);
    if (windowMs === null || started === null || !Number.isFinite(started)) return null;
    return {
        windowMs,
        fromMs: started - windowMs,
        untilMs: started,
        fromLabel: formatTimestamp(new Date(started - windowMs).toISOString()),
        untilLabel: formatTimestamp(new Date(started).toISOString()),
    };
}

/** The Summary view: what this attempt produced, at a glance, plus its captured settings. */
export type DailyView = 'summary' | 'generation' | 'publishing';

/**
 * The module's view set (0390): Summary, Generation, Publishing. This is an append-only strip:
 * existing deep links keep working through {@link DAILY_VIEW_ALIASES}.
 */
export const DAILY_VIEWS: readonly DailyView[] = ['summary', 'generation', 'publishing'];

/**
 * Deep-link aliases for the retired tab names: `results` and `progress` both open Generation
 * (results media/files are Generation view outputs; progress nodes are Generation stages), and
 * `config` opens Summary (captured settings live there as a drill-down now).
 */
export const DAILY_VIEW_ALIASES: Readonly<Record<string, DailyView>> = {
    results: 'generation',
    progress: 'generation',
    config: 'summary',
};

/** Resolve a deep-link segment to a view id: exact match first, then the alias table. */
export function resolveDailyView(segment: string | null | undefined): DailyView | null {
    if (!segment) return null;
    if ((DAILY_VIEWS as readonly string[]).includes(segment)) return segment as DailyView;
    return DAILY_VIEW_ALIASES[segment] ?? null;
}

/** The board path segment of a view id. */
export function dailyViewPath(view: DailyView): string {
    return view;
}

/**
 * The workflow family the module reads today. `kk-daily-ai-voice2` (and its `kk-daily-ai-voice`
 * predecessor, listed in {@link RETIRED_DAILY_WORKFLOWS}) are retired: their runs stay readable,
 * but a day that only ran under them is shown as a retired-layout day rather than as "no run"
 * (0384) — see {@link pickDailyFamily} and {@link retiredLayoutNotice}.
 */
export const DAILY_WORKFLOW = 'kk-news-generate';

/** Retired families, newest first, consulted only when the current family has no runs. */
export const RETIRED_DAILY_WORKFLOWS: readonly string[] = ['kk-daily-ai-voice2', 'kk-daily-ai-voice'];

/** One family's run list, as the reader answered it. */
export interface DailyRunSource {
    family: string;
    rows: RunListRow[];
}

/** Which family answers for this Board module, and whether that answer is a retired layout. */
export interface DailyFamilyChoice {
    family: string;
    rows: RunListRow[];
    retired: boolean;
}

/**
 * Pick the family that answers this module: the current family whenever it recorded any run,
 * otherwise the first retired family that did. Both empty keeps the current family selected, so the
 * empty state names the family the operator is expected to run — never a retired one.
 */
export function pickDailyFamily(current: RunListRow[], retired: readonly DailyRunSource[]): DailyFamilyChoice {
    if (current.length > 0) return { family: DAILY_WORKFLOW, rows: current, retired: false };
    const hit = retired.find((source) => source.rows.length > 0);
    if (hit !== undefined) return { family: hit.family, rows: hit.rows, retired: true };
    return { family: DAILY_WORKFLOW, rows: current, retired: false };
}

/**
 * The banner text for a retired-layout answer, or null when the current family answered. It names
 * the family and the day count: an operator looking at old runs must not read them as this
 * workflow's output.
 */
export function retiredLayoutNotice(choice: DailyFamilyChoice): string | null {
    if (!choice.retired) return null;
    const days = choice.rows.length === 1 ? '1 run' : `${choice.rows.length} runs`;
    return `Showing ${days} recorded under the retired ${choice.family} layout. New runs are recorded as ${DAILY_WORKFLOW}, so this list stops growing until that workflow runs.`;
}
