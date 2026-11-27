import type {
    BoardHealth,
    CollectChannelYield,
    CollectRunStore,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    DailyDigest,
    DayArtifactDocument,
    DaySummary,
    RunConfig,
    RunEvidence,
    RunResults,
    StoreChannelsQuery,
} from '../contracts';
import type { RunListPage } from './run-selection';

/**
 * The browser-side HTTP client for KK module routes and the Spur run API.
 *
 * This module IS the browser's HTTP boundary: every outbound request the modules make
 * goes through it, which keeps the entry components free of fetch/polling logic and lets
 * 0255's Playwright suite drive supported fixtures. A `fetchImpl` may be injected so the
 * pure URL/validation rules are testable without a live server.
 */

/** Minimal fetch signature the client depends on (satisfied by the platform `fetch`). */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** The most run ids the overview route accepts in one request (`runs=` 1–25, design §3). */
export const MAX_OVERVIEW_RUNS = 25;

/** The filter names the Items panel renders, one per items-route parameter. */
export type StoreItemFilterName = 'source' | 'seen' | 'decision' | 'value' | 'selection' | 'search';

/** The filters the Items tab sends to the run's items route (design §3). */
export interface StoreItemsQuery {
    page?: number;
    source?: string;
    seen?: 'new' | 'reseen';
    decision?: string;
    value?: string;
    selection?: 'selected' | 'published' | 'dropped' | 'none';
    search?: string;
}

/**
 * The items route's query string: every declared filter and nothing else, so a half-set
 * decision/value pair (which the reader refuses) is never sent by accident.
 */
export function storeItemsQueryString(query: StoreItemsQuery): string {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.source !== undefined) params.set('source', query.source);
    if (query.seen !== undefined) params.set('seen', query.seen);
    if (query.decision !== undefined && query.value !== undefined) {
        params.set('decision', query.decision);
        params.set('value', query.value);
    }
    if (query.selection !== undefined) params.set('selection', query.selection);
    if (query.search !== undefined && query.search.trim() !== '') {
        params.set('search', query.search.trim());
    }
    return params.toString();
}

/** The filters for the selections route. */
export interface StoreSelectionsQuery {
    page?: number;
    topic?: string;
    status?: 'selected' | 'published' | 'dropped';
    runId?: string;
    search?: string;
}

/** The selections route's query string. */
export function storeSelectionsQueryString(query: StoreSelectionsQuery): string {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.topic !== undefined && query.topic !== '') params.set('topic', query.topic);
    if (query.status !== undefined) params.set('status', query.status);
    if (query.runId !== undefined && query.runId !== '') params.set('runId', query.runId);
    if (query.search !== undefined && query.search.trim() !== '') {
        params.set('search', query.search.trim());
    }
    return params.toString();
}

/** The channels route's query string: `from`/`until`/`page` are always present (0319). */
export function storeChannelsQueryString(query: StoreChannelsQuery): string {
    const params = new URLSearchParams({
        from: String(query.fromMs),
        until: String(query.untilMs),
        page: String(query.page),
    });
    return params.toString();
}

/** The module identity and browser location used to address the project server. */
export interface BoardClientOptions {
    moduleId: string;
    boardOrigin: string;
    pathname?: string;
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
    /**
     * One run's evidence envelope (0391): capture identity, authorized Spur run state and the
     * workflow projection. Answers even for uncaptured attempts (`capture`/`results` then null).
     */
    evidence(workflow: string, runId: string): Promise<RunEvidence>;
    /** One day's digest (G83): the day-centric console's single read for Today. */
    day(day: string): Promise<DailyDigest>;
    /** The bounded day list (G83) behind the History view. */
    days(from: string, until: string): Promise<DaySummary[]>;
    /**
     * One editable draft of a day (G84/0445): its current bytes, the sha the plane expects, and both
     * argv recipes computed server-side. Read-only — the write is `action('edit-artifact', …)`.
     */
    dayArtifact(day: string, artifact: string): Promise<DayArtifactDocument>;
    /**
     * The guarded action plane (G83/0442): one POST to `/api/actions/<kind>`. A preview omits the
     * token; an execute presents it. The reader refuses everything unless `board.actions.enabled`.
     */
    action(kind: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
    /** The reader URL for one allowlisted artifact (used as a link/download target). */
    artifactUrl(workflow: string, runId: string, artifactId: string): string;
    /** The Spur run history page for a workflow (`/api/runs`). */
    runs(workflow: string, cursor?: string): Promise<RunListPage>;
    /** One run's detail, as the frozen §9 shape. */
    runDetail(runId: string): Promise<unknown>;
    /** One run's progress projection. */
    progress(runId: string): Promise<unknown>;
    /** The Collect store overview for up to {@link MAX_OVERVIEW_RUNS} Spur run ids. */
    storeOverview(runIds: readonly string[]): Promise<CollectStoreOverview>;
    /** One run's stored facts and label quality. */
    storeRun(runId: string): Promise<CollectRunStore>;
    /** One page of items, filtered (optionally scoped to a runId). */
    storeItems(runId?: string, query?: StoreItemsQuery): Promise<CollectStoreItems>;
    /** One page of selections, filtered. */
    storeSelections(query?: StoreSelectionsQuery): Promise<CollectStoreSelections>;
    /** The 30-day channel-yield + plugin-count aggregate (always the loopback aggregate reader). */
    storeChannels(query: StoreChannelsQuery): Promise<CollectChannelYield>;
}

/**
 * True when `origin` is a well-formed http(s) origin with no path, query or credentials.
 *
 * The Board origin is never operator input — every module passes `window.location.origin` — and the
 * browser enforces same-origin on the requests it carries. A Board served on a LAN address
 * (`spur self serve --host 0.0.0.0`, or behind a TLS proxy) is therefore usable; only a malformed value
 * is refused.
 */
export function isHttpOrigin(origin: string): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username !== '' || url.password !== '') return false;
    return url.pathname === '/' && url.search === '' && url.hash === '';
}

/** The gateway prefix before the Board route, empty for a standalone project server. */
export function boardBasePath(pathname: string): string {
    const board = pathname.indexOf('/board/');
    return board === -1 ? '' : pathname.slice(0, board);
}

/** Build a same-origin client for the module and its project's Spur run API. */
export function createBoardClient(options: BoardClientOptions): BoardClient {
    if (!isHttpOrigin(options.boardOrigin)) {
        throw new Error(`board origin must be an http origin, got '${options.boardOrigin}'`);
    }
    const board = new URL(options.boardOrigin).origin + boardBasePath(options.pathname ?? '');
    const moduleApi = `${board}/api/modules/${encodeURIComponent(options.moduleId)}`;
    const doFetch: FetchLike = options.fetchImpl ?? fetch;

    async function getJson<T>(url: string): Promise<T> {
        const response = await doFetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`request failed (${response.status}): ${url}`);
        }
        return (await response.json()) as T;
    }

    return {
        health: () => getJson<BoardHealth>(`${moduleApi}/api/health`),
        results: (workflow, runId) =>
            getJson<RunResults>(
                `${moduleApi}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/results`,
            ),
        config: (workflow, runId) =>
            getJson<RunConfig>(
                `${moduleApi}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/config`,
            ),
        artifactUrl: (workflow, runId, artifactId) =>
            `${moduleApi}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        runs: (workflow, cursor) => {
            const params = new URLSearchParams({ workflow, limit: '25' });
            if (cursor !== undefined) params.set('cursor', cursor);
            return getJson<RunListPage>(`${board}/api/runs?${params.toString()}`);
        },
        storeOverview: (runIds) => {
            const params = new URLSearchParams({ runs: runIds.slice(0, MAX_OVERVIEW_RUNS).join(',') });
            return getJson<CollectStoreOverview>(
                `${moduleApi}/api/workflows/kk-collect/store/overview?${params.toString()}`,
            );
        },
        storeRun: (runId) =>
            getJson<CollectRunStore>(`${moduleApi}/api/workflows/kk-collect/runs/${encodeURIComponent(runId)}/store`),
        storeItems: (runId, query = {}) => {
            const qs = storeItemsQueryString(query);
            const path =
                runId !== undefined && runId.trim() !== ''
                    ? `${moduleApi}/api/workflows/kk-collect/runs/${encodeURIComponent(runId)}/store/items?${qs}`
                    : `${moduleApi}/api/workflows/kk-collect/store/items?${qs}`;
            return getJson<CollectStoreItems>(path);
        },
        storeSelections: (query = {}) =>
            getJson<CollectStoreSelections>(
                `${moduleApi}/api/workflows/kk-collect/store/selections?${storeSelectionsQueryString(query)}`,
            ),
        storeChannels: (query) =>
            getJson<CollectChannelYield>(
                `${moduleApi}/api/workflows/kk-collect/store/channels?${storeChannelsQueryString(query)}`,
            ),
        runDetail: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}`),
        evidence: (workflow, runId) =>
            getJson<RunEvidence>(
                `${moduleApi}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/evidence`,
            ),
        day: (day) => getJson<DailyDigest>(`${moduleApi}/api/days/${encodeURIComponent(day)}`),
        dayArtifact: (day, artifact) =>
            getJson<DayArtifactDocument>(
                `${moduleApi}/api/days/${encodeURIComponent(day)}/artifacts/${encodeURIComponent(artifact)}`,
            ),
        days: (from, until) =>
            getJson<DaySummary[]>(
                `${moduleApi}/api/days?from=${encodeURIComponent(from)}&until=${encodeURIComponent(until)}`,
            ),
        action: async (kind, body) => {
            const response = await doFetch(`${moduleApi}/api/actions/${encodeURIComponent(kind)}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-kk-action': '1' },
                body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
        },
        progress: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}/progress`),
    };
}
