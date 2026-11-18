import type {
    ArtifactDescriptor,
    BoardDiagnostic,
    RunCapture,
    RunResults,
    WorkflowName,
} from '@gobing-ai/kk-board/contracts';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    type ArtifactSpec,
    artifactsFor,
    type FileState,
    type MarkerState,
    type ProducerState,
    resolveAvailability,
    resolveWithin,
} from './manifest';

/**
 * The Collect projection: turn the selected run's captured record + artifact observations into
 * the reader's `RunResults` JSON.
 *
 * Artifacts-only by contract (§9): counts come from the run's own `store-result.json`,
 * `label-result.txt` and the captured blended `Doc[]`. Anything the run did not record is
 * reported `unavailable`, never invented — there is no store/DAO read on this path.
 */

/** What the reader observed for one manifest artifact. */
export interface ArtifactObservation {
    state: FileState;
    bytes?: number;
    /** Decoded text, present only for previewable text/json artifacts under the cap. */
    text?: string;
    /** The canonical path read, present only when the observation touched the filesystem. */
    path?: string;
}

/** The run-detail subset the projection needs. */
export interface RunDetailSummary {
    id: string;
    workflowName: string;
    status: string;
    startedAt?: string | null;
    completedAt?: string | null;
}

/** A terminal run has stopped changing: producer-less artifacts are `missing`, not `pending`. */
export function isTerminalStatus(status: string): boolean {
    const normalized = status.toLowerCase();
    return normalized === 'done' || normalized === 'completed' || normalized === 'failed' || normalized === 'cancelled';
}

/** The existing source-count rule: one count per `metadata.sources[].file`. */
export function sourceCountsOf(docs: readonly unknown[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const doc of docs) {
        if (typeof doc !== 'object' || doc === null) continue;
        const sources = (doc as Record<string, unknown>).metadata;
        const list =
            typeof sources === 'object' && sources !== null ? (sources as Record<string, unknown>).sources : undefined;
        if (!Array.isArray(list)) continue;
        for (const source of list) {
            const file =
                typeof source === 'object' && source !== null ? (source as Record<string, unknown>).file : undefined;
            if (typeof file === 'string' && file !== '') counts[file] = (counts[file] ?? 0) + 1;
        }
    }
    return counts;
}

function parseJson(raw: string | undefined): Record<string, unknown> | null {
    if (raw === undefined) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
}

/** The first `lines` lines of the core-facts markdown, or null when it was not previewable. */
export function factsPreview(text: string | undefined, lines = 20): string | null {
    if (text === undefined || text === '') return null;
    return text.split('\n').slice(0, lines).join('\n');
}

/** Build one `ArtifactDescriptor` from its spec and the observed state (shared by both projections). */
export function descriptorFor(
    spec: ArtifactSpec,
    availability: ArtifactDescriptor['availability'],
    observation: ArtifactObservation | undefined,
): ArtifactDescriptor {
    return {
        id: spec.id,
        label: spec.label,
        kind: spec.kind,
        availability,
        producerNode: spec.producerNode,
        ...(spec.producerActionKey === undefined ? {} : { producerActionKey: spec.producerActionKey }),
        ...(spec.mime === undefined ? {} : { mime: spec.mime }),
        ...(observation?.bytes === undefined ? {} : { bytes: observation.bytes }),
    };
}

/** A diagnostic for an artifact whose workspace ownership cannot be trusted (shared by both projections). */
export function markerDiagnostic(marker: MarkerState): BoardDiagnostic[] {
    if (marker === 'owned') return [];
    if (marker === 'foreign') {
        return [
            {
                code: 'board.artifact.superseded',
                message: 'A later run owns this workspace; the files predate it and are not displayed.',
            },
        ];
    }
    if (marker === 'invalid') {
        return [
            {
                code: 'board.marker.invalid',
                message: 'The workspace ownership marker is malformed; the files are not displayed.',
            },
        ];
    }
    return [
        {
            code: 'board.artifact.unverified',
            message: 'No workspace ownership marker was recorded for this run.',
        },
    ];
}

/**
 * Project one run's results. Pure: the reader supplies the observed file states and the
 * producer evidence it read from the run's own Spur progress.
 */
export function projectCollectResults(input: {
    record: RunCapture;
    detail: RunDetailSummary;
    marker: MarkerState;
    producerOf: (spec: ArtifactSpec) => ProducerState;
    observationOf: (spec: ArtifactSpec) => ArtifactObservation | undefined;
    diagnostics?: BoardDiagnostic[];
}): RunResults {
    const { record, detail, marker } = input;
    const terminal = isTerminalStatus(detail.status);
    const specs = artifactsFor(record.workflow as WorkflowName);
    const diagnostics: BoardDiagnostic[] = [...(input.diagnostics ?? []), ...markerDiagnostic(marker)];
    const artifacts: ArtifactDescriptor[] = [];
    // artifact id -> availability; the summary is built from the SAME observations.
    const availability = new Map<string, ArtifactDescriptor['availability']>();
    for (const spec of specs) {
        const state = resolveAvailability(
            marker,
            input.producerOf(spec),
            input.observationOf(spec)?.state ?? 'absent',
            terminal,
        );
        availability.set(spec.id, state);
        artifacts.push(descriptorFor(spec, state, input.observationOf(spec)));
    }
    const blended = specs.find((spec) => spec.id === 'blended');
    const storeResult = specs.find((spec) => spec.id === 'store-result');
    const labelResult = specs.find((spec) => spec.id === 'label-result');
    const facts = specs.find((spec) => spec.id === 'facts');
    const blendedText =
        blended !== undefined && availability.get('blended') === 'available'
            ? input.observationOf(blended)?.text
            : undefined;
    const storeText =
        storeResult !== undefined && availability.get('store-result') === 'available'
            ? input.observationOf(storeResult)?.text
            : undefined;
    const labelText =
        labelResult !== undefined && availability.get('label-result') === 'available'
            ? input.observationOf(labelResult)?.text
            : undefined;
    const factsText =
        facts !== undefined && availability.get('facts') === 'available' ? input.observationOf(facts)?.text : undefined;
    const blendedDocs = blendedText === undefined ? null : (parseJsonArray(blendedText) ?? null);
    const store = parseJson(storeText);
    const label = parseJson(labelText);
    return {
        schemaVersion: 1,
        workflow: record.workflow as WorkflowName,
        runId: record.runId,
        availability: overallAvailability(artifacts.map((artifact) => artifact.availability)),
        summary: {
            status: detail.status,
            startedAt: detail.startedAt ?? null,
            completedAt: detail.completedAt ?? null,
            sourceCounts: blendedDocs === null ? null : sourceCountsOf(blendedDocs),
            inserted: numberOrNull(store?.inserted),
            updated: numberOrNull(store?.updated),
            unchanged: numberOrNull(store?.unchanged),
            labeled: numberOrNull(label?.labeled),
            model: numberOrNull(label?.model),
            fallback: numberOrNull(label?.fallback),
            verdict: stringOrNull(label?.verdict),
            confidence: stringOrNull(label?.confidence),
            factsPreview: factsPreview(factsText),
        },
        artifacts,
        diagnostics,
    };
}

/**
 * The run's overall availability, derived from its artifacts (never a separate guess).
 * AC2: only a run whose EVERY artifact is available reads as `available`; a partial run
 * rolls up to the most specific non-available state it contains.
 */
export function overallAvailability(
    states: readonly ArtifactDescriptor['availability'][],
): ArtifactDescriptor['availability'] {
    if (states.length === 0) return 'unverified';
    if (states.every((state) => state === 'available')) return 'available';
    if (states.every((state) => state === 'unverified')) return 'unverified';
    if (states.includes('superseded')) return 'superseded';
    if (states.includes('invalid')) return 'invalid';
    if (states.includes('oversized')) return 'oversized';
    if (states.includes('pending')) return 'pending';
    return 'missing';
}

/** Parse a JSON array of documents; anything else is null (an honest unavailable). */
function parseJsonArray(raw: string): unknown[] | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * The largest text/json body the reader will load into memory for one artifact (§9). The artifacts
 * route streams ranges above this cap; the results projection simply reports `too-large`.
 */
export const MAX_PREVIEW_BYTES = 1024 * 1024;

/** `fs.realPath` throws for a missing path; a missing path is simply not canonical. */
export function safeRealPath(fs: FileSystem, path: string): string | null {
    try {
        return fs.realPath?.(path) ?? path;
    } catch {
        return null;
    }
}

/**
 * The workspace-read core every Board projection shares (§9): a fixed, manifest-derived relative
 * path is resolved inside the workspace (never traversal), canonicalized twice around the read so
 * a symlink swapped in mid-flight is an escaping read rather than a hit, and text/json bodies are
 * bounded to {@link MAX_PREVIEW_BYTES} with a post-read size check that discards a file whose size
 * changed while it was being read. Ownership is the CALLER's re-verification, not this function's.
 */
export async function observeRelative(
    fs: FileSystem,
    workspacePath: string,
    relative: string,
    kind: ArtifactSpec['kind'],
): Promise<ArtifactObservation> {
    const target = resolveWithin(workspacePath, relative);
    if (target === null) return { state: 'absent' };
    const canonicalRoot = safeRealPath(fs, workspacePath);
    const canonical = safeRealPath(fs, target);
    // A symlink inside the workspace pointing outside it is an escaping read, never a hit.
    if (canonicalRoot === null || canonical === null) return { state: 'absent' };
    if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}/`)) return { state: 'absent' };
    // Re-resolve immediately before the read: a symlink swapped in since the check above is
    // still an escaping read, never a hit (§9 no-follow containment).
    if (safeRealPath(fs, target) !== canonical) return { state: 'absent' };
    if (!(await fs.exists(target))) return { state: 'absent' };
    const stat = await fs.stat(target);
    if (stat === null || !stat.isFile()) return { state: 'absent' };
    if (kind === 'text' || kind === 'json') {
        if (stat.size > MAX_PREVIEW_BYTES) return { state: 'too-large', bytes: stat.size };
        try {
            const text = await fs.readFile(target);
            // Enforce the cap on the bytes actually read: a file that changed size mid-read is
            // a swapped/partially-written artifact, never a clean hit.
            const after = await fs.stat(target);
            if (after === null || after.size !== stat.size) return { state: 'unreadable', bytes: stat.size };
            return { state: 'present', bytes: stat.size, text, path: canonical };
        } catch {
            return { state: 'unreadable', bytes: stat.size };
        }
    }
    return { state: 'present', bytes: stat.size, path: canonical };
}
