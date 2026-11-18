import {
    Badge,
    type BadgeVariant,
    Diagnostic,
    EmptyState,
    ModuleHeader,
    ModuleShell,
    ModuleTabs,
    withBase,
} from '@gobing-ai/spur/board/ui';
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectChannelYield, NewsSummaryEvidence, RunConfig, RunEvidence, RunResults } from '../contracts';
import { type BoardClient, createBoardClient, DEFAULT_READER_ORIGIN, readerOriginFrom } from '../shared/api';
import { ChannelYieldTable, PluginRunTable } from '../shared/channel-yield';
import { type ArtifactView, artifactViews, type ResultFact } from '../shared/collect';
import { dedupeDiagnostics, formatTimestamp } from '../shared/format';
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
    mergeRunPages,
    parseDeepLink,
    type RunListRow,
    type RunSelection,
    resolveSelection,
    selectionPath,
    syncSelectionUrl,
} from '../shared/run-selection';
import {
    type GenerationStageRow,
    generationStageRows,
    latestIssue,
    newsSummaryFacts,
    newsSummaryOf,
    type OutputGroup,
    outputGroups,
    type PublishingTargetRow,
    publishingWindowRows,
    type StateTone,
    uncapturedDiagnostic,
} from './evidence';
import {
    DAILY_VIEW_ALIASES,
    DAILY_VIEWS,
    DAILY_WORKFLOW,
    type DailyChannelView,
    type DailyFunnelView,
    type DailySupplyContext,
    type DailyView,
    dailySummary,
    dailySummaryFacts,
    funnelView,
    pickDailyFamily,
    RETIRED_DAILY_WORKFLOWS,
    retiredLayoutNotice,
    supplyContextOf,
} from './view';

/**
 * The Daily AI Voice Board module (`kk-daily-ai-voice2` route), rendered inside the host's React
 * tree on the native module UI kit (0390, L3 R11).
 *
 * Three views — Summary, Generation, Publishing — share ONE run selection. The news family
 * (`kk-news-generate`) renders the 0391 evidence envelope (`GET …/runs/<id>/evidence`) narrowed by
 * `./evidence.ts`; the retired voice2 families keep their legacy panels as the fallback layout, so
 * historical days stay readable (0384). Selection, polling/backoff, availability and projection
 * logic live in `src/shared/`, `./view.ts` and `./evidence.ts`; this file owns only React state,
 * the two polling loops and the view panels.
 */

/** The host route the module is mounted at. */
const MODULE_PATH = '/board/modules/kk-daily-ai-voice2';

/** The view tab strip identity: buttons are `${…}-${id}`, panels `${…}-panel-${id}`. */
const VIEW_TABS_ID = 'daily-voice-view';

/** Display labels for the three views, in strip order. */
const VIEW_LABELS: Record<DailyView, string> = {
    summary: 'Summary',
    generation: 'Generation',
    publishing: 'Publishing',
};

/** Kit badge variant for a recorded producer-state tone. */
const TONE_BADGE: Record<StateTone, BadgeVariant> = {
    info: 'info',
    success: 'success',
    warn: 'warning',
    error: 'error',
    neutral: 'neutral',
};

/** Badge variant for a run-list status word. */
function statusBadgeVariant(status: string): BadgeVariant {
    if (status === 'done' || status === 'success' || status === 'passed') return 'success';
    if (status === 'failed' || status === 'failure') return 'error';
    return 'info';
}

/** The installed host's contribution ABI (`@gobing-ai/spur/board/index.d.ts`, apiVersion 1). */
interface BoardContribution {
    readonly apiVersion: 1;
    readonly component: ComponentType;
}

/** A fetch that never reached the reader reads as offline, not as missing data. */
function isOfflineError(message: string): boolean {
    return message.includes('Failed to fetch') || message.includes('NetworkError') || message.includes('ECONNREFUSED');
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

/** The three views of the Daily AI Voice module, on the native kit shell. */
export function DailyVoiceModule() {
    const [link] = useState(() => parseDeepLink(window.location.search, DAILY_VIEWS, DAILY_VIEW_ALIASES));
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
    const [selection, setSelection] = useState<RunSelection<DailyView>>({
        runId: link.runId ?? null,
        tab: link.tab ?? 'summary',
    });
    const [diagnostics, setDiagnostics] = useState(() => [
        ...link.diagnostics,
        ...(reader.diagnostic === null ? [] : [reader.diagnostic]),
        ...(aggregateReader.diagnostic === null ? [] : [aggregateReader.diagnostic]),
    ]);
    const [historyRefresh, setHistoryRefresh] = useState<RefreshState>(() => initialRefresh(HISTORY_POLL_MS));
    const [readerRefresh, setReaderRefresh] = useState<RefreshState>(() => initialRefresh(ACTIVE_POLL_MS));
    // The selected run's reader payload, family-shaped: the news family answers the evidence
    // envelope; a retired voice2 family keeps the legacy results/config pair its panels render.
    const [evidence, setEvidence] = useState<RunEvidence | null>(null);
    const [results, setResults] = useState<RunResults | null>(null);
    const [config, setConfig] = useState<RunConfig | null>(null);
    const [filterQuery, setFilterQuery] = useState('');

    // G82: supply context (channels aggregate) for the Summary view. Keyed to run + bounds, with a
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
    // The family the selected rows came from: the reader payload must be asked of THAT family, or a
    // retired-layout run would be requested from the current one and answer 404 (0384).
    const [family, setFamily] = useState<string>(DAILY_WORKFLOW);
    const familyRef = useRef<string>(DAILY_WORKFLOW);

    const loadHistory = useCallback(async () => {
        if (historyBusy.current) return;
        historyBusy.current = true;
        setHistoryRefresh((state) => tick(state));
        try {
            // The current family answers whenever it has runs. Only when it has none do the retired
            // families get asked — their days stay readable, flagged as a retired layout (0384).
            const current = await client.runs(DAILY_WORKFLOW);
            let chosen = { family: DAILY_WORKFLOW, page: current };
            if (current.runs.length === 0) {
                const retiredPages = await Promise.all(
                    RETIRED_DAILY_WORKFLOWS.map(async (retired) => ({
                        family: retired,
                        page: await client.runs(retired),
                    })),
                );
                const choice = pickDailyFamily(
                    current.runs,
                    retiredPages.map((entry) => ({ family: entry.family, rows: entry.page.runs })),
                );
                const hit = retiredPages.find((entry) => entry.family === choice.family);
                if (choice.retired && hit !== undefined) chosen = { family: hit.family, page: hit.page };
            }
            familyRef.current = chosen.family;
            setFamily(chosen.family);
            setRows((existing) => mergeRunPages(existing, chosen.page).runs);
            setCursor(chosen.page.nextCursor);
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
            if (familyRef.current === DAILY_WORKFLOW) {
                const envelope = await client.evidence(familyRef.current, runId);
                if (selectionRef.current.runId !== runId) {
                    stale = true;
                    return;
                }
                setEvidence(envelope);
                setResults(null);
                setConfig(null);
            } else {
                const [nextResults, nextConfig] = await Promise.all([
                    client.results(familyRef.current, runId),
                    client.config(familyRef.current, runId),
                ]);
                if (selectionRef.current.runId !== runId) {
                    stale = true;
                    return;
                }
                setResults(nextResults);
                setConfig(nextConfig);
                setEvidence(null);
            }
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
            setSelection((state) => (state.runId === null ? resolveSelection(rows, link, 'summary') : state));
        }
    }, [rows, selection.runId, link]);

    useEffect(() => {
        syncSelectionUrl(selection, { location: window.location, history: window.history }, MODULE_PATH);
    }, [selection]);

    const view = selection.tab;
    const newsFamily = family === DAILY_WORKFLOW;
    const now = Date.now();
    const legacySummary = results === null ? null : dailySummary(results);
    // The news projection: only when the selected rows really came from the news family, so a
    // retired-layout day never renders the news narrowing over a voice2 bag.
    const news = evidence !== null && newsFamily ? newsSummaryOf(evidence) : null;
    const newsFacts = evidence !== null && newsFamily ? newsSummaryFacts(evidence) : [];
    const issue = evidence !== null && newsFamily ? latestIssue(news, evidence.diagnostics) : null;
    const funnel = funnelView(results?.summary.funnel);
    const legacyArtifacts = results === null ? [] : artifactViews(results, readerOrigin);
    const outputRows: OutputGroup[] =
        evidence !== null && newsFamily && evidence.results !== null
            ? outputGroups(evidence.results, readerOrigin)
            : [];
    const stageRows: GenerationStageRow[] = news === null ? [] : generationStageRows(news);
    // G82: the configured supply interval — [startedAt − captured window, startedAt). The news
    // capture's allowlisted settings stand in for the legacy captured config's `window` value.
    const context = supplyContextOf(
        newsFamily ? (evidence?.capture?.settings.window ?? null) : (config?.settings.window ?? null),
        news?.startedAt ?? legacySummary?.startedAt ?? null,
    );
    useEffect(() => {
        const bounds = view === 'summary' && context !== null ? context : null;
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
    }, [client, view, context, selection.runId]);

    const selectedRow = rows.find((row) => row.id === selection.runId);
    const filteredRows = useMemo(() => {
        const q = filterQuery.trim().toLowerCase();
        if (q === '') return rows;
        return rows.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }, [rows, filterQuery]);

    const displayDiagnostics = dedupeDiagnostics([
        ...diagnostics,
        ...(evidence?.diagnostics ?? results?.diagnostics ?? []),
    ]);
    const freshness = freshnessLabel(readerRefresh);
    const availability = evidence?.results?.availability ?? results?.availability ?? 'unverified';
    const outcomeWord = newsFamily ? (news?.outcome ?? null) : (legacySummary?.outcome ?? null);

    const filterBox = (
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
                    onChange={(event) => setSelection((state) => ({ ...state, runId: event.target.value || null }))}
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
    );

    return (
        <ModuleShell className="kk-board kk-board-daily-voice">
            <ModuleHeader
                icon={<span aria-hidden="true">🎙️</span>}
                title="Daily AI Voice"
                subtitle={
                    <>
                        Run <code>{selection.runId ?? 'none selected'}</code> · {freshness} ·{' '}
                        {outcomeWord === null ? 'outcome unknown' : `Outcome ${outcomeWord}`} · {availability}
                    </>
                }
                status={
                    selectedRow ? (
                        <Badge variant={statusBadgeVariant(selectedRow.status)} size="sm">
                            {selectedRow.status}
                        </Badge>
                    ) : undefined
                }
                filters={filterBox}
                tabs={
                    <ModuleTabs
                        tabs={DAILY_VIEWS.map((id) => ({ id, label: VIEW_LABELS[id] }))}
                        value={view}
                        onChange={(id) => setSelection((state) => ({ ...state, tab: id as DailyView }))}
                        label="Daily AI Voice views"
                        idPrefix={VIEW_TABS_ID}
                    />
                }
            />
            {newsFamily ? null : (
                <p className="kk-board-empty kk-board-retired-layout">
                    {retiredLayoutNotice({ family, rows, retired: true })}
                </p>
            )}
            {rows.length === 0 ? (
                <EmptyState testId="daily-voice-no-runs">
                    No runs recorded for {DAILY_WORKFLOW}. Configure the workflow in{' '}
                    <a href={withBase('/board/settings/workflows')}>Settings → Workflows</a>.
                </EmptyState>
            ) : null}
            {DAILY_VIEWS.map((panelView) => {
                const active = panelView === view;
                const panel =
                    panelView === 'summary' ? (
                        newsFamily ? (
                            <NewsSummaryPanel
                                evidence={evidence}
                                news={news}
                                facts={newsFacts}
                                issue={issue}
                                context={context}
                                supply={supply}
                                storeOffline={storeOffline}
                            />
                        ) : (
                            <LegacySummaryPanel
                                facts={results === null ? [] : dailySummaryFacts(results, now)}
                                results={results}
                                config={config}
                                funnel={funnel}
                                artifacts={legacyArtifacts}
                                context={context}
                                supply={supply}
                                storeOffline={storeOffline}
                            />
                        )
                    ) : panelView === 'generation' ? (
                        newsFamily ? (
                            <NewsGenerationPanel
                                evidence={evidence}
                                news={news}
                                stages={stageRows}
                                groups={outputRows}
                            />
                        ) : (
                            <>
                                <LegacyResultsPanel
                                    artifacts={legacyArtifacts}
                                    channels={legacySummary?.channels ?? []}
                                />
                                <LegacyProgressPanel progress={legacySummary?.progress ?? null} />
                            </>
                        )
                    ) : newsFamily ? (
                        <NewsPublishingPanel news={news} />
                    ) : (
                        <LegacyChannelList channels={legacySummary?.channels ?? []} />
                    );
                return (
                    <div
                        key={panelView}
                        id={`${VIEW_TABS_ID}-panel-${panelView}`}
                        role="tabpanel"
                        aria-labelledby={`${VIEW_TABS_ID}-${panelView}`}
                        hidden={!active}
                        style={active ? { display: 'flex', flexDirection: 'column', gap: '0.875rem' } : undefined}
                    >
                        {panel}
                    </div>
                );
            })}
            {displayDiagnostics.map((diagnostic) => (
                <Diagnostic
                    key={diagnostic.code}
                    tone="error"
                    title={diagnostic.code}
                    detail={diagnostic.message}
                    testId="daily-voice-diagnostic"
                />
            ))}
            {cursor === null ? null : (
                <button type="button" onClick={() => void loadHistory()}>
                    Load more runs
                </button>
            )}
            <p className="kk-board-footnote">
                Run history every {HISTORY_POLL_MS / 1000}s; selected run every {ACTIVE_POLL_MS / 1000}s.
            </p>
        </ModuleShell>
    );
}

/* ---------------------------------------------------------------------------------------------- */
/* News views — the 0391 evidence envelope narrowed by ./evidence.ts                              */
/* ---------------------------------------------------------------------------------------------- */

/**
 * Summary: what this attempt produced at a glance, the latest actionable issue, the captured
 * settings drill-down and the G82 supply-context panel.
 */
function NewsSummaryPanel({
    evidence,
    news,
    facts,
    issue,
    context,
    supply,
    storeOffline,
}: {
    evidence: RunEvidence | null;
    news: NewsSummaryEvidence | null;
    facts: ResultFact[];
    issue: { title: string; detail: string } | null;
    context: DailySupplyContext | null;
    supply: CollectChannelYield | null;
    storeOffline: boolean;
}) {
    if (evidence === null) return <EmptyState>No evidence for the selected run yet.</EmptyState>;
    const capture = evidence.capture;
    const settings = capture === null ? [] : Object.entries(capture.settings);
    return (
        <>
            {issue === null ? null : (
                <Diagnostic tone="error" title={issue.title} detail={issue.detail} testId="daily-voice-issue" />
            )}
            {uncapturedDiagnostic(evidence) === null ? null : (
                <Diagnostic
                    tone="warning"
                    title="Attempt not captured"
                    detail={uncapturedDiagnostic(evidence)?.message}
                    code={uncapturedDiagnostic(evidence)?.code}
                    testId="daily-voice-uncaptured"
                />
            )}
            <dl className="kk-board-facts" data-testid="daily-voice-summary-facts">
                {facts.map((fact) => (
                    <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>
                            {fact.value} <span className="kk-board-state">{fact.availability}</span>
                        </dd>
                    </div>
                ))}
            </dl>
            {capture === null ? null : (
                <details className="kk-card" data-testid="daily-voice-captured-settings">
                    <summary>
                        Captured settings <span className="kk-stat-sub">stamp {capture.stamp}</span>
                    </summary>
                    <div className="kk-board-config">
                        <p>Captured {formatTimestamp(capture.capturedAt)}</p>
                        {settings.length === 0 ? <p>No settings were recorded for this attempt.</p> : null}
                        <dl>
                            {settings.map(([key, value]) => (
                                <div key={key}>
                                    <dt>{key}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                        {capture.definitionDigest === undefined ? null : (
                            <p>
                                Definition digest <code>{capture.definitionDigest}</code>
                            </p>
                        )}
                    </div>
                </details>
            )}
            <SupplyPanel context={context} supply={supply} storeOffline={storeOffline} />
            {news === null ? (
                <p className="kk-board-footnote">
                    The generation and publishing views stay empty for an uncaptured attempt — fixed artifacts are
                    unknown, never invented.
                </p>
            ) : null}
        </>
    );
}

/** One generation stage row: recorded producer state, engine attempt count and last timing. */
function StageRow({ stage }: { stage: GenerationStageRow }) {
    return (
        <li>
            <strong>{stage.label}</strong>{' '}
            <Badge variant={TONE_BADGE[stage.tone]} size="sm">
                {stage.word}
            </Badge>
            {stage.timing === null ? null : <span className="kk-board-state"> {stage.timing}</span>}
        </li>
    );
}

/** The authorized reader URL rendering of one artifact, exactly as `artifactViews` resolved it. */
function ArtifactRow({ artifact }: { artifact: ArtifactView }) {
    if (artifact.href === null) {
        return (
            <li key={artifact.id}>
                <span>
                    {artifact.label} — {artifact.state}
                </span>
            </li>
        );
    }
    if (artifact.kind === 'audio') {
        return (
            <li key={artifact.id}>
                <audio controls src={artifact.href}>
                    {/* The episode audio has no caption track; the element still needs one to satisfy the media a11y rule. */}
                    <track kind="captions" />
                </audio>{' '}
                <a href={artifact.href} download>
                    download {artifact.label}
                </a>{' '}
                — {artifact.state}
            </li>
        );
    }
    if (artifact.kind === 'image') {
        return (
            <li key={artifact.id}>
                <img src={artifact.href} alt={artifact.label} /> {artifact.label} — {artifact.state}
            </li>
        );
    }
    return (
        <li key={artifact.id}>
            <a href={artifact.href}>{artifact.label}</a> — {artifact.state}
        </li>
    );
}

/**
 * Generation: the recorded producer stages with the loud engine chain, the gate verdict and the
 * launch receipt (stale flagged), plus artifact groups behind collapsible drill-downs — reader
 * URLs only, never file links the run did not authorize.
 */
function NewsGenerationPanel({
    evidence,
    news,
    stages,
    groups,
}: {
    evidence: RunEvidence | null;
    news: NewsSummaryEvidence | null;
    stages: GenerationStageRow[];
    groups: OutputGroup[];
}) {
    if (evidence === null || evidence.results === null) {
        return (
            <EmptyState testId="daily-voice-generation-empty">No captured projection for the selected run.</EmptyState>
        );
    }
    const gate = news?.generation.gate.status ?? null;
    const launch = news?.generation.launch ?? null;
    return (
        <>
            <div className="kk-stat-grid" data-testid="daily-voice-generation-facts">
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Generation outcome</span>
                    <span className="kk-stat-value">{news?.generation.outcome ?? '—'}</span>
                    <span className="kk-stat-sub">from the recorded result files</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Pool gate</span>
                    <span className="kk-stat-value">{gate ?? '—'}</span>
                    <span className="kk-stat-sub">pool-gate verdict</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Launch receipt</span>
                    <span className="kk-stat-value">{launch?.status ?? '—'}</span>
                    <span className="kk-stat-sub">
                        {launch === null
                            ? 'not recorded'
                            : launch.stale
                              ? `stale — receipt run ${launch.runId ?? 'unknown'} is not this attempt`
                              : `run ${launch.runId ?? 'unknown'}`}
                    </span>
                </div>
            </div>
            {stages.length === 0 ? (
                <p>No producer stages were recorded for this attempt.</p>
            ) : (
                <ul className="kk-board-progress" data-testid="daily-voice-generation-stages">
                    {stages.map((stage) => (
                        <StageRow key={stage.id} stage={stage} />
                    ))}
                </ul>
            )}
            {groups.length === 0 ? (
                <p>No fixed artifacts were recorded for this attempt.</p>
            ) : (
                groups.map((group) => (
                    <details
                        key={group.producer || 'unattributed'}
                        className="kk-card"
                        data-testid="daily-voice-artifact-group"
                    >
                        <summary>
                            {group.label}{' '}
                            <span className="kk-stat-sub">
                                {group.artifacts.filter((a) => a.href !== null).length} available of{' '}
                                {group.artifacts.length}
                            </span>
                        </summary>
                        <ul className="kk-board-artifacts">
                            {group.artifacts.map((artifact) => (
                                <ArtifactRow key={artifact.id} artifact={artifact} />
                            ))}
                        </ul>
                    </details>
                ))
            )}
        </>
    );
}

/** A recorded count as its word: the number, or `not recorded` when the projection lacks it. */
function countWord(value: number | null): string {
    return value === null ? 'not recorded' : `${value}`;
}

/** The word for a sum of two counts: unrecorded stays unrecorded, never a fabricated 0. */
function countSumWord(left: number | null, right: number | null): string {
    return left === null || right === null ? 'not recorded' : `${left + right}`;
}

/** One recorded provenance check: matched / mismatched / unknown, never a rewritten verdict. */
function ProvenanceRow({ label, matched }: { label: string; matched: boolean | null }) {
    const word = matched === null ? 'unknown' : matched ? 'matched' : 'MISMATCHED';
    const tone: StateTone = matched === null ? 'neutral' : matched ? 'success' : 'error';
    return (
        <li>
            {label}{' '}
            <Badge variant={TONE_BADGE[tone]} size="sm">
                {word}
            </Badge>
        </li>
    );
}

/** One publishing target row: recorded send status, delivery effect and fixed evidence paths. */
function TargetRow({ target }: { target: PublishingTargetRow }) {
    return (
        <li key={target.id} data-testid="daily-voice-publish-target">
            <strong>{target.id}</strong>{' '}
            <Badge variant={TONE_BADGE[target.tone]} size="sm">
                {target.word}
            </Badge>
            {target.target === null ? null : <span> · {target.target}</span>}
            {target.mode === null ? null : <span> ({target.mode})</span>}
            {target.url === null ? null : (
                <>
                    {' '}
                    <a href={target.url} rel="noreferrer">
                        open
                    </a>
                </>
            )}
            {target.error === null ? null : <span className="kk-board-state"> — {target.error}</span>}
            {target.finishedAt === null ? null : (
                <span className="kk-board-state"> finished {formatTimestamp(target.finishedAt)}</span>
            )}
            <span className="kk-board-state">
                {' '}
                evidence <code>{target.evidence.plan}</code>
                {target.evidence.receipt === null ? (
                    ' · receipt not recorded'
                ) : (
                    <code> · {target.evidence.receipt}</code>
                )}
            </span>
        </li>
    );
}

/**
 * Publishing: the frozen bundle's identity card and one group per publishable window with its
 * recorded outcome, identity-bound provenance checks and target receipts.
 */
function NewsPublishingPanel({ news }: { news: NewsSummaryEvidence | null }) {
    if (news === null) {
        return (
            <EmptyState testId="daily-voice-publishing-empty">
                No captured publishing projection for the selected run.
            </EmptyState>
        );
    }
    const bundle = news.publishing.bundle;
    const rows = publishingWindowRows(news);
    return (
        <>
            <div className="kk-stat-grid" data-testid="daily-voice-bundle">
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Bundle</span>
                    <span className="kk-stat-value">{bundle?.title ?? '—'}</span>
                    <span className="kk-stat-sub">{bundle === null ? 'not recorded' : bundle.identity}</span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Run date</span>
                    <span className="kk-stat-value">{bundle?.runDate ?? '—'}</span>
                    <span className="kk-stat-sub">
                        {bundle?.variants.length ? `variants ${bundle.variants.join(', ')}` : 'variants unrecorded'}
                    </span>
                </div>
                <div className="kk-stat-card">
                    <span className="kk-stat-label">Targets</span>
                    <span className="kk-stat-value">{countWord(news.counts.targetsSucceeded)} sent</span>
                    <span className="kk-stat-sub">
                        {countSumWord(news.counts.targetsFailed, news.counts.targetsUncertain)} failed or uncertain ·{' '}
                        {countWord(news.counts.targetsPlanned)} planned
                    </span>
                </div>
            </div>
            {bundle?.parentRunId == null ? null : (
                <p>
                    Parent run <code>{bundle.parentRunId}</code>
                </p>
            )}
            {bundle?.safety == null ? null : <p>Safety: {bundle.safety}</p>}
            {rows.length === 0 ? (
                <EmptyState>No publishable window was recorded for this attempt.</EmptyState>
            ) : (
                rows.map((row) => (
                    <section key={row.window} className="kk-card" data-testid="daily-voice-publish-window">
                        <div className="kk-card-header">
                            <h2>{row.label}</h2>
                            <Badge
                                variant={row.recorded === null ? 'neutral' : TONE_BADGE[row.recorded.tone]}
                                size="sm"
                            >
                                {row.recorded === null ? 'outcome not recorded' : row.recorded.word}
                            </Badge>
                        </div>
                        <ul className="kk-board-edges">
                            {row.provenance.map((check) => (
                                <ProvenanceRow key={check.label} label={check.label} matched={check.matched} />
                            ))}
                        </ul>
                        {row.targets.length === 0 ? (
                            <p>No target plan was recorded for this window.</p>
                        ) : (
                            <ul className="kk-board-channels">
                                {row.targets.map((target) => (
                                    <TargetRow key={target.id} target={target} />
                                ))}
                            </ul>
                        )}
                    </section>
                ))
            )}
            <p className="kk-board-footnote">
                Evidence paths are workspace-relative references recorded by the run — shown as text, never turned into
                links.
            </p>
        </>
    );
}

/* ---------------------------------------------------------------------------------------------- */
/* Retired-family fallback panels (voice2) — preserved unchanged from the legacy layout (0384)     */
/* ---------------------------------------------------------------------------------------------- */

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
    artifacts: ArtifactView[];
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
 * The artifact-backed voice2 episode funnel: pool → annotation → topic filter → QC rejection →
 * dedup → plan, the duration ladder bounds and the no-content gate. Counts come from the run's own
 * artifacts with their evidence ids; unknown stays unavailable, never 0.
 */
function FunnelPanel({ funnel, artifacts }: { funnel: DailyFunnelView; artifacts: ArtifactView[] }) {
    const rows: { label: string; value: string; field: string }[] = [
        { label: '1 · Episode pool', value: funnelCount(funnel.poolCount), field: 'poolCount' },
        { label: '2 · Annotated', value: funnelCount(funnel.annotatedCount), field: 'annotatedCount' },
        { label: '3 · Topic filter kept', value: funnelCount(funnel.topicKeptCount), field: 'topicKeptCount' },
        { label: '4 · QC rejected', value: funnelCount(funnel.qcRejectedCount), field: 'qcRejectedCount' },
        {
            label: '5 · Post-dedup survivors',
            // The refusal is the specific cause (2026-10-22 planned 3, then the duration refusal cleared
            // the survivors), so it outranks the generic plan-recorded reason.
            value:
                funnel.dedupKeptCount === null &&
                (funnel.gate === 'episode-duration' || funnel.gate === 'script' || funnel.gate === 'qc-floor')
                    ? 'unknown — cleared by the refusal'
                    : funnel.dedupKeptCount === null && funnel.plannedCount !== null
                      ? 'unknown — plan recorded'
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
 * unknown; the news runs' artifact evidence and the voice2 funnel remain the consumption truth.
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
                A source absent from this window recorded 0 contributions; its health is unknown. The artifact-backed
                evidence stays the consumption record — supply here is context, not consumption.
            </p>
        </section>
    );
}

/**
 * Summary for a retired voice2 day: legacy facts, the captured-configuration drill-down (the
 * content the retired `?tab=config` target used to render in full), the funnel and supply context.
 */
function LegacySummaryPanel({
    facts,
    results,
    config,
    funnel,
    artifacts,
    context,
    supply,
    storeOffline,
}: {
    facts: ResultFact[];
    results: RunResults | null;
    config: RunConfig | null;
    funnel: DailyFunnelView;
    artifacts: ArtifactView[];
    context: DailySupplyContext | null;
    supply: CollectChannelYield | null;
    storeOffline: boolean;
}) {
    if (results === null) return <EmptyState>No captured results for the selected run.</EmptyState>;
    const summary = dailySummary(results);
    const settings = config === null ? [] : Object.entries(config.settings);
    const liveChannels = summary.channels.filter((c) => c.state === 'live').length;
    return (
        <>
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
            {config === null ? null : (
                <details className="kk-card" data-testid="daily-voice-captured-config">
                    <summary>
                        Captured configuration{' '}
                        <span className="kk-stat-sub">
                            {config.capturedAt === null
                                ? 'capture time not recorded'
                                : `captured ${formatTimestamp(config.capturedAt)}`}
                        </span>
                    </summary>
                    <div className="kk-board-config">
                        <p>
                            {config.capturedAt === null
                                ? 'This run predates capture: its settings are unknown, never today’s defaults.'
                                : `Captured ${formatTimestamp(config.capturedAt)}`}
                        </p>
                        {settings.length === 0 ? (
                            <p>No settings were recorded for this run.</p>
                        ) : (
                            <dl>
                                {settings.map(([key, value]) => (
                                    <div key={key}>
                                        <dt>{key}</dt>
                                        <dd>{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                        {config.unavailableKeys.length === 0 ? null : (
                            <p>
                                Not captured: <code>{config.unavailableKeys.join(', ')}</code>
                            </p>
                        )}
                        {config.definitionDigest === undefined ? null : (
                            <p>
                                Definition digest <code>{config.definitionDigest}</code>
                            </p>
                        )}
                    </div>
                </details>
            )}
            <FunnelPanel funnel={funnel} artifacts={artifacts} />
            <SupplyPanel context={context} supply={supply} storeOffline={storeOffline} />
        </>
    );
}

/** One voice2 channel row: draft/live/skipped/failed, with a public link only when one was recorded. */
function LegacyChannelList({ channels }: { channels: DailyChannelView[] }) {
    if (channels.length === 0) return <EmptyState>No channel outcomes recorded for the selected run.</EmptyState>;
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

/** Generation view for a retired voice2 day: media/file evidence and per-channel outcomes. */
function LegacyResultsPanel({ artifacts, channels }: { artifacts: ArtifactView[]; channels: DailyChannelView[] }) {
    if (artifacts.length === 0) return <EmptyState>No artifact evidence for the selected run.</EmptyState>;
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
            <LegacyChannelList channels={channels} />
        </div>
    );
}

/** Voice2 execution progress: DAG node attempts + captured edges; unknown edges stay unknown. */
function LegacyProgressPanel({ progress }: { progress: ReturnType<typeof dailySummary>['progress'] }) {
    if (progress === null || progress.nodes.length === 0) {
        return <EmptyState>Recorded progress is unavailable for the selected run.</EmptyState>;
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
                    <a href={withBase('/board/settings/workflows')}>Settings → Workflows</a> for the current graph.
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

/** Entry the host mounts: no `createRoot`, no private Board context imports. */
export const webModule: BoardContribution = { apiVersion: 1, component: DailyVoiceModule };
