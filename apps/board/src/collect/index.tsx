import { type ChangeEvent, type ComponentType, type MouseEvent, useCallback, useEffect, useRef, useState } from 'react';
import type {
    BoardDiagnostic,
    CollectChannelYield,
    CollectRunStore,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    RunConfig,
    RunResults,
} from '../contracts';
import {
    boardBasePath,
    createBoardClient,
    MAX_OVERVIEW_RUNS,
    type StoreItemFilterName,
    type StoreItemsQuery,
    type StoreSelectionsQuery,
} from '../shared/api';
import { artifactViews, collectSummaryFacts, type ProgressRow, progressRows } from '../shared/collect';
import { dedupeDiagnostics, diagnosticLine } from '../shared/format';
import {
    ACTIVE_POLL_MS,
    delayMs,
    failed,
    HISTORY_POLL_MS,
    initialRefresh,
    type RefreshState,
    requestSequence,
    succeeded,
    tick,
} from '../shared/refresh';
import {
    COLLECT_MODULE_PATH,
    COLLECT_TAB_ALIASES,
    COLLECT_TABS,
    type CollectTab,
    mergeRunPages,
    parseDeepLink,
    type RunListRow,
    type RunSelection,
    resolveSelection,
    selectionPath,
    syncSelectionUrl,
} from '../shared/run-selection';
import { ItemDetailModal, ItemsPanel, RunDetailModal, RunDetailsPanel, SelectionsPanel, SummaryPanel } from './panels';

/**
 * The Collect Board module (`kk-collect`), rendered inside the host's React tree.
 *
 * Provides:
 * 1. Summary: High-level operational telemetry aligned with Observabilities & Histories
 * 2. Run Details: Detailed run list with drilldown modal
 * 3. Items: Joined items + labels table with search, filters & item inspection modal
 * 4. Selections: Selections table joined with items
 */

/** The Collect module's tab labels in display order. */
const TAB_LABELS: Record<CollectTab, string> = {
    summary: 'Summary',
    runs: 'Run Details',
    items: 'Items',
    selections: 'Selections',
};

/** The installed host's contribution ABI (`@gobing-ai/spur/board/index.d.ts`, apiVersion 1). */
interface BoardContribution {
    readonly apiVersion: 1;
    readonly component: ComponentType;
}

/** The one-line message for a caught error. */
function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** The channel-yield range pills, in display order (0319). */
const COLLECT_RANGES = ['24h', '7d', '14d', '30d', 'All'] as const;
type CollectRange = (typeof COLLECT_RANGES)[number];

/** `?range=` resolution: an invalid or missing range defaults to 14d (R3). */
function parseRange(search: string): { range: CollectRange; diagnostic: BoardDiagnostic | null } {
    const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('range');
    if (raw === null) return { range: '14d', diagnostic: null };
    if ((COLLECT_RANGES as readonly string[]).includes(raw)) {
        return { range: raw as CollectRange, diagnostic: null };
    }
    return {
        range: '14d',
        diagnostic: { code: 'board.deeplink.unknown-range', message: `Unknown range '${raw}'; showing 14d.` },
    };
}

/** The `[fromMs, untilMs)` window a range pill names, from one captured `now` (R3). */
function rangeWindow(range: CollectRange, now: number): { fromMs: number; untilMs: number } {
    const untilMs = now;
    if (range === 'All') return { fromMs: 0, untilMs };
    const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '14d' ? 14 : 30;
    return { fromMs: untilMs - days * 86_400_000, untilMs };
}

/**
 * Poll one async loader on a steady interval with a capped backoff after failures, stopping
 * while the document is hidden.
 */
function usePolling(loader: () => Promise<void>, intervalMs: number, refresh: RefreshState): void {
    const loaderRef = useRef(loader);
    loaderRef.current = loader;
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;
        const loop = async (): Promise<void> => {
            if (!document.hidden) {
                await loaderRef.current();
            }
            if (!cancelled) timer = setTimeout(() => void loop(), delayMs(refreshRef.current, intervalMs));
        };
        void loop();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [intervalMs]);
}

function isOfflineError(msg: string): boolean {
    return msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ECONNREFUSED');
}

/** The six tabs of the Collect module. */
export function CollectModule() {
    const [link] = useState(() => parseDeepLink(window.location.search, COLLECT_TABS, COLLECT_TAB_ALIASES));
    const [rangeLink] = useState(() => parseRange(window.location.search));
    const basePath = boardBasePath(window.location.pathname);
    const modulePath = basePath + COLLECT_MODULE_PATH;
    const [client] = useState(() =>
        createBoardClient({
            moduleId: 'kk-collect',
            boardOrigin: window.location.origin,
            pathname: window.location.pathname,
        }),
    );

    const [rows, setRows] = useState<RunListRow[]>([]);
    const [_cursor, setCursor] = useState<string | null>(null);
    const [selection, setSelection] = useState<RunSelection<CollectTab>>({
        runId: link.runId ?? null,
        tab: link.tab ?? 'summary',
    });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(rangeLink.diagnostic === null ? [] : [rangeLink.diagnostic]),
    ]);
    const [isReaderOffline, setIsReaderOffline] = useState(false);

    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [overview, setOverview] = useState<CollectStoreOverview | null>(null);
    const [storeRun, setStoreRun] = useState<CollectRunStore | null>(null);

    // Items tab state
    const [items, setItems] = useState<CollectStoreItems | null>(null);
    const [itemFilters, setItemFilters] = useState<StoreItemsQuery>({ page: 1 });
    const [selectedInspectItem, setSelectedInspectItem] = useState<CollectStoreItem | null>(null);

    // Selections tab state
    const [selections, setSelections] = useState<CollectStoreSelections | null>(null);
    const [selectionsFilters, setSelectionsFilters] = useState<StoreSelectionsQuery>({ page: 1 });

    // Summary channel-yield aggregate state (0319)
    const [channels, setChannels] = useState<CollectChannelYield | null>(null);
    const [channelsPage, setChannelsPage] = useState(1);

    // Modals and view controls
    const [selectedModalRunId, setSelectedModalRunId] = useState<string | null>(null);
    const [modalStoreRun, setModalStoreRun] = useState<CollectRunStore | null>(null);
    const [modalResults, setModalResults] = useState<RunResults | null>(null);
    const [modalProgress, setModalProgress] = useState<unknown>(null);
    const [modalConfig, setModalConfig] = useState<RunConfig | null>(null);
    const [timeRange, setTimeRange] = useState<CollectRange>(rangeLink.range);
    const [showEffective, setShowEffective] = useState(false);
    const [runSearchQuery, setRunSearchQuery] = useState('');
    const [runStatusFilter, setRunStatusFilter] = useState<'all' | 'done' | 'failed' | 'running'>('all');

    const historyBusy = useRef(false);
    const readerBusy = useRef(false);
    /** The run the modal's cached store data belongs to; a new target must not reuse it. */
    const modalTarget = useRef<string | null>(null);

    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    /** The store overview for the loaded page */
    const loadOverview = useCallback(
        async (runIds: readonly string[]) => {
            if (runIds.length === 0) return;
            try {
                const res = await client.storeOverview(runIds);
                setOverview(res);
                setIsReaderOffline(false);
            } catch (error) {
                const msg = messageOf(error);
                if (isOfflineError(msg)) {
                    setIsReaderOffline(true);
                } else {
                    setDiagnostics((existing) => [...existing, { code: 'board.store.unavailable', message: msg }]);
                }
            }
        },
        [client],
    );

    const loadHistory = useCallback(async () => {
        if (historyBusy.current) return;
        historyBusy.current = true;
        setHistoryRefresh((state) => tick(state));
        let loaded: RunListRow[] = rowsRef.current;
        try {
            const page = await client.runs('kk-collect');
            loaded = mergeRunPages(rowsRef.current, page).runs;
            setRows(loaded);
            setCursor(page.nextCursor);
            setHistoryRefresh(() => succeeded(Date.now(), HISTORY_POLL_MS));
        } catch (error) {
            setDiagnostics((existing) => [
                ...existing,
                { code: 'board.history.unavailable', message: messageOf(error) },
            ]);
            setHistoryRefresh((state) => failed(state, Date.now()));
        } finally {
            historyBusy.current = false;
        }
        await loadOverview(loaded.slice(0, MAX_OVERVIEW_RUNS).map((row) => row.id));
    }, [client, loadOverview]);

    const loadReader = useCallback(async () => {
        if (readerBusy.current) return;
        const runId = selectionRef.current.runId;
        if (runId === null) return;
        readerBusy.current = true;
        setReaderRefresh((state) => tick(state));
        try {
            const [nextResults, nextConfig] = await Promise.all([
                client.results('kk-collect', runId),
                client.config('kk-collect', runId),
            ]);
            if (selectionRef.current.runId !== runId) return;
            setResults(nextResults);
            setConfig(nextConfig);
            setReaderRefresh(() => succeeded(Date.now(), ACTIVE_POLL_MS));
            setIsReaderOffline(false);
        } catch (error) {
            if (selectionRef.current.runId !== runId) return;
            const msg = messageOf(error);
            if (isOfflineError(msg)) {
                setIsReaderOffline(true);
            } else {
                setDiagnostics((existing) => [...existing, { code: 'board.reader.unavailable', message: msg }]);
            }
            setReaderRefresh((state) => failed(state, Date.now()));
        } finally {
            readerBusy.current = false;
        }

        try {
            const nextStoreRun = await client.storeRun(runId);
            if (selectionRef.current.runId !== runId) return;
            setStoreRun(nextStoreRun);
            setIsReaderOffline(false);
        } catch (error) {
            if (selectionRef.current.runId !== runId) return;
            const msg = messageOf(error);
            if (isOfflineError(msg)) {
                setIsReaderOffline(true);
            } else {
                setDiagnostics((existing) => [...existing, { code: 'board.store.run-unavailable', message: msg }]);
            }
        }
    }, [client]);

    // Items loader with sequence token
    const itemsRequests = useRef(requestSequence());
    const loadItems = useCallback(
        async (runId: string) => {
            const token = itemsRequests.current.begin();
            try {
                const page = await client.storeItems(runId, itemFilters);
                if (!itemsRequests.current.isCurrent(token)) return;
                setItems(page);
                setIsReaderOffline(false);
            } catch (error) {
                if (!itemsRequests.current.isCurrent(token)) return;
                setItems(null);
                const msg = messageOf(error);
                if (isOfflineError(msg)) {
                    setIsReaderOffline(true);
                } else {
                    setDiagnostics((existing) => [
                        ...existing,
                        { code: 'board.store.items-unavailable', message: msg },
                    ]);
                }
            }
        },
        [client, itemFilters],
    );

    // Selections loader with sequence token
    const selectionsRequests = useRef(requestSequence());
    const loadSelections = useCallback(async () => {
        const token = selectionsRequests.current.begin();
        try {
            const page = await client.storeSelections(selectionsFilters);
            if (!selectionsRequests.current.isCurrent(token)) return;
            setSelections(page);
            setIsReaderOffline(false);
        } catch (error) {
            if (!selectionsRequests.current.isCurrent(token)) return;
            setSelections(null);
            const msg = messageOf(error);
            if (isOfflineError(msg)) {
                setIsReaderOffline(true);
            } else {
                setDiagnostics((existing) => [
                    ...existing,
                    { code: 'board.store.selections-unavailable', message: msg },
                ]);
            }
        }
    }, [client, selectionsFilters]);

    // Channel-yield loader with a sequence token, so a stale range response never wins (R6).
    const channelsRequests = useRef(requestSequence());
    const loadChannels = useCallback(async () => {
        const token = channelsRequests.current.begin();
        const { fromMs, untilMs } = rangeWindow(timeRange, Date.now());
        try {
            const page = await client.storeChannels({ fromMs, untilMs, page: channelsPage });
            if (!channelsRequests.current.isCurrent(token)) return;
            setChannels(page);
            setIsReaderOffline(false);
        } catch (error) {
            if (!channelsRequests.current.isCurrent(token)) return;
            setChannels(null);
            const msg = messageOf(error);
            if (isOfflineError(msg)) {
                setIsReaderOffline(true);
            } else {
                setDiagnostics((existing) => [...existing, { code: 'board.store.channels-unavailable', message: msg }]);
            }
        }
    }, [client, timeRange, channelsPage]);

    /** A range change restarts the aggregate at page 1 (R3). */
    const rangeChanged = useCallback((range: string) => {
        setTimeRange(range as CollectRange);
        setChannelsPage(1);
    }, []);

    // Dedicated modal run data loader
    useEffect(() => {
        if (!selectedModalRunId) {
            modalTarget.current = null;
            setModalStoreRun(null);
            setModalResults(null);
            setModalProgress(null);
            setModalConfig(null);
            return;
        }

        // A new target must never show the previous run's row while its own store request is in
        // flight (G81/0309 R1) — clear on a target change, not on every poll re-run of this effect.
        if (modalTarget.current !== selectedModalRunId) {
            modalTarget.current = selectedModalRunId;
            setModalStoreRun(null);
            setModalResults(null);
            setModalProgress(null);
            setModalConfig(null);
        }

        // Reuse the page's data only when it provably belongs to this target: the page keeps the
        // previous run's row until its own request settles. `progress` carries no run id, so it is
        // reused only once the modal has fetched it for this target itself.
        if (selectedModalRunId === selection.runId) {
            if (storeRun?.runId === selectedModalRunId) setModalStoreRun(storeRun);
            if (results?.runId === selectedModalRunId) setModalResults(results);
            if (config?.runId === selectedModalRunId) setModalConfig(config);
            if (
                modalProgress !== null &&
                storeRun?.runId === selectedModalRunId &&
                results?.runId === selectedModalRunId &&
                config?.runId === selectedModalRunId
            ) {
                return;
            }
        }

        let cancelled = false;
        async function fetchModalData(runId: string) {
            try {
                const [rResults, rStore, rProg, rConfig] = await Promise.allSettled([
                    client.results('kk-collect', runId),
                    client.storeRun(runId),
                    client.progress(runId),
                    client.config('kk-collect', runId),
                ]);
                if (cancelled) return;
                if (rResults.status === 'fulfilled') setModalResults(rResults.value);
                if (rStore.status === 'fulfilled') setModalStoreRun(rStore.value);
                if (rProg.status === 'fulfilled') setModalProgress(rProg.value);
                if (rConfig.status === 'fulfilled') setModalConfig(rConfig.value);
            } catch {
                // Non-fatal for modal
            }
        }
        void fetchModalData(selectedModalRunId);

        return () => {
            cancelled = true;
        };
    }, [selectedModalRunId, selection.runId, storeRun, results, config, modalProgress, client]);

    usePolling(loadHistory, HISTORY_POLL_MS, historyRefresh);
    usePolling(loadReader, ACTIVE_POLL_MS, readerRefresh);

    // Fetch items when tab is items
    useEffect(() => {
        if (selection.tab !== 'items') return;
        void loadItems(selection.runId ?? '');
    }, [selection.tab, selection.runId, loadItems]);

    // Fetch selections when tab is selections
    useEffect(() => {
        if (selection.tab !== 'selections') return;
        void loadSelections();
    }, [selection.tab, loadSelections]);

    // Fetch the channel-yield aggregate when the Summary tab is selected (R1/R2).
    useEffect(() => {
        if (selection.tab !== 'summary') return;
        void loadChannels();
    }, [selection.tab, loadChannels]);

    // First visit picks newest run
    useEffect(() => {
        if (selection.runId === null && rows.length > 0) {
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link, 'summary') : state));
        }
    }, [rows, selection.runId, link]);

    // Sync address bar
    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history }, modulePath);
    }, [selection, modulePath]);

    // Persist the range pill in the URL (R3); the selection sync above preserves it on rewrite.
    useEffect(() => {
        if (window.location.pathname !== modulePath) return;
        const params = new URLSearchParams(window.location.search);
        if (params.get('range') === timeRange) return;
        params.set('range', timeRange);
        window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
    }, [timeRange, modulePath]);

    const tab = selection.tab;
    const now = Date.now();
    const currentStoreRun = storeRun?.runId === selection.runId ? storeRun : null;

    const runHref = useCallback(
        (runId: string) => selectionPath({ runId, tab: 'runs' }, window.location.search, modulePath),
        [modulePath],
    );
    const toggleQuality = useCallback(() => setShowEffective((state) => !state), []);

    const filterChanged = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
        const name = event.currentTarget.name as StoreItemFilterName;
        const value = event.currentTarget.value === '' ? undefined : event.currentTarget.value;
        setItemFilters((state) => ({
            ...state,
            [name]: value,
            page: 1,
            ...(name === 'decision' ? { value: undefined } : {}),
        }));
    }, []);

    const pageChanged = useCallback((event: MouseEvent<HTMLButtonElement>) => {
        const delta = event.currentTarget.name === 'previous' ? -1 : 1;
        setItemFilters((state) => ({ ...state, page: Math.max(1, (state.page ?? 1) + delta) }));
    }, []);

    const handleInspectRun = useCallback((runId: string) => {
        setSelectedModalRunId(runId);
        setSelection((s) => ({ ...s, runId }));
    }, []);

    const handleCloseModal = useCallback(() => {
        setSelectedModalRunId(null);
        setSelection((s) => ({ ...s, runId: null }));
    }, []);

    const modalFacts = modalResults ? collectSummaryFacts(modalResults, now) : [];
    const modalArtifacts = modalResults ? artifactViews(modalResults, client.artifactUrl) : [];
    const modalSteps: ProgressRow[] = progressRows(modalProgress);

    // Filter out reader/store connection diagnostics if reader is marked offline (preventing 4-error noise)
    const displayDiagnostics = dedupeDiagnostics([...diagnostics, ...(results?.diagnostics ?? [])]).filter((d) => {
        if (!isReaderOffline) return true;
        return (
            d.code !== 'board.reader.unavailable' &&
            d.code !== 'board.store.run-unavailable' &&
            d.code !== 'board.store.unavailable' &&
            d.code !== 'board.store.items-unavailable' &&
            d.code !== 'board.store.selections-unavailable' &&
            d.code !== 'board.store.channels-unavailable'
        );
    });

    return (
        <div className="kk-board kk-board-collect">
            <header className="kk-board-header">
                <div className="kk-board-header-left">
                    <div className="kk-board-header-title-row">
                        <h1>Collect</h1>
                    </div>
                </div>
                <div className="kk-board-header-right">
                    <button
                        type="button"
                        onClick={() => {
                            void loadReader();
                            void loadHistory();
                            if (selection.tab === 'items') void loadItems(selection.runId ?? '');
                            if (selection.tab === 'selections') void loadSelections();
                            if (selection.tab === 'summary') void loadChannels();
                        }}
                        title="Refresh data"
                    >
                        ↻ Refresh
                    </button>
                    <a
                        href={selectionPath(selection, window.location.search, modulePath)}
                        className="kk-btn-action"
                        title="Permanent link"
                    >
                        🔗 Link
                    </a>
                </div>
            </header>

            {isReaderOffline ? (
                <div className="kk-board-reader-offline-banner" role="alert">
                    <div className="kk-board-reader-offline-icon">⚠️</div>
                    <div className="kk-board-reader-offline-content">
                        <strong>Board module API unavailable</strong>
                        <p>
                            Store facts, item inspection, and artifact evidence are temporarily unavailable. Spur run
                            execution history remains available.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="kk-btn-action"
                        onClick={() => {
                            setIsReaderOffline(false);
                            void loadReader();
                            void loadHistory();
                            if (selection.tab === 'items') void loadItems(selection.runId ?? '');
                            if (selection.tab === 'selections') void loadSelections();
                            if (selection.tab === 'summary') void loadChannels();
                        }}
                    >
                        ↻ Retry Connection
                    </button>
                </div>
            ) : null}

            {/* Segmented Control Navigation Tabs */}
            <nav className="kk-board-tabs" aria-label="Collect tabs">
                {COLLECT_TABS.map((candidate) => (
                    <button
                        key={candidate}
                        type="button"
                        aria-current={candidate === tab ? 'page' : undefined}
                        onClick={() => setSelection((state) => ({ ...state, tab: candidate }))}
                    >
                        {TAB_LABELS[candidate]}
                    </button>
                ))}
            </nav>

            {rows.length === 0 ? (
                <p className="kk-board-empty">
                    No runs recorded for kk-collect. Configure the workflow in{' '}
                    <a href={`${basePath}/board/settings/workflows`}>Settings → Workflows</a>.
                </p>
            ) : null}

            {/* Panel 1: Summary (Executive Operational Telemetry) */}
            {tab === 'summary' ? (
                <SummaryPanel
                    channels={channels}
                    timeRange={timeRange}
                    onTimeRangeChange={rangeChanged}
                    channelsPage={channelsPage}
                    onChannelsPageChange={(delta) => setChannelsPage((page) => Math.max(1, page + delta))}
                />
            ) : null}

            {/* Panel 2: Run Details (Run List Table Drilldown) */}
            {tab === 'runs' ? (
                <RunDetailsPanel
                    runs={rows}
                    overview={overview}
                    now={now}
                    runHref={runHref}
                    searchQuery={runSearchQuery}
                    statusFilter={runStatusFilter}
                    onSearchChange={setRunSearchQuery}
                    onStatusFilterChange={setRunStatusFilter}
                    onInspectRun={handleInspectRun}
                />
            ) : null}

            {/* Panel 3: Items (Items + Labels joined) */}
            {tab === 'items' ? (
                <ItemsPanel
                    runId={selection.runId}
                    items={items}
                    filters={itemFilters}
                    quality={currentStoreRun?.labelQuality ?? []}
                    runs={rows}
                    onRunChange={(rId) => {
                        setItemFilters((s) => ({ ...s, page: 1 }));
                        setSelection((s) => ({ ...s, runId: rId ?? null }));
                    }}
                    onFilterChange={filterChanged}
                    onSearchChange={(e) => setItemFilters((s) => ({ ...s, search: e.target.value, page: 1 }))}
                    onPageChange={pageChanged}
                    onInspectItem={(item) => setSelectedInspectItem(item)}
                />
            ) : null}

            {/* Panel 4: Selections (Table selections joined with items) */}
            {tab === 'selections' ? (
                <SelectionsPanel
                    selections={selections}
                    topics={selections?.topics ?? []}
                    filters={selectionsFilters}
                    onTopicChange={(topic) => setSelectionsFilters((s) => ({ ...s, topic, page: 1 }))}
                    onStatusChange={(status) => setSelectionsFilters((s) => ({ ...s, status, page: 1 }))}
                    onSearchChange={(search) => setSelectionsFilters((s) => ({ ...s, search, page: 1 }))}
                    onPageChange={(delta) =>
                        setSelectionsFilters((s) => ({ ...s, page: Math.max(1, (s.page ?? 1) + delta) }))
                    }
                    onInspectRun={handleInspectRun}
                />
            ) : null}

            {/* Diagnostics (sanitized and deduplicated) */}
            {displayDiagnostics.map((diagnostic) => (
                <p key={diagnostic.code} role="status" className="kk-board-diagnostic">
                    {diagnosticLine(diagnostic)}
                </p>
            ))}

            {/* Run Detail Modal Window */}
            {selectedModalRunId ? (
                <RunDetailModal
                    runId={selectedModalRunId}
                    storeRun={modalStoreRun}
                    results={modalResults}
                    facts={modalFacts}
                    artifacts={modalArtifacts}
                    steps={modalSteps}
                    config={modalConfig}
                    basePath={basePath}
                    showEffective={showEffective}
                    onToggleQuality={toggleQuality}
                    onClose={handleCloseModal}
                />
            ) : null}

            {/* Item Detail Modal Window */}
            {selectedInspectItem ? (
                <ItemDetailModal item={selectedInspectItem} onClose={() => setSelectedInspectItem(null)} />
            ) : null}
        </div>
    );
}

/** Entry the host mounts: no `createRoot`, no private Board context imports. */
export const webModule: BoardContribution = { apiVersion: 1, component: CollectModule };
