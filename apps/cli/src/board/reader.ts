import type { BoardDiagnostic, RunCapture, RunConfig, RunResults, WorkflowName } from '@gobing-ai/kk-board/contracts';
import { ITEM_DECISION_IDS } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { captureRecordPath, markerPath, readCaptureRecord, readOwnerMarker } from './capture';
import { type ArtifactObservation, isTerminalStatus, projectCollectResults, type RunDetailSummary } from './collect';
import { type CollectStoreItemsQuery, storeItems, storeOverview, storeRun } from './collect-store';
import { dagProducerState, projectDailyResults } from './daily-voice';
import { itcResultSpecs, projectItcResults } from './itc';
import {
    type ArtifactSpec,
    allowlistedKeys,
    artifactById,
    artifactsFor,
    expandPattern,
    type MarkerState,
    type ProducerState,
    resolveAvailability,
    resolveWithin,
    WORKFLOW_NAMES,
} from './manifest';

/**
 * The read-only loopback Board reader.
 *
 * It is knowledge-kit's own HTTP boundary: it binds 127.0.0.1, accepts only the configured
 * exact Board origin, and answers only allowlisted run-bound artifacts. Project/run identity
 * is proven against the Board's public HTTP APIs — a browser assertion is never authorization.
 */

/** The default reader port (§4). */
export const DEFAULT_BOARD_PORT = 4340;

/** Text/JSON preview cap (§4): larger evidence is reported `oversized`, never truncated silently. */
export const MAX_PREVIEW_BYTES = 1024 * 1024;

/** Minimal fetch signature (satisfied by the platform `fetch`), injectable for tests. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Reader options. */
export interface BoardReaderOptions {
    /** The exact Board origin allowed to call the reader, e.g. `http://127.0.0.1:4310`. */
    boardOrigin: string;
    /** Loopback port; defaults to {@link DEFAULT_BOARD_PORT}. `0` binds any free port. */
    port?: number;
    /** Project root that owns `.works/.board`; defaults to the canonical cwd. */
    projectPath?: string;
    fs?: FileSystem;
    fetchImpl?: FetchLike;
}

/** A running reader. */
export interface BoardReader {
    /** The reader origin clients should call. */
    readonly url: string;
    readonly port: number;
    /** Stop the server (idempotent). */
    stop(): void;
}

/** True when `origin` is an http loopback origin with no path, query or credentials. */
export function isLoopbackOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:') return false;
    if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        return false;
    }
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

/** True when a `Host` header names a loopback address (DNS-rebinding guard). */
export function isLoopbackHost(host: string): boolean {
    const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/**
 * Parse one `Range: bytes=…` header against a known size.
 *
 * @returns `null` when there is no range, `'unsatisfiable'` for 416, else the inclusive slice.
 */
export function parseByteRange(
    header: string | null,
    size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
    if (header === null || header === '') return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (match === null) return 'unsatisfiable';
    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '') return 'unsatisfiable';
    if (rawStart === '') {
        const suffix = Number(rawEnd);
        if (suffix <= 0) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(rawStart);
    const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
    if (start >= size || end < start) return 'unsatisfiable';
    return { start, end };
}

/** One JSON HTTP answer. */
interface BoardResponse {
    status: number;
    body: unknown;
}

/** A run's identity is proven only by the Board's own `/api/project` and `/api/runs/<id>` answers. */
type Authorization =
    | { ok: true; record: RunCapture; detail: RunDetailSummary; diagnostics: BoardDiagnostic[] }
    | { ok: false; response: BoardResponse };

/** The capture-free half of {@link Authorization}: project ownership plus the run's own Board detail. */
type RunAuthorization =
    | { ok: true; detail: RunDetailSummary; diagnostics: BoardDiagnostic[] }
    | { ok: false; response: BoardResponse };

function stringField(value: unknown, key: string): string | null {
    if (typeof value !== 'object' || value === null) return null;
    const field = (value as Record<string, unknown>)[key];
    return typeof field === 'string' && field !== '' ? field : null;
}

/** `fs.realPath` throws for a missing path; a missing path is simply not canonical. */
function safeRealPath(fs: FileSystem, path: string): string | null {
    try {
        return fs.realPath?.(path) ?? path;
    } catch {
        return null;
    }
}

/** Read a detail/action field defensively from the versioned Board payload. */
function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/**
 * The producer state a state-machine progress payload records for one `actionKey`, resolved
 * across EVERY visit: `success` when any recorded attempt passed, `pending` while a retry is
 * running and none has passed, else `failure` (a same-run retry never hides its own success).
 */
export function producerStateFrom(progress: unknown, actionKey: string | undefined, node: string): ProducerState {
    if (actionKey === undefined) return 'unknown';
    const root = asRecord(progress);
    const states = root === null ? undefined : root.states;
    if (!Array.isArray(states)) return 'unknown';
    let matched = false;
    let running = false;
    for (const state of states) {
        const actions = asRecord(state)?.actions;
        if (!Array.isArray(actions)) continue;
        for (const action of actions) {
            const record = asRecord(action);
            if (record === null) continue;
            const key = stringField(record, 'actionKey') ?? stringField(record, 'id');
            if (key !== actionKey) continue;
            matched = true;
            const status = (stringField(record, 'status') ?? '').toLowerCase();
            if (status === 'passed') return 'success';
            if (status === 'pending' || status === 'running') running = true;
        }
    }
    void node;
    if (!matched) return 'unknown';
    return running ? 'pending' : 'failure';
}

/** The MIME type for an allowlisted artifact: a declared mime wins, the kind is the fallback. */
export function mimeFor(kind: ArtifactSpec['kind'], declared?: string): string {
    if (declared !== undefined && declared !== '') return declared;
    switch (kind) {
        case 'json':
            return 'application/json';
        case 'image':
            return 'image/png';
        case 'audio':
            return 'audio/mpeg';
        case 'text':
            return 'text/plain';
    }
}

/**
 * Create and start the reader. A bind collision or a non-loopback origin throws immediately
 * (fail loud) instead of silently serving on a surprising address.
 */
export function createBoardReader(options: BoardReaderOptions): BoardReader {
    if (!isLoopbackOrigin(options.boardOrigin)) {
        throw new Error(`--board-origin must be a loopback http origin, got '${options.boardOrigin}'`);
    }
    const port = options.port ?? DEFAULT_BOARD_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port must be an integer 0-65535, got '${port}'`);
    }
    const fs = options.fs ?? createNodeFileSystem();
    const doFetch: FetchLike = options.fetchImpl ?? fetch;
    const projectPath = options.projectPath ?? safeRealPath(fs, process.cwd()) ?? process.cwd();
    const boardOrigin = options.boardOrigin.replace(/\/+$/, '');

    async function boardGet(path: string): Promise<{ status: number; body: unknown } | null> {
        try {
            const response = await doFetch(`${boardOrigin}${path}`, { headers: { accept: 'application/json' } });
            if (!response.ok) return { status: response.status, body: null };
            return { status: response.status, body: await response.json() };
        } catch {
            return null;
        }
    }

    async function authorize(workflow: WorkflowName, runId: string): Promise<Authorization> {
        const record = await readCaptureRecord(fs, projectPath, runId);
        if (record === null) {
            // §9: a record that exists but does not parse is malformed stored evidence (422),
            // never "no captured run" (404).
            const present = await fs.exists(captureRecordPath(projectPath, runId));
            return {
                ok: false,
                response: present
                    ? {
                          status: 422,
                          body: { code: 'board.capture.invalid', message: `Captured run '${runId}' is malformed.` },
                      }
                    : {
                          status: 404,
                          body: { code: 'board.capture.missing', message: `No captured run '${runId}'.` },
                      },
            };
        }
        if (record.workflow !== workflow) {
            return {
                ok: false,
                response: {
                    status: 404,
                    body: { code: 'board.capture.missing', message: `No captured run '${runId}'.` },
                },
            };
        }
        const authorized = await authorizeRun(workflow, runId);
        if (!authorized.ok) return authorized;
        return { ok: true, record, detail: authorized.detail, diagnostics: authorized.diagnostics };
    }

    /**
     * The project + Spur run-detail half of {@link authorize}, WITHOUT a capture record: the Collect
     * store views serve runs that predate capture (design §3). Every refusal code is the shipped one.
     */
    async function authorizeRun(workflow: WorkflowName, runId: string): Promise<RunAuthorization> {
        const project = await boardGet('/api/project');
        if (project === null) {
            return {
                ok: false,
                response: {
                    status: 503,
                    body: { code: 'board.authority.unavailable', message: 'Board project API unavailable.' },
                },
            };
        }
        const boardPath = stringField(project.body, 'path');
        const canonicalBoardPath = boardPath === null ? null : safeRealPath(fs, boardPath);
        if (canonicalBoardPath === null || canonicalBoardPath !== projectPath) {
            return {
                ok: false,
                response: {
                    status: 403,
                    body: {
                        code: 'board.project.mismatch',
                        message: 'The Board project does not own this run record.',
                    },
                },
            };
        }
        const detail = await boardGet(`/api/runs/${encodeURIComponent(runId)}`);
        if (detail === null) {
            return {
                ok: false,
                response: {
                    status: 503,
                    body: { code: 'board.authority.unavailable', message: 'Board run API unavailable.' },
                },
            };
        }
        const run = asRecord(asRecord(detail.body)?.run);
        const detailId = run === null ? null : stringField(run, 'id');
        const detailWorkflow = run === null ? null : stringField(run, 'workflowName');
        if (run === null || detailId !== runId || detailWorkflow !== workflow) {
            return {
                ok: false,
                response: { status: 404, body: { code: 'board.run.unknown', message: `Board has no run '${runId}'.` } },
            };
        }
        return {
            ok: true,
            detail: {
                id: runId,
                workflowName: workflow,
                status: stringField(run, 'status') ?? 'unknown',
                startedAt: stringField(run, 'startedAt'),
                completedAt: stringField(run, 'completedAt'),
            },
            diagnostics: [],
        };
    }

    /** The workspace marker's relation to the selected run. */
    async function markerState(record: RunCapture): Promise<MarkerState> {
        const marker = await readOwnerMarker(fs, record.workspacePath);
        if (marker === null) {
            // §9: a marker that exists but does not parse is malformed evidence (`invalid`),
            // never simply `unverified`.
            return (await fs.exists(markerPath(record.workspacePath))) ? 'invalid' : 'absent';
        }
        return marker.runId === record.runId &&
            marker.projectPath === record.projectPath &&
            marker.workflow === record.workflow
            ? 'owned'
            : 'foreign';
    }

    /**
     * Read one artifact from its fixed manifest pattern (§9): canonical containment, a fresh
     * symlink re-resolution before the read, and a post-read stat that discards a file whose size
     * changed while it was being read. Ownership is re-verified by the callers before serialising.
     */
    async function observe(record: RunCapture, spec: ArtifactSpec): Promise<ArtifactObservation> {
        const relative = expandPattern(spec.pattern, record.stamp);
        const target = resolveWithin(record.workspacePath, relative);
        if (target === null) return { state: 'absent' };
        const canonicalRoot = safeRealPath(fs, record.workspacePath);
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
        if (spec.kind === 'text' || spec.kind === 'json') {
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

    /**
     * Producer evidence for every manifest artifact, read once per request.
     *
     * A state machine's producers come from the progress projection's recorded `actionKey`s. A DAG
     * (`kk-daily-ai-voice2`) has no state projection: its producers come from the run-detail action
     * rows keyed by node (§9 orphan-row fallback), and those rows are returned so the daily
     * projection can render node attempts and retry siblings.
     */
    async function producerEvidence(
        workflow: WorkflowName,
        runId: string,
        specs: readonly ArtifactSpec[] = artifactsFor(workflow),
    ): Promise<{
        states: Map<string, ProducerState>;
        diagnostics: BoardDiagnostic[];
        actions: unknown[];
        progress: unknown;
    }> {
        const states = new Map<string, ProducerState>();
        const actions: unknown[] = [];
        let progress: unknown = null;
        const stateSpecs = specs.filter((spec) => spec.producerActionKey !== undefined);
        if (stateSpecs.length > 0) {
            const response = await boardGet(`/api/runs/${encodeURIComponent(runId)}/progress`);
            if (response === null || response.status !== 200) {
                return {
                    states,
                    actions,
                    progress,
                    diagnostics: [
                        {
                            code: 'board.progress.unavailable',
                            message: 'Recorded producer evidence is unavailable; artifacts stay unverified.',
                        },
                    ],
                };
            }
            progress = response.body;
            for (const spec of stateSpecs) {
                states.set(
                    spec.producerActionKey ?? spec.producerNode,
                    producerStateFrom(response.body, spec.producerActionKey, spec.producerNode),
                );
            }
        }
        const nodeSpecs = specs.filter((spec) => spec.producerActionKey === undefined);
        if (nodeSpecs.length > 0) {
            const detail = await boardGet(`/api/runs/${encodeURIComponent(runId)}`);
            const list = detail === null ? undefined : asRecord(detail.body)?.actions;
            if (Array.isArray(list)) actions.push(...list);
            for (const spec of nodeSpecs) states.set(spec.producerNode, dagProducerState(actions, spec.producerNode));
        }
        return { states, diagnostics: [], actions, progress };
    }

    /** The captured publish plan's text, or undefined when it is absent/unavailable (ITC). */
    async function planTextOf(record: RunCapture, specs: readonly ArtifactSpec[]): Promise<string | undefined> {
        const planSpec = specs.find((spec) => spec.id === 'publish-plan');
        if (planSpec === undefined) return undefined;
        const observation = await observe(record, planSpec);
        return observation.state === 'present' ? observation.text : undefined;
    }

    async function resultsFor(workflow: WorkflowName, runId: string): Promise<BoardResponse> {
        const authorized = await authorize(workflow, runId);
        if (!authorized.ok) return authorized.response;
        const { record, detail } = authorized;
        const baseSpecs = artifactsFor(workflow);
        // §9: ITC target names are open-ended, so the run's own plan names the per-target result
        // files. Deriving them from the plan (never a client path) keeps the manifest fixed while
        // still exposing real publisher results.
        const resultSpecs = workflow === 'kk-itc' ? itcResultSpecs(await planTextOf(record, baseSpecs)) : [];
        const allSpecs = [...baseSpecs, ...resultSpecs.map((entry) => entry.spec)];
        const evidence = await producerEvidence(workflow, runId, allSpecs);
        const observations = new Map<string, ArtifactObservation>();
        for (const spec of allSpecs) {
            observations.set(spec.id, await observe(record, spec));
        }
        // §9: ownership is re-verified AFTER the bounded reads, so a workspace that changed owner
        // mid-read discards the observations instead of serving the successor's bytes.
        const marker = await markerState(record);
        const projection = {
            record,
            detail,
            marker,
            diagnostics: [...authorized.diagnostics, ...evidence.diagnostics],
            producerOf: (spec: ArtifactSpec) =>
                evidence.states.get(spec.producerActionKey ?? spec.producerNode) ?? 'unknown',
            observationOf: (spec: ArtifactSpec) => observations.get(spec.id),
        };
        // The DAG projection also consumes the run-detail action rows (node attempts + retries).
        let results: RunResults;
        if (workflow === 'kk-daily-ai-voice2') {
            results = projectDailyResults({ ...projection, actions: evidence.actions });
        } else if (workflow === 'kk-itc') {
            results = projectItcResults({ ...projection, resultSpecs, progress: evidence.progress });
        } else {
            results = projectCollectResults(projection);
        }
        return { status: 200, body: results };
    }

    async function configFor(workflow: WorkflowName, runId: string): Promise<BoardResponse> {
        const authorized = await authorize(workflow, runId);
        if (!authorized.ok) return authorized.response;
        const { record, detail } = authorized;
        void detail;
        const diagnostics: BoardDiagnostic[] = [...authorized.diagnostics];
        const config: RunConfig = {
            schemaVersion: 1,
            workflow,
            runId,
            capturedAt: record.capturedAt,
            settings: record.settings,
            unavailableKeys: allowlistedKeys(workflow).filter((key) => !(key in record.settings)),
            ...(record.definitionDigest === undefined ? {} : { definitionDigest: record.definitionDigest }),
            diagnostics,
        };
        return { status: 200, body: config };
    }

    async function artifactFor(
        workflow: WorkflowName,
        runId: string,
        artifactId: string,
        rangeHeader: string | null,
    ): Promise<BoardResponse> {
        const spec = artifactById(workflow, artifactId);
        if (spec === undefined) {
            return {
                status: 404,
                body: { code: 'board.artifact.unknown', message: `Unknown artifact '${artifactId}'.` },
            };
        }
        const authorized = await authorize(workflow, runId);
        if (!authorized.ok) return authorized.response;
        const { record, detail } = authorized;
        const evidence = await producerEvidence(workflow, runId);
        const markerBefore = await markerState(record);
        const observed = await observe(record, spec);
        const availability = resolveAvailability(
            markerBefore,
            evidence.states.get(spec.producerActionKey ?? spec.producerNode) ?? 'unknown',
            observed.state,
            isTerminalStatus(detail.status),
        );
        if (availability !== 'available') {
            if (availability === 'invalid') {
                return {
                    status: 422,
                    body: { code: 'board.artifact.invalid', message: `Artifact '${artifactId}' is malformed.` },
                };
            }
            return {
                status: 404,
                body: { code: 'board.artifact.unavailable', message: `Artifact '${artifactId}' is not available.` },
            };
        }
        const size = observed.bytes ?? 0;
        const range = parseByteRange(rangeHeader, size);
        if (range === 'unsatisfiable') {
            return {
                status: 416,
                body: { code: 'board.artifact.range', message: 'Requested range is not satisfiable.' },
            };
        }
        // §9 / 0252 P2: the bytes are read HERE, before the ownership re-check below, so a marker
        // swap during the fetch discards them. A ranged media request reads only its slice — the whole
        // file is never loaded for a preview. Text is already read inside `observe`.
        const content = await artifactContent(spec.kind, observed, range, size);
        // §9: re-verify ownership AFTER the bounded read, immediately before serialising. A marker
        // written mid-read discards the observation instead of serving the superseded run's bytes.
        if ((await markerState(record)) !== markerBefore) {
            return {
                status: 404,
                body: {
                    code: 'board.artifact.owner-changed',
                    message: `Artifact '${artifactId}' ownership changed during the read.`,
                },
            };
        }
        return {
            status: range === null ? 200 : 206,
            body: {
                __binary: true,
                mime: mimeFor(spec.kind, spec.mime),
                text: content,
                bytes: size,
                range,
            },
        };
    }

    /**
     * The three Collect store views (G81): read-only projections of `.works/kk.db`. They are the
     * ONLY routes that take query parameters, and only the ones their design declares.
     */
    async function storeOverviewFor(runIds: readonly string[]): Promise<BoardResponse> {
        return { status: 200, body: await storeOverview({ projectPath, fs }, runIds) };
    }

    async function storeRunFor(runId: string): Promise<BoardResponse> {
        return { status: 200, body: await storeRun({ projectPath, fs }, runId) };
    }

    async function storeItemsFor(runId: string, query: CollectStoreItemsQuery): Promise<BoardResponse> {
        const items = await storeItems({ projectPath, fs }, runId, query);
        // A source outside the store's own values is a bad request, never an empty page (§3).
        if (items === null) {
            return {
                status: 400,
                body: { code: 'board.query.invalid', message: "`source` is not one of this store's item sources." },
            };
        }
        return { status: 200, body: items };
    }

    const server = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch: async (request) => {
            const cors: Record<string, string> = {
                'access-control-allow-origin': boardOrigin,
                'access-control-allow-methods': 'GET, HEAD, OPTIONS',
                'access-control-allow-headers': 'range, content-type',
                vary: 'origin',
            };
            const origin = request.headers.get('origin');
            if (origin !== null && origin !== boardOrigin) {
                return jsonResponse(
                    { code: 'board.origin.refused', message: 'Origin is not the configured Board.' },
                    403,
                    cors,
                );
            }
            if (!isLoopbackHost(request.headers.get('host') ?? '')) {
                return jsonResponse({ code: 'board.host.refused', message: 'Host must be loopback.' }, 403, cors);
            }
            if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                return jsonResponse({ code: 'board.method.refused', message: 'Only GET/HEAD/OPTIONS.' }, 405, cors);
            }
            const url = new URL(request.url);
            const path = url.pathname;
            if (path === '/api/health') {
                return jsonResponse({ schemaVersion: 1, projectPath }, 200, cors);
            }
            const overviewMatch = /^\/api\/workflows\/([^/]+)\/store\/overview$/.exec(path);
            const runStoreMatch = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/store$/.exec(path);
            const runStoreItemsMatch = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/store\/items$/.exec(path);
            const storeMatch = overviewMatch ?? runStoreMatch ?? runStoreItemsMatch;
            if (storeMatch !== null) {
                const storeRaw = storeMatch[1] ?? '';
                // Store views exist for kk-collect only: another workflow is an unknown route, not
                // a bad identity (§3).
                if (decodeURIComponent(storeRaw) !== STORE_WORKFLOW) {
                    return jsonResponse({ code: 'board.route.unknown', message: 'Unknown reader route.' }, 404, cors);
                }
                if (overviewMatch !== null) {
                    const runs = parseRunsQuery(url.searchParams);
                    if ('response' in runs) return jsonResponse(runs.response.body, runs.response.status, cors);
                    const response = await storeOverviewFor(runs.runIds);
                    return jsonResponse(response.body, response.status, cors);
                }
                if (runStoreMatch !== null) {
                    // §3 declares "Query: none" here: this route refuses every parameter, exactly
                    // like the shipped ones (review 0307 P3).
                    const refused = parseQuery(url.searchParams);
                    if (refused !== null) return jsonResponse(refused.body, refused.status, cors);
                }
                const identified = identify(storeRaw, storeMatch[2] ?? '');
                if ('response' in identified)
                    return jsonResponse(identified.response.body, identified.response.status, cors);
                const query = runStoreItemsMatch === null ? null : parseItemsQuery(url.searchParams);
                if (query !== null && 'response' in query)
                    return jsonResponse(query.response.body, query.response.status, cors);
                const authorized = await authorizeRun(identified.workflow, identified.runId);
                if (!authorized.ok) return jsonResponse(authorized.response.body, authorized.response.status, cors);
                const response =
                    query === null
                        ? await storeRunFor(identified.runId)
                        : await storeItemsFor(identified.runId, query.query);
                return jsonResponse(response.body, response.status, cors);
            }
            const match = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/(results|config)$/.exec(path);
            const artifactMatch = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/artifacts\/([^/]+)$/.exec(path);
            // Query parsing moved AFTER matching: only the store routes declare parameters, every
            // shipped route keeps refusing them (§3 / R8).
            const query = parseQuery(url.searchParams);
            if (query !== null) return jsonResponse(query.body, query.status, cors);
            if (match !== null) {
                const [, workflow, runId, verb] = match;
                const identified = identify(workflow ?? '', runId ?? '');
                if ('response' in identified)
                    return jsonResponse(identified.response.body, identified.response.status, cors);
                const response =
                    verb === 'results'
                        ? await resultsFor(identified.workflow, identified.runId)
                        : await configFor(identified.workflow, identified.runId);
                return jsonResponse(response.body, response.status, cors);
            }
            if (artifactMatch !== null) {
                const [, workflow, runId, artifactId] = artifactMatch;
                const identified = identify(workflow ?? '', runId ?? '');
                if ('response' in identified)
                    return jsonResponse(identified.response.body, identified.response.status, cors);
                const response = await artifactFor(
                    identified.workflow,
                    identified.runId,
                    decodeURIComponent(artifactId ?? ''),
                    request.headers.get('range'),
                );
                return artifactResponse(response, cors);
            }
            return jsonResponse({ code: 'board.route.unknown', message: 'Unknown reader route.' }, 404, cors);
        },
    });

    const boundPort = server.port ?? port;
    const readerUrl = `http://127.0.0.1:${boundPort}`;
    return { url: readerUrl, port: boundPort, stop: () => void server.stop(true) };
}

/** The one workflow whose store views this reader serves (design §3). */
const STORE_WORKFLOW: WorkflowName = 'kk-collect';

/** The reader's run-id rule: one safe segment (never a path). */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** `?runs=` accepts at most this many ids per request (design §3). */
export const MAX_OVERVIEW_RUNS = 25;

/** The label-value domain the `decision`+`value` filter accepts. */
const LABEL_VALUE_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** The `selection` filter's domain (`none` = the item has no selection row). */
const SELECTION_FILTERS = ['selected', 'published', 'dropped', 'none'] as const;

/** The `page`/`source`/… keys `…/store/items` declares; anything else is a bad request. */
const ITEMS_QUERY_KEYS = new Set(['page', 'source', 'seen', 'decision', 'value', 'selection']);

/** A bounded 400 for a malformed store query: the offending value is never echoed. */
function invalidQuery(message: string): BoardResponse {
    return { status: 400, body: { code: 'board.query.invalid', message } };
}

/**
 * `?runs=<id>,…` for the overview route: 1–25 safe run ids, deduplicated. The ids only select
 * rows — they are never proof of anything (no Spur call, no Board call).
 */
export function parseRunsQuery(params: URLSearchParams): { runIds: string[] } | { response: BoardResponse } {
    for (const key of params.keys()) {
        if (key !== 'runs') return { response: invalidQuery('This route accepts only a `runs` parameter.') };
    }
    const raw = params.get('runs');
    if (raw === null || raw === '') return { response: invalidQuery('`runs` is required.') };
    const ids = raw.split(',');
    if (ids.length > MAX_OVERVIEW_RUNS) {
        return { response: invalidQuery(`At most ${MAX_OVERVIEW_RUNS} run ids are accepted.`) };
    }
    for (const id of ids) {
        if (!RUN_ID_PATTERN.test(id))
            return { response: invalidQuery('`runs` must be a comma-separated run id list.') };
    }
    return { runIds: [...new Set(ids)] };
}

/**
 * The `…/store/items` query: syntactically validated here, with `source` checked against the
 * store's own values downstream (that domain is data, not syntax).
 */
export function parseItemsQuery(
    params: URLSearchParams,
): { query: CollectStoreItemsQuery } | { response: BoardResponse } {
    for (const key of params.keys()) {
        if (!ITEMS_QUERY_KEYS.has(key)) return { response: invalidQuery('Unknown query parameter.') };
    }
    const rawPage = params.get('page');
    const page = rawPage === null ? 1 : Number(rawPage);
    if (rawPage !== null && (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1)) {
        return { response: invalidQuery('`page` must be an integer of at least 1.') };
    }
    const source = params.get('source');
    if (source !== null && (source === '' || source.length > 128)) {
        return { response: invalidQuery('`source` must be a short non-empty value.') };
    }
    const seen = params.get('seen');
    if (seen !== null && seen !== 'new' && seen !== 'reseen') {
        return { response: invalidQuery('`seen` must be `new` or `reseen`.') };
    }
    const decision = params.get('decision');
    if (decision !== null && !(ITEM_DECISION_IDS as readonly string[]).includes(decision)) {
        return { response: invalidQuery('`decision` is not a known decision id.') };
    }
    const value = params.get('value');
    // A decision without its value (or the reverse) would filter on a half-known label: refuse.
    if ((decision === null) !== (value === null)) {
        return { response: invalidQuery('`decision` and `value` are accepted together or not at all.') };
    }
    if (value !== null && !LABEL_VALUE_PATTERN.test(value)) {
        return { response: invalidQuery('`value` must match [A-Za-z0-9._-]{1,64}.') };
    }
    const selection = params.get('selection');
    if (selection !== null && !(SELECTION_FILTERS as readonly string[]).includes(selection)) {
        return { response: invalidQuery('`selection` must be selected, published, dropped or none.') };
    }
    return {
        query: {
            page,
            ...(source === null ? {} : { source }),
            ...(seen === null ? {} : { seen }),
            ...(decision === null ? {} : { decision }),
            ...(value === null ? {} : { value }),
            ...(selection === null ? {} : { selection: selection as (typeof SELECTION_FILTERS)[number] }),
        },
    };
}

/** Reject unknown query parameters: a reader route takes none (§9). */
function parseQuery(params: URLSearchParams): BoardResponse | null {
    if (params.size === 0) return null;
    return {
        status: 400,
        body: { code: 'board.query.invalid', message: 'This reader route accepts no query parameters.' },
    };
}

/** Validate the workflow/run path identity before any filesystem or Board work. */
function identify(
    rawWorkflow: string,
    rawRunId: string,
): { workflow: WorkflowName; runId: string } | { response: BoardResponse } {
    const workflow = decodeURIComponent(rawWorkflow);
    const runId = decodeURIComponent(rawRunId);
    if (!WORKFLOW_NAMES.includes(workflow as WorkflowName)) {
        return {
            response: {
                status: 400,
                body: { code: 'board.workflow.unknown', message: `Unknown workflow '${workflow}'.` },
            },
        };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) || runId === '.' || runId === '..') {
        return {
            response: {
                status: 400,
                body: { code: 'board.run.invalid', message: 'Run id must be a single safe segment.' },
            },
        };
    }
    return { workflow: workflow as WorkflowName, runId };
}

/** A JSON answer with the CORS headers the browser needs. */
function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
    });
}

/**
 * The bytes to serve for one artifact: decoded text for a text/json preview, a REAL byte slice
 * for image/audio media (never `String(bytes)`). `Content-Range`/`Content-Length` are then
 * computed from these bytes, so a media response never promises bytes it does not send.
 */
export async function artifactContent(
    kind: ArtifactSpec['kind'],
    observed: ArtifactObservation,
    range: { start: number; end: number } | null,
    size: number,
): Promise<string | Uint8Array> {
    if (kind === 'text' || kind === 'json') {
        const text = observed.text ?? '';
        if (range === null) return text;
        const path = observed.path;
        // No file to cut (an in-memory observation): fall back to the character slice rather than
        // failing — a real observation always carries its path, and `observe` only fills `text` for a
        // file it read.
        if (path === undefined) return text.slice(range.start, range.end + 1);
        // `Content-Range` is BYTE-based, so a ranged text preview is cut from the raw bytes and then
        // decoded: slicing the JS string would cut by UTF-16 code unit and disagree with the header
        // for multi-byte content (the shipped core-facts markdown is CJK).
        return new TextDecoder().decode(
            new Uint8Array(
                await Bun.file(path)
                    .slice(range.start, range.end + 1)
                    .arrayBuffer(),
            ),
        );
    }
    const start = range?.start ?? 0;
    const end = (range?.end ?? size - 1) + 1;
    return new Uint8Array(
        await Bun.file(observed.path ?? '')
            .slice(start, end)
            .arrayBuffer(),
    );
}

/** An artifact answer: JSON diagnostics stay JSON, content goes out with its MIME and attachment name. */
export function artifactResponse(response: { status: number; body: unknown }, cors: Record<string, string>): Response {
    const body = asRecord(response.body);
    if (response.status !== 200 && response.status !== 206) {
        return jsonResponse(response.body, response.status, cors);
    }
    if (body === null || body.__binary !== true) {
        return jsonResponse(response.body, response.status, cors);
    }
    const headers: Record<string, string> = {
        'content-type': String(body.mime),
        'content-disposition': 'attachment',
        ...cors,
    };
    const range = asRecord(body.range);
    if (range !== null) {
        headers['content-range'] = `bytes ${range.start}-${range.end}/${body.bytes}`;
    }
    const payload = body.text;
    if (payload instanceof Uint8Array) {
        headers['content-length'] = String(payload.byteLength);
        return new Response(payload, { status: response.status, headers });
    }
    return new Response(String(payload), { status: response.status, headers });
}
