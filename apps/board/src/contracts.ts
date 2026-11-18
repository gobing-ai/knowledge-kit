/**
 * The frozen cross-task type contract for the native KK Board modules
 * (docs/design/workflow-board-modules.md §9).
 *
 * Types only: no runtime values, no React, no DOM. Published to the CLI as the
 * declaration-only `@gobing-ai/kk-board/contracts` export, and mirrored by the
 * reader's JSON responses (`schemaVersion: 1`).
 */

/** The three workflow definitions a KK Board module may inspect. */
export type WorkflowName = 'kk-collect' | 'kk-daily-ai-voice2' | 'kk-itc' | 'kk-news-generate' | 'kk-article-generate';

/**
 * Truthful per-artifact state. `available` is the only state that permits content;
 * every other value is a distinct reason the operator sees instead of invented data.
 */
export type Availability = 'available' | 'pending' | 'missing' | 'invalid' | 'oversized' | 'superseded' | 'unverified';

/** One bounded, safe diagnostic: never a raw error, stack or command line. */
export interface BoardDiagnostic {
    /** Stable machine code, e.g. `board.capture.missing`. */
    code: string;
    /** Operator-facing sentence, bounded and free of raw payloads. */
    message: string;
}

/** The validated input of `captureRun` (the shared preparation seam). */
export interface RunCaptureInput {
    /** Workflow that owns the run. */
    workflow: WorkflowName;
    /** Single safe path segment identifying the run. */
    runId: string;
    /** Canonical directory the run writes its artifacts into. */
    workDir: string;
    /** Run stamp, `[A-Za-z0-9_-]+` plus `Z`. */
    stamp: string;
    /** Validated allowlisted effective settings (never free text or secrets). */
    settings: Record<string, string>;
    /** `sha256:…` digest of the executed definition, when the engine injected one. */
    definitionDigest?: string;
}

/** One captured run's immutable metadata record (`.works/.board/runs/<id>.json`). */
export interface RunCapture {
    schemaVersion: 1;
    projectPath: string;
    workflow: WorkflowName;
    runId: string;
    workspacePath: string;
    stamp: string;
    /** ISO timestamp of the capture. */
    capturedAt: string;
    /** Validated effective settings, exactly as captured (never current defaults). */
    settings: Record<string, string>;
    definitionDigest?: string;
    topology?: RunTopology;
}

/** The run's dependency/transition edges, read only on exact definition-digest agreement. */
export interface RunTopology {
    nodes: string[];
    edges: { from: string; to: string }[];
}

/** `GET /api/health` — the reader's own identity, never the browser's claim. */
export interface BoardHealth {
    schemaVersion: 1;
    projectPath: string;
}

/** A captured, sanitized run configuration projection. */
export interface RunConfig {
    schemaVersion: 1;
    workflow: WorkflowName;
    runId: string;
    /** Null means the run predates capture — not that today's defaults apply. */
    capturedAt: string | null;
    settings: Record<string, string>;
    /** Allowlisted keys that were not captured for this run. */
    unavailableKeys: string[];
    definitionDigest?: string;
    diagnostics: BoardDiagnostic[];
}

/** One allowlisted artifact the selected run may serve. */
export interface ArtifactDescriptor {
    /** Opaque id, resolvable only through the fixed workflow manifest. */
    id: string;
    label: string;
    kind: 'text' | 'json' | 'image' | 'audio';
    availability: Availability;
    /** The state/node that must have recorded a successful attempt. */
    producerNode: string;
    /** The `actionKey` a state action must record, when the workflow is a state machine. */
    producerActionKey?: string;
    mime?: string;
    bytes?: number;
}

/** One run's artifact-backed result projection (`GET …/results`). */
export interface RunResults {
    schemaVersion: 1;
    workflow: WorkflowName;
    runId: string;
    availability: Availability;
    /** Workflow-specific typed projection, narrowed by the owning module. */
    summary: Record<string, unknown>;
    artifacts: ArtifactDescriptor[];
    diagnostics: BoardDiagnostic[];
}

/** One operator exclusion reason: the rule that fired and the text it matched (bounded lengths). */
export interface DailyFunnelExclusion {
    rule: string;
    matched: string;
}

/**
 * The Daily AI Voice episode funnel (G82, task 0320) — additive optional field under
 * `RunResults.summary.funnel` (schemaVersion stays 1; older readers ignore it). Every count comes
 * from one authorized run artifact; `evidence` maps the field name to the fixed manifest artifact
 * id (or `captured-settings`) that supplied it. Null is explicit unknown, never zero.
 */
export interface DailyEpisodeFunnel {
    poolCount: number | null;
    annotatedCount: number | null;
    qcRejectedCount: number | null;
    topicKeptCount: number | null;
    /** Post-dedup survivors; unknown after a refusal cleared the candidates file. */
    dedupKeptCount: number | null;
    plannedCount: number | null;
    estimatedMinutes: number | null;
    measuredMinutes: number | null;
    minMinutes: number | null;
    maxMinutes: number | null;
    /** The evidenced gate that closed a no-content run, null for a content run, `unknown` when unproven. */
    gate: 'episode-duration' | 'script' | 'qc-floor' | 'empty-pool' | 'qc-empty' | 'unknown' | null;
    exclusions: DailyFunnelExclusion[];
    /** Field name → fixed manifest artifact id (or `captured-settings`); never a caller path. */
    evidence: Record<string, string>;
    diagnostics: BoardDiagnostic[];
}

/* ------------------------------------------------------------------------------------------------
 * Run evidence envelope + news generation/publishing DTO (0391, docs/design/board-evidence-dto.md)
 *
 * `GET /api/workflows/<w>/runs/<id>/evidence` answers this envelope. `capture`/`results` are null
 * for an attempt launched before capture binding: only authorized Spur run state plus the
 * `board.evidence.uncaptured` diagnostic is available, and fixed artifacts stay unknown — never
 * invented. `results.summary` for `kk-news-generate` is the typed news projection below; the
 * voice2-family `summary` stays the workflow-specific bag its own module narrows.
 * ---------------------------------------------------------------------------------------------- */

/** The selected attempt's capture identity, present only when a capture record exists. */
export interface RunEvidenceCapture {
    capturedAt: string;
    stamp: string;
    /** Allowlisted effective settings, exactly as captured. */
    settings: Record<string, string>;
    definitionDigest?: string;
}

/** `GET /api/workflows/<w>/runs/<id>/evidence` — capture + authorized state + projection. */
export interface RunEvidence {
    schemaVersion: 1;
    workflow: WorkflowName;
    runId: string;
    /** Null when the attempt predates capture binding: the projection is then null too. */
    capture: RunEvidenceCapture | null;
    /** Spur's own authorized run state; present for captured AND uncaptured attempts. */
    run: { id: string; status: string; startedAt: string | null; completedAt: string | null };
    /** The full workflow projection for captured runs; null for uncaptured attempts. */
    results: RunResults | null;
    diagnostics: BoardDiagnostic[];
}

/** One engine node's producer state and its bounded recorded attempts (loud fallback chains). */
export interface NewsEngineEvidence {
    node: string;
    /** Resolved producer state over the recorded DAG action rows (`unknown` when unrecorded). */
    state: string;
    attempts: { status: string; timing: string }[];
}

/** The launch receipt as bounded evidence, flagged stale when it names another run. */
export interface NewsLaunchEvidence {
    status: string | null;
    runId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    reason: string | null;
    stale: boolean;
}

/** The attempt's generation side: outcome, gate verdict, launch receipt, engines and progress. */
export interface NewsGenerationEvidence {
    outcome: string | null;
    gate: { status: string | null };
    launch: NewsLaunchEvidence;
    engines: NewsEngineEvidence[];
    progress: DailyProgressBag | null;
}

/** The frozen bundle's bounded identity card: run date, parent run, title, variants, safety. */
export interface NewsBundleEvidence {
    identity: string;
    runDate: string;
    parentRunId: string | null;
    title: string | null;
    variants: string[];
    safety: string | null;
}

/** One publish target's plan-and-receipt evidence: send status, delivery effect, references. */
export interface NewsPublishTargetEvidence {
    id: string;
    tier: number | null;
    mode: string | null;
    target: string | null;
    status: 'succeeded' | 'failed' | 'uncertain' | 'planned' | 'dummy' | 'skipped';
    effect: 'confirmed' | 'none' | 'unknown' | null;
    url: string | null;
    guid: string | null;
    finishedAt: string | null;
    error: string | null;
    /** Fixed workspace-relative references — rendered as text, never turned into links. */
    evidence: { plan: string; receipt: string | null };
}

/** One publish window's recorded evidence: planned targets, outcome status, provenance checks. */
export interface NewsPublishWindowEvidence {
    window: string;
    recordedStatus: 'full' | 'partial' | 'none' | 'dummy' | null;
    provenance: {
        dateMatch: boolean | null;
        bundleMatch: boolean | null;
        parentMatch: boolean | null;
        digestMatch: boolean | null;
    };
    targets: NewsPublishTargetEvidence[];
}

/** The attempt's publishing side: the bundle card plus one window group per publishable window. */
export interface NewsPublishingEvidence {
    bundle: NewsBundleEvidence | null;
    windows: NewsPublishWindowEvidence[];
}

/** The typed news summary carried under `RunResults.summary` for `kk-news-generate`. */
export interface NewsSummaryEvidence {
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    outcome: string | null;
    generation: NewsGenerationEvidence;
    publishing: NewsPublishingEvidence;
    /**
     * The projection's own counts. `null` means the projection never recorded that count (a
     * projection predating the field), which the module renders as an unrecorded word — never as
     * an invented zero.
     */
    counts: {
        artifactsAvailable: number | null;
        artifactsTotal: number | null;
        targetsSucceeded: number | null;
        targetsFailed: number | null;
        targetsUncertain: number | null;
        targetsPlanned: number | null;
        windowsFull: number | null;
        windowsPartial: number | null;
        windowsNone: number | null;
    };
}

/** The untyped recorded progress bag a news generation row may carry (narrowed by the module). */
export interface DailyProgressBag {
    nodes?: unknown;
    edges?: unknown;
    edgesKnown?: unknown;
    childRunId?: unknown;
}

/* ------------------------------------------------------------------------------------------------
 * Collect store views (G81, task 0307 — docs/design/collect-store-views.md §3)
 *
 * Read-only projections of `<project>/.works/kk.db` (ADR-035 amendment 2026-10-16, Collect only).
 * `availability: 'unavailable'` means the store could not be read at all: the payload then carries
 * its empty shape plus a diagnostic, never zeros that read as real facts.
 * ---------------------------------------------------------------------------------------------- */

/** Whether the store answered at all, plus the bounded reasons it did not. */
export interface CollectStoreAvailability {
    availability: 'available' | 'unavailable';
    diagnostics: BoardDiagnostic[];
}

/** One run's stored facts; every count names its unit (rows, items, observations). */
export interface CollectRunStoreRow {
    runId: string;
    /** Parsed `collect_runs.source_counts_json`; `{}` (plus a diagnostic) when it does not parse. */
    sourceCounts: Record<string, number>;
    /** Items written by this run. */
    inserted: number;
    updated: number;
    /** Label observations (one per item × decision × maker). */
    labelRows: number;
    /** Distinct items with at least one label row in this run. */
    labeledItems: number;
    labelRowsBySource: Record<string, number>;
    /** Items FIRST seen in this run, by their strongest selection status. */
    yield: { selected: number; published: number; dropped: number };
}

/** `GET /api/workflows/kk-collect/store/overview` — the last stored collection and per-run rows. */
export interface CollectStoreOverview extends CollectStoreAvailability {
    schemaVersion: 1;
    /** `max(collect_runs.finished_at)` as an RFC 3339 stamp, `null` when nothing was stored. */
    lastStoredAt: string | null;
    /** `null` = that Spur run never reached `store` (a failed tick writes no row). */
    rows: Record<string, CollectRunStoreRow | null>;
}

/** `GET /api/workflows/kk-collect/runs/<id>/store` — one run's stored facts and label quality. */
export interface CollectRunStore extends CollectStoreAvailability {
    schemaVersion: 1;
    runId: string;
    row: CollectRunStoreRow | null;
    labelQuality: {
        decisionId: string;
        /** This run's own rows: value × confidence level (`none` = no level recorded). */
        run: { value: string; HIGH: number; MEDIUM: number; LOW: number; none: number }[];
        /** The effective (`labels_current`) distribution over the same items. */
        effective: { value: string; count: number }[];
    }[];
}

/** One effective label's value plus the detail the store recorded for it. */
export interface CollectItemLabelDetail {
    value: string;
    confidence: string | null;
    maker: string | null;
    score: number | null;
}

/** One item as the store views render it; all text renders as text nodes, never HTML. */
export interface CollectStoreItem {
    id: string;
    /** Capped at 300 characters. */
    title: string;
    /** `canonical_url` only when it is `http(s)`, else `null`. */
    url: string | null;
    source: string;
    storyId: string | null;
    seen: 'new' | 'reseen';
    /** Effective labels, `decision_id → value`. */
    labels: Record<string, string>;
    /** Detailed labels including confidence, maker, and score. */
    labelDetails?: Record<string, CollectItemLabelDetail>;
    selection: 'selected' | 'published' | 'dropped' | 'none';
    domain?: string | null;
    lang?: string | null;
    bodyChars?: number | null;
    engagement?: number | null;
    firstSeenAt?: number | null;
    publishedAt?: number | null;
}

/** `GET /api/workflows/kk-collect/runs/<id>/store/items` — one page of the run's items. */
export interface CollectStoreItems extends CollectStoreAvailability {
    schemaVersion: 1;
    runId: string;
    page: number;
    pageSize: 25;
    total: number;
    items: CollectStoreItem[];
    /** The `source` filter's domain, read from the store. */
    sources: string[];
}

/** One selection as the store views render it. */
export interface CollectStoreSelection {
    topic: string;
    itemId: string;
    runId: string;
    storyId: string;
    workflow: string | null;
    rank: number | null;
    reason: string | null;
    status: 'selected' | 'published' | 'dropped';
    selectedAt: number;
    publishedAt: number | null;
    title: string | null;
    source: string | null;
    url: string | null;
}

/** `GET /api/workflows/kk-collect/store/selections` — one page of selections. */
export interface CollectStoreSelections extends CollectStoreAvailability {
    schemaVersion: 1;
    page: number;
    pageSize: 25;
    total: number;
    selections: CollectStoreSelection[];
    topics: string[];
}

/** `GET /api/workflows/kk-collect/store/channels` query (task 0319). */
export interface StoreChannelsQuery {
    fromMs: number;
    untilMs: number;
    page: number;
}

/** One channel-yield day: new items per source, plus the day's total. */
export interface CollectChannelDay {
    day: string;
    total: number;
    sources: Record<string, number>;
}

/** One tick day: `collect_runs` count plus summed plugin counts (`null` = malformed evidence). */
export interface CollectRunDay {
    day: string;
    runs: number;
    plugins: Record<string, number> | null;
}

/**
 * `GET /api/workflows/kk-collect/store/channels` — both aggregate tables, one 30-day page.
 * `bySource` and `totalDays` cover the whole requested interval, not just this page.
 */
export interface CollectChannelYield extends CollectStoreAvailability {
    schemaVersion: 1;
    fromMs: number;
    untilMs: number;
    timeZone: string;
    page: number;
    pageSize: 30;
    totalDays: number;
    sources: string[];
    plugins: string[];
    byDay: CollectChannelDay[];
    bySource: Record<string, number>;
    runsByDay: CollectRunDay[];
    lastPositiveAt: Record<string, number | null>;
}
