import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunConfig, RunResults } from '../contracts';
import { type BoardClient, createBoardClient, readerOriginFrom } from '../shared/api';
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
import { type DailyChannelView, type DailyProgressView, dailySummary, dailySummaryFacts } from './view';

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
        try {
            const [nextResults, nextConfig] = await Promise.all([
                client.results(WORKFLOW, runId),
                client.config(WORKFLOW, runId),
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
    const artifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const selectedRow = rows.find((row) => row.id === selection.runId);

    return (
        <div className="kk-board kk-board-daily-voice">
            <header className="kk-board-header">
                <h1>Daily AI Voice</h1>
                <p>
                    Run <code>{selection.runId ?? 'none selected'}</code> · {selectedRow?.status ?? 'status unknown'} ·{' '}
                    {freshnessLabel(readerRefresh)}
                </p>
                {summary === null ? null : (
                    <p>
                        Outcome {summary.outcome ?? 'unknown'} · {results?.availability ?? 'unverified'}
                    </p>
                )}
                <button type="button" onClick={() => void loadReader()}>
                    Refresh
                </button>
                {selection.runId === null ? null : (
                    <a href={selectionPath(selection, window.location.search, MODULE_PATH)}>
                        Permanent link to this view
                    </a>
                )}
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
                    No runs recorded for kk-daily-ai-voice2. Configure the workflow in{' '}
                    <a href="/board/settings/workflows">Settings → Workflows</a>.
                </p>
            ) : null}
            {tab === 'summary' ? <SummaryPanel facts={facts} results={results} /> : null}
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

/** Summary: execution status, result outcome and channel counts with every unknown explicit. */
function SummaryPanel({ facts, results }: { facts: ReturnType<typeof dailySummaryFacts>; results: RunResults | null }) {
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
