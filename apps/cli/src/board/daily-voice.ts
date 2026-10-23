import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    DailyEpisodeFunnel,
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
    /** The artifact-backed episode funnel (G82/0320), or null when nothing was recorded. */
    funnel: DailyEpisodeFunnel;
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

/* ------------------------------------------------------------------------------------------------
 * G82/0320 — the artifact-backed episode funnel.
 *
 * Every count comes from one authorized stage artifact (pool → annotated → exclusions/candidates →
 * plan), each with its fixed evidence id. A refusal that cleared `candidates.json` makes the
 * post-dedup count unknown — never 0, and never a reason to call the original pool empty. Gate
 * precedence for a no-content run: measured duration refusal → script refusal → QC floor →
 * empty-pool → qc-empty → unknown.
 * ---------------------------------------------------------------------------------------------- */

/** Bound for exclusion rows and each rule/matched string (0320 Design). */
const FUNNEL_EXCLUSION_ROWS = 100;
const FUNNEL_TEXT_CHARS = 200;

/** Parse any JSON document (the pool/annotated/plan artifacts are TOP-LEVEL ARRAYS). */
function parseAnyJson(raw: string | undefined): unknown {
    if (raw === undefined) return null;
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return null;
    }
}

/** A finite nonnegative number, else null (never a negative or NaN "minute"). */
function nonNegativeNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** The length of `value` when it is an array, else null (a count comes only from a real array). */
function arrayCount(value: unknown): number | null {
    return Array.isArray(value) ? value.length : null;
}

/** Seconds → minutes, rounded ONCE to one decimal (display math happens once). */
function minutesFromSeconds(seconds: number): number {
    return Math.round((seconds / 60) * 10) / 10;
}

/** One bounded rule/matched pair, or null when the entry carries no string rule. */
function exclusionRow(entry: unknown): { rule: string; matched: string } | null {
    const record = asRecord(entry);
    if (record === null || typeof record.rule !== 'string') return null;
    return {
        rule: record.rule.slice(0, FUNNEL_TEXT_CHARS),
        matched: typeof record.matched === 'string' ? record.matched.slice(0, FUNNEL_TEXT_CHARS) : '',
    };
}

/** The measured-refusal evidence: only a validated measuredMinutes/minMinutes pair (no stage). */
function measuredRefusalOf(record: Record<string, unknown> | null): {
    measuredMinutes: number;
    estimatedMinutes: number | null;
    minMinutes: number;
    keptCount: number | null;
    id: string;
} | null {
    if (record === null || record.stage === 'script') return null;
    const measuredMinutes = nonNegativeNumber(record.measuredMinutes);
    const minMinutes = nonNegativeNumber(record.minMinutes);
    if (measuredMinutes === null || minMinutes === null) return null;
    return {
        measuredMinutes,
        estimatedMinutes: nonNegativeNumber(record.estimatedMinutes),
        minMinutes,
        keptCount: nonNegativeNumber(record.keptCount),
        id: 'episode-duration-refusal',
    };
}

/** The script-refusal evidence: only `stage === 'script'`, from whichever spec was authorized. */
function scriptRefusalOf(
    availability: ReadonlyMap<string, ArtifactDescriptor['availability']>,
    jsonOf: (id: string) => Record<string, unknown> | null,
): { estimatedMinutes: number | null; minMinutes: number | null; keptCount: number | null; id: string } | null {
    for (const id of [
        'episode-script-refusal',
        'episode-script-refusal-fallback',
        'episode-script-refusal-fallback2',
    ]) {
        if (availability.get(id) !== 'available') continue;
        const record = jsonOf(id);
        if (record === null || record.stage !== 'script') continue;
        return {
            estimatedMinutes: nonNegativeNumber(record.estimatedMinutes),
            minMinutes: nonNegativeNumber(record.minMinutes),
            keptCount: nonNegativeNumber(record.keptCount),
            id,
        };
    }
    return null;
}

/** The QC floor-refusal evidence. */
function floorRefusalOf(record: Record<string, unknown> | null): {
    estimatedMinutes: number | null;
    minMinutes: number | null;
    id: string;
} | null {
    if (record === null) return null;
    return {
        estimatedMinutes: nonNegativeNumber(record.estimatedMinutes),
        minMinutes: nonNegativeNumber(record.minMinutes),
        id: 'episode-floor-refusal',
    };
}

/**
 * Project the episode funnel from the run's own authorized artifacts. Pure: the availability map
 * and text reader are the same ones every other summary field uses, so marker/producer/size
 * authorization is inherited, never re-implemented.
 */
export function projectFunnel(
    settings: Record<string, string>,
    availability: ReadonlyMap<string, ArtifactDescriptor['availability']>,
    textOf: (id: string) => string | undefined,
    outcome: string | null,
): DailyEpisodeFunnel {
    const diagnostics: BoardDiagnostic[] = [];
    const evidence: Record<string, string> = {};
    const rawOf = (id: string): unknown => parseAnyJson(textOf(id));

    const poolRecord = rawOf('episode-pool');
    const poolCount = arrayCount(poolRecord);
    if (poolCount !== null) evidence.poolCount = 'episode-pool';
    const annotatedCount = arrayCount(rawOf('episode-annotated'));
    if (annotatedCount !== null) evidence.annotatedCount = 'episode-annotated';
    const qcRejectedCount = arrayCount(asRecord(rawOf('episode-qc-rejections'))?.rejected);
    if (qcRejectedCount !== null) evidence.qcRejectedCount = 'episode-qc-rejections';
    const exclusionsRecord = asRecord(rawOf('episode-exclusions'));
    const topicKeptCount = arrayCount(exclusionsRecord?.kept);
    if (topicKeptCount !== null) evidence.topicKeptCount = 'episode-exclusions';
    const plannedCount = arrayCount(rawOf('episode-plan'));
    if (plannedCount !== null) evidence.plannedCount = 'episode-plan';

    // Exclusion reasons: bounded rows of bounded strings, with a truncation diagnostic.
    const exclusions: { rule: string; matched: string }[] = [];
    const excludedRaw = Array.isArray(exclusionsRecord?.excluded) ? exclusionsRecord.excluded : [];
    const truncated =
        excludedRaw.length > FUNNEL_EXCLUSION_ROWS ||
        excludedRaw.some(
            (entry) =>
                typeof (entry as Record<string, unknown> | null)?.rule === 'string' &&
                ((entry as Record<string, unknown>).rule as string).length > FUNNEL_TEXT_CHARS,
        );
    for (const entry of excludedRaw.slice(0, FUNNEL_EXCLUSION_ROWS)) {
        const row = exclusionRow(entry);
        if (row !== null) exclusions.push(row);
    }
    if (truncated) {
        diagnostics.push({
            code: 'board.daily.funnel.truncated',
            message: `Exclusion evidence was bounded to ${FUNNEL_EXCLUSION_ROWS} rows of ${FUNNEL_TEXT_CHARS} characters.`,
        });
    }

    // A refusal clears candidates.json, so the post-dedup count survives only without one.
    const measured = measuredRefusalOf(asRecord(rawOf('episode-duration-refusal')));
    const script = scriptRefusalOf(availability, (id) => asRecord(rawOf(id)) ?? null);
    const floor = floorRefusalOf(asRecord(rawOf('episode-floor-refusal')));
    const refusalPresent = measured !== null || script !== null || floor !== null;
    const candidatesRecord = asRecord(rawOf('episode-candidates'));
    const candidateDocs = arrayCount(metadataOf(candidatesRecord ?? {})?.docs);
    const dedupKeptCount = refusalPresent ? null : candidateDocs;
    if (dedupKeptCount !== null) evidence.dedupKeptCount = 'episode-candidates';

    // Minutes: refusal/verdict evidence first, converted once; the settings floor/ceiling are
    // independent fallbacks and never overwrite recorded evidence.
    const verdict = asRecord(rawOf('episode-duration'));
    const verdictMeasured = nonNegativeNumber(verdict?.measuredMinutes);
    const verdictMin = nonNegativeNumber(verdict?.minMinutes);
    const verdictMax = nonNegativeNumber(verdict?.maxMinutes);
    const audioSeconds = nonNegativeNumber(asRecord(asRecord(rawOf('audio-record'))?.metadata)?.duration);
    let measuredMinutes: number | null = null;
    if (measured !== null) {
        measuredMinutes = measured.measuredMinutes;
        evidence.measuredMinutes = measured.id;
    } else if (verdictMeasured !== null) {
        measuredMinutes = verdictMeasured;
        evidence.measuredMinutes = 'episode-duration';
    } else if (audioSeconds !== null) {
        measuredMinutes = minutesFromSeconds(audioSeconds);
        evidence.measuredMinutes = 'audio-record';
    }
    let estimatedMinutes: number | null = null;
    if (measured?.estimatedMinutes != null) {
        estimatedMinutes = measured.estimatedMinutes;
        evidence.estimatedMinutes = measured.id;
    } else if (script?.estimatedMinutes != null) {
        estimatedMinutes = script.estimatedMinutes;
        evidence.estimatedMinutes = script.id;
    } else if (floor?.estimatedMinutes != null) {
        estimatedMinutes = floor.estimatedMinutes;
        evidence.estimatedMinutes = floor.id;
    }
    const settingsNumber = (key: string): number | null => {
        const value = Number(settings[key]);
        return settings[key] !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
    };
    let minMinutes: number | null = measured?.minMinutes ?? script?.minMinutes ?? floor?.minMinutes ?? verdictMin;
    if (minMinutes !== null) evidence.minMinutes = measured?.id ?? script?.id ?? floor?.id ?? 'episode-duration';
    else if (settingsNumber('episode_min_minutes') !== null) {
        minMinutes = settingsNumber('episode_min_minutes');
        evidence.minMinutes = 'captured-settings';
    }
    let maxMinutes: number | null = verdictMax;
    if (maxMinutes !== null) evidence.maxMinutes = 'episode-duration';
    else if (settingsNumber('episode_max_minutes') !== null) {
        maxMinutes = settingsNumber('episode_max_minutes');
        evidence.maxMinutes = 'captured-settings';
    }

    // Population mismatch (2026-10-21: pool 3 vs annotated 7): keep both values, diagnose, never
    // reconcile by subtraction — planning also filters/caps/translates.
    if (poolCount !== null && annotatedCount !== null && poolCount !== annotatedCount) {
        diagnostics.push({
            code: 'board.daily.funnel.mismatch',
            message: `Stage evidence disagrees: the pool records ${poolCount} item(s) while the annotation input carries ${annotatedCount}; both are shown as recorded.`,
        });
    }

    // Gate precedence (0320 Design): measured refusal → script refusal → QC floor → empty pool →
    // qc-empty — and `unknown` when nothing is proven. The run's recorded outcome is never
    // rewritten; a refusal beside a completed run is a diagnostic, not a gate.
    let gate: DailyEpisodeFunnel['gate'] = null;
    if (outcome === 'full' || outcome === 'partial') {
        if (refusalPresent) {
            diagnostics.push({
                code: 'board.daily.funnel.contradictory',
                message:
                    'A refusal artifact is present beside a recorded content outcome; the outcome stands and the gate stays unset.',
            });
        }
    } else {
        if (measured !== null) gate = 'episode-duration';
        else if (script !== null) gate = 'script';
        else if (floor !== null) gate = 'qc-floor';
        else if (poolCount === 0) gate = 'empty-pool';
        else if (poolCount !== null && poolCount > 0 && candidateDocs === 0) gate = 'qc-empty';
        else gate = 'unknown';
        if (gate === 'empty-pool') evidence.gate = 'episode-pool';
        else if (gate === 'qc-empty') evidence.gate = 'episode-candidates';
        else if (gate !== 'unknown') evidence.gate = measured?.id ?? script?.id ?? floor?.id ?? '';
    }

    return {
        poolCount,
        annotatedCount,
        qcRejectedCount,
        topicKeptCount,
        dedupKeptCount,
        plannedCount,
        estimatedMinutes,
        measuredMinutes,
        minMinutes,
        maxMinutes,
        gate,
        exclusions,
        evidence,
        diagnostics,
    };
}

/** A bounded text field for sanitized downloads (never a doc body, never an unbounded string). */
function boundedText(value: unknown, limit = FUNNEL_TEXT_CHARS): string | null {
    return typeof value === 'string' && value !== '' ? value.slice(0, limit) : null;
}

function countProjection(value: unknown, key = 'count'): Record<string, unknown> | null {
    return Array.isArray(value) ? { [key]: value.length } : null;
}

/**
 * G82/0320: sanitized projections for the downloadable funnel JSON ids. The raw pool/candidate
 * artifacts carry scraped doc bodies and titles; downloads serve counts, bounded rule/matched
 * strings and the refusal's numeric evidence instead. `null` = not a funnel id (raw serving
 * path). Parse failures degrade to `{ note: 'malformed' }` rather than 500s.
 */
export function sanitizeFunnelArtifact(
    workflow: WorkflowName,
    artifactId: string,
    raw: string | undefined,
): Record<string, unknown> | null {
    if (workflow !== 'kk-daily-ai-voice2') return null;
    const parsed = parseAnyJson(raw);
    if (parsed === null && raw !== undefined) return { note: 'malformed' };
    const record = asRecord(parsed);
    switch (artifactId) {
        case 'episode-pool':
        case 'episode-annotated':
        case 'episode-plan':
            return countProjection(parsed);
        case 'episode-qc-rejections':
            return countProjection(record?.rejected, 'rejectedCount');
        case 'episode-candidates':
            return countProjection(metadataOf(record ?? {})?.docs, 'docCount');
        case 'episode-exclusions': {
            if (record === null) return null;
            const excluded = Array.isArray(record.excluded) ? record.excluded : [];
            return {
                keptCount: arrayCount(record.kept),
                excluded: excluded
                    .slice(0, FUNNEL_EXCLUSION_ROWS)
                    .map((entry) => exclusionRow(entry))
                    .filter((row): row is { rule: string; matched: string } => row !== null),
            };
        }
        case 'episode-floor-refusal':
            return record === null
                ? null
                : {
                      estimatedMinutes: nonNegativeNumber(record.estimatedMinutes),
                      minMinutes: nonNegativeNumber(record.minMinutes),
                      candidateChars: nonNegativeNumber(record.candidateChars),
                      reason: boundedText(record.reason),
                  };
        case 'episode-duration':
            return record === null
                ? null
                : {
                      measuredMinutes: nonNegativeNumber(record.measuredMinutes),
                      minMinutes: nonNegativeNumber(record.minMinutes),
                      maxMinutes: nonNegativeNumber(record.maxMinutes),
                      ok: typeof record.ok === 'boolean' ? record.ok : null,
                  };
        case 'episode-duration-refusal':
        case 'episode-script-refusal':
        case 'episode-script-refusal-fallback':
        case 'episode-script-refusal-fallback2':
            return record === null
                ? null
                : {
                      stage: record.stage === 'script' ? 'script' : null,
                      measuredMinutes: nonNegativeNumber(record.measuredMinutes),
                      estimatedMinutes: nonNegativeNumber(record.estimatedMinutes),
                      minMinutes: nonNegativeNumber(record.minMinutes),
                      keptCount: nonNegativeNumber(record.keptCount),
                      reason: boundedText(record.reason),
                  };
        default:
            return null;
    }
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
        funnel: projectFunnel(record.settings, availability, textOf, outcome),
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
