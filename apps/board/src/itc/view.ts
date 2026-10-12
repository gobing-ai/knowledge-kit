import type { Availability, RunResults } from '../contracts';
import type { ResultFact } from '../shared/collect';
import { formatElapsed, formatTimestamp } from '../shared/format';

/**
 * The IT Content module's read-only view model.
 *
 * Pure projection of the reader's `RunResults.summary` bag into render rows, so the entry stays a
 * thin component. Absent evidence is an explicit availability, never an invented zero — the reader
 * never fabricates a value and the view never fills one in.
 */

/** The content-judge confidence levels a verdict may carry (`HIGH` | `MEDIUM` | `LOW`). */
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

/** The three recognized confidence levels, in strength order. */
export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

/** One bounded outline/draft preview row. */
export interface ItcPreviewView {
    id: string;
    label: string;
    /** Bounded recorded text, or null when the artifact is not available. */
    text: string | null;
    availability: Availability;
}

/** The recorded judge verdict, with an out-of-vocabulary confidence kept as an explicit unknown. */
export interface ItcJudgeView {
    verdict: string | null;
    confidence: ConfidenceLevel | null;
    /** True when the verdict recorded a confidence outside HIGH|MEDIUM|LOW. */
    confidenceInvalid: boolean;
    feedback: string[];
}

/** Recorded revision evidence. Null counts mean nothing was recorded, never zero. */
export interface ItcRevisionsView {
    revise: number | null;
    autoRevise: number | null;
    total: number | null;
    budget: number | null;
    recorded: boolean;
}

/** One publish target's recorded outcome. */
export interface ItcTargetView {
    target: string;
    transport: string;
    /** `ok` true/false, or null when the result was not recorded. */
    ok: boolean | null;
    state: string;
    url: string | null;
    error: string | null;
    detail: string;
}

/** The narrowed ITC summary. */
export interface ItcSummaryView {
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    outlines: ItcPreviewView[];
    selectedOutline: ItcPreviewView | null;
    draft: ItcPreviewView | null;
    judge: ItcJudgeView | null;
    revisions: ItcRevisionsView;
    targets: ItcTargetView[];
    report: { outcome: string | null; verdict: string | null; revisions: number | null } | null;
    counts: {
        artifactsAvailable: number;
        artifactsTotal: number;
        targetsOk: number;
        targetsFailed: number;
        targetsUnknown: number;
    };
    /** False when the reader sent no counts bag — the counts rows then state the gap, never 0. */
    countsRecorded: boolean;
}

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

/** True when `value` is one of the three recognized confidence levels. */
export function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
    return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW';
}

/** Narrow one preview entry, dropping a malformed row. */
function previewView(value: unknown): ItcPreviewView | null {
    const record = asRecord(value);
    if (record === null || typeof record.id !== 'string') return null;
    return {
        id: record.id,
        label: asString(record.label) ?? record.id,
        text: asString(record.text),
        availability: (asString(record.availability) as Availability | null) ?? 'unverified',
    };
}

/** Narrow one target outcome entry, dropping a malformed row. */
function targetView(value: unknown): ItcTargetView | null {
    const record = asRecord(value);
    if (record === null || typeof record.target !== 'string') return null;
    const ok = typeof record.ok === 'boolean' ? record.ok : null;
    return {
        target: record.target,
        transport: asString(record.transport) ?? 'unknown',
        ok,
        state: ok === true ? 'Published' : ok === false ? 'Failed' : 'Not recorded',
        url: asString(record.url),
        error: asString(record.error),
        detail: asString(record.detail) ?? 'result unknown',
    };
}

/** Narrow the reader's `summary` bag into the ITC projection without inventing values. */
export function itcSummary(results: RunResults): ItcSummaryView {
    const raw = results.summary ?? {};
    const judge = asRecord(raw.judge);
    const revisions = asRecord(raw.revisions);
    const report = asRecord(raw.report);
    const counts = asRecord(raw.counts);
    return {
        status: asString(raw.status),
        startedAt: asString(raw.startedAt),
        completedAt: asString(raw.completedAt),
        outcome: asString(raw.outcome),
        outlines: Array.isArray(raw.outlines)
            ? raw.outlines.map(previewView).filter((entry): entry is ItcPreviewView => entry !== null)
            : [],
        selectedOutline: previewView(raw.selectedOutline),
        draft: previewView(raw.draft),
        judge:
            judge === null
                ? null
                : {
                      verdict: asString(judge.verdict),
                      confidence: isConfidenceLevel(judge.confidence) ? judge.confidence : null,
                      confidenceInvalid: judge.confidenceInvalid === true,
                      feedback: Array.isArray(judge.feedback)
                          ? judge.feedback.filter((note): note is string => typeof note === 'string')
                          : [],
                  },
        revisions: {
            revise: asNumber(revisions?.revise),
            autoRevise: asNumber(revisions?.autoRevise),
            total: asNumber(revisions?.total),
            budget: asNumber(revisions?.budget),
            recorded: revisions?.recorded === true,
        },
        targets: Array.isArray(raw.targets)
            ? raw.targets.map(targetView).filter((entry): entry is ItcTargetView => entry !== null)
            : [],
        report:
            report === null
                ? null
                : {
                      outcome: asString(report.outcome),
                      verdict: asString(report.verdict),
                      revisions: asNumber(report.revisions),
                  },
        counts: {
            artifactsAvailable: asNumber(counts?.artifactsAvailable) ?? 0,
            artifactsTotal: asNumber(counts?.artifactsTotal) ?? 0,
            targetsOk: asNumber(counts?.targetsOk) ?? 0,
            targetsFailed: asNumber(counts?.targetsFailed) ?? 0,
            targetsUnknown: asNumber(counts?.targetsUnknown) ?? 0,
        },
        countsRecorded: counts !== null,
    };
}

function count(value: number | null): string {
    return value === null ? 'unavailable' : String(value);
}

/** The recorded confidence as text, stating an out-of-vocabulary value instead of echoing it. */
function confidenceText(judge: ItcJudgeView | null): string {
    if (judge === null) return 'not recorded';
    if (judge.confidence !== null) return judge.confidence;
    return judge.confidenceInvalid ? 'unknown (recorded value is outside HIGH/MEDIUM/LOW)' : 'not recorded';
}

/**
 * The Summary tab's fact rows: execution status kept apart from result outcome, with every unknown
 * explicit — a run whose engine finished but whose publishing partially failed never reads as fully
 * successful.
 */
export function itcSummaryFacts(results: RunResults, now: number): ResultFact[] {
    const summary = itcSummary(results);
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
            label: 'Artifacts available',
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
            label: 'Judge verdict',
            value: summary.judge?.verdict ?? 'not recorded',
            availability: summary.judge === null || summary.judge.verdict === null ? 'unverified' : 'available',
        },
        {
            label: 'Judge confidence',
            value: confidenceText(summary.judge),
            availability: summary.judge?.confidence == null ? 'unverified' : 'available',
        },
        {
            label: 'Revision rounds',
            value: summary.revisions.recorded ? count(summary.revisions.total) : 'not recorded',
            availability: summary.revisions.recorded ? 'available' : 'unverified',
        },
        {
            label: 'Publish targets',
            value: summary.countsRecorded
                ? `${summary.counts.targetsOk} ok, ${summary.counts.targetsFailed} failed, ${summary.counts.targetsUnknown} unknown`
                : 'not recorded',
            availability: !summary.countsRecorded
                ? 'unverified'
                : summary.counts.targetsFailed > 0
                  ? 'missing'
                  : summary.counts.targetsUnknown > 0
                    ? 'unverified'
                    : 'available',
        },
        {
            label: 'Run report',
            value: summary.report?.outcome ?? 'not recorded',
            availability: summary.report === null ? 'unverified' : 'available',
        },
    ];
    return facts;
}
