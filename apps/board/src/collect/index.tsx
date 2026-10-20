import {
    type ChangeEvent,
    type ComponentType,
    type MouseEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    CollectRunStore,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    RunConfig,
    RunResults,
} from '../contracts';
import {
    type BoardClient,
    createBoardClient,
    MAX_OVERVIEW_RUNS,
    readerOriginFrom,
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
    freshnessLabel,
    HISTORY_POLL_MS,
    initialRefresh,
    type RefreshState,
    requestSequence,
    succeeded,
    tick,
} from '../shared/refresh';
import {
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
import {
    ConfigPanel,
    ItemDetailModal,
    ItemsPanel,
    ProgressPanel,
    RunDetailModal,
    RunDetailsPanel,
    SelectionsPanel,
    SummaryPanel,
} from './panels';

/**
 * The Collect Board module (`kk-collect`), rendered inside the host's React tree.
 *
 * Provides:
 * 1. Summary: High-level operational telemetry aligned with Observabilities & Histories
 * 2. Run Details: Detailed run list with drilldown modal
 * 3. Items: Joined items + labels table with search, filters & item inspection modal
 * 4. Selections: Selections table joined with items
 * 5. Progress: Pipeline execution states
 * 6. Config: Captured workflow settings
 */

/** The Collect module's tab labels in display order. */
const TAB_LABELS: Record<CollectTab, string> = {
    summary: 'Summary',
    runs: 'Run Details',
    items: 'Items',
    selections: 'Selections',
    progress: 'Execution progress',
    config: 'Workflow Config Summary',
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
    const [reader] = useState(() => readerOriginFrom(window.location.search));
    const readerOrigin = reader.origin;
    const client = useMemo<BoardClient>(
        () => createBoardClient({ readerOrigin, boardOrigin: window.location.origin }),
        [readerOrigin],
    );

    const [rows, setRows] = useState<RunListRow[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [selection, setSelection] = useState<RunSelection<CollectTab>>({
        runId: link.runId ?? null,
        tab: link.tab ?? 'summary',
    });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(reader.diagnostic === null ? [] : [reader.diagnostic]),
    ]);
    const [isReaderOffline, setIsReaderOffline] = useState(false);

    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [progress, setProgress] = useState<unknown>(null);
    const [overview, setOverview] = useState<CollectStoreOverview | null>(null);
    const [storeRun, setStoreRun] = useState<CollectRunStore | null>(null);

    // Items tab state
    const [items, setItems] = useState<CollectStoreItems | null>(null);
    const [itemFilters, setItemFilters] = useState<StoreItemsQuery>({ page: 1 });
    const [selectedInspectItem, setSelectedInspectItem] = useState<CollectStoreItem | null>(null);

    // Selections tab state
    const [selections, setSelections] = useState<CollectStoreSelections | null>(null);
    const [selectionsFilters, setSelectionsFilters] = useState<StoreSelectionsQuery>({ page: 1 });

    // Modals and view controls
    const [selectedModalRunId, setSelectedModalRunId] = useState<string | null>(null);
    const [modalStoreRun, setModalStoreRun] = useState<CollectRunStore | null>(null);
    const [modalResults, setModalResults] = useState<RunResults | null>(null);
    const [modalProgress, setModalProgress] = useState<unknown>(null);
    const [timeRange, setTimeRange] = useState('24h');
    const [showEffective, setShowEffective] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');

    const historyBusy = useRef(false);
    const readerBusy = useRef(false);

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

        try {
            const nextProgress = await client.progress(runId);
            if (selectionRef.current.runId !== runId) return;
            setProgress(nextProgress);
        } catch {
            // Leave last progress in place
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

    // Dedicated modal run data loader
    useEffect(() => {
        if (!selectedModalRunId) {
            setModalStoreRun(null);
            setModalResults(null);
            setModalProgress(null);
            return;
        }

        // If the modal targets the currently selected run, reuse cached values
        if (selectedModalRunId === selection.runId) {
            setModalStoreRun(storeRun);
            setModalResults(results);
            setModalProgress(progress);
            return;
        }

        let cancelled = false;
        async function fetchModalData(runId: string) {
            try {
                const [rResults, rStore, rProg] = await Promise.allSettled([
                    client.results('kk-collect', runId),
                    client.storeRun(runId),
                    client.progress(runId),
                ]);
                if (cancelled) return;
                if (rResults.status === 'fulfilled') setModalResults(rResults.value);
                if (rStore.status === 'fulfilled') setModalStoreRun(rStore.value);
                if (rProg.status === 'fulfilled') setModalProgress(rProg.value);
            } catch {
                // Non-fatal for modal
            }
        }
        void fetchModalData(selectedModalRunId);

        return () => {
            cancelled = true;
        };
    }, [selectedModalRunId, selection.runId, storeRun, results, progress, client]);

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

    // First visit picks newest run
    useEffect(() => {
        if (selection.runId === null && rows.length > 0) {
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link, 'summary') : state));
        }
    }, [rows, selection.runId, link]);

    // Sync address bar
    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history });
    }, [selection]);

    const tab = selection.tab;
    const now = Date.now();
    const currentStoreRun = storeRun?.runId === selection.runId ? storeRun : null;
    const steps: ProgressRow[] = progressRows(progress);
    const selectedRow = rows.find((row) => row.id === selection.runId);

    const filteredRows = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        if (q === '') return rows;
        return rows.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }, [rows, filterQuery]);

    const runHref = useCallback((runId: string) => selectionPath({ runId, tab: 'runs' }, window.location.search), []);
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

    const modalFacts = modalResults ? collectSummaryFacts(modalResults, now) : [];
    const modalArtifacts = modalResults ? artifactViews(modalResults, readerOrigin) : [];
    const modalSteps: ProgressRow[] = progressRows(modalProgress);

    // Filter out reader/store connection diagnostics if reader is marked offline (preventing 4-error noise)
    const displayDiagnostics = dedupeDiagnostics([...diagnostics, ...(results?.diagnostics ?? [])]).filter((d) => {
        if (!isReaderOffline) return true;
        return (
            d.code !== 'board.reader.unavailable' &&
            d.code !== 'board.store.run-unavailable' &&
            d.code !== 'board.store.unavailable' &&
            d.code !== 'board.store.items-unavailable' &&
            d.code !== 'board.store.selections-unavailable'
        );
    });

    return (
        <div className="kk-board kk-board-collect">
            <header className="kk-board-header">
                <div className="kk-board-header-left">
                    <div className="kk-board-header-title-row">
                        <h1>Collect</h1>
                        {selectedRow ? (
                            <span
                                className={`kk-badge ${selectedRow.status === 'done' ? 'kk-badge-success' : selectedRow.status === 'failed' ? 'kk-badge-failed' : 'kk-badge-running'}`}
                            >
                                {selectedRow.status}
                            </span>
                        ) : null}
                    </div>
                    <p>
                        Selected run <code>{selection.runId ?? 'none selected'}</code> · {freshnessLabel(readerRefresh)}
                        {results === null ? '' : ` · Results ${results.availability}`}
                    </p>
                </div>
                <div className="kk-board-header-right">
                    <div className="kk-board-run-filter-group">
                        <input
                            type="text"
                            className="kk-board-run-filter-input"
                            placeholder="Filter runs..."
                            value={filterQuery}
                            onChange={(e) => setFilterQuery(e.target.value)}
                            aria-label="Filter runs"
                        />
                        <label className="kk-board-run-selector">
                            Run
                            <select
                                value={selection.runId ?? ''}
                                onChange={(event) => {
                                    setItemFilters((state) => ({ ...state, page: 1 }));
                                    setResults(null);
                                    setConfig(null);
                                    setProgress(null);
                                    setStoreRun(null);
                                    setSelection((state) => ({ ...state, runId: event.target.value || null }));
                                }}
                            >
                                <option value="">
                                    {rows.length === 0
                                        ? 'No runs recorded'
                                        : filteredRows.length === 0
                                          ? 'No matching runs'
                                          : 'Select a run'}
                                </option>
                                {filteredRows.map((row) => (
                                    <option key={row.id} value={row.id}>
                                        {row.id} — {row.status}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            void loadReader();
                            void loadHistory();
                            if (selection.tab === 'items') void loadItems(selection.runId ?? '');
                            if (selection.tab === 'selections') void loadSelections();
                        }}
                        title="Refresh data"
                    >
                        ↻ Refresh
                    </button>
                    {selection.runId === null ? null : (
                        <a
                            href={selectionPath(selection, window.location.search)}
                            className="kk-btn-action"
                            title="Permanent link"
                        >
                            🔗 Link
                        </a>
                    )}
                </div>
            </header>

            {/* Clear companion reader offline status banner */}
            {isReaderOffline ? (
                <div className="kk-board-reader-offline-banner" role="alert">
                    <div className="kk-board-reader-offline-icon">⚠️</div>
                    <div className="kk-board-reader-offline-content">
                        <strong>Loopback Board Reader Offline ({readerOrigin})</strong>
                        <p>
                            Store facts, item inspection, and artifact evidence require the local reader process. Spur
                            run execution history remains available. To start the reader, run:
                        </p>
                        <code>bun run apps/cli/src/index.ts board serve --board-origin {window.location.origin}</code>
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
                    <a href="/board/settings/workflows">Settings → Workflows</a>.
                </p>
            ) : null}

            {/* Panel 1: Summary (Executive Operational Telemetry) */}
            {tab === 'summary' ? (
                <SummaryPanel
                    runs={rows}
                    overview={overview}
                    now={now}
                    timeRange={timeRange}
                    onTimeRangeChange={setTimeRange}
                    onInspectRun={(runId) => setSelectedModalRunId(runId)}
                />
            ) : null}

            {/* Panel 2: Run Details (Run List Table Drilldown) */}
            {tab === 'runs' ? (
                <RunDetailsPanel
                    runs={filteredRows}
                    overview={overview}
                    now={now}
                    runHref={runHref}
                    onInspectRun={(runId) => setSelectedModalRunId(runId)}
                />
            ) : null}

            {/* Panel 3: Items (Items + Labels joined) */}
            {tab === 'items' ? (
                <ItemsPanel
                    runId={selection.runId}
                    items={items}
                    filters={itemFilters}
                    quality={currentStoreRun?.labelQuality ?? []}
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
                    onInspectRun={(runId) => setSelectedModalRunId(runId)}
                />
            ) : null}

            {/* Panel 5: Progress */}
            {tab === 'progress' ? <ProgressPanel steps={steps} /> : null}

            {/* Panel 6: Config */}
            {tab === 'config' ? <ConfigPanel config={config} /> : null}

            {/* Diagnostics (sanitized and deduplicated) */}
            {displayDiagnostics.map((diagnostic) => (
                <p key={diagnostic.code} role="status" className="kk-board-diagnostic">
                    {diagnosticLine(diagnostic)}
                </p>
            ))}

            {cursor === null ? null : (
                <button type="button" onClick={() => void loadHistory()}>
                    Load more runs
                </button>
            )}

            <p className="kk-board-footnote">
                Run history every {HISTORY_POLL_MS / 1000}s; selected run every {ACTIVE_POLL_MS / 1000}s.
            </p>

            {/* Run Detail Modal Window */}
            {selectedModalRunId ? (
                <RunDetailModal
                    runId={selectedModalRunId}
                    storeRun={modalStoreRun}
                    results={modalResults}
                    facts={modalFacts}
                    artifacts={modalArtifacts}
                    steps={modalSteps}
                    showEffective={showEffective}
                    onToggleQuality={toggleQuality}
                    onClose={() => setSelectedModalRunId(null)}
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
