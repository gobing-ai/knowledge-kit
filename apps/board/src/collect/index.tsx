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
import type { CollectRunStore, CollectStoreItems, CollectStoreOverview, RunConfig, RunResults } from '../contracts';
import {
    type BoardClient,
    createBoardClient,
    MAX_OVERVIEW_RUNS,
    readerOriginFrom,
    type StoreItemFilterName,
    type StoreItemsQuery,
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
import { ConfigPanel, ItemsPanel, OverviewPanel, ProgressPanel, RunDetailPanel } from './panels';

/**
 * The Collect Board module (`kk-collect`), rendered inside the host's React tree.
 *
 * Thin by construction: selection, polling/backoff, availability and projection logic live in
 * `src/shared/` so they are unit-tested without a DOM. This file owns only React state, the three
 * loaders and the five tab panels. Store strings render as React text nodes, never HTML.
 */

/** The Collect module's tab labels (ids are frozen in `shared/run-selection.ts`). */
const TAB_LABELS: Record<CollectTab, string> = {
    overview: 'Overview',
    summary: 'Run detail',
    items: 'Items',
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
 * while the document is hidden. The loader owns its own `gave up/last success` bookkeeping
 * through `src/shared/refresh.ts`, which stays the single owner of the polling rules.
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
        // Poll immediately on mount, then on the steady interval: a first visit must show the
        // recorded history/results without waiting a whole interval (a blank module for 30s was the
        // observed defect this replaces). `loop` awaits a loader that owns its own error handling.
        void loop();
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [intervalMs]);
}

/** The five tabs of the Collect module. */
export function CollectModule() {
    const [link] = useState(() => parseDeepLink(window.location.search, COLLECT_TABS, COLLECT_TAB_ALIASES));
    // A mistyped or hostile `kkApi` value falls back to the default reader with a diagnostic —
    // it never reaches `createBoardClient` and aborts the module during render (§4).
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
        tab: link.tab ?? 'overview',
    });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(reader.diagnostic === null ? [] : [reader.diagnostic]),
    ]);
    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [progress, setProgress] = useState<unknown>(null);
    const [overview, setOverview] = useState<CollectStoreOverview | null>(null);
    const [storeRun, setStoreRun] = useState<CollectRunStore | null>(null);
    const [items, setItems] = useState<CollectStoreItems | null>(null);
    const [itemFilters, setItemFilters] = useState<StoreItemsQuery>({ page: 1 });
    const [showEffective, setShowEffective] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');

    // `tick`'s pending bit + one busy ref per source: a manual Refresh/"Load more" click can
    // never overlap an in-flight poll and let the slower response win (§6).
    const historyBusy = useRef(false);
    const readerBusy = useRef(false);

    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    /** The store overview for the loaded page: ids only select rows, the reader calls no workflow. */
    const loadOverview = useCallback(
        async (runIds: readonly string[]) => {
            if (runIds.length === 0) return;
            try {
                setOverview(await client.storeOverview(runIds));
            } catch (error) {
                setDiagnostics((existing) => [
                    ...existing,
                    { code: 'board.store.unavailable', message: messageOf(error) },
                ]);
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
        } catch (error) {
            if (selectionRef.current.runId !== runId) return;
            setDiagnostics((existing) => [
                ...existing,
                { code: 'board.reader.unavailable', message: messageOf(error) },
            ]);
            setReaderRefresh((state) => failed(state, Date.now()));
        } finally {
            readerBusy.current = false;
        }
        // The store projection is a separate reader route: its failure states itself inside the
        // store panels (R7) instead of blanking the artifact-backed tabs.
        try {
            const nextStoreRun = await client.storeRun(runId);
            if (selectionRef.current.runId !== runId) return;
            setStoreRun(nextStoreRun);
        } catch (error) {
            if (selectionRef.current.runId !== runId) return;
            setDiagnostics((existing) => [
                ...existing,
                { code: 'board.store.run-unavailable', message: messageOf(error) },
            ]);
        }
        // §6: a reader outage affects the result/config panels, never Spur's own run history — the
        // progress projection comes from the Board API, so it is fetched independently of the reader
        // and a reader failure leaves the last good progress in place instead of blanking the tab.
        try {
            const nextProgress = await client.progress(runId);
            if (selectionRef.current.runId !== runId) return;
            setProgress(nextProgress);
        } catch {
            // The tab states unavailability; the reader failure above already carries the diagnosis.
        }
    }, [client]);

    // The items fetch is a racing one: a filter/page/run change starts a new request while an older
    // one may still be in flight. Only the newest token may write, so a slow earlier page can never
    // overwrite the newer one (same discipline as `historyBusy`/`readerBusy` above).
    const itemsRequests = useRef(requestSequence());

    const loadItems = useCallback(
        async (runId: string) => {
            const token = itemsRequests.current.begin();
            try {
                const page = await client.storeItems(runId, itemFilters);
                if (!itemsRequests.current.isCurrent(token)) return;
                setItems(page);
            } catch (error) {
                if (!itemsRequests.current.isCurrent(token)) return;
                setItems(null);
                setDiagnostics((existing) => [
                    ...existing,
                    { code: 'board.store.items-unavailable', message: messageOf(error) },
                ]);
            }
        },
        [client, itemFilters],
    );

    usePolling(loadHistory, HISTORY_POLL_MS, historyRefresh);
    usePolling(loadReader, ACTIVE_POLL_MS, readerRefresh);

    // The items page is fetched only for the Items tab, and re-fetched when the run or the
    // component-state filters change (the filters go to the 0307 route, not to a client filter).
    useEffect(() => {
        if (selection.tab !== 'items' || selection.runId === null) return;
        void loadItems(selection.runId);
    }, [selection.tab, selection.runId, loadItems]);

    // First visit picks the newest recorded run; a run disappearing never steals the selection.
    useEffect(() => {
        if (selection.runId === null && rows.length > 0) {
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link, 'overview') : state));
        }
    }, [rows, selection.runId, link]);

    // AC1: keep the address bar in step with the run/tab selection so a reload or a shared URL
    // restores it. The host router's history state is preserved by `syncSelectionUrl`.
    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history });
    }, [selection]);

    const tab = selection.tab;
    const now = Date.now();
    const currentStoreRun = storeRun?.runId === selection.runId ? storeRun : null;
    const facts = results === null ? [] : collectSummaryFacts(results, now);
    const artifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const steps: ProgressRow[] = progressRows(progress);
    const selectedRow = rows.find((row) => row.id === selection.runId);
    const filteredRows = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        if (q === '') return rows;
        return rows.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }, [rows, filterQuery]);

    /** The Run detail deep link for one Overview row (AC6: the same `?run=&tab=` shape). */
    const runHref = useCallback(
        (runId: string) => selectionPath({ runId, tab: 'summary' }, window.location.search),
        [],
    );
    const toggleQuality = useCallback(() => setShowEffective((state) => !state), []);
    /**
     * One change handler for all five item filters (`select name=`), so the panel stays handler-free.
     * A filter change starts at page 1, and a new decision clears the value it no longer names.
     */
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
                        Run <code>{selection.runId ?? 'none selected'}</code> · {freshnessLabel(readerRefresh)}
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
                                    // A new run starts at page 1: the page belongs to the previous run's
                                    // result set, and carrying it over can ask for a page that run does
                                    // not have (a false "No items match these filters." — G81 / 0312).
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
                    <button type="button" onClick={() => void loadReader()} title="Refresh run data">
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
            {tab === 'overview' ? <OverviewPanel runs={rows} overview={overview} now={now} runHref={runHref} /> : null}
            {tab === 'summary' ? (
                <RunDetailPanel
                    storeRun={currentStoreRun}
                    results={results}
                    facts={facts}
                    artifacts={artifacts}
                    showEffective={showEffective}
                    onToggleQuality={toggleQuality}
                />
            ) : null}
            {tab === 'items' ? (
                <ItemsPanel
                    runId={selection.runId}
                    items={items}
                    filters={itemFilters}
                    quality={currentStoreRun?.labelQuality ?? []}
                    onFilterChange={filterChanged}
                    onPageChange={pageChanged}
                />
            ) : null}
            {tab === 'progress' ? <ProgressPanel steps={steps} /> : null}
            {tab === 'config' ? <ConfigPanel config={config} /> : null}
            {dedupeDiagnostics([...diagnostics, ...(results?.diagnostics ?? [])]).map((diagnostic) => (
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
        </div>
    );
}

/** Entry the host mounts: no `createRoot`, no private Board context imports. */
export const webModule: BoardContribution = { apiVersion: 1, component: CollectModule };
