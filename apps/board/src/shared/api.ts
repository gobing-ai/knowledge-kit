import type {
    BoardDiagnostic,
    BoardHealth,
    CollectChannelYield,
    CollectItemLabelDetail,
    CollectRunStore,
    CollectRunStoreRow,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelection,
    CollectStoreSelections,
    RunConfig,
    RunEvidence,
    RunResults,
    StoreChannelsQuery,
    WorkflowName,
} from '../contracts';
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

/** The documented default reader origin (design §4). */
export const DEFAULT_READER_ORIGIN = 'http://127.0.0.1:4340';

/** The two configured origins: the loopback reader and the exact Board origin. */
export interface BoardClientOptions {
    /** Reader origin, e.g. `http://127.0.0.1:4340`. Must be loopback http. */
    readerOrigin: string;
    /** Exact Board origin the reader is configured to accept. */
    boardOrigin: string;
    /**
     * The loopback reader origin the Collect channel-yield aggregate always targets (0319), even in
     * native mode. Defaults to {@link DEFAULT_READER_ORIGIN}; must be loopback http.
     */
    aggregateReaderOrigin?: string;
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
 * Resolve the reader origin from a module's query string.
 *
 * A `kkApi` override is accepted only when it is a loopback http origin; anything else is refused
 * with a `board.reader.origin-invalid` diagnostic and the default origin is used.
 */
export function readerOriginFrom(
    search: string,
    defaultOrigin: string = DEFAULT_READER_ORIGIN,
): { origin: string; diagnostic: BoardDiagnostic | null } {
    const override = new URLSearchParams(search).get('kkApi');
    if (override === null) return { origin: defaultOrigin, diagnostic: null };
    if (isLoopbackHttpOrigin(override)) return { origin: override, diagnostic: null };
    return {
        origin: defaultOrigin,
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

/** Strip one trailing slash so path joins never double up. */
function origin(base: string): string {
    return base.replace(/\/+$/, '');
}

/** Spur Board database table page response format. */
interface SpurDbPage {
    page: number;
    pageSize: number;
    total: number;
    columns: string[];
    rows: Array<Array<{ t: string; v?: unknown }>>;
}

/** Convert Spur database row cells into a key-value object array. */
function parseSpurDbRows<T = Record<string, unknown>>(pageData: SpurDbPage): T[] {
    const { columns, rows } = pageData;
    if (!columns || !rows) return [];
    return rows.map((rowCells) => {
        const rowObj: Record<string, unknown> = {};
        columns.forEach((col, idx) => {
            const cell = rowCells[idx];
            if (!cell || cell.t === 'null') {
                rowObj[col] = null;
            } else if (cell.t === 'num' || cell.t === 'text') {
                rowObj[col] = cell.v;
            } else {
                rowObj[col] = null;
            }
        });
        return rowObj as T;
    });
}

/**
 * Build the client. Both origins are validated up front: a malformed Board origin, or a
 * cross-origin reader that is not loopback, is a programming error, never a silent broken link.
 *
 * Native mode (reader origin == Board origin) is exempt from the loopback rule: the Board itself may
 * be served on a LAN address, where a loopback reader origin would name the *client's* machine.
 */
export function createBoardClient(options: BoardClientOptions): BoardClient {
    const reader = origin(options.readerOrigin);
    const board = origin(options.boardOrigin);
    const isNativeSpur = reader === board;
    if (!isHttpOrigin(options.boardOrigin)) {
        throw new Error(`board origin must be an http origin, got '${options.boardOrigin}'`);
    }
    if (!isNativeSpur && !isLoopbackHttpOrigin(options.readerOrigin)) {
        throw new Error(`reader origin must be loopback http, got '${options.readerOrigin}'`);
    }
    const aggregateReader = origin(options.aggregateReaderOrigin ?? DEFAULT_READER_ORIGIN);
    if (!isLoopbackHttpOrigin(options.aggregateReaderOrigin ?? DEFAULT_READER_ORIGIN)) {
        throw new Error(`aggregate reader origin must be loopback http, got '${options.aggregateReaderOrigin}'`);
    }
    const doFetch: FetchLike = options.fetchImpl ?? fetch;

    async function getJson<T>(url: string): Promise<T> {
        const response = await doFetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`request failed (${response.status}): ${url}`);
        }
        return (await response.json()) as T;
    }

    async function nativeStoreOverview(runIds: readonly string[]): Promise<CollectStoreOverview> {
        try {
            const pageData = await getJson<SpurDbPage>(
                `${board}/api/project/database/tables/collect_runs/rows?pageSize=100&sort=started_at&dir=desc`,
            );
            const dbRows = parseSpurDbRows<{
                run_id: string;
                started_at?: number;
                finished_at?: number;
                status?: string;
                source_counts_json?: string;
                inserted?: number;
                updated?: number;
            }>(pageData);
            const byId = new Map<string, CollectRunStoreRow>();
            let maxFinishedAt = 0;

            for (const row of dbRows) {
                let sourceCounts: Record<string, number> = {};
                try {
                    if (row.source_counts_json) {
                        const parsed = JSON.parse(row.source_counts_json);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            sourceCounts = parsed;
                        }
                    }
                } catch {
                    sourceCounts = {};
                }
                if (row.finished_at && typeof row.finished_at === 'number' && row.finished_at > maxFinishedAt) {
                    maxFinishedAt = row.finished_at;
                }
                byId.set(row.run_id, {
                    runId: row.run_id,
                    sourceCounts,
                    inserted: row.inserted ?? 0,
                    updated: row.updated ?? 0,
                    labelRows: 0,
                    labeledItems: 0,
                    labelRowsBySource: {},
                    yield: { selected: 0, published: 0, dropped: 0 },
                });
            }

            const rowsMap: Record<string, CollectRunStoreRow | null> = {};
            for (const id of runIds) {
                rowsMap[id] = byId.get(id) ?? null;
            }

            return {
                schemaVersion: 1,
                availability: 'available',
                lastStoredAt: maxFinishedAt > 0 ? new Date(maxFinishedAt).toISOString() : null,
                rows: rowsMap,
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                availability: 'available',
                lastStoredAt: null,
                rows: Object.fromEntries(runIds.map((id) => [id, null])),
                diagnostics: [],
            };
        }
    }

    async function nativeStoreRun(runId: string): Promise<CollectRunStore> {
        try {
            const runRes = await getJson<SpurDbPage>(
                `${board}/api/project/database/tables/collect_runs/rows?filterColumn=run_id&filter=${encodeURIComponent(runId)}`,
            );
            const runRows = parseSpurDbRows<{
                run_id: string;
                source_counts_json?: string;
                inserted?: number;
                updated?: number;
            }>(runRes);
            const rowData = runRows[0];

            let runStoreRow: CollectRunStoreRow | null = null;
            if (rowData) {
                let sourceCounts: Record<string, number> = {};
                try {
                    if (rowData.source_counts_json) {
                        const parsed = JSON.parse(rowData.source_counts_json);
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            sourceCounts = parsed;
                        }
                    }
                } catch {
                    sourceCounts = {};
                }
                runStoreRow = {
                    runId: rowData.run_id,
                    sourceCounts,
                    inserted: rowData.inserted ?? 0,
                    updated: rowData.updated ?? 0,
                    labelRows: 0,
                    labeledItems: 0,
                    labelRowsBySource: {},
                    yield: { selected: 0, published: 0, dropped: 0 },
                };
            }

            let labelQuality: CollectRunStore['labelQuality'] = [];
            try {
                const labelsRes = await getJson<SpurDbPage>(
                    `${board}/api/project/database/tables/labels/rows?filterColumn=run_id&filter=${encodeURIComponent(runId)}&pageSize=200`,
                );
                const labelRows = parseSpurDbRows<{
                    decision_id?: string;
                    value?: string;
                    confidence?: string;
                }>(labelsRes);
                const decisionMap = new Map<
                    string,
                    Map<string, { HIGH: number; MEDIUM: number; LOW: number; none: number }>
                >();
                for (const l of labelRows) {
                    const dec = l.decision_id || 'unknown';
                    const val = String(l.value ?? 'none');
                    const conf = (l.confidence || 'none') as 'HIGH' | 'MEDIUM' | 'LOW' | 'none';
                    let valMap = decisionMap.get(dec);
                    if (!valMap) {
                        valMap = new Map();
                        decisionMap.set(dec, valMap);
                    }
                    let counts = valMap.get(val);
                    if (!counts) {
                        counts = { HIGH: 0, MEDIUM: 0, LOW: 0, none: 0 };
                        valMap.set(val, counts);
                    }
                    if (conf === 'HIGH' || conf === 'MEDIUM' || conf === 'LOW') {
                        counts[conf] = (counts[conf] ?? 0) + 1;
                    } else {
                        counts.none = (counts.none ?? 0) + 1;
                    }
                }
                labelQuality = Array.from(decisionMap.entries()).map(([decisionId, valMap]) => ({
                    decisionId,
                    run: Array.from(valMap.entries()).map(([value, counts]) => ({
                        value,
                        ...counts,
                    })),
                    effective: Array.from(valMap.entries()).map(([value, counts]) => ({
                        value,
                        count: counts.HIGH + counts.MEDIUM + counts.LOW + counts.none,
                    })),
                }));
            } catch {
                labelQuality = [];
            }

            return {
                schemaVersion: 1,
                availability: 'available',
                runId,
                row: runStoreRow,
                labelQuality,
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                availability: 'available',
                runId,
                row: null,
                labelQuality: [],
                diagnostics: [],
            };
        }
    }

    async function nativeStoreItems(runId?: string, query: StoreItemsQuery = {}): Promise<CollectStoreItems> {
        const pageNum = query.page ?? 1;
        const params = new URLSearchParams({
            page: String(pageNum),
            pageSize: '25',
            sort: 'first_seen_at',
            dir: 'desc',
        });
        if (query.search?.trim()) {
            params.set('filterColumn', 'title');
            params.set('filter', query.search.trim());
        } else if (query.source) {
            params.set('filterColumn', 'source');
            params.set('filter', query.source);
        } else if (runId?.trim()) {
            params.set('filterColumn', 'first_seen_run');
            params.set('filter', runId.trim());
        }

        try {
            const pageData = await getJson<SpurDbPage>(
                `${board}/api/project/database/tables/items/rows?${params.toString()}`,
            );
            const rows = parseSpurDbRows<{
                id: string;
                title?: string;
                canonical_url?: string;
                source?: string;
                story_id?: string;
                first_seen_run?: string;
                last_seen_run?: string;
                first_seen_at?: number;
                published_at?: number;
                domain?: string;
                lang?: string;
                body_chars?: number;
                engagement?: number;
            }>(pageData);

            const itemsWithLabels: CollectStoreItem[] = await Promise.all(
                rows.map(async (row) => {
                    const labels: Record<string, string> = {};
                    const labelDetails: Record<string, CollectItemLabelDetail> = {};
                    try {
                        const labRes = await getJson<SpurDbPage>(
                            `${board}/api/project/database/tables/labels/rows?filterColumn=item_id&filter=${encodeURIComponent(row.id)}&pageSize=50`,
                        );
                        const labRows = parseSpurDbRows<{
                            decision_id?: string;
                            value?: unknown;
                            confidence?: string;
                            maker?: string;
                            score?: number;
                        }>(labRes);
                        for (const l of labRows) {
                            if (l.decision_id) {
                                labels[l.decision_id] = String(l.value ?? '');
                                labelDetails[l.decision_id] = {
                                    value: String(l.value ?? ''),
                                    confidence: l.confidence ?? null,
                                    maker: l.maker ?? null,
                                    score: typeof l.score === 'number' ? l.score : null,
                                };
                            }
                        }
                    } catch {
                        // Keep empty labels on failure
                    }

                    const url = row.canonical_url && /^https?:\/\//i.test(row.canonical_url) ? row.canonical_url : null;
                    const seen: 'new' | 'reseen' =
                        row.first_seen_run && row.last_seen_run && row.first_seen_run !== row.last_seen_run
                            ? 'reseen'
                            : 'new';

                    return {
                        id: row.id,
                        title: (row.title || '').slice(0, 300),
                        url,
                        source: row.source || 'unknown',
                        storyId: row.story_id ?? null,
                        seen,
                        labels,
                        labelDetails,
                        selection: 'none',
                        domain: row.domain ?? null,
                        lang: row.lang ?? null,
                        bodyChars: row.body_chars ?? null,
                        engagement: row.engagement ?? null,
                        firstSeenAt: row.first_seen_at ?? null,
                        publishedAt: row.published_at ?? null,
                    };
                }),
            );

            return {
                schemaVersion: 1,
                availability: 'available',
                runId: runId ?? '',
                page: pageNum,
                pageSize: 25,
                total: pageData.total ?? itemsWithLabels.length,
                items: itemsWithLabels,
                sources: ['aihot', 'hackernews', 'youtube', 'reddit', 'polymarket', 'github', 'grounding', 'rss'],
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                availability: 'available',
                runId: runId ?? '',
                page: pageNum,
                pageSize: 25,
                total: 0,
                items: [],
                sources: [],
                diagnostics: [],
            };
        }
    }

    async function nativeStoreSelections(query: StoreSelectionsQuery = {}): Promise<CollectStoreSelections> {
        const pageNum = query.page ?? 1;
        const params = new URLSearchParams({
            page: String(pageNum),
            pageSize: '25',
            sort: 'selected_at',
            dir: 'desc',
        });
        if (query.topic) {
            params.set('filterColumn', 'topic');
            params.set('filter', query.topic);
        } else if (query.status) {
            params.set('filterColumn', 'status');
            params.set('filter', query.status);
        } else if (query.runId) {
            params.set('filterColumn', 'run_id');
            params.set('filter', query.runId);
        }

        try {
            const pageData = await getJson<SpurDbPage>(
                `${board}/api/project/database/tables/selections/rows?${params.toString()}`,
            );
            const rows = parseSpurDbRows<{
                topic: string;
                item_id: string;
                run_id: string;
                story_id: string;
                workflow?: string;
                rank?: number;
                reason?: string;
                status?: string;
                selected_at: number;
                published_at?: number;
            }>(pageData);

            const selectionsWithItems: CollectStoreSelection[] = await Promise.all(
                rows.map(async (row) => {
                    let title: string | null = null;
                    let source: string | null = row.workflow ?? null;
                    let url: string | null = null;

                    try {
                        const itRes = await getJson<SpurDbPage>(
                            `${board}/api/project/database/tables/items/rows?filterColumn=id&filter=${encodeURIComponent(row.item_id)}&pageSize=1`,
                        );
                        const itRows = parseSpurDbRows<{ title?: string; source?: string; canonical_url?: string }>(
                            itRes,
                        );
                        if (itRows[0]) {
                            title = itRows[0].title ?? null;
                            source = itRows[0].source ?? source;
                            url =
                                itRows[0].canonical_url && /^https?:\/\//i.test(itRows[0].canonical_url)
                                    ? itRows[0].canonical_url
                                    : null;
                        }
                    } catch {
                        // Fall back to row data
                    }

                    return {
                        topic: row.topic,
                        itemId: row.item_id,
                        runId: row.run_id,
                        storyId: row.story_id,
                        workflow: row.workflow ?? null,
                        rank: typeof row.rank === 'number' ? row.rank : null,
                        reason: row.reason ?? null,
                        status: (row.status as 'selected' | 'published' | 'dropped') ?? 'selected',
                        selectedAt: row.selected_at,
                        publishedAt: row.published_at ?? null,
                        title: title || row.item_id,
                        source: source || 'unknown',
                        url,
                    };
                }),
            );

            return {
                schemaVersion: 1,
                availability: 'available',
                page: pageNum,
                pageSize: 25,
                total: pageData.total ?? selectionsWithItems.length,
                selections: selectionsWithItems,
                topics: ['ai-news'],
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                availability: 'available',
                page: pageNum,
                pageSize: 25,
                total: 0,
                selections: [],
                topics: ['ai-news'],
                diagnostics: [],
            };
        }
    }

    async function nativeResults(workflow: string, runId: string): Promise<RunResults> {
        try {
            const runData = await getJson<{
                run?: { status?: string; startedAt?: string; completedAt?: string };
                actions?: Array<{ durationMs?: number }>;
                phases?: unknown[];
            }>(`${board}/api/runs/${encodeURIComponent(runId)}`);
            const totalDuration = runData.actions?.reduce((acc, a) => acc + (a.durationMs || 0), 0) ?? 0;
            return {
                schemaVersion: 1,
                workflow: workflow as WorkflowName,
                runId,
                availability: 'available',
                summary: {
                    status: runData.run?.status ?? 'done',
                    startedAt: runData.run?.startedAt,
                    completedAt: runData.run?.completedAt,
                    durationMs: totalDuration,
                    actions: runData.actions?.length ?? 0,
                    phases: runData.phases?.length ?? 0,
                },
                artifacts: [],
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                workflow: workflow as WorkflowName,
                runId,
                availability: 'missing',
                summary: {},
                artifacts: [],
                diagnostics: [],
            };
        }
    }

    async function nativeConfig(workflow: string, runId: string): Promise<RunConfig> {
        try {
            const runData = await getJson<{
                run?: { workflowName?: string; status?: string; mode?: string; startedAt?: string };
            }>(`${board}/api/runs/${encodeURIComponent(runId)}`);
            return {
                schemaVersion: 1,
                workflow: workflow as WorkflowName,
                runId,
                capturedAt: runData.run?.startedAt ?? null,
                settings: {
                    workflowName: runData.run?.workflowName ?? workflow,
                    status: runData.run?.status ?? 'done',
                    mode: runData.run?.mode ?? 'state-machine',
                },
                unavailableKeys: [],
                diagnostics: [],
            };
        } catch {
            return {
                schemaVersion: 1,
                workflow: workflow as WorkflowName,
                runId,
                capturedAt: null,
                settings: {},
                unavailableKeys: [],
                diagnostics: [],
            };
        }
    }

    return {
        health: () =>
            isNativeSpur
                ? getJson<unknown>(`${board}/api/health`).then(() => ({
                      schemaVersion: 1,
                      projectPath: 'knowledge-kit',
                  }))
                : getJson<BoardHealth>(`${reader}/api/health`),
        results: (workflow, runId) =>
            isNativeSpur
                ? nativeResults(workflow, runId)
                : getJson<RunResults>(
                      `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/results`,
                  ),
        config: (workflow, runId) =>
            isNativeSpur
                ? nativeConfig(workflow, runId)
                : getJson<RunConfig>(
                      `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/config`,
                  ),
        artifactUrl: (workflow, runId, artifactId) =>
            `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
        runs: (workflow, cursor) => {
            const params = new URLSearchParams({ workflow, limit: '25' });
            if (cursor !== undefined) params.set('cursor', cursor);
            return getJson<RunListPage>(`${board}/api/runs?${params.toString()}`);
        },
        storeOverview: (runIds) => {
            if (isNativeSpur) return nativeStoreOverview(runIds);
            const params = new URLSearchParams({ runs: runIds.slice(0, MAX_OVERVIEW_RUNS).join(',') });
            return getJson<CollectStoreOverview>(
                `${reader}/api/workflows/kk-collect/store/overview?${params.toString()}`,
            );
        },
        storeRun: (runId) =>
            isNativeSpur
                ? nativeStoreRun(runId)
                : getJson<CollectRunStore>(
                      `${reader}/api/workflows/kk-collect/runs/${encodeURIComponent(runId)}/store`,
                  ),
        storeItems: (runId, query = {}) => {
            if (isNativeSpur) return nativeStoreItems(runId, query);
            const qs = storeItemsQueryString(query);
            const path =
                runId !== undefined && runId.trim() !== ''
                    ? `${reader}/api/workflows/kk-collect/runs/${encodeURIComponent(runId)}/store/items?${qs}`
                    : `${reader}/api/workflows/kk-collect/store/items?${qs}`;
            return getJson<CollectStoreItems>(path);
        },
        storeSelections: (query = {}) =>
            isNativeSpur
                ? nativeStoreSelections(query)
                : getJson<CollectStoreSelections>(
                      `${reader}/api/workflows/kk-collect/store/selections?${storeSelectionsQueryString(query)}`,
                  ),
        storeChannels: (query) =>
            getJson<CollectChannelYield>(
                `${aggregateReader}/api/workflows/kk-collect/store/channels?${storeChannelsQueryString(query)}`,
            ),
        runDetail: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}`),
        evidence: (workflow, runId) =>
            getJson<RunEvidence>(
                `${reader}/api/workflows/${encodeURIComponent(workflow)}/runs/${encodeURIComponent(runId)}/evidence`,
            ),
        progress: (runId) => getJson<unknown>(`${board}/api/runs/${encodeURIComponent(runId)}/progress`),
    };
}
