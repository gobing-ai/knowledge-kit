import type { BoardDiagnostic, BoardHealth, RunConfig, RunResults } from '../contracts';
import type { RunListPage } from './run-selection';

/**
 * The browser-side HTTP client for the reader and the same-origin Spur Board API.
 *
 * This module IS the browser's HTTP boundary: every outbound request the modules make
 * goes through it, which keeps the entry components free of fetch/polling logic and lets
 * 0255's Playwright suite drive supported fixtures. A `fetchImpl` may be injected so the
 * pure URL/validation rules are testable without a live server.
 */

/** Minimal fetch signature the client depends on (satisfied by the platform `fetch`). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** The documented default reader origin (design §4). */
export const DEFAULT_READER_ORIGIN = 'http://127.0.0.1:4340';

/** The two configured origins: the loopback reader and the exact Board origin. */
export interface BoardClientOptions {
    /** Reader origin, e.g. `http://127.0.0.1:4340`. Must be loopback http. */
    readerOrigin: string;
    /** Exact Board origin the reader is configured to accept. */
    boardOrigin: string;
    /** Injectable fetch (tests); defaults to the platform implementation. */
    fetchImpl?: FetchLike;
}

/** The reader/Board API surface the modules consume. */
export interface BoardClient {
    /** Reader identity; throws on an unavailable reader. */
    health(): Promise<BoardHealth>;
    /** One run's artifact-backed results projection. */
    results(workflow: string, runId: string): Promise<RunResults>;
    /** One run's captured-config projection. */
    config(workflow: string, runId: string): Promise<RunConfig>;
    /** The reader URL for one allowlisted artifact (used as a link/download target). */
    artifactUrl(workflow: string, runId: string, artifactId: string): string;
    /** The Spur run history page for a workflow (`/api/runs`). */
    runs(workflow: string, cursor?: string): Promise<RunListPage>;
    /** One run's detail, as the frozen §9 shape. */
    runDetail(runId: string): Promise<unknown>;
    /** One run's progress projection. */
    progress(runId: string): Promise<unknown>;
}

/**
 * Resolve the reader origin from a module's query string.
 *
 * A `kkApi` override is accepted only when it is a loopback http origin; anything else is refused
 * with a `board.reader.origin-invalid` diagnostic and the documented default is used (§4: never
 * accept non-loopback reader URLs — and never crash the module over a mistyped one).
 */
export function readerOriginFrom(search: string): { origin: string; diagnostic: BoardDiagnostic | null } {
    const override = new URLSearchParams(search).get('kkApi');
    if (override === null) return { origin: DEFAULT_READER_ORIGIN, diagnostic: null };
    if (isLoopbackHttpOrigin(override)) return { origin: override, diagnostic: null };
    return {
        origin: DEFAULT_READER_ORIGIN,
        diagnostic: {
            code: 'board.reader.origin-invalid',
            message: 'Ignored a non-loopback kkApi origin; using the default reader.',
        },
    };
}

/** True when `origin` is an http origin on a loopback host with no path, query or credentials. */
export function isLoopbackHttpOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:') return false;
    if (url.username !== '' || url.password !== '') return false;
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
}

/** Strip one trailing slash so path joins never double up. */
function origin(base: string): string {
    return base.replace(/\/+$/, '');
}

/**
 * Build the client. Both origins are validated up front: a non-loopback reader or a
 * malformed Board origin is a programming error, never a silent broken link.
 */
export function createBoardClient(options: BoardClientOptions): BoardClient {
    if (!isLoopbackHttpOrigin(options.readerOrigin)) {
        throw new Error(`reader origin must be loopback http, got '${options.readerOrigin}'`);
    }
    if (!isLoopbackHttpOrigin(options.boardOrigin)) {
        throw new Error(`board origin must be loopback http, got '${options.boardOrigin}'`);
    }
    const reader = origin(options.readerOrigin);
    const board = origin(options.boardOrigin);
    const doFetch: FetchLike = options.fetchImpl ?? fetch;

    async function getJson<T>(url: string): Promise<T> {
        const response = await doFetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`request failed (${response.status}): ${url}`);
        }
        return (await response.json()) as T;
    }

    return {
        health: () => getJson<BoardHealth>(`${reader}/api/health`),
        results: (workflow, runId) =>
            getJson<RunResults>(
                `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/results`,
            ),
        config: (workflow, runId) =>
            getJson<RunConfig>(
                `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/config`,
            ),
        artifactUrl: (workflow, runId, artifactId) =>
            `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        runs: (workflow, cursor) => {
            const params = new URLSearchParams({ workflow, limit: '25' });
            if (cursor !== undefined) params.set('cursor', cursor);
            return getJson<RunListPage>(`${board}/api/runs?${params.toString()}`);
        },
        runDetail: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}`),
        progress: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}/progress`),
    };
}
