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
 * Day-centric Daily AI Voice digest (G83, task 0439 — docs/design/daily-voice-ops-console.md §1–§5)
 *
 * One projection (`projectDay`) serves `GET /api/days/<day>`, `GET /api/days?from&until` and
 * `kk news digest`, so the console and the CLI cannot disagree. Missing evidence is an explicit
 * `unknown` with its reason — never a zero and never a success (R12).
 * ---------------------------------------------------------------------------------------------- */

/**
 * The day's overall health. `running` outranks `failed`, which outranks `attention`; `unknown` is
 * the answer when the evidence needed for the call is missing, and is never rendered as `ok`.
 */
export type DayStatus = 'ok' | 'attention' | 'failed' | 'running' | 'unknown';

/** The closed action-kind union shared by a recipe and the reader's action plane (§6). */
export type ActionKind =
    | 'generate-from-node'
    | 'publish-retry'
    | 'publish-window'
    | 'rerender-step'
    | 'cancel-run'
    | 'store-release'
    | 'edit-artifact'
    | 'revert-artifact';

/** A redo/render recipe: the argv is resolved server-side by the same function that executes it. */
export interface Recipe {
    kind: ActionKind;
    /** Short operator-facing label, e.g. `retry the failed target`. */
    label: string;
    /** Only the keys the kind allowlists — never free text. */
    params: Record<string, string>;
    argv: string[];
    /** argv the action plane runs to preview the command, when the kind has one. */
    dryRunArgv?: string[];
    /** `true` when the command can send to a live channel and needs a typed confirmation. */
    live: boolean;
}

/** The closed attention-rule set; a new rule is added to the design table, never inferred here. */
export type AttentionKind =
    | 'generation-failed'
    | 'generation-refused'
    | 'engine-fallback'
    | 'window-not-run'
    | 'target-failed'
    | 'provenance-mismatch'
    | 'safety-flag'
    | 'artifact-edited';

/** One thing that needs the operator, with the evidence that raised it and its recipes. */
export interface AttentionItem {
    severity: 'error' | 'warn' | 'info';
    kind: AttentionKind;
    /** What the item is about (a node, a window, a target id, `safety`). */
    subject: string;
    message: string;
    /** The artifact path or run id that raised the item, rendered as text. */
    evidence: string | null;
    recipes: Recipe[];
}

/** One recorded launch attempt for the day (a capture record plus its receipt status). */
export interface DayAttempt {
    runId: string;
    capturedAt: string;
    /** The launch receipt's status when it names this attempt; null when nothing recorded it. */
    status: string | null;
}

/** One recorded step duration from `step-timing.json`; `durationMs` is null when the pair is not a range. */
export interface DayNodeDuration {
    step: string;
    startedAt: string;
    endedAt: string;
    durationMs: number | null;
}

/** The generation side of one day: the current attempt, its launch status and recorded durations. */
export interface DayGeneration {
    /** The newest captured attempt's run id, or null when no capture record exists. */
    runId: string | null;
    /** The launch receipt's own status (`running` | `done` | `no-content` | `failed` | `refused`). */
    launchStatus: string | null;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    /** `episode` when a frozen bundle exists, the receipt's refusal word otherwise, null when unrecorded. */
    outcome: string | null;
    attempts: DayAttempt[];
    bundle: NewsBundleEvidence | null;
    durations: DayNodeDuration[];
    /** Why a generation figure is unknown; null when every figure was recorded. */
    unknownReason: string | null;
}

/** One publish window of the day: its launcher receipt, recorded outcome and per-target evidence. */
export interface DayWindow {
    window: string;
    /** The window's launcher run id from its receipt; null when no receipt recorded one. */
    runId: string | null;
    /**
     * `not-run` (no receipt and no plan), `unknown` (a plan with no launch receipt), or the
     * receipt's recorded status. Never derived from the absence of a failure.
     */
    launchStatus: 'not-run' | 'unknown' | 'running' | 'done' | 'failed' | 'refused' | 'no-content';
    unknownReason: string | null;
    recordedStatus: NewsPublishWindowEvidence['recordedStatus'];
    provenance: NewsPublishWindowEvidence['provenance'];
    targets: NewsPublishTargetEvidence[];
}

/** The day's safety verdict, or the reason it is unknown. */
export interface DaySafety {
    /** The recorded safety decision (`pass` | `exclude` | …); null when no decision file exists. */
    verdict: string | null;
    /** The judge verdict (`PASS` | `FAIL` | …), when the judge ran and recorded one. */
    judge: string | null;
    unknownReason: string | null;
    /**
     * True when the reviewed draft no longer matches what the verdict was recorded against, or an
     * edit is pending that the digest cannot see yet (G84). A stale verdict is never a pass.
     */
    stale?: boolean;
    /** Why it reads stale: the recorded digest moved, or the article body is newer than content.json. */
    staleReason?: string | null;
}

/** One `actions.jsonl` line: a preview, a launch, an exit or a refusal, append-only (§6). */
export interface DailyActionLine {
    ts: string;
    kind: string;
    /** The day the line belongs to; null for a run-scoped action whose id carries no day. */
    day?: string | null;
    argv: string[];
    origin: string | null;
    /** `sha256(kind + argv)`, never the token itself. */
    tokenHash: string | null;
    runId: string | null;
    exit: number | null;
    result?: string;
    refusal?: string;
}

/** The action plane's own state, so the console can render recipes-only when it is off. */
export interface DayActionPlane {
    enabled: boolean;
    /** The recorded lines for the day, bounded (newest last). */
    lines: DailyActionLine[];
}

/** One day's whole digest — the Today tab, the History drill-down and `kk news digest` payload. */
export interface DailyDigest {
    schemaVersion: 1;
    /** `YYYYMMDD` — the `kk-news-generate` work-dir basename. */
    day: string;
    status: DayStatus;
    generation: DayGeneration;
    windows: DayWindow[];
    safety: DaySafety;
    attention: AttentionItem[];
    /** The action plane's state and the day's recorded lines (G83/0442). */
    actions: DayActionPlane;
    /** Figure → the artifact path or run id that supplied it (R2). */
    sources: Record<string, string>;
    diagnostics: BoardDiagnostic[];
}

/**
 * One editable draft of a day, as the Generation tab's editor loads it (G84/0445).
 *
 * The reader computes the sha and both argv recipes server-side — the browser never derives a
 * digest and never builds a command, so a copied recipe and a clicked action stay byte-identical.
 */
export interface DayArtifactDocument {
    schemaVersion: 1;
    day: string;
    artifact: 'article' | 'script';
    /** The draft's path inside the day directory, rendered as text and never as a link. */
    path: string;
    /** The current bytes, or null when the draft does not exist yet. */
    text: string | null;
    /** sha256 of `text`; null when there is no text to hash. */
    sha256: string | null;
    /** The argv that would edit this draft against its current sha. */
    recipe: Recipe | null;
    /** The argv that reverts it, present only when a backup exists. */
    revertRecipe: Recipe | null;
    /** The newest backup's file name, when one exists. */
    backup: string | null;
    /** Whether `board.actions.enabled` allows launching (false renders recipes only). */
    editable: boolean;
}

/** One row of the History view: a day's health and its per-step durations. */
export interface DaySummary {
    day: string;
    status: DayStatus;
    runId: string | null;
    /** Per-window recorded status, or `not-run` when the window has no evidence at all. */
    windows: { window: string; launchStatus: DayWindow['launchStatus'] }[];
    durations: DayNodeDuration[];
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
