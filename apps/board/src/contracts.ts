/**
 * The frozen cross-task type contract for the native KK Board modules
 * (docs/design/workflow-board-modules.md §9).
 *
 * Types only: no runtime values, no React, no DOM. Published to the CLI as the
 * declaration-only `@gobing-ai/kk-board/contracts` export, and mirrored by the
 * reader's JSON responses (`schemaVersion: 1`).
 */

/** The three workflow definitions a KK Board module may inspect. */
export type WorkflowName = 'kk-collect' | 'kk-daily-ai-voice2' | 'kk-itc';

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
    selection: 'selected' | 'published' | 'dropped' | 'none';
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
