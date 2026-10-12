import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunConfig, RunResults } from '../contracts';
import { type BoardClient, createBoardClient, readerOriginFrom } from '../shared/api';
import { artifactViews, collectSummaryFacts, type ProgressRow, progressRows } from '../shared/collect';
import { dedupeDiagnostics, diagnosticLine, formatTimestamp } from '../shared/format';
import {
    ACTIVE_POLL_MS,
    delayMs,
    failed,
    freshnessLabel,
    HISTORY_POLL_MS,
    initialRefresh,
    type RefreshState,
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

/**
 * The Collect Board module (`kk-collect`), rendered inside the host's React tree.
 *
 * Thin by construction: selection, polling/backoff, availability and projection logic live in
 * `src/shared/` so they are unit-tested without a DOM. This file owns only React state, the two
 * polling loops and the four tab panels.
 */

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
        timer = setTimeout(() => void loop(), intervalMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [intervalMs]);
}

/** The four tabs of the Collect module. */
export function CollectModule() {
    const [link] = useState(() => parseDeepLink(window.location.search));
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
    const [selection, setSelection] = useState<RunSelection>({ runId: link.runId ?? null, tab: link.tab ?? 'summary' });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(reader.diagnostic === null ? [] : [reader.diagnostic]),
    ]);
    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [progress, setProgress] = useState<unknown>(null);

    // `tick`'s pending bit + one busy ref per source: a manual Refresh/"Load more" click can
    // never overlap an in-flight poll and let the slower response win (§6).
    const historyBusy = useRef(false);
    const readerBusy = useRef(false);

    const loadHistory = useCallback(async () => {
        if (historyBusy.current) return;
        historyBusy.current = true;
        setHistoryRefresh((state) => tick(state));
        try {
            const page = await client.runs('kk-collect');
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
        try {
            const [nextResults, nextConfig] = await Promise.all([
                client.results('kk-collect', runId),
                client.config('kk-collect', runId),
            ]);
            setResults(nextResults);
            setConfig(nextConfig);
            setReaderRefresh(() => succeeded(Date.now(), ACTIVE_POLL_MS));
        } catch (error) {
            setDiagnostics((existing) => [
                ...existing,
                { code: 'board.reader.unavailable', message: messageOf(error) },
            ]);
            setReaderRefresh((state) => failed(state, Date.now()));
        } finally {
            readerBusy.current = false;
        }
        // §6: a reader outage affects the result/config panels, never Spur's own run history — the
        // progress projection comes from the Board API, so it is fetched independently of the reader
        // and a reader failure leaves the last good progress in place instead of blanking the tab.
        try {
            setProgress(await client.progress(runId));
        } catch {
            // The tab states unavailability; the reader failure above already carries the diagnosis.
        }
    }, [client]);

    const selectionRef = useRef(selection);
    selectionRef.current = selection;

    usePolling(loadHistory, HISTORY_POLL_MS, historyRefresh);
    usePolling(loadReader, ACTIVE_POLL_MS, readerRefresh);

    // First visit picks the newest recorded run; a run disappearing never steals the selection.
    useEffect(() => {
        if (selection.runId === null && rows.length > 0) {
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link) : state));
        }
    }, [rows, selection.runId, link]);

    // AC1: keep the address bar in step with the run/tab selection so a reload or a shared URL
    // restores it. The host router's history state is preserved by `syncSelectionUrl`.
    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history });
    }, [selection]);

    const tab = selection.tab;
    const now = Date.now();
    const facts = results === null ? [] : collectSummaryFacts(results, now);
    const artifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const steps: ProgressRow[] = progressRows(progress);
    const selectedRow = rows.find((row) => row.id === selection.runId);

    return (
        <div className="kk-board kk-board-collect">
            <header className="kk-board-header">
                <h1>Collect</h1>
                <p>
                    Run <code>{selection.runId ?? 'none selected'}</code> · {selectedRow?.status ?? 'status unknown'} ·{' '}
                    {freshnessLabel(readerRefresh)}
                </p>
                {results === null ? null : <p>Results {results.availability}</p>}
                <button type="button" onClick={() => void loadReader()}>
                    Refresh
                </button>
                {selection.runId === null ? null : (
                    <a href={selectionPath(selection, window.location.search)}>Permanent link to this view</a>
                )}
            </header>
            <nav className="kk-board-tabs" aria-label="Collect tabs">
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
            <label className="kk-board-run-selector">
                Run
                <select
                    value={selection.runId ?? ''}
                    onChange={(event) => setSelection((state) => ({ ...state, runId: event.target.value || null }))}
                >
                    <option value="">{rows.length === 0 ? 'No runs recorded' : 'Select a run'}</option>
                    {rows.map((row) => (
                        <option key={row.id} value={row.id}>
                            {row.id} — {row.status}
                        </option>
                    ))}
                </select>
            </label>
            {rows.length === 0 ? (
                <p className="kk-board-empty">
                    No runs recorded for kk-collect. Configure the workflow in{' '}
                    <a href="/board/settings/workflows">Settings → Workflows</a>.
                </p>
            ) : null}
            {tab === 'summary' ? <SummaryPanel facts={facts} results={results} /> : null}
            {tab === 'results' ? <ResultsPanel artifacts={artifacts} /> : null}
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

/** Summary: execution status kept apart from result outcome, with every unknown explicit. */
function SummaryPanel({
    facts,
    results,
}: {
    facts: ReturnType<typeof collectSummaryFacts>;
    results: RunResults | null;
}) {
    if (results === null) return <p>No captured results for the selected run.</p>;
    return (
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
    );
}

/** Results: ingestion/labeling evidence plus allowlisted downloads. */
function ResultsPanel({ artifacts }: { artifacts: ReturnType<typeof artifactViews> }) {
    if (artifacts.length === 0) return <p>No artifact evidence for the selected run.</p>;
    return (
        <ul className="kk-board-artifacts">
            {artifacts.map((artifact) => (
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
    );
}

/** Execution progress: recorded state visits and attempts; never an execution action. */
function ProgressPanel({ steps }: { steps: ProgressRow[] }) {
    if (steps.length === 0) return <p>Recorded progress is unavailable for the selected run.</p>;
    return (
        <ul className="kk-board-progress">
            {steps.map((step) => (
                <li key={`${step.state}-${step.visit}`}>
                    <strong>{step.state}</strong> visit {step.visit} — {step.status} · {step.timing}
                    {step.operatorWait ? <span className="kk-board-state"> operator wait</span> : null}
                    {step.actions.length === 0 ? null : (
                        <ul>
                            {step.actions.map((action) => (
                                <li key={action}>{action}</li>
                            ))}
                        </ul>
                    )}
                </li>
            ))}
        </ul>
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
export const webModule: BoardContribution = { apiVersion: 1, component: CollectModule };
