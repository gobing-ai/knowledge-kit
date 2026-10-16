import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunConfig, RunResults } from '../contracts';
import { type BoardClient, createBoardClient, readerOriginFrom } from '../shared/api';
import { artifactViews, type ProgressRow, progressRows } from '../shared/collect';
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
import { type ItcPreviewView, type ItcSummaryView, itcSummary, itcSummaryFacts } from './view';

/**
 * The IT Content Board module (`kk-itc`), rendered inside the host's React tree.
 *
 * Thin by construction: selection, polling/backoff, availability, progress and projection logic
 * live in `src/shared/` and `./view.ts` so they are unit-tested without a DOM. This file owns only
 * the React state, the polling loops and the four tab panels.
 */

/** The workflow this module inspects. */
const WORKFLOW = 'kk-itc';

/** The host route the module is mounted at. */
const MODULE_PATH = '/board/modules/kk-itc';

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

/** The four tabs of the IT Content module. */
export function ItcModule() {
    const [link] = useState(() => parseDeepLink(window.location.search));
    // A mistyped or hostile `kkApi` value falls back to the default reader with a diagnostic.
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
    const [filterQuery, setFilterQuery] = useState('');

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
        // §6: a reader outage never blanks the state-machine progress, which comes from the Board API.
        try {
            setProgress(await client.progress(runId));
        } catch {
            // The tab states unavailability; the reader failure above already carries the diagnosis.
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
    const summary = results === null ? null : itcSummary(results);
    const facts = results === null ? [] : itcSummaryFacts(results, now);
    const artifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const steps: ProgressRow[] = progressRows(progress);
    const selectedRow = rows.find((row) => row.id === selection.runId);
    const filteredRows = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        if (q === '') return rows;
        return rows.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }, [rows, filterQuery]);

    return (
        <div className="kk-board kk-board-itc">
            <header className="kk-board-header">
                <div className="kk-board-header-left">
                    <div className="kk-board-header-title-row">
                        <h1>IT Content</h1>
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
            <nav className="kk-board-tabs" aria-label="IT Content tabs">
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
                    No runs recorded for kk-itc. Configure the workflow in{' '}
                    <a href="/board/settings/workflows">Settings → Workflows</a>.
                </p>
            ) : null}
            {tab === 'summary' ? <SummaryPanel facts={facts} results={results} /> : null}
            {tab === 'results' ? <ResultsPanel summary={summary} artifacts={artifacts} /> : null}
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

/** Summary: execution status, result outcome, judge/revision evidence and every unknown explicit. */
function SummaryPanel({ facts, results }: { facts: ReturnType<typeof itcSummaryFacts>; results: RunResults | null }) {
    if (results === null) return <p>No captured results for the selected run.</p>;
    const summary = itcSummary(results);
    const readyTargets = summary.targets.filter((t) => t.state === 'live' || t.state === 'draft').length;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div className="kk-stat-grid">
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Article Outcome</span>
                    <span className="kk-stat-value">{summary.outcome ?? '—'}</span>
                    <span className="kk-stat-sub">IT Content pipeline</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Publish Targets</span>
                    <span className="kk-stat-value">
                        {readyTargets} / {summary.targets.length}
                    </span>
                    <span className="kk-stat-sub">Platforms prepared</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Judge Verdict</span>
                    <span className="kk-stat-value">{summary.judge?.verdict ?? '—'}</span>
                    <span className="kk-stat-sub">Confidence: {summary.judge?.confidence ?? '—'}</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Revision Rounds</span>
                    <span className="kk-stat-value">{summary.revisions.revise ?? 0}</span>
                    <span className="kk-stat-sub">{summary.revisions.autoRevise ?? 0} automated revisions</span>
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
        </div>
    );
}

/** One outline/draft preview block, or an explicit availability when it is not readable. */
function PreviewBlock({ preview }: { preview: ItcPreviewView }) {
    return (
        <div className="kk-board-preview">
            <strong>{preview.label}</strong> <span className="kk-board-state">{preview.availability}</span>
            {preview.text === null ? null : <pre>{preview.text}</pre>}
        </div>
    );
}

/** Results: outlines, draft, judge/revision evidence, illustrations, per-target outcomes, report. */
function ResultsPanel({
    summary,
    artifacts,
}: {
    summary: ItcSummaryView | null;
    artifacts: ReturnType<typeof artifactViews>;
}) {
    if (summary === null) return <p>No artifact evidence for the selected run.</p>;
    const cover = artifacts.find((artifact) => artifact.id === 'cover');
    const report = artifacts.find((artifact) => artifact.id === 'report');
    const files = artifacts.filter((artifact) => artifact.id !== 'cover' && artifact.id !== 'report');
    return (
        <div className="kk-board-results">
            <section>
                <h2>Outlines</h2>
                {summary.outlines.length === 0 ? (
                    <p>No outline alternatives were recorded.</p>
                ) : (
                    summary.outlines.map((outline) => <PreviewBlock key={outline.id} preview={outline} />)
                )}
                {summary.selectedOutline === null ? (
                    <p>No selected outline was recorded.</p>
                ) : (
                    <PreviewBlock preview={summary.selectedOutline} />
                )}
            </section>
            <section>
                <h2>Draft</h2>
                {summary.draft === null ? <p>No draft was recorded.</p> : <PreviewBlock preview={summary.draft} />}
            </section>
            <section>
                <h2>Judge &amp; revisions</h2>
                {summary.judge === null ? (
                    <p>No judge verdict was recorded.</p>
                ) : (
                    <p>
                        <strong>{summary.judge.verdict ?? 'verdict not recorded'}</strong>{' '}
                        {summary.judge.confidenceInvalid ? (
                            <span className="kk-board-state">confidence outside HIGH/MEDIUM/LOW</span>
                        ) : (
                            <span className="kk-board-state">
                                {summary.judge.confidence ?? 'confidence not recorded'}
                            </span>
                        )}
                    </p>
                )}
                {summary.judge === null || summary.judge.feedback.length === 0 ? null : (
                    <ul className="kk-board-feedback">
                        {summary.judge.feedback.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                )}
                {summary.revisions.recorded ? (
                    <p>
                        {summary.revisions.revise ?? 0} interactive + {summary.revisions.autoRevise ?? 0} auto revision
                        rounds (budget {summary.revisions.budget ?? 'unknown'})
                    </p>
                ) : (
                    <p>No recorded revision visits.</p>
                )}
            </section>
            <section>
                <h2>Illustrations</h2>
                {cover === undefined || cover.href === null ? (
                    <p>Cover illustration — {cover?.state ?? 'not recorded'}</p>
                ) : (
                    <p>
                        <img src={cover.href} alt="Cover illustration" /> {cover.state}
                    </p>
                )}
            </section>
            <section>
                <h2>Publish targets</h2>
                {summary.targets.length === 0 ? (
                    <p>No publish targets were planned for this run.</p>
                ) : (
                    <ul className="kk-board-targets">
                        {summary.targets.map((target) => (
                            <li key={`${target.transport}-${target.target}`}>
                                <strong>{target.target}</strong> — {target.state}
                                <span className="kk-board-state"> ({target.detail})</span>
                                {target.url === null ? null : (
                                    <>
                                        {' '}
                                        <a href={target.url} rel="noreferrer">
                                            open
                                        </a>
                                    </>
                                )}
                                {target.error === null ? null : <span className="kk-board-state"> {target.error}</span>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section>
                <h2>Final report</h2>
                {summary.report === null ? (
                    <p>No run report was recorded.</p>
                ) : (
                    <p>
                        Outcome {summary.report.outcome ?? 'unknown'} · verdict {summary.report.verdict ?? 'unknown'} ·{' '}
                        {summary.report.revisions ?? 'unknown'} revisions
                    </p>
                )}
                {report === undefined || report.href === null ? null : <a href={report.href}>Open the run report</a>}
            </section>
            <section>
                <h2>Files</h2>
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
            </section>
        </div>
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
export const webModule: BoardContribution = { apiVersion: 1, component: ItcModule };
