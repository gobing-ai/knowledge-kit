import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectChannelYield, RunConfig, RunResults } from '../contracts';
import { type BoardClient, createBoardClient, DEFAULT_READER_ORIGIN, readerOriginFrom } from '../shared/api';
import { ChannelYieldTable, PluginRunTable } from '../shared/channel-yield';
import { artifactViews } from '../shared/collect';
import { dedupeDiagnostics, diagnosticLine, formatTimestamp } from '../shared/format';
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
    BOARD_TABS,
    type BoardTab,
    mergeRunPages,
    parseDeepLink,
    type RunListRow,
    type RunSelection,
    resolveSelection,
    selectionPath,
    syncSelectionUrl,
} from '../shared/run-selection';
import {
    type DailyChannelView,
    type DailyFunnelView,
    type DailyProgressView,
    type DailySupplyContext,
    dailySummary,
    dailySummaryFacts,
    funnelView,
    supplyContextOf,
} from './view';

/**
 * The Daily AI Voice Board module (`kk-daily-ai-voice2`), rendered inside the host's React tree.
 *
 * Thin by construction: selection, polling/backoff, availability and projection logic live in
 * `src/shared/` and `./view.ts` so they are unit-tested without a DOM. This file owns only the
 * React state, the two polling loops and the four tab panels.
 */

/** The workflow this module inspects. */
const WORKFLOW = 'kk-daily-ai-voice2';

/** The host route the module is mounted at. */
const MODULE_PATH = '/board/modules/kk-daily-ai-voice2';

const TAB_LABELS: Record<BoardTab, string> = {
    summary: 'Summary',
    results: 'Results',
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

/** A fetch that never reached the reader reads as offline, not as missing data. */
function isOfflineError(message: string): boolean {
    return message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('ECONNREFUSED');
}

/**
 * Poll one async loader on a steady interval with a capped backoff after failures, stopping while
 * the document is hidden. The loader owns its own bookkeeping through `src/shared/refresh.ts`.
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
            if (!document.hidden) await loaderRef.current();
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

/** The four tabs of the Daily AI Voice module. */
export function DailyVoiceModule() {
    const [link] = useState(() => parseDeepLink(window.location.search));
    const [reader] = useState(() => readerOriginFrom(window.location.search));
    // G82: the ONE store consumption — the 0319 channels aggregate, read through the loopback
    // aggregate reader (a valid kkApi override wins, else the documented default; ADR-035 2026-10-22).
    const [aggregateReader] = useState(() => readerOriginFrom(window.location.search, DEFAULT_READER_ORIGIN));
    const readerOrigin = reader.origin;
    const client = useMemo<BoardClient>(
        () =>
            createBoardClient({
                readerOrigin,
                aggregateReaderOrigin: aggregateReader.origin,
                boardOrigin: window.location.origin,
            }),
        [readerOrigin, aggregateReader.origin],
    );
    const [rows, setRows] = useState<RunListRow[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [selection, setSelection] = useState<RunSelection>({ runId: link.runId ?? null, tab: link.tab ?? 'summary' });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(reader.diagnostic === null ? [] : [reader.diagnostic]),
        ...(aggregateReader.diagnostic === null ? [] : [aggregateReader.diagnostic]),
    ]);
    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [filterQuery, setFilterQuery] = useState('');

    // G82: supply context (channels aggregate) for the Summary tab. Keyed to run + bounds, with a
    // sequence token so a stale response never overwrites the panel of a newer selection.
    const [supply, setSupply] = useState<CollectChannelYield | null>(null);
    const [storeOffline, setStoreOffline] = useState(false);
    const supplyRequests = useRef(requestSequence());
    const supplyKeyRef = useRef<string | null>(null);

    // One busy ref per source: a manual Refresh/"Load more" click can never overlap an in-flight poll.
    const historyBusy = useRef(false);
    const readerBusy = useRef(false);
    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    const loadHistory = useCallback(async () => {
        if (historyBusy.current) return;
        historyBusy.current = true;
        setHistoryRefresh((state) => tick(state));
        try {
            const page = await client.runs(WORKFLOW);
            setRows((existing) => mergeRunPages(existing, page).runs);
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
    }, [client]);

    const loadReader = useCallback(async () => {
        if (readerBusy.current) return;
        const runId = selectionRef.current.runId;
        if (runId === null) return;
        readerBusy.current = true;
        setReaderRefresh((state) => tick(state));
        // A response for a run the operator has already left is stale: it is discarded and the
        // newly selected run is fetched immediately (no wrong-run panel for a whole poll cycle).
        let stale = false;
        try {
            const [nextResults, nextConfig] = await Promise.all([
                client.results(WORKFLOW, runId),
                client.config(WORKFLOW, runId),
            ]);
            if (selectionRef.current.runId !== runId) {
                stale = true;
                return;
            }
            setResults(nextResults);
            setConfig(nextConfig);
            setReaderRefresh(() => succeeded(Date.now(), ACTIVE_POLL_MS));
        } catch (error) {
            if (selectionRef.current.runId !== runId) {
                stale = true;
                return;
            }
            setDiagnostics((existing) => [
                ...existing,
                { code: 'board.reader.unavailable', message: messageOf(error) },
            ]);
            setReaderRefresh((state) => failed(state, Date.now()));
        } finally {
            readerBusy.current = false;
            if (stale) void loadReader();
        }
    }, [client]);

    usePolling(loadHistory, HISTORY_POLL_MS, historyRefresh);
    usePolling(loadReader, ACTIVE_POLL_MS, readerRefresh);

    useEffect(() => {
        if (selection.runId === null && rows.length > 0) {
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link) : state));
        }
    }, [rows, selection.runId, link]);

    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history }, MODULE_PATH);
    }, [selection]);

    const tab = selection.tab;
    const now = Date.now();
    const summary = results === null ? null : dailySummary(results);
    const facts = results === null ? [] : dailySummaryFacts(results, now);
    const funnel = funnelView(results?.summary.funnel);
    const context = supplyContextOf(config?.settings.window ?? null, summary?.startedAt ?? null);
    // G82: the configured supply interval — [startedAt − captured window, startedAt). Unknown
    // input renders unknown and issues NO store query (ADR-035 2026-10-22).
    useEffect(() => {
        const bounds = tab === 'summary' && context !== null ? context : null;
        const key = bounds === null ? null : `${selection.runId}:${bounds.fromMs}:${bounds.untilMs}`;
        if (key === supplyKeyRef.current) return;
        supplyKeyRef.current = key;
        if (bounds === null) {
            setSupply(null);
            return;
        }
        const token = supplyRequests.current.begin();
        let cancelled = false;
        void (async () => {
            try {
                const page = await client.storeChannels({ fromMs: bounds.fromMs, untilMs: bounds.untilMs, page: 1 });
                if (cancelled || !supplyRequests.current.isCurrent(token)) return;
                setSupply(page);
                setStoreOffline(false);
            } catch (error) {
                if (cancelled || !supplyRequests.current.isCurrent(token)) return;
                setSupply(null);
                const message = messageOf(error);
                if (isOfflineError(message)) setStoreOffline(true);
                else setDiagnostics((existing) => [...existing, { code: 'board.store.channels-unavailable', message }]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [client, tab, context, selection.runId]);
    const artifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const selectedRow = rows.find((row) => row.id === selection.runId);
    const filteredRows = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        if (q === '') return rows;
        return rows.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }, [rows, filterQuery]);

    return (
        <div className="kk-board kk-board-daily-voice">
            <header className="kk-board-header">
                <div className="kk-board-header-left">
                    <div className="kk-board-header-title-row">
                        <h1>Daily AI Voice</h1>
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
                        {summary === null
                            ? ''
                            : ` · Outcome ${summary.outcome ?? 'unknown'} · ${results?.availability ?? 'unverified'}`}
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
                                onChange={(event) =>
                                    setSelection((state) => ({ ...state, runId: event.target.value || null }))
                                }
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
                            href={selectionPath(selection, window.location.search, MODULE_PATH)}
                            className="kk-btn-action"
                            title="Permanent link"
                        >
                            🔗 Link
                        </a>
                    )}
                </div>
            </header>
            <nav className="kk-board-tabs" aria-label="Daily AI Voice tabs">
                {BOARD_TABS.map((candidate) => (
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
                    No runs recorded for kk-daily-ai-voice2. Configure the workflow in{' '}
                    <a href="/board/settings/workflows">Settings → Workflows</a>.
                </p>
            ) : null}
            {tab === 'summary' ? (
                <SummaryPanel
                    facts={facts}
                    results={results}
                    funnel={funnel}
                    artifacts={artifacts}
                    context={context}
                    supply={supply}
                    storeOffline={storeOffline}
                />
            ) : null}
            {tab === 'results' ? <ResultsPanel artifacts={artifacts} channels={summary?.channels ?? []} /> : null}
            {tab === 'progress' ? <ProgressPanel progress={summary?.progress ?? null} /> : null}
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

/** Summary: execution status, result outcome, the episode funnel and the supply context panel. */
function SummaryPanel({
    facts,
    results,
    funnel,
    artifacts,
    context,
    supply,
    storeOffline,
}: {
    facts: ReturnType<typeof dailySummaryFacts>;
    results: RunResults | null;
    funnel: DailyFunnelView;
    artifacts: ReturnType<typeof artifactViews>;
    context: DailySupplyContext | null;
    supply: CollectChannelYield | null;
    storeOffline: boolean;
}) {
    if (results === null) return <p>No captured results for the selected run.</p>;
    const summary = dailySummary(results);
    const liveChannels = summary.channels.filter((c) => c.state === 'live').length;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div className="kk-stat-grid">
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Episode Outcome</span>
                    <span className="kk-stat-value">{summary.outcome ?? '—'}</span>
                    <span className="kk-stat-sub">
                        {summary.articleTitle ? summary.articleTitle.slice(0, 32) : 'Daily podcast'}
                    </span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Distribution</span>
                    <span className="kk-stat-value">
                        {liveChannels} / {summary.channels.length}
                    </span>
                    <span className="kk-stat-sub">Channels published live</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Quality Score</span>
                    <span className="kk-stat-value">{summary.quality?.overallScore ?? '—'}</span>
                    <span className="kk-stat-sub">
                        {summary.quality?.passed ? 'Passed QC standard' : 'Under evaluation'}
                    </span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Safety Verdict</span>
                    <span className="kk-stat-value">{summary.safety?.verdict ?? '—'}</span>
                    <span className="kk-stat-sub">Confidence: {summary.safety?.confidence ?? '—'}</span>
                </div>
            </div>
            <dl className="kk-board-facts">
                {facts.map((fact) => (
                    <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>
                            {fact.value} <span className="kk-board-state">{fact.availability}</span>
                        </dd>
                    </div>
                ))}
            </dl>
            <FunnelPanel funnel={funnel} artifacts={artifacts} />
            <SupplyPanel context={context} supply={supply} storeOffline={storeOffline} />
        </div>
    );
}

/** A count that is `unavailable` when the artifact evidence was never recorded. */
function funnelCount(value: number | null): string {
    return value === null ? 'unavailable' : String(value);
}

/** Minutes with one decimal, or `unavailable` — never a guessed duration. */
function funnelMinutes(value: number | null): string {
    return value === null ? 'unavailable' : `${value.toFixed(1)} min`;
}

/** The evidence chip for one funnel field: the fixed artifact id, linked when authorized. */
function EvidenceChip({
    field,
    funnel,
    artifacts,
}: {
    field: string;
    funnel: DailyFunnelView;
    artifacts: ReturnType<typeof artifactViews>;
}) {
    const evidenceId = funnel.evidence[field];
    if (evidenceId === undefined) return <span className="kk-board-state">no evidence</span>;
    if (evidenceId === 'captured-settings') return <code>captured-settings</code>;
    const artifact = artifacts.find((candidate) => candidate.id === evidenceId);
    return artifact === undefined || artifact.href === null ? (
        <code>
            {evidenceId} ({artifact?.state ?? 'missing'})
        </code>
    ) : (
        <a href={artifact.href}>
            <code>{evidenceId}</code>
        </a>
    );
}

/**
 * The artifact-backed episode funnel: pool → annotation → topic filter → QC rejection → dedup →
 * plan, the duration ladder bounds and the no-content gate. Counts come from the run's own
 * artifacts with their evidence ids; unknown stays unavailable, never 0.
 */
function FunnelPanel({ funnel, artifacts }: { funnel: DailyFunnelView; artifacts: ReturnType<typeof artifactViews> }) {
    const rows: { label: string; value: string; field: string }[] = [
        { label: '1 · Episode pool', value: funnelCount(funnel.poolCount), field: 'poolCount' },
        { label: '2 · Annotated', value: funnelCount(funnel.annotatedCount), field: 'annotatedCount' },
        { label: '3 · Topic filter kept', value: funnelCount(funnel.topicKeptCount), field: 'topicKeptCount' },
        { label: '4 · QC rejected', value: funnelCount(funnel.qcRejectedCount), field: 'qcRejectedCount' },
        {
            label: '5 · Post-dedup survivors',
            value:
                funnel.dedupKeptCount === null && funnel.plannedCount !== null
                    ? 'unknown — plan recorded'
                    : funnel.dedupKeptCount === null &&
                        (funnel.gate === 'episode-duration' || funnel.gate === 'script' || funnel.gate === 'qc-floor')
                      ? 'unknown — cleared by the refusal'
                      : funnelCount(funnel.dedupKeptCount),
            field: 'dedupKeptCount',
        },
        { label: '6 · Episode plan', value: funnelCount(funnel.plannedCount), field: 'plannedCount' },
    ];
    return (
        <section className="kk-card kk-daily-funnel">
            <div className="kk-card-header">
                <h2>Episode funnel</h2>
                <span className="kk-stat-sub">artifact-backed by this run</span>
            </div>
            <dl>
                {rows.map((row) => (
                    <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>
                            {row.value} · evidence{' '}
                            <EvidenceChip field={row.field} funnel={funnel} artifacts={artifacts} />
                        </dd>
                    </div>
                ))}
                <div key="minutes">
                    <dt>Duration ladder</dt>
                    <dd>
                        measured {funnelMinutes(funnel.measuredMinutes)} · estimated{' '}
                        {funnelMinutes(funnel.estimatedMinutes)} · floor {funnelMinutes(funnel.minMinutes)} · ceiling{' '}
                        {funnelMinutes(funnel.maxMinutes)}
                    </dd>
                </div>
                <div key="gate">
                    <dt>No-content gate</dt>
                    <dd>
                        {funnel.gateName} · evidence <EvidenceChip field="gate" funnel={funnel} artifacts={artifacts} />
                    </dd>
                </div>
            </dl>
            {funnel.exclusions.length === 0 ? null : (
                <div>
                    <h3>Topic-filter exclusions</h3>
                    <ul className="kk-board-channels">
                        {funnel.exclusions.map((exclusion) => (
                            // One rule can exclude several matched strings, so both identify a row.
                            <li key={`${exclusion.rule}::${exclusion.matched}`}>
                                <strong>{exclusion.rule}</strong>
                                {exclusion.matched === '' ? null : ` — matched “${exclusion.matched}”`}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {funnel.diagnostics.length === 0 ? null : (
                <ul>
                    {funnel.diagnostics.map((diagnostic) => (
                        <li key={diagnostic.code} role="status" className="kk-board-diagnostic">
                            {diagnostic.code}: {diagnostic.message}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

/**
 * The ONE store consumption (ADR-035 2026-10-22): the 0319 channels aggregate rendered as supply
 * CONTEXT for the half-open interval configured for this run. The extract ladder bounds are not
 * persisted, so the panel is labeled configured context and the effective extraction window stays
 * unknown; the artifact-backed funnel above remains the consumption truth.
 */
function SupplyPanel({
    context,
    supply,
    storeOffline,
}: {
    context: DailySupplyContext | null;
    supply: CollectChannelYield | null;
    storeOffline: boolean;
}) {
    return (
        <section className="kk-card kk-daily-supply">
            <div className="kk-card-header">
                <h2>Supply context (configured)</h2>
                <span className="kk-stat-sub">read from the kk-collect store</span>
            </div>
            {context === null ? (
                <p>
                    The configured supply interval is unknown — no captured window setting or run start was recorded, so
                    no store query was issued.
                </p>
            ) : (
                <p>
                    Window <code>{context.fromLabel}</code> → <code>{context.untilLabel}</code>
                    {supply === null ? '' : ` · time zone ${supply.timeZone}`} — configured context; the effective
                    extraction window (ladder bounds) is unknown, not persisted.
                </p>
            )}
            {storeOffline ? <p>The store reader is offline; supply counts are unavailable.</p> : null}
            {supply !== null && supply.availability === 'unavailable' ? (
                <p>The store could not be read for this window; no counts are shown.</p>
            ) : null}
            {supply !== null && supply.availability === 'unavailable' && supply.diagnostics.length > 0 ? (
                <ul>
                    {supply.diagnostics.map((diagnostic) => (
                        <li key={diagnostic.code} className="kk-board-diagnostic">
                            {diagnostic.code}: {diagnostic.message}
                        </li>
                    ))}
                </ul>
            ) : null}
            {supply !== null && supply.availability === 'available' ? (
                <div className="kk-summary-grids">
                    <div className="kk-card">
                        <div className="kk-card-header">
                            <h2>New items by day and source</h2>
                            <span className="kk-stat-sub">{supply.sources.length} sources</span>
                        </div>
                        <div className="kk-table-container">
                            <ChannelYieldTable data={supply} />
                        </div>
                    </div>
                    <div className="kk-card">
                        <div className="kk-card-header">
                            <h2>Collection ticks and plugin contributions</h2>
                            <span className="kk-stat-sub">{supply.plugins.length} plugins</span>
                        </div>
                        <div className="kk-table-container">
                            <PluginRunTable data={supply} />
                        </div>
                    </div>
                </div>
            ) : null}
            <p className="kk-board-footnote">
                A source absent from this window recorded 0 contributions; its health is unknown. The episode funnel
                above stays artifact-backed — supply here is context, not the run’s consumption record.
            </p>
        </section>
    );
}

/** One channel row: draft/live/skipped/failed, with a public link only when one was recorded. */
function ChannelList({ channels }: { channels: DailyChannelView[] }) {
    if (channels.length === 0) return <p>No channel outcomes recorded for the selected run.</p>;
    return (
        <ul className="kk-board-channels">
            {channels.map((channel) => (
                <li key={channel.channel}>
                    <strong>{channel.label}</strong> — {channel.state}
                    {channel.detail === null ? null : <span className="kk-board-state"> ({channel.detail})</span>}
                    {channel.url === null ? null : (
                        <>
                            {' '}
                            <a href={channel.url} rel="noreferrer">
                                open
                            </a>
                        </>
                    )}
                </li>
            ))}
        </ul>
    );
}

/** Results: article/cover/script/audio evidence, report links and per-channel outcomes. */
function ResultsPanel({
    artifacts,
    channels,
}: {
    artifacts: ReturnType<typeof artifactViews>;
    channels: DailyChannelView[];
}) {
    if (artifacts.length === 0) return <p>No artifact evidence for the selected run.</p>;
    const media = artifacts.filter((artifact) => artifact.kind === 'image' || artifact.kind === 'audio');
    const files = artifacts.filter((artifact) => artifact.kind !== 'image' && artifact.kind !== 'audio');
    return (
        <div className="kk-board-results">
            {media.map((artifact) =>
                artifact.href === null ? (
                    <p key={artifact.id}>
                        {artifact.label} — {artifact.state}
                    </p>
                ) : artifact.kind === 'audio' ? (
                    <p key={artifact.id}>
                        <audio controls src={artifact.href}>
                            {/* The episode audio has no caption track; the element still needs one to satisfy the media a11y rule. */}
                            <track kind="captions" />
                        </audio>
                        <a href={artifact.href} download>
                            download {artifact.label}
                        </a>{' '}
                        — {artifact.state}
                    </p>
                ) : (
                    <p key={artifact.id}>
                        <img src={artifact.href} alt={artifact.label} /> {artifact.label} — {artifact.state}
                    </p>
                ),
            )}
            <ul className="kk-board-artifacts">
                {files.map((artifact) => (
                    <li key={artifact.id}>
                        {artifact.href === null ? (
                            <span>
                                {artifact.label} — {artifact.state}
                            </span>
                        ) : (
                            <a href={artifact.href}>
                                {artifact.label} — {artifact.state}
                            </a>
                        )}
                    </li>
                ))}
            </ul>
            <ChannelList channels={channels} />
        </div>
    );
}

/** Execution progress: DAG node attempts + captured dependency edges; unknown edges stay unknown. */
function ProgressPanel({ progress }: { progress: DailyProgressView | null }) {
    if (progress === null || progress.nodes.length === 0) {
        return <p>Recorded progress is unavailable for the selected run.</p>;
    }
    return (
        <div className="kk-board-progress">
            <ul>
                {progress.nodes.map((node) => (
                    <li key={node.id}>
                        <strong>{node.id}</strong> — {node.status} · {node.timing}
                        {node.attempts > 1 ? <span className="kk-board-state"> {node.attempts} attempts</span> : null}
                    </li>
                ))}
            </ul>
            {progress.edgesKnown && progress.edges !== null ? (
                <ul className="kk-board-edges">
                    {progress.edges.map((edge) => (
                        <li key={`${edge.from}->${edge.to}`}>
                            {edge.from} → {edge.to}
                        </li>
                    ))}
                </ul>
            ) : (
                <p>
                    Dependency edges are unknown — no digest-verified topology was captured. See{' '}
                    <a href="/board/settings/workflows">Settings → Workflows</a> for the current graph.
                </p>
            )}
            {progress.childRunId === null ? null : (
                <p>
                    Nested safety run: <code>{progress.childRunId}</code>
                </p>
            )}
        </div>
    );
}

/** Workflow Config Summary: captured run values only; current definitions stay in Settings. */
function ConfigPanel({ config }: { config: RunConfig | null }) {
    if (config === null) return <p>No captured configuration for the selected run.</p>;
    const entries = Object.entries(config.settings);
    return (
        <div className="kk-board-config">
            <p>Captured {formatTimestamp(config.capturedAt)}</p>
            {entries.length === 0 ? <p>Recorded configuration unavailable for this run.</p> : null}
            <dl>
                {entries.map(([key, value]) => (
                    <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            {config.unavailableKeys.length === 0 ? null : <p>Uncaptured keys: {config.unavailableKeys.join(', ')}</p>}
            <p>
                Current definitions and defaults live in <a href="/board/settings/workflows">Settings → Workflows</a>.
            </p>
        </div>
    );
}

/** Entry the host mounts: no `createRoot`, no private Board context imports. */
export const webModule: BoardContribution = { apiVersion: 1, component: DailyVoiceModule };
