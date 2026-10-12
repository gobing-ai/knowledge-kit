import type { BoardDiagnostic, RunCapture, RunConfig, RunResults, WorkflowName } from '@gobing-ai/kk-board/contracts';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { captureRecordPath, markerPath, readCaptureRecord, readOwnerMarker } from './capture';
import { type ArtifactObservation, projectCollectResults, type RunDetailSummary } from './collect';
import {
    type ArtifactSpec,
    allowlistedKeys,
    artifactById,
    artifactsFor,
    expandPattern,
    type MarkerState,
    type ProducerState,
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
        if (canonicalBoardPath === null || canonicalBoardPath !== record.projectPath) {
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
        const diagnostics: BoardDiagnostic[] = [];
        return {
            ok: true,
            record,
            detail: {
                id: runId,
                workflowName: workflow,
                status: stringField(run, 'status') ?? 'unknown',
                startedAt: stringField(run, 'startedAt'),
                completedAt: stringField(run, 'completedAt'),
            },
            diagnostics,
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

    /** Producer evidence for every manifest artifact, read once per request from the run's progress. */
    async function producerEvidence(
        workflow: WorkflowName,
        runId: string,
    ): Promise<{ states: Map<string, ProducerState>; diagnostics: BoardDiagnostic[] }> {
        const states = new Map<string, ProducerState>();
        const specs = artifactsFor(workflow);
        const response = await boardGet(`/api/runs/${encodeURIComponent(runId)}/progress`);
        if (response === null || response.status !== 200) {
            return {
                states,
                diagnostics: [
                    {
                        code: 'board.progress.unavailable',
                        message: 'Recorded producer evidence is unavailable; artifacts stay unverified.',
                    },
                ],
            };
        }
        for (const spec of specs) {
            states.set(
                spec.producerActionKey ?? spec.producerNode,
                producerStateFrom(response.body, spec.producerActionKey, spec.producerNode),
            );
        }
        return { states, diagnostics: [] };
    }

    async function resultsFor(workflow: WorkflowName, runId: string): Promise<BoardResponse> {
        const authorized = await authorize(workflow, runId);
        if (!authorized.ok) return authorized.response;
        const { record, detail } = authorized;
        const evidence = await producerEvidence(workflow, runId);
        const observations = new Map<string, ArtifactObservation>();
        for (const spec of artifactsFor(workflow)) {
            observations.set(spec.id, await observe(record, spec));
        }
        // §9: ownership is re-verified AFTER the bounded reads, so a workspace that changed owner
        // mid-read discards the observations instead of serving the successor's bytes.
        const marker = await markerState(record);
        const results: RunResults = projectCollectResults({
            record,
            detail,
            marker,
            diagnostics: [...authorized.diagnostics, ...evidence.diagnostics],
            producerOf: (spec) => evidence.states.get(spec.producerActionKey ?? spec.producerNode) ?? 'unknown',
            observationOf: (spec) => observations.get(spec.id),
        });
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
        const marker = markerBefore;
        const state = projectCollectResults({
            record,
            detail,
            marker,
            diagnostics: evidence.diagnostics,
            producerOf: (candidate) =>
                evidence.states.get(candidate.producerActionKey ?? candidate.producerNode) ?? 'unknown',
            observationOf: (candidate) => (candidate.id === spec.id ? observed : undefined),
        });
        const descriptor = state.artifacts.find((artifact) => artifact.id === spec.id);
        if (descriptor === undefined || descriptor.availability !== 'available') {
            if (descriptor?.availability === 'invalid') {
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
        const content = await artifactContent(spec.kind, observed, range, size);
        return {
            status: range === null ? 200 : 206,
            body: {
                __binary: true,
                mime: mimeFor(spec.kind, descriptor.mime),
                text: content,
                bytes: size,
                range,
            },
        };
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
            const match = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/(results|config)$/.exec(path);
            const artifactMatch = /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/artifacts\/([^/]+)$/.exec(path);
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
