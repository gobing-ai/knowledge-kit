/**
 * 0390 — pure narrowing and view rows over the `RunEvidence` envelope for news runs.
 *
 * This module is the news module's ONLY reader of the evidence DTO: the component renders rows it
 * hands back and never reaches into raw payloads. Everything here is defensive narrowing over the
 * projection bag (`results.summary`) so a projection that predates a field degrades to an
 * unrecorded word, never a crash or an invented zero. Tone and label vocabulary come from the
 * shared format module; artifact availability comes from the manifest producer keys, never from
 * timestamps or directory names.
 *
 * DTO: docs/design/board-evidence-dto.md. Producer vocabulary: apps/cli/src/board/manifest.ts.
 */

import type {
    Availability,
    BoardDiagnostic,
    NewsBundleEvidence,
    NewsEngineEvidence,
    NewsGenerationEvidence,
    NewsPublishTargetEvidence,
    NewsPublishWindowEvidence,
    NewsSummaryEvidence,
    RunEvidence,
    RunResults,
} from '../contracts';
import { type ArtifactView, artifactViews, type ResultFact } from '../shared/collect';

/* -------------------------------------------------------------------------------------------- */
/* Capture state                                                                                */
/* -------------------------------------------------------------------------------------------- */

/** The news workflow id (the day-centric console's per-run drill-down reads only this one). */
export const DAILY_WORKFLOW = 'kk-news-generate';

/** Whether the selected attempt has a capture record at all. */
export type EvidenceCaptureState = 'captured' | 'uncaptured';

/** The selection's capture state — uncaptured attempts authorize run state only. */
export function captureState(evidence: RunEvidence): EvidenceCaptureState {
    return evidence.capture ? 'captured' : 'uncaptured';
}

/* -------------------------------------------------------------------------------------------- */
/* Narrowing over the projection bag                                                            */
/* -------------------------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBool(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

/** The typed news summary, or null when the run has no projection (uncaptured attempt). */
export function newsSummaryOf(evidence: RunEvidence): NewsSummaryEvidence | null {
    if (!evidence.results) return null;
    return newsSummaryOfResults(evidence.results);
}

/** Same narrowing for a raw `RunResults` (used by rows that already hold the projection). */
export function newsSummaryOfResults(results: RunResults): NewsSummaryEvidence | null {
    const summary = asRecord(results.summary);
    if (!summary) return null;
    const generation = generationOf(summary);
    const publishing = publishingOf(summary);
    const counts = countsOf(summary);
    const outcome = asString(summary.outcome);
    return {
        status: asString(summary.status) ?? 'unknown',
        startedAt: asString(summary.startedAt),
        completedAt: asString(summary.completedAt),
        outcome,
        generation,
        publishing,
        counts,
    };
}

function generationOf(summary: Record<string, unknown>): NewsGenerationEvidence {
    const bag = asRecord(summary.generation) ?? {};
    const gate = asRecord(bag.gate) ?? {};
    const launch = asRecord(bag.launch) ?? {};
    const progress = asRecord(bag.progress) ?? null;
    const engines: NewsEngineEvidence[] = Array.isArray(bag.engines)
        ? bag.engines.flatMap((entry) => {
              const row = asRecord(entry);
              if (!row) return [];
              const attempts = Array.isArray(row.attempts)
                  ? row.attempts.flatMap((attempt) => {
                        const a = asRecord(attempt);
                        if (!a) return [];
                        return [
                            {
                                status: asString(a.status) ?? 'unknown',
                                timing: asString(a.timing) ?? 'unknown',
                            },
                        ];
                    })
                  : [];
              return [
                  {
                      node: asString(row.node) ?? 'unknown',
                      state: asString(row.state) ?? 'unknown',
                      attempts,
                  },
              ];
          })
        : [];
    return {
        outcome: asString(bag.outcome),
        gate: { status: asString(gate.status) },
        launch: {
            status: asString(launch.status),
            runId: asString(launch.runId),
            startedAt: asString(launch.startedAt),
            finishedAt: asString(launch.finishedAt),
            reason: asString(launch.reason),
            stale: asBool(launch.stale) === true,
        },
        engines,
        progress,
    };
}

function publishingOf(summary: Record<string, unknown>): {
    bundle: NewsBundleEvidence | null;
    windows: NewsPublishWindowEvidence[];
} {
    const bag = asRecord(summary.publishing) ?? {};
    const bundleBag = asRecord(bag.bundle) ?? null;
    const bundle: NewsBundleEvidence | null = bundleBag
        ? {
              identity: asString(bundleBag.identity) ?? 'unknown',
              runDate: asString(bundleBag.runDate) ?? 'unknown',
              parentRunId: asString(bundleBag.parentRunId),
              title: asString(bundleBag.title),
              variants: Array.isArray(bundleBag.variants)
                  ? bundleBag.variants.flatMap((v) => {
                        const s = asString(v);
                        return s ? [s] : [];
                    })
                  : [],
              safety: asString(bundleBag.safety),
          }
        : null;
    const windows = Array.isArray(bag.windows)
        ? bag.windows.flatMap((entry) => {
              const row = asRecord(entry);
              if (!row) return [];
              const windowId = asString(row.window);
              if (!windowId) return [];
              const provenance = asRecord(row.provenance) ?? {};
              const recorded = asString(row.recordedStatus);
              return [
                  {
                      window: windowId,
                      recordedStatus: isWindowStatus(recorded) ? recorded : null,
                      provenance: {
                          dateMatch: asBool(provenance.dateMatch),
                          bundleMatch: asBool(provenance.bundleMatch),
                          parentMatch: asBool(provenance.parentMatch),
                          digestMatch: asBool(provenance.digestMatch),
                      },
                      targets: Array.isArray(row.targets)
                          ? row.targets.flatMap((target) => {
                                const t = asRecord(target);
                                if (!t) return [];
                                const id = asString(t.id);
                                if (!id) return [];
                                const evidenceFiles = asRecord(t.evidence) ?? {};
                                return [
                                    {
                                        id,
                                        tier: asNumber(t.tier),
                                        mode: asString(t.mode),
                                        target: asString(t.target),
                                        status: isTargetStatus(asString(t.status))
                                            ? (asString(t.status) as NewsPublishTargetEvidence['status'])
                                            : 'planned',
                                        effect: asString(t.effect) as NewsPublishTargetEvidence['effect'],
                                        url: asString(t.url),
                                        guid: asString(t.guid),
                                        finishedAt: asString(t.finishedAt),
                                        error: asString(t.error),
                                        evidence: {
                                            plan: asString(evidenceFiles.plan) ?? 'unknown',
                                            receipt: asString(evidenceFiles.receipt),
                                        },
                                    },
                                ];
                            })
                          : [],
                  },
              ];
          })
        : [];
    return { bundle, windows };
}

function isWindowStatus(value: string | null): value is NewsPublishWindowEvidence['recordedStatus'] {
    return value === 'full' || value === 'partial' || value === 'none' || value === 'dummy';
}

function isTargetStatus(value: string | null): boolean {
    return (
        value === 'succeeded' ||
        value === 'failed' ||
        value === 'uncertain' ||
        value === 'planned' ||
        value === 'dummy' ||
        value === 'skipped'
    );
}

/**
 * The recorded counts, `null` per count the projection did not record. A projection that predates
 * `counts` therefore renders an unrecorded word, never the zero `?? 0` would invent.
 */
function countsOf(summary: Record<string, unknown>): NewsSummaryEvidence['counts'] {
    const bag = asRecord(summary.counts) ?? {};
    const n = (key: string): number | null => asNumber(bag[key]);
    return {
        artifactsAvailable: n('artifactsAvailable'),
        artifactsTotal: n('artifactsTotal'),
        targetsSucceeded: n('targetsSucceeded'),
        targetsFailed: n('targetsFailed'),
        targetsUncertain: n('targetsUncertain'),
        targetsPlanned: n('targetsPlanned'),
        windowsFull: n('windowsFull'),
        windowsPartial: n('windowsPartial'),
        windowsNone: n('windowsNone'),
    };
}

/* -------------------------------------------------------------------------------------------- */
/* State words — the recorded vocabulary only, one row per recorded producer state              */
/* -------------------------------------------------------------------------------------------- */

/** Visual tone for a recorded producer/engine state word. */
export type StateTone = 'info' | 'success' | 'warn' | 'error' | 'neutral';

const ENGINE_WORDS: Record<string, { word: string; tone: StateTone }> = {
    success: { word: 'done', tone: 'success' },
    failure: { word: 'failed', tone: 'error' },
    pending: { word: 'active', tone: 'info' },
    unknown: { word: 'unrecorded', tone: 'neutral' },
};

/** The module's word for a recorded producer state — never invented, only these four exist. */
export function engineStateWord(state: string): { word: string; tone: StateTone } {
    return ENGINE_WORDS[state] ?? { word: state, tone: 'neutral' };
}

const TARGET_WORDS: Record<NewsPublishTargetEvidence['status'], { word: string; tone: StateTone }> = {
    succeeded: { word: 'sent', tone: 'success' },
    failed: { word: 'failed', tone: 'error' },
    uncertain: { word: 'uncertain', tone: 'warn' },
    planned: { word: 'no evidence recorded', tone: 'warn' },
    dummy: { word: 'rehearsal only', tone: 'neutral' },
    skipped: { word: 'skipped', tone: 'neutral' },
};

/** The module's word for a recorded target send state. */
export function targetStateWord(target: NewsPublishTargetEvidence): { word: string; tone: StateTone } {
    return TARGET_WORDS[target.status] ?? { word: target.status, tone: 'neutral' };
}

const WINDOW_WORDS: Record<
    NonNullable<NewsPublishWindowEvidence['recordedStatus']>,
    { word: string; tone: StateTone }
> = {
    full: { word: 'all targets sent', tone: 'success' },
    partial: { word: 'partially sent', tone: 'warn' },
    none: { word: 'nothing sent', tone: 'error' },
    dummy: { word: 'rehearsal only', tone: 'neutral' },
};

/** The module's word for a recorded window outcome. */
export function windowStateWord(
    status: NewsPublishWindowEvidence['recordedStatus'],
): { word: string; tone: StateTone } | null {
    return status ? (WINDOW_WORDS[status] ?? null) : null;
}

/** Human label for a recorded publish window id. */
export function windowLabel(window: string): string {
    if (window === 'after-generate') return 'After generate';
    if (window === 'cn-peak') return 'CN peak';
    if (window === 'overseas-rss') return 'Overseas RSS';
    return window;
}

/** The fixed, identity-bound provenance checks of one window, as display rows. */
export function provenanceRows(window: NewsPublishWindowEvidence): { label: string; matched: boolean | null }[] {
    return [
        { label: 'run date matches the bundle', matched: window.provenance.dateMatch },
        { label: 'plan references this bundle', matched: window.provenance.bundleMatch },
        { label: 'plan references this parent run', matched: window.provenance.parentMatch },
        { label: 'receipt digests match the plan', matched: window.provenance.digestMatch },
    ];
}

/* -------------------------------------------------------------------------------------------- */
/* Generation rows: ordered recorded stages with engine attempts folded in                      */
/* -------------------------------------------------------------------------------------------- */

/** One ordered generation stage row: the recorded DAG node plus its engine attempts, if any. */
export interface GenerationStageRow {
    id: string;
    label: string;
    status: string;
    /** Word + tone from the recorded producer state vocabulary. */
    word: string;
    tone: StateTone;
    timing: string | null;
    /** Recorded engine attempts when the node is part of the voice chain, else null. */
    engine: NewsEngineEvidence | null;
}

/**
 * Ordered recorded stages for the Generation view, primary producers first: the recorded engine
 * chain rows (voice + its fallbacks) followed by the remaining recorded progress nodes in record
 * order. Fallback engine rows are labeled as retries of the same producer, never as hidden steps.
 */
export function generationStageRows(summary: NewsSummaryEvidence): GenerationStageRow[] {
    const recorded = new Set<string>();
    const engineRows: GenerationStageRow[] = summary.generation.engines.map((engine) => {
        recorded.add(engine.node);
        const { word, tone } = engineStateWord(engine.state);
        const attempts = engine.attempts.length;
        return {
            id: engine.node,
            label: engineNodeLabel(engine.node),
            status: engine.state,
            word: attempts > 1 ? `${word} after ${attempts} attempts` : word,
            tone,
            timing: engine.attempts.at(-1)?.timing ?? null,
            engine,
        };
    });
    const progress = asRecord(summary.generation.progress);
    const nodes = progress && Array.isArray(progress.nodes) ? progress.nodes : [];
    const progressRows = nodes.flatMap((entry) => {
        const row = asRecord(entry);
        if (!row) return [];
        const id = asString(row.id);
        if (!id || recorded.has(id)) return [];
        const status = asString(row.status) ?? 'unknown';
        const { word, tone } = engineStateWord(status);
        return [
            {
                id,
                label: engineNodeLabel(id),
                status,
                word,
                tone,
                timing: asString(row.timing),
                engine: null,
            } satisfies GenerationStageRow,
        ];
    });
    return [...engineRows, ...progressRows];
}

/** The module's label for a recorded DAG node id — known nodes get human words. */
export function engineNodeLabel(node: string): string {
    const labels: Record<string, string> = {
        prepare: 'Prepare sources',
        curate: 'Curate topics',
        'script-write': 'Write script',
        'editorial-judge': 'Editorial review',
        render: 'Render article & cover',
        safety: 'Safety review',
        voice: 'Generate audio',
        'voice-fallback': 'Generate audio (retry A)',
        'voice-fallback2': 'Generate audio (retry B)',
        freeze: 'Freeze bundle',
    };
    return labels[node] ?? node;
}

/* -------------------------------------------------------------------------------------------- */
/* Publishing rows: identity-bound window groups                                                */
/* -------------------------------------------------------------------------------------------- */

/** One publishing target row enriched with its display words. */
export interface PublishingTargetRow extends NewsPublishTargetEvidence {
    word: string;
    tone: StateTone;
}

/** One publishing window group: recorded outcome, provenance rows, and its target rows. */
export interface PublishingWindowRow {
    window: string;
    label: string;
    recorded: { word: string; tone: StateTone } | null;
    provenance: { label: string; matched: boolean | null }[];
    targets: PublishingTargetRow[];
}

/** Window groups in recorded order; a window with no recorded outcome still shows its plan rows. */
export function publishingWindowRows(summary: NewsSummaryEvidence): PublishingWindowRow[] {
    return summary.publishing.windows.map((window) => ({
        window: window.window,
        label: windowLabel(window.window),
        recorded: windowStateWord(window.recordedStatus),
        provenance: provenanceRows(window),
        targets: window.targets.map((target) => {
            const { word, tone } = targetStateWord(target);
            return { ...target, word, tone };
        }),
    }));
}

/* -------------------------------------------------------------------------------------------- */
/* Output groups: manifest-keyed artifacts, ordered by producer stage                            */
/* -------------------------------------------------------------------------------------------- */

/** Stage order for grouping artifacts; unknown producer nodes keep record order after these. */
const STAGE_ORDER: readonly string[] = [
    'prepare',
    'curate',
    'script-write',
    'editorial-judge',
    'render',
    'safety',
    'voice',
    'freeze',
];

/** One producer stage's available/total artifacts, plus the rows for the drill-down list. */
export interface OutputGroup {
    producer: string;
    label: string;
    artifacts: ArtifactView[];
}

/**
 * Group artifact views by their manifest producer node, in stage order. Availability was resolved
 * by the reader from the fixed manifest keys — this never invents an artifact or a link.
 */
export function outputGroups(results: RunResults, readerOrigin: string): OutputGroup[] {
    const views = artifactViews(results, readerOrigin);
    const producersOf = new Map(views.map((view) => [view.id, view]));
    const byProducer = new Map<string, ArtifactView[]>();
    for (const descriptor of results.artifacts) {
        const view = producersOf.get(descriptor.id);
        if (!view) continue;
        const producer = descriptor.producerNode ?? '';
        const bucket = byProducer.get(producer);
        if (bucket) bucket.push(view);
        else byProducer.set(producer, [view]);
    }
    const producers = [...byProducer.keys()].sort((a, b) => {
        const ia = STAGE_ORDER.indexOf(a);
        const ib = STAGE_ORDER.indexOf(b);
        return (ia === -1 ? STAGE_ORDER.length : ia) - (ib === -1 ? STAGE_ORDER.length : ib);
    });
    return producers.map((producer) => ({
        producer,
        label: producer ? engineNodeLabel(producer) : 'Unattributed',
        artifacts: byProducer.get(producer) ?? [],
    }));
}

/* -------------------------------------------------------------------------------------------- */
/* Summary facts + the latest actionable issue                                                  */
/* -------------------------------------------------------------------------------------------- */

function stamp(value: string | null): string {
    if (!value) return 'not recorded';
    const ms = Date.parse(value);
    return Number.isNaN(ms)
        ? value
        : new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The Summary view's fact rows for a news run — recorded values only.
 *
 * Availability comes from the envelope's OWN recorded word (`results.availability`), never from a
 * timestamp: DTO honesty rule 1 forbids inferring availability, so a two-day-old completed run
 * still reads `available` and only a recorded supersession reads `superseded`.
 */
export function newsSummaryFacts(evidence: RunEvidence): ResultFact[] {
    const summary = newsSummaryOf(evidence);
    const facts: ResultFact[] = [{ label: 'Status', value: evidence.run.status, availability: 'available' }];
    if (!summary) {
        facts.push({
            label: 'Projection',
            value: 'No captured projection for this attempt',
            availability: 'unverified',
        });
        return facts;
    }
    // Per-fact availability describes THAT value, never the run's artifact roll-up: `results.availability`
    // reads `missing` whenever any manifest artifact is absent (the normal case), so echoing it beside a
    // recorded value said the value was absent. A recorded value is `available`; a superseded workspace
    // keeps its recorded word; only an absent value is `missing` — never inferred from a timestamp
    // (DTO honesty rule 1). The roll-up word stays where it belongs, the header subtitle.
    const workspace = evidence.results?.availability;
    const availabilityOf = (present: boolean): Availability =>
        present ? (workspace === 'superseded' ? 'superseded' : 'available') : 'missing';
    facts.push({
        label: 'Outcome',
        value: summary.outcome ?? 'not recorded',
        availability: summary.outcome ? 'available' : 'missing',
    });
    facts.push({
        label: 'Gate',
        value: summary.generation.gate.status ?? 'not recorded',
        availability: summary.generation.gate.status ? 'available' : 'missing',
    });
    facts.push({
        label: 'Started',
        value: stamp(summary.startedAt),
        availability: availabilityOf(summary.startedAt !== null),
    });
    facts.push({
        label: 'Completed',
        value: stamp(summary.completedAt),
        availability: availabilityOf(summary.completedAt !== null),
    });
    const { artifactsAvailable, artifactsTotal, targetsSucceeded, targetsFailed, targetsUncertain } = summary.counts;
    const countsRecorded =
        artifactsAvailable !== null &&
        artifactsTotal !== null &&
        targetsSucceeded !== null &&
        targetsFailed !== null &&
        targetsUncertain !== null;
    facts.push({
        label: 'Artifacts',
        value:
            artifactsAvailable === null || artifactsTotal === null
                ? 'not recorded'
                : `${artifactsAvailable} available of ${artifactsTotal}`,
        availability: countsRecorded ? availabilityOf(true) : 'unverified',
    });
    const sent = targetsSucceeded ?? 0;
    const bad = (targetsFailed ?? 0) + (targetsUncertain ?? 0);
    facts.push({
        label: 'Publishing',
        value: !countsRecorded ? 'not recorded' : bad > 0 ? `${sent} sent, ${bad} failed or uncertain` : `${sent} sent`,
        availability: countsRecorded ? availabilityOf(true) : 'unverified',
    });
    return facts;
}

/** One actionable issue: the first failed/uncertain target, else the first error diagnostic. */
export function latestIssue(
    summary: NewsSummaryEvidence | null,
    diagnostics: readonly BoardDiagnostic[],
): { title: string; detail: string } | null {
    if (summary) {
        for (const window of summary.publishing.windows) {
            for (const target of window.targets) {
                if (target.status === 'failed' || target.status === 'uncertain') {
                    const why = target.error ?? 'no error detail recorded';
                    return {
                        title: `${windowLabel(window.window)}: ${target.id} ${target.status}`,
                        detail: why,
                    };
                }
            }
        }
        if (summary.generation.launch.stale) {
            return {
                title: 'Launch receipt points at another run',
                detail: `receipt run ${summary.generation.launch.runId ?? 'unknown'} is not this attempt`,
            };
        }
    }
    const first = diagnostics.find((d) => typeof d.message === 'string' && d.message.length > 0);
    return first ? { title: first.code, detail: first.message } : null;
}

/** The uncaptured diagnostic's words, when the attempt has no capture record. */
export function uncapturedDiagnostic(evidence: RunEvidence): BoardDiagnostic | null {
    if (captureState(evidence) !== 'uncaptured') return null;
    const found = evidence.diagnostics.find((d) => d.code === 'board.evidence.uncaptured');
    return found ?? null;
}

/** True when the evidence envelope is a news-run envelope for this module's workflow. */
export function isNewsEvidence(evidence: RunEvidence): boolean {
    return evidence.workflow === DAILY_WORKFLOW;
}
