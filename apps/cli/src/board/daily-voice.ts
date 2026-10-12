import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    RunCapture,
    RunResults,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import {
    type ArtifactObservation,
    descriptorFor,
    isTerminalStatus,
    markerDiagnostic,
    overallAvailability,
    type RunDetailSummary,
} from './collect';
import {
    type ArtifactSpec,
    artifactsFor,
    CONFIDENCE_LEVELS,
    type ConfidenceLevel,
    isConfidenceLevel,
    type MarkerState,
    type ProducerState,
    resolveAvailability,
} from './manifest';

/**
 * The Daily AI Voice projection: turn the selected DAG run's captured record + artifact
 * observations into the reader's `RunResults` JSON.
 *
 * The workflow is a static DAG (§9), so a producer is identified by its NODE id and the recorded
 * run-detail action rows — not a state-machine `actionKey`. Channel outcomes are SEMANTIC
 * (draft/live/skipped/error), derived from the recorded result files and the captured settings,
 * never from engine execution status. Anything the run did not record stays `unavailable`.
 */

/** The semantic publish outcome of one channel, independent of engine execution status. */
export type ChannelOutcome = 'live' | 'draft' | 'skipped' | 'error' | 'pending' | 'unavailable';

/**
 * The content-judge confidence levels the daily safety gate accepts, re-exported from the manifest
 * (the artifact metadata owns the vocabulary, so a judge-verdict artifact declares it there).
 */
export { CONFIDENCE_LEVELS, type ConfidenceLevel, isConfidenceLevel } from './manifest';

/** One channel's projected outcome with a validated public link when it recorded one. */
export interface DailyChannelOutcome {
    channel: string;
    label: string;
    outcome: ChannelOutcome;
    /** A validated `http(s)` public link, or null when none was recorded. */
    url: string | null;
    /** Bounded recorded detail (e.g. `1/2 targets ok`), never raw payload. */
    detail: string | null;
}

/** One DAG node's recorded attempts. Retry siblings are DISTINCT nodes, never merged. */
export interface DailyProgressNode {
    id: string;
    /** Aggregated recorded status across the node's action attempts. */
    status: string;
    /** Number of recorded action rows for the node (one per attempt). */
    attempts: number;
    /** Recorded timing, or `timing unknown`. */
    timing: string;
}

/** The recorded DAG progress: node attempts from run-detail actions + captured topology edges. */
export interface DailyProgress {
    nodes: DailyProgressNode[];
    /** Captured dependency edges, or null when no digest-verified topology was recorded. */
    edges: { from: string; to: string }[] | null;
    /** True only when the capture recorded a digest-verified topology. */
    edgesKnown: boolean;
    /** The nested safety run id, present only when the safety action recorded one. */
    childRunId: string | null;
}

/** The typed daily-voice summary carried under `RunResults.summary`. */
export interface DailySummary {
    status: string | null;
    startedAt: string | null;
    completedAt: string | null;
    /** Known result outcome: `full` | `partial` | `none` | `no-content`, else null. */
    outcome: string | null;
    articleTitle: string | null;
    channels: DailyChannelOutcome[];
    /** Audio QC evidence from the generation record, or null when it was not recorded. */
    quality: { overallScore: number | null; passed: boolean | null; criticalIssues: string[] } | null;
    /** Content-safety verdict evidence, or null when it was not recorded. */
    safety: { verdict: string | null; confidence: ConfidenceLevel | null } | null;
    progress: DailyProgress | null;
    counts: {
        artifactsAvailable: number;
        artifactsTotal: number;
        live: number;
        draft: number;
        failed: number;
        skipped: number;
    };
}

/** A publish channel and how its semantic outcome is derived from recorded evidence. */
interface ChannelSpec {
    channel: string;
    label: string;
    /** The manifest artifact id holding the channel's recorded result file. */
    resultId: string;
    /** True when the captured settings enabled the channel for this run. */
    enabled: (settings: Record<string, string>) => boolean;
    /** The channel's "live vs draft" default when a target records no explicit status. */
    live: (settings: Record<string, string>) => boolean;
}

const isTrue = (settings: Record<string, string>, key: string): boolean => settings[key] === 'true';

const CHANNELS: readonly ChannelSpec[] = [
    {
        channel: 'surfdash',
        label: 'SurfDash post',
        resultId: 'surfdash-result',
        enabled: (s) => isTrue(s, 'publish_enabled'),
        live: () => true,
    },
    {
        channel: 'podcast',
        label: 'Podcast episode',
        resultId: 'podcast-result',
        enabled: (s) => isTrue(s, 'publish_enabled'),
        live: () => true,
    },
    {
        channel: 'xhs',
        label: 'Xiaohongshu',
        resultId: 'xhs-result',
        enabled: (s) => isTrue(s, 'xhs_enabled'),
        live: (s) => isTrue(s, 'xhs_live'),
    },
    {
        channel: 'wechat',
        label: 'WeChat MP',
        resultId: 'wechat-result',
        enabled: (s) => isTrue(s, 'publish_enabled') && isTrue(s, 'wechat_enabled'),
        live: (s) => isTrue(s, 'wechat_live'),
    },
    {
        channel: 'locales',
        label: 'Locale drafts',
        resultId: 'locales-result',
        enabled: (s) => isTrue(s, 'publish_enabled'),
        // Locale output is scaffolds by construction (`publishCompleteness` records the locale sync as
        // done = drafts written), so it is never "live" unless a recorded status says otherwise.
        live: () => false,
    },
];

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

/** `record.metadata`, or an empty object — a missing metadata bag is simply no evidence. */
function metadataOf(record: Record<string, unknown>): Record<string, unknown> {
    return asRecord(record.metadata) ?? {};
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
    if (raw === undefined) return null;
    try {
        return asRecord(JSON.parse(raw));
    } catch {
        return null;
    }
}

/** A validated public link: only credential-free `http`/`https` absolute URLs become clickable. */
export function isPublicHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '';
    } catch {
        return false;
    }
}

/**
 * True when `value` is one of the three recognized content-judge confidence levels
 * (`HIGH` | `MEDIUM` | `LOW`). Callers use it to keep an out-of-vocabulary value explicit as
 * unknown rather than echoing an unrecognized string as a confidence level.
 */
/** The levels the judge-verdict artifact declares, falling back to the shared vocabulary. */
function verdictConfidenceLevels(): readonly ConfidenceLevel[] {
    return (
        artifactsFor('kk-daily-ai-voice2').find((spec) => spec.confidenceVocabulary !== undefined)
            ?.confidenceVocabulary ?? CONFIDENCE_LEVELS
    );
}

/** The recorded confidence as a recognized level, or null when it is absent/out-of-vocabulary. */
function asConfidenceLevel(value: unknown): ConfidenceLevel | null {
    if (!isConfidenceLevel(value)) return null;
    // The manifest's judge-verdict artifact owns the vocabulary; honoring it keeps one source.
    return verdictConfidenceLevels().includes(value) ? value : null;
}

/**
 * The producer state a DAG run's action rows record for one node (§9).
 *
 * `success` when any recorded attempt passed; `pending` while an attempt runs and none passed
 * (a same-run retry never hides its own success); `unknown` when the node has no recorded row.
 */
export function dagProducerState(actions: readonly unknown[], node: string): ProducerState {
    let matched = false;
    let running = false;
    for (const entry of actions) {
        const record = asRecord(entry);
        if (record === null || record.node !== node) continue;
        matched = true;
        const status = (stringOrNull(record.status) ?? '').toLowerCase();
        if (record.ok === true || ['passed', 'done', 'success', 'completed'].includes(status)) return 'success';
        if (status === 'pending' || status === 'running') running = true;
    }
    if (!matched) return 'unknown';
    return running ? 'pending' : 'failure';
}

/** Recorded timing for one action row (`12s` | `started → completed` | `timing unknown`). */
function rowTiming(record: Record<string, unknown>): string {
    const durationMs = record.durationMs;
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
        return durationMs < 1000 ? `${Math.round(durationMs)}ms` : `${Math.round(durationMs / 1000)}s`;
    }
    const started = stringOrNull(record.startedAt);
    const completed = stringOrNull(record.completedAt);
    if (started !== null && completed !== null) return `${started} → ${completed}`;
    return 'timing unknown';
}

/** Aggregate one node's action rows into a single recorded status. */
function nodeStatusOf(rows: readonly Record<string, unknown>[]): string {
    if (rows.length === 0) return 'not recorded';
    const statuses = rows.map((row) => (stringOrNull(row.status) ?? '').toLowerCase());
    if (
        rows.some((row) => row.ok === true) ||
        statuses.some((status) => ['passed', 'done', 'success', 'completed'].includes(status))
    ) {
        return 'passed';
    }
    if (statuses.some((status) => status === 'running' || status === 'pending')) return 'running';
    if (statuses.some((status) => status === 'failed' || status === 'error')) return 'failed';
    return stringOrNull(rows[rows.length - 1]?.status) ?? 'unknown';
}

/** Run ids are single safe path segments — the same bound both child-run paths use. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** A bounded run id, or null when the recorded value is not a safe single path segment. */
function boundRunId(value: string | null): string | null {
    return value !== null && RUN_ID_PATTERN.test(value) ? value : null;
}

/** The nested safety run id recorded on the safety node's action, or null (§9). */
function childRunOf(rows: readonly Record<string, unknown>[], node: string): string | null {
    for (const row of rows) {
        if (row.node !== node) continue;
        const summary = row.resultSummary;
        const direct = asRecord(summary);
        const fromObject =
            direct === null ? null : boundRunId(stringOrNull(direct.runId) ?? stringOrNull(direct.childRunId));
        if (fromObject !== null) return fromObject;
        if (typeof summary === 'string') {
            const match = /(?:runId|childRunId)[=: ]([A-Za-z0-9][A-Za-z0-9._-]{0,127})/.exec(summary);
            if (match?.[1] !== undefined) return match[1];
        }
    }
    return null;
}

/**
 * Project the recorded DAG progress: node attempts from run-detail action rows, dependency edges
 * only from a captured digest-verified topology (unknown edges stay unknown — §9).
 */
export function projectProgress(actions: readonly unknown[], topology: RunCapture['topology']): DailyProgress {
    const rows = actions.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
    const byNode = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
        const node = stringOrNull(row.node);
        if (node === null) continue;
        const list = byNode.get(node) ?? [];
        list.push(row);
        byNode.set(node, list);
    }
    const ids = new Set<string>(topology?.nodes ?? []);
    for (const node of byNode.keys()) ids.add(node);
    const nodes = [...ids].map((id) => {
        const nodeRows = byNode.get(id) ?? [];
        const last = nodeRows[nodeRows.length - 1];
        return {
            id,
            status: nodeStatusOf(nodeRows),
            attempts: nodeRows.length,
            timing: last === undefined ? 'timing unknown' : rowTiming(last),
        };
    });
    return {
        nodes,
        edges: topology?.edges ?? null,
        edgesKnown: topology !== undefined,
        childRunId: childRunOf(rows, 'safety'),
    };
}

/** Project one channel's semantic outcome from its recorded result file + captured settings. */
function channelOutcome(
    spec: ChannelSpec,
    settings: Record<string, string>,
    state: ArtifactDescriptor['availability'],
    raw: string | undefined,
): DailyChannelOutcome {
    const base = { channel: spec.channel, label: spec.label };
    if (state !== 'available') {
        const outcome: ChannelOutcome = state === 'pending' ? 'pending' : 'unavailable';
        return { ...base, outcome, url: null, detail: `result ${state}` };
    }
    const parsed = parseJsonObject(raw);
    // TWO recorded shapes exist. A fan-out result carries `targets[]` (surfdash/podcast), while a
    // single-target publish (xhs/wechat) and the locale sync write ONE top-level `Result` object
    // (`{ok, target, metadata:{publishStatus}, url?, error?}` — `writePublishResult`). Treat that
    // object as one implicit target: assuming `targets[]` everywhere reported every real draft as
    // `error` (review P1).
    const fanOut = Array.isArray(parsed?.targets);
    const targets = fanOut
        ? ((parsed?.targets ?? []) as unknown[]).map(asRecord).filter((t): t is Record<string, unknown> => t !== null)
        : parsed === null
          ? []
          : [parsed];
    if (targets.length === 0) return { ...base, outcome: 'error', url: null, detail: 'no result recorded' };
    const ok = targets.filter((target) => target.ok === true);
    const detail = fanOut
        ? `${ok.length}/${targets.length} targets ok`
        : ok.length === 1
          ? 'recorded ok'
          : 'recorded not ok';
    if (ok.length === 0) return { ...base, outcome: 'error', url: null, detail };
    const statuses = ok.map((target) => stringOrNull(metadataOf(target).publishStatus));
    const wantsLive = statuses.includes('public');
    const wantsDraft = statuses.includes('draft');
    const outcome: ChannelOutcome = wantsLive || (!wantsDraft && spec.live(settings)) ? 'live' : 'draft';
    const url =
        ok
            .map((target) => stringOrNull(target.url))
            .find((candidate): candidate is string => candidate !== null && isPublicHttpUrl(candidate)) ?? null;
    return { ...base, outcome, url, detail };
}

/** Project every channel's outcome from the recorded result files + captured settings. */
export function channelOutcomes(
    settings: Record<string, string>,
    availability: ReadonlyMap<string, ArtifactDescriptor['availability']>,
    textOf: (id: string) => string | undefined,
): DailyChannelOutcome[] {
    return CHANNELS.map((spec) => {
        if (!spec.enabled(settings)) {
            return {
                channel: spec.channel,
                label: spec.label,
                outcome: 'skipped' as ChannelOutcome,
                url: null,
                detail: 'channel disabled for this run',
            };
        }
        const state = availability.get(spec.resultId) ?? 'unverified';
        const raw = state === 'available' ? textOf(spec.resultId) : undefined;
        return channelOutcome(spec, settings, state, raw);
    });
}

/** String entries of an array, bounded — a malformed evidence field yields no rows. */
function stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Project one daily run's results. Pure: the reader supplies the observed file states and the
 * run-detail action rows it read from the Board's own run API.
 */
export function projectDailyResults(input: {
    record: RunCapture;
    detail: RunDetailSummary;
    marker: MarkerState;
    actions: readonly unknown[];
    producerOf: (spec: ArtifactSpec) => ProducerState;
    observationOf: (spec: ArtifactSpec) => ArtifactObservation | undefined;
    diagnostics?: BoardDiagnostic[];
}): RunResults {
    const { record, detail, marker } = input;
    const terminal = isTerminalStatus(detail.status);
    const specs = artifactsFor(record.workflow as WorkflowName);
    const diagnostics: BoardDiagnostic[] = [...(input.diagnostics ?? []), ...markerDiagnostic(marker)];
    const availability = new Map<string, ArtifactDescriptor['availability']>();
    const artifacts: ArtifactDescriptor[] = [];
    for (const spec of specs) {
        const observation = input.observationOf(spec);
        const state = resolveAvailability(marker, input.producerOf(spec), observation?.state ?? 'absent', terminal);
        availability.set(spec.id, state);
        artifacts.push(descriptorFor(spec, state, observation));
    }
    const textOf = (id: string): string | undefined => {
        if (availability.get(id) !== 'available') return undefined;
        const spec = specs.find((candidate) => candidate.id === id);
        return spec === undefined ? undefined : input.observationOf(spec)?.text;
    };
    const jsonOf = (id: string): Record<string, unknown> | null => parseJsonObject(textOf(id));

    const publishStatus = stringOrNull(textOf('publish-status')?.trim());
    const reportText = textOf('report');
    const outcome = publishStatus ?? (reportText !== undefined && /no-content/i.test(reportText) ? 'no-content' : null);

    const qc = asRecord(asRecord(jsonOf('audio-record')?.metadata)?.qc);
    const quality =
        qc === null
            ? null
            : {
                  overallScore: numberOrNull(qc.overallScore),
                  passed: boolOrNull(qc.passed),
                  criticalIssues: stringArray(qc.criticalIssues),
              };
    const verdictRecord = jsonOf('safety-verdict');
    const safety =
        verdictRecord === null
            ? null
            : { verdict: stringOrNull(verdictRecord.verdict), confidence: asConfidenceLevel(verdictRecord.confidence) };

    const channels = channelOutcomes(record.settings, availability, textOf);
    const availableCount = artifacts.filter((artifact) => artifact.availability === 'available').length;
    const summary: DailySummary = {
        status: stringOrNull(detail.status) ?? detail.status,
        startedAt: detail.startedAt ?? null,
        completedAt: detail.completedAt ?? null,
        outcome,
        articleTitle: stringOrNull(jsonOf('article-content')?.title),
        channels,
        quality,
        safety,
        progress: projectProgress(input.actions, record.topology),
        counts: {
            artifactsAvailable: availableCount,
            artifactsTotal: artifacts.length,
            live: channels.filter((channel) => channel.outcome === 'live').length,
            draft: channels.filter((channel) => channel.outcome === 'draft').length,
            failed: channels.filter((channel) => channel.outcome === 'error').length,
            skipped: channels.filter((channel) => channel.outcome === 'skipped').length,
        },
    };
    if (!summary.progress?.edgesKnown) {
        diagnostics.push({
            code: 'board.progress.topology-unknown',
            message:
                'No digest-verified topology was captured; dependency edges are unknown (see Settings → Workflows).',
        });
    }
    return {
        schemaVersion: 1,
        workflow: record.workflow as WorkflowName,
        runId: record.runId,
        availability: overallAvailability(artifacts.map((artifact) => artifact.availability)),
        summary: summary as unknown as Record<string, unknown>,
        artifacts,
        diagnostics,
    };
}
