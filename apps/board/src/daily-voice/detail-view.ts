import type { DailyDigest, NewsGenerationEvidence, NewsPublishWindowEvidence, RunEvidence } from '../contracts';
import type { ResultFact } from '../shared/collect';
import { windowRows } from './day-view';
import {
    type GenerationStageRow,
    generationStageRows,
    newsSummaryFacts,
    newsSummaryOf,
    type StateTone,
} from './evidence';

/**
 * The Generation and Publishing detail view models (G83, task 0441 —
 * docs/design/daily-voice-ops-console.md §4).
 *
 * Everything here is narrowing over an `RunEvidence` envelope plus the day digest: no new route, no
 * figure invented from an absent artifact, and every unknown carries the word `unknown` with its
 * reason. The component renders these rows; it never reaches into a raw payload.
 */

/** The per-node diagnostics budget before the panel states it truncated. */
export const NODE_DIAGNOSTIC_CAP = 20;

/** One timeline node: producer state, recorded attempts and the day's own step duration. */
export interface TimelineNode {
    id: string;
    label: string;
    status: string;
    word: string;
    tone: StateTone;
    /** Recorded attempt timing from the run detail (null when the run recorded none). */
    timing: string | null;
    /** Duration from `step-timing.json`; null is the explicit unknown, never 0. */
    durationMs: number | null;
    /** True when this node is part of the voice chain (its attempts are engine attempts). */
    engine: boolean;
}

/** The Generation tab's whole model for one attempt. */
export interface GenerationDetail {
    runId: string;
    /** `captured` | `uncaptured` — an attempt with no capture record still has Spur state only. */
    captureState: 'captured' | 'uncaptured';
    availability: string;
    facts: ResultFact[];
    timeline: TimelineNode[];
    /** The recorded engine chain (voice, its fallbacks), in run order. */
    engines: { node: string; label: string; state: string; attempts: number; lastTiming: string | null }[];
    /** Why a figure is unknown at the whole-run level, when the envelope says so. */
    unknownReason: string | null;
    diagnostics: { code: string; message: string }[];
    /** Artifact rows with their availability reason; never a link to an unavailable artifact. */
    artifacts: { id: string; label: string; availability: string; reason: string | null }[];
}

/** The step durations the day recorded, keyed by step id, for the timeline join. */
function durationIndex(digest: DailyDigest): Map<string, number | null> {
    const index = new Map<string, number | null>();
    for (const duration of digest.generation.durations) index.set(duration.step, duration.durationMs);
    return index;
}

/** A node id a timeline row can match against `step-timing.json`'s step ids. */
function stepIdOf(nodeId: string): string {
    // `voice-fallback`/`voice-fallback2` are the SAME step's retries: the timing file records the
    // step once (`voice`), so the fallback rows read that duration rather than claiming a gap.
    return nodeId.startsWith('voice') ? 'voice' : nodeId;
}

/** The engine chain rows: one row per recorded chain node, attempts and last timing included. */
function engineChainOf(generation: NewsGenerationEvidence | undefined): GenerationDetail['engines'] {
    return (generation?.engines ?? []).map((engine) => ({
        node: engine.node,
        label: engine.node.startsWith('voice-fallback') ? `${engine.node} (retry)` : engine.node,
        state: engine.state,
        attempts: engine.attempts.length,
        lastTiming: engine.attempts.at(-1)?.timing ?? null,
    }));
}

/**
 * Project one attempt's `RunEvidence` into the Generation tab's model.
 *
 * A projection that predates a field degrades to an unrecorded word; the timeline never invents a
 * duration or a producer state.
 */
export function generationDetail(evidence: RunEvidence, digest: DailyDigest): GenerationDetail {
    const summary = newsSummaryOf(evidence);
    const generation = summary?.generation;
    const durations = durationIndex(digest);
    const stageRows: GenerationStageRow[] = summary === null ? [] : generationStageRows(summary);
    const timeline: TimelineNode[] = stageRows.map((row) => ({
        id: row.id,
        label: row.label,
        status: row.status,
        word: row.word,
        tone: row.tone,
        timing: row.timing,
        durationMs: durations.get(stepIdOf(row.id)) ?? null,
        engine: row.engine !== null,
    }));
    // A step the run never charted (the DAG topology was not captured) still gets a row when the
    // day recorded its timing: the operator asked for the timeline, and step-timing is evidence.
    for (const duration of digest.generation.durations) {
        if (timeline.some((node) => stepIdOf(node.id) === duration.step)) continue;
        timeline.push({
            id: duration.step,
            label: duration.step,
            status: 'unknown',
            word: 'state unrecorded',
            tone: 'neutral',
            timing: null,
            durationMs: duration.durationMs,
            engine: false,
        });
    }
    const diagnostics = [...evidence.diagnostics, ...(summary === null ? [] : [])].slice(0, NODE_DIAGNOSTIC_CAP);
    return {
        runId: evidence.runId,
        captureState: evidence.capture === null ? 'uncaptured' : 'captured',
        availability: evidence.results?.availability ?? 'unverified',
        facts: newsSummaryFacts(evidence),
        timeline,
        engines: engineChainOf(generation),
        unknownReason:
            generation === undefined
                ? evidence.capture === null
                    ? 'no-capture-record'
                    : 'no-recorded-projection'
                : null,
        diagnostics: diagnostics.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message })),
        artifacts:
            evidence.results?.artifacts.map((artifact) => ({
                id: artifact.id,
                label: artifact.label,
                availability: artifact.availability,
                reason: artifact.availability === 'available' ? null : artifact.availability,
            })) ?? [],
    };
}

/** One matrix row of the Publishing tab: every column the design names, unknowns explicit. */
export interface MatrixRow {
    id: string;
    target: string;
    tier: string;
    mode: string;
    status: string;
    tone: StateTone;
    effect: string;
    url: string | null;
    error: string;
    /** The receipt/plan references, rendered as text and never as a link. */
    evidence: string;
}

/** One window of the Publishing tab: launch state, recorded outcome, provenance and its rows. */
export interface PublishingDetailWindow {
    window: string;
    label: string;
    launch: string;
    tone: StateTone;
    unknownReason: string | null;
    recorded: string;
    runId: string | null;
    provenance: { label: string; matched: boolean | null }[];
    rows: MatrixRow[];
    /** True when the day carries no plan and no launch receipt for this window at all. */
    notRun: boolean;
}

/** A URL is linkable only when it is a public http(s) URL (never a receipt path). */
export function isPublicHttpUrl(value: string | null): boolean {
    if (value === null) return false;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
        const host = url.hostname;
        if (host === 'localhost' || host === '' || host.endsWith('.local')) return false;
        if (/^(127\.|10\.|192\.168\.|::1$|\[::1\])/.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

/** Provenance labels in the design's order (date, bundle, parent, digest). */
const PROVENANCE_LABELS: Record<keyof NewsPublishWindowEvidence['provenance'], string> = {
    dateMatch: 'date',
    bundleMatch: 'bundle',
    parentMatch: 'parent run',
    digestMatch: 'plan digest',
};

/** Provenance rows from a recorded window: `yes`/`no`/`not checked`, never a silent pass. */
export function provenanceRows(window: NewsPublishWindowEvidence): { label: string; matched: boolean | null }[] {
    return (Object.keys(PROVENANCE_LABELS) as (keyof typeof PROVENANCE_LABELS)[]).map((key) => ({
        label: PROVENANCE_LABELS[key],
        matched: window.provenance[key],
    }));
}

/** The provenance cell word for one recorded check. */
export function provenanceWord(matched: boolean | null): string {
    return matched === null ? 'not checked' : matched ? 'yes' : 'no';
}

/**
 * The Publishing tab's model.
 *
 * The digest's window strip supplies launch state, the day's plan supplies the matrix rows, and a
 * planned row with no receipt reads `planned` (never `succeeded`) — the same discipline the reader's
 * own matrix applies.
 */
export function publishingDetail(digest: DailyDigest): PublishingDetailWindow[] {
    const strip = windowRows(digest);
    return digest.windows.map((window) => {
        const projected = strip.find((row) => row.window === window.window);
        const rows: MatrixRow[] = window.targets.map((target) => ({
            id: target.id,
            target: target.target ?? target.id.split('.')[0] ?? target.id,
            tier: target.tier === null ? 'unknown' : String(target.tier),
            mode: target.mode ?? 'unknown',
            status: target.status,
            tone:
                target.status === 'succeeded'
                    ? 'success'
                    : target.status === 'failed'
                      ? 'error'
                      : target.status === 'planned'
                        ? 'neutral'
                        : 'warn',
            effect: target.effect ?? 'unknown',
            url: isPublicHttpUrl(target.url) ? target.url : null,
            error: target.error ?? '',
            evidence: target.evidence.receipt ?? target.evidence.plan,
        }));
        return {
            window: window.window,
            label: projected?.label ?? window.window,
            launch: window.launchStatus,
            tone: projected?.tone ?? 'neutral',
            unknownReason: window.unknownReason,
            recorded: window.recordedStatus ?? 'unknown',
            runId: window.runId,
            provenance: provenanceRows({
                window: window.window,
                recordedStatus: window.recordedStatus,
                provenance: window.provenance,
                targets: [],
            }),
            rows,
            notRun: window.launchStatus === 'not-run' && window.targets.length === 0,
        };
    });
}
