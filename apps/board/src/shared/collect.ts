import type { Availability, CollectRunStore, CollectRunStoreRow, RunResults } from '../contracts';
import { availabilityLabel, formatElapsed, formatTimestamp } from './format';

/**
 * The Collect module's read-only view model.
 *
 * Pure projection of the reader's `RunResults` JSON into render rows, so the Collect
 * entry stays a thin component. Absent evidence is rendered as an explicit availability,
 * never as an invented zero.
 */

/** The Collect result summary projection the reader serves under `summary`. */
export interface CollectSummary {
    /** Executed run status from the Board's own run detail (`done`, `failed`, `running`, ...). */
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    /** Per-source ingested document counts, or null when no source evidence was captured. */
    sourceCounts: Record<string, number> | null;
    inserted: number | null;
    updated: number | null;
    unchanged: number | null;
    labeled: number | null;
    model: number | null;
    fallback: number | null;
    verdict: string | null;
    confidence: string | null;
    /** Head of the rendered core-facts markdown, or null when it is not previewable. */
    factsPreview: string | null;
}

/** One rendered label/value row with the availability it was derived from. */
export interface ResultFact {
    label: string;
    value: string;
    availability: Availability;
}

/** One artifact row: never a link unless the artifact is actually available. */
export interface ArtifactView {
    id: string;
    label: string;
    kind: string;
    availability: Availability;
    /** Operator-facing availability text. */
    state: string;
    /** Reader URL for the content, present only when the artifact is available. */
    href: string | null;
}

function asCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

/** Narrow the reader's `summary` bag into the Collect projection without inventing values. */
export function collectSummary(results: RunResults): CollectSummary {
    const raw = results.summary ?? {};
    const sources = raw.sourceCounts;
    const sourceCounts =
        typeof sources === 'object' && sources !== null && !Array.isArray(sources)
            ? (sources as Record<string, number>)
            : null;
    return {
        status: asText(raw.status),
        startedAt: asText(raw.startedAt),
        completedAt: asText(raw.completedAt),
        sourceCounts,
        inserted: asCount(raw.inserted),
        updated: asCount(raw.updated),
        unchanged: asCount(raw.unchanged),
        labeled: asCount(raw.labeled),
        model: asCount(raw.model),
        fallback: asCount(raw.fallback),
        verdict: asText(raw.verdict),
        confidence: asText(raw.confidence),
        factsPreview: asText(raw.factsPreview),
    };
}

function count(value: number | null): string {
    return value === null ? 'unavailable' : String(value);
}

/**
 * The Summary tab's fact rows: execution status kept separate from result outcome, and every
 * unknown stated explicitly — a run whose engine succeeded but whose publishing partially failed
 * never reads as fully successful.
 */
export function collectSummaryFacts(results: RunResults, now: number): ResultFact[] {
    const summary = collectSummary(results);
    const available = results.artifacts.filter((artifact) => artifact.availability === 'available').length;
    const facts: ResultFact[] = [
        {
            label: 'Execution status',
            value: summary.status ?? 'unavailable',
            availability: summary.status === null ? 'unverified' : 'available',
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
            label: 'Inserted',
            value: count(summary.inserted),
            availability: summary.inserted === null ? 'unverified' : 'available',
        },
        {
            label: 'Updated',
            value: count(summary.updated),
            availability: summary.updated === null ? 'unverified' : 'available',
        },
        {
            label: 'Unchanged',
            value: count(summary.unchanged),
            availability: summary.unchanged === null ? 'unverified' : 'available',
        },
        {
            label: 'Labeled',
            value: count(summary.labeled),
            availability: summary.labeled === null ? 'unverified' : 'available',
        },
        {
            label: 'Model labeled',
            value: count(summary.model),
            availability: summary.model === null ? 'unverified' : 'available',
        },
        {
            label: 'Fallback labeled',
            value: count(summary.fallback),
            availability: summary.fallback === null ? 'unverified' : 'available',
        },
    ];
    if (summary.factsPreview !== null) {
        const preview = truncatePreview(summary.factsPreview, PREVIEW_CHARS);
        facts.push({
            label: 'Core facts',
            value: preview.truncated
                ? `${preview.text} (truncated — the facts artifact holds the full text)`
                : preview.text,
            availability: preview.truncated ? 'oversized' : 'available',
        });
    }
    if (summary.verdict !== null) {
        facts.push({
            label: 'Label verdict',
            value: summary.confidence === null ? summary.verdict : `${summary.verdict} (${summary.confidence})`,
            availability: 'available',
        });
    }
    for (const [file, sources] of Object.entries(summary.sourceCounts ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        facts.push({ label: `Source ${file}`, value: String(sources), availability: 'available' });
    }
    return facts;
}

/** Characters of a text preview a Summary fact row shows before it points at the artifact. */
const PREVIEW_CHARS = 160;

/**
 * Bound a text preview to `max` characters and collapse its whitespace, so a fact row stays one
 * line. Truncation is REPORTED, not silent: the caller labels the row and the full text stays
 * downloadable from the artifact the preview came from.
 */
export function truncatePreview(text: string, max: number): { text: string; truncated: boolean } {
    const flat = text.replaceAll(/\s+/g, ' ').trim();
    if (flat === '') return { text: 'unavailable', truncated: false };
    if (flat.length <= max) return { text: flat, truncated: false };
    return { text: `${flat.slice(0, max).trimEnd()}…`, truncated: true };
}

/** One recorded state visit and its actions, as the Progress tab renders them. */
export interface ProgressRow {
    /** The state id and how many times the run visited it (retries are separate rows). */
    state: string;
    visit: number;
    status: string;
    /** `actionKey — status` for each recorded action, in payload order. */
    actions: string[];
    /** Recorded timing for the visit (`12s`, `started → completed`), or `timing unknown`. */
    timing: string;
    /** True only when the recorded evidence names an operator wait — never inferred from speed. */
    operatorWait: boolean;
}

/**
 * Recorded timing for one state visit. Derived only from fields the Board payload carries
 * (`durationMs`, `startedAt`, `completedAt`); anything else states the gap instead of guessing.
 */
function timingOf(record: Record<string, unknown>): string {
    const durationMs = record.durationMs;
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
        return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${Math.round(durationMs / 1000)}s`;
    }
    const started = record.startedAt;
    const completed = record.completedAt;
    if (typeof started === 'string' && typeof completed === 'string') return `${started} → ${completed}`;
    return 'timing unknown';
}

/**
 * True when the recorded status or an action key names an operator wait (an approval/HITL gate).
 * Derived from recorded evidence only: a fast state must never be labelled as waiting.
 */
function operatorWaitOf(status: string, actions: readonly unknown[]): boolean {
    const waitRe = /wait|pause|approv|hitl|question|escalat/i;
    if (waitRe.test(status)) return true;
    return actions.some((action) => {
        if (typeof action !== 'object' || action === null) return false;
        const key = (action as Record<string, unknown>).actionKey;
        return typeof key === 'string' && waitRe.test(key);
    });
}

/**
 * Narrow the Board's progress projection into render rows.
 *
 * Recorded state visits and per-action attempts are passed through verbatim; a payload without a
 * `states` array yields no rows (the tab then states that progress is unavailable) rather than an
 * invented empty progression.
 */
export function progressRows(progress: unknown): ProgressRow[] {
    if (typeof progress !== 'object' || progress === null) return [];
    const states = (progress as { states?: unknown }).states;
    if (!Array.isArray(states)) return [];
    const rows: ProgressRow[] = [];
    for (const entry of states) {
        if (typeof entry !== 'object' || entry === null) continue;
        const record = entry as Record<string, unknown>;
        if (typeof record.state !== 'string') continue;
        const actions = Array.isArray(record.actions) ? record.actions : [];
        rows.push({
            state: record.state,
            visit: typeof record.visit === 'number' ? record.visit : 1,
            status: typeof record.status === 'string' ? record.status : 'unknown',
            timing: timingOf(record),
            operatorWait: operatorWaitOf(typeof record.status === 'string' ? record.status : '', actions),
            actions: actions
                .map((action) =>
                    typeof action === 'object' && action !== null
                        ? `${String((action as Record<string, unknown>).actionKey ?? 'action')} — ${String(
                              (action as Record<string, unknown>).status ?? 'unknown',
                          )}`
                        : null,
                )
                .filter((line): line is string => line !== null),
        });
    }
    return rows;
}

/** The Results tab's artifact rows, with a reader URL only for an available artifact. */
export function artifactViews(results: RunResults, readerOrigin: string): ArtifactView[] {
    return results.artifacts.map((artifact) => ({
        id: artifact.id,
        label: artifact.label,
        kind: artifact.kind,
        availability: artifact.availability,
        state: availabilityLabel(artifact.availability),
        href:
            artifact.availability === 'available'
                ? `${readerOrigin}/api/workflows/${results.workflow}/runs/${results.runId}/artifacts/${artifact.id}`
                : null,
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Store views (G81/0308 — docs/design/collect-store-views.md §2)
 *
 * The reader serves the store projections; these helpers turn them into render rows without
 * inventing a number. Absent evidence is `—` or `unavailable`, never `0`.
 * ---------------------------------------------------------------------------------------------- */

/** The cadence states the Overview banner shows (frozen names, design §2). */
export type CadenceState = 'on schedule' | 'late' | 'stalled' | 'unknown';

/** `kk-collect` runs every 6 h; the cadence states are measured against that schedule. */
export const CADENCE_SCHEDULE_HOURS = 6;

/** One cadence verdict: the state, the age of the last stored collection, its operator sentence. */
export interface Cadence {
    state: CadenceState;
    /** Hours since `lastStoredAt`, or null when the store recorded no collection. */
    sinceHours: number | null;
    detail: string;
}

/**
 * Time since the last stored collection against the 6 h schedule: `on schedule` ≤ 6 h, `late`
 * ≤ 12 h, `stalled` beyond, `unknown` without a stored collection (or an unreadable store).
 */
export function cadenceState(lastStoredAt: string | null, now: number): Cadence {
    const since = lastStoredAt === null ? Number.NaN : Date.parse(lastStoredAt);
    if (Number.isNaN(since)) {
        return { state: 'unknown', sinceHours: null, detail: 'No stored collection recorded.' };
    }
    const sinceHours = Math.max(0, (now - since) / 3_600_000);
    const state: CadenceState =
        sinceHours <= CADENCE_SCHEDULE_HOURS
            ? 'on schedule'
            : sinceHours <= 2 * CADENCE_SCHEDULE_HOURS
              ? 'late'
              : 'stalled';
    return {
        state,
        sinceHours,
        detail: `${sinceHours.toFixed(1)} h since the last stored collection (schedule ${CADENCE_SCHEDULE_HOURS} h).`,
    };
}

/** `default` label rows ÷ label rows, or `—` when the run recorded no label rows. */
export function fallbackShare(row: Pick<CollectRunStoreRow, 'labelRows' | 'labelRowsBySource'>): string {
    if (row.labelRows <= 0) return '—';
    const fallback = row.labelRowsBySource.default ?? 0;
    return `${Math.round((fallback / row.labelRows) * 100)}%`;
}

/** One source's slice of a stacked "collected per source" bar. */
export interface SourceSegment {
    source: string;
    count: number;
    /** The slice's fraction of the run's collected total, 0–1. */
    share: number;
}

/** The per-source stacked bar: sources with a positive count, alphabetical, shares summing to 1. */
export function sourceSegments(sourceCounts: Record<string, number>): SourceSegment[] {
    const entries = Object.entries(sourceCounts)
        .filter(([, count]) => Number.isFinite(count) && count > 0)
        .sort(([a], [b]) => a.localeCompare(b));
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    return entries.map(([source, count]) => ({ source, count, share: total === 0 ? 0 : count / total }));
}

/** The Overview banner's attention counters for the current run-list page. */
export interface BannerCounts {
    /** Spur runs that failed. */
    failed: number;
    /** `done` runs with no `collect_runs` row: the tick finished without storing anything. */
    doneWithoutRow: number;
    /** Running runs with no row yet — in progress, never a missing store. */
    inProgress: number;
}

/**
 * Count what needs attention on this page. Spur records no distinct "skipped" state, so a tick that
 * stored nothing shows up as a failed run or as `done` without a row — nothing is counted twice.
 */
export function bannerCounts(
    runs: readonly { id: string; status: string }[],
    rows: Record<string, CollectRunStoreRow | null>,
): BannerCounts {
    const counts: BannerCounts = { failed: 0, doneWithoutRow: 0, inProgress: 0 };
    for (const run of runs) {
        if (rows[run.id] !== undefined && rows[run.id] !== null) continue;
        if (run.status === 'failed') counts.failed += 1;
        else if (run.status === 'done') counts.doneWithoutRow += 1;
        else if (run.status === 'running') counts.inProgress += 1;
    }
    return counts;
}

/** One funnel stage: its number, the unit that number counts, and what it is made of. */
export interface FunnelCard {
    title: string;
    /** The headline number, or `unavailable` — never a zero standing in for absent evidence. */
    value: string;
    /** The unit `value` counts (`items`, …) — every stage names its own. */
    unit: string;
    detail: string;
    availability: 'available' | 'unavailable';
}

const NAMED_MAKERS = ['heuristic', 'model', 'default'] as const;

/**
 * Label observations by maker: the three named makers, plus `other` only when the run recorded
 * rows under another maker (`labels.maker` is not a closed set).
 */
export function makerBreakdown(labelRowsBySource: Record<string, number>): string {
    const named = NAMED_MAKERS.map((maker) => `${labelRowsBySource[maker] ?? 0} ${maker}`);
    const other = Object.entries(labelRowsBySource)
        .filter(([maker]) => !(NAMED_MAKERS as readonly string[]).includes(maker))
        .reduce((sum, [, count]) => sum + count, 0);
    return (other > 0 ? [...named, `${other} other`] : named).join(' · ');
}

/**
 * The Run detail funnel: Collected → Stored → Labeled → Downstream, each naming its own unit.
 * `unchanged` is not in `collect_runs` — it comes from the shipped results projection, and stays
 * `unavailable` when that projection does not carry it.
 */
export function funnelCards(row: CollectRunStoreRow | null, results: RunResults | null): FunnelCard[] {
    if (row === null) {
        const unavailable: FunnelCard = {
            title: 'Collected',
            value: 'unavailable',
            unit: 'items',
            detail: 'This run wrote no store row.',
            availability: 'unavailable',
        };
        return [unavailable];
    }
    const segments = sourceSegments(row.sourceCounts);
    const collected = segments.reduce((sum, segment) => sum + segment.count, 0);
    const unchanged = results === null ? null : collectSummary(results).unchanged;
    const stored = row.inserted + row.updated;
    const yieldTotal = row.yield.selected + row.yield.published + row.yield.dropped;
    return [
        {
            title: 'Collected',
            value: String(collected),
            unit: 'items',
            detail:
                segments.length === 0
                    ? 'No source counts recorded.'
                    : segments.map((s) => `${s.source} ${s.count}`).join(' · '),
            availability: 'available',
        },
        {
            title: 'Stored',
            value: String(stored),
            unit: 'items',
            detail: `${row.inserted} inserted · ${row.updated} updated · ${unchanged === null ? 'unavailable' : `${unchanged} unchanged`}`,
            availability: 'available',
        },
        {
            title: 'Labeled',
            value: String(row.labeledItems),
            unit: 'items',
            detail: `${row.labelRows} label rows: ${makerBreakdown(row.labelRowsBySource)}`,
            availability: 'available',
        },
        {
            title: 'Downstream',
            value: String(yieldTotal),
            unit: 'items',
            detail: `${row.yield.selected} selected · ${row.yield.published} published · ${row.yield.dropped} dropped`,
            availability: 'available',
        },
    ];
}

/** The `value` filter's domain for one decision: the values this run's own label rows recorded. */
export function decisionValues(quality: CollectRunStore['labelQuality'], decisionId: string): string[] {
    const entry = quality.find((candidate) => candidate.decisionId === decisionId);
    return entry === undefined ? [] : entry.run.map((row) => row.value);
}

/** Spur run duration (`completedAt − startedAt`), `—` while the run is still running. */
export function runDuration(startedAt: string | null | undefined, completedAt: string | null | undefined): string {
    if (startedAt === null || startedAt === undefined) return '—';
    if (completedAt === null || completedAt === undefined) return '—';
    const end = Date.parse(completedAt);
    if (Number.isNaN(Date.parse(startedAt)) || Number.isNaN(end)) return '—';
    return formatElapsed(startedAt, end);
}

/** `page`/`pages` for the Items pager: `pageSize` is frozen at 25 by the 0307 route. */
export function pager(page: number, total: number, pageSize = 25): { page: number; pages: number; total: number } {
    return { page, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
