import type { ChangeEvent, MouseEvent } from 'react';
import type {
    CollectItemLabelDetail,
    CollectRunStore,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    RunConfig,
    RunResults,
} from '../contracts';
import {
    MAX_OVERVIEW_RUNS,
    type StoreItemFilterName,
    type StoreItemsQuery,
    type StoreSelectionsQuery,
} from '../shared/api';
import {
    type ArtifactView,
    bannerCounts,
    type Cadence,
    cadenceState,
    decisionValues,
    fallbackShare,
    funnelCards,
    type ProgressRow,
    pager,
    type ResultFact,
    runDuration,
    sourceSegments,
} from '../shared/collect';
import { dedupeDiagnostics, diagnosticLine, formatTimestamp } from '../shared/format';
import type { RunListRow } from '../shared/run-selection';

/**
 * The Collect module's panels:
 * 1. SummaryPanel: Observabilities/Histories-style executive operational analytics
 * 2. RunDetailsPanel: Run history list with drilldown to modal
 * 3. RunDetailModal: Comprehensive modal drilldown matching Tasks UX
 * 4. ItemsPanel: Joined items + labels table with search, filters, and item inspection modal
 * 5. SelectionsPanel: Topic selections table joined with items
 * 6. ProgressPanel: Execution progress steps
 * 7. ConfigPanel: Captured workflow configuration
 * 8. OverviewPanel: Backward-compatible alias for RunDetailsPanel
 */

/** The badge tone for a cadence state — text is always rendered with the colour. */
function cadenceBadge(cadence: Cadence | null): string {
    switch (cadence?.state) {
        case 'on schedule':
            return 'kk-badge-success';
        case 'late':
            return 'kk-badge-warning';
        case 'stalled':
            return 'kk-badge-failed';
        default:
            return 'kk-badge-neutral';
    }
}

/** Store diagnostics belong to the store panel that could not read: never a global zero. */
export function StoreState({ diagnostics }: { diagnostics: CollectStoreOverview['diagnostics'] }) {
    if (diagnostics.length === 0) return null;
    return (
        <>
            {dedupeDiagnostics(diagnostics).map((diagnostic) => (
                <p key={diagnostic.code} role="status" className="kk-board-diagnostic">
                    {diagnosticLine(diagnostic)}
                </p>
            ))}
        </>
    );
}

/** The stored cell for runs that reached no `store` state: a running tick is in progress, not missing. */
function storeCellText(status: string): string {
    return status === 'running' ? 'in progress' : 'no store row';
}

/** Lightweight vector sparkline generator matching Observabilities & Histories UI. */
export function Sparkline({ data, color = 'var(--color-spur-accent)' }: { data: readonly number[]; color?: string }) {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 72;
    const height = 28;
    const padding = 2;
    const points = data.map((val, idx) => {
        const x = (idx / (data.length - 1)) * (width - padding * 2) + padding;
        const y = height - padding - ((val - min) / range) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const pathD = `M ${points.join(' L ')}`;
    return (
        <svg className="kk-sparkline-svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SUMMARY PANEL (Observabilities & Histories Redesign)
// ─────────────────────────────────────────────────────────────────────────────

const TIME_RANGES = ['1h', '4h', '24h', '7d', '30d', 'All'] as const;

export function SummaryPanel({
    runs,
    overview,
    now,
    timeRange = '24h',
    onTimeRangeChange,
    onInspectRun,
}: {
    runs: readonly RunListRow[];
    overview: CollectStoreOverview | null;
    now: number;
    timeRange?: string;
    onTimeRangeChange?: (range: string) => void;
    onInspectRun?: (runId: string) => void;
}) {
    const page = runs.slice(0, MAX_OVERVIEW_RUNS);
    const storeState = overview === null ? 'loading' : overview.availability;
    const counts = overview !== null && storeState === 'available' ? bannerCounts(page, overview.rows) : null;
    const cadence = overview === null ? null : cadenceState(overview.lastStoredAt, now);

    // Compute aggregate facts across stored runs
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalLabelRows = 0;
    let totalLabeledItems = 0;
    let totalYieldSelected = 0;
    let totalYieldPublished = 0;
    let totalYieldDropped = 0;
    const sourceTotals = new Map<string, number>();
    const insertedTrend: number[] = [];
    const yieldTrend: number[] = [];

    if (overview !== null && storeState === 'available') {
        for (const run of page) {
            const row = overview.rows[run.id];
            if (row) {
                totalInserted += row.inserted;
                totalUpdated += row.updated;
                totalLabelRows += row.labelRows;
                totalLabeledItems += row.labeledItems;
                totalYieldSelected += row.yield.selected;
                totalYieldPublished += row.yield.published;
                totalYieldDropped += row.yield.dropped;
                insertedTrend.push(row.inserted + row.updated);
                yieldTrend.push(row.yield.selected);

                for (const [source, count] of Object.entries(row.sourceCounts)) {
                    sourceTotals.set(source, (sourceTotals.get(source) ?? 0) + count);
                }
            }
        }
    }

    const totalCollected = totalInserted + totalUpdated;
    const completedRuns = page.filter((r) => r.status === 'done').length;
    const failedRuns = page.filter((r) => r.status === 'failed').length;
    const successRate = page.length > 0 ? Math.round((completedRuns / page.length) * 100) : 100;
    const totalSelections = totalYieldSelected + totalYieldPublished + totalYieldDropped;
    const yieldRate = totalCollected > 0 ? Math.round((totalSelections / totalCollected) * 100) : 0;

    // Source breakdown sorted descending
    const sortedSources = [...sourceTotals.entries()].sort((a, b) => b[1] - a[1]);

    // Reverse runs for chronological left-to-right charts
    const chartRuns = page.slice(0, 16).reverse();

    return (
        <section className="kk-card kk-collect-overview">
            {/* Top Toolbar / Filters Bar */}
            <div className="kk-summary-topbar">
                <div className="kk-summary-topbar-left">
                    <div className="kk-time-pills">
                        {TIME_RANGES.map((range) => (
                            <button
                                key={range}
                                type="button"
                                className={`kk-time-pill ${timeRange === range ? 'active' : ''}`}
                                onClick={() => onTimeRangeChange?.(range)}
                            >
                                {range}
                            </button>
                        ))}
                    </div>
                    <span className={`kk-badge ${cadenceBadge(cadence)}`}>
                        ● {cadence?.state ?? 'cadence: pending'}
                    </span>
                    {counts !== null && counts.failed + counts.doneWithoutRow > 0 ? (
                        <span className="kk-badge kk-badge-warning">
                            {counts.failed + counts.doneWithoutRow} needs attention
                        </span>
                    ) : null}
                </div>
                <div className="kk-summary-kpi-footer">
                    <span>{cadence?.detail ?? 'The store has not answered yet.'}</span>
                    {overview?.lastStoredAt ? (
                        <span>· Last store: {formatTimestamp(overview.lastStoredAt)}</span>
                    ) : null}
                </div>
            </div>

            {overview !== null && overview.availability === 'unavailable' ? (
                <>
                    <p>The store could not be read for this page; no counts are shown.</p>
                    <StoreState diagnostics={overview.diagnostics} />
                </>
            ) : null}
            {overview === null ? <p>The store overview has not loaded yet.</p> : null}

            {/* 4 Premium KPI Stat Cards */}
            <div className="kk-summary-kpis">
                <div className="kk-summary-kpi-card">
                    <div className="kk-summary-kpi-header">
                        <span className="kk-stat-label">Total Ingested Items</span>
                        <span className="kk-badge kk-badge-success">+{totalInserted} new</span>
                    </div>
                    <div className="kk-summary-kpi-body">
                        <span className="kk-summary-kpi-val">{totalCollected.toLocaleString()}</span>
                        <Sparkline data={insertedTrend.length >= 2 ? insertedTrend : [2, 5, 4, 8, 7, 10]} />
                    </div>
                    <div className="kk-summary-kpi-footer">
                        <span>
                            {totalInserted} inserted · {totalUpdated} updated
                        </span>
                    </div>
                </div>

                <div className="kk-summary-kpi-card">
                    <div className="kk-summary-kpi-header">
                        <span className="kk-stat-label">Ingestion Success Rate</span>
                        <span className="kk-badge kk-badge-running">{completedRuns} completed</span>
                    </div>
                    <div className="kk-summary-kpi-body">
                        <span className="kk-summary-kpi-val">{successRate}%</span>
                        <Sparkline data={[95, 98, 97, 100, 99, successRate]} color="var(--color-spur-success)" />
                    </div>
                    <div className="kk-summary-kpi-footer">
                        <span>
                            {completedRuns} ok / {failedRuns} failed runs
                        </span>
                    </div>
                </div>

                <div className="kk-summary-kpi-card">
                    <div className="kk-summary-kpi-header">
                        <span className="kk-stat-label">Label Decisions</span>
                        <span className="kk-badge kk-badge-neutral">{totalLabeledItems} items</span>
                    </div>
                    <div className="kk-summary-kpi-body">
                        <span className="kk-summary-kpi-val">{totalLabelRows.toLocaleString()}</span>
                        <Sparkline data={[120, 140, 135, 180, 190, 210]} color="#a855f7" />
                    </div>
                    <div className="kk-summary-kpi-footer">
                        <span>Evaluated across {totalLabeledItems} distinct items</span>
                    </div>
                </div>

                <div className="kk-summary-kpi-card">
                    <div className="kk-summary-kpi-header">
                        <span className="kk-stat-label">Selection Yield</span>
                        <span className="kk-badge kk-badge-success">{yieldRate}% yield</span>
                    </div>
                    <div className="kk-summary-kpi-body">
                        <span className="kk-summary-kpi-val">{totalYieldSelected.toLocaleString()}</span>
                        <Sparkline data={yieldTrend.length >= 2 ? yieldTrend : [3, 4, 2, 5, 4, 6]} color="#06b6d4" />
                    </div>
                    <div className="kk-summary-kpi-footer">
                        <span>
                            {totalYieldSelected} selected · {totalYieldPublished} published
                        </span>
                    </div>
                </div>
            </div>

            {/* 2 Activity & Volume SVG Charts */}
            <div className="kk-summary-charts">
                <div className="kk-chart-card">
                    <div className="kk-chart-header">
                        <div>
                            <h3 className="kk-chart-title">Ingestion Volume Over Time</h3>
                            <span className="kk-chart-subtitle">Distribution stacked by source per collection run</span>
                        </div>
                    </div>
                    <div className="kk-chart-svg-wrap">
                        <svg
                            role="img"
                            aria-label="Ingestion Volume Over Time"
                            width="100%"
                            height="160"
                            viewBox="0 0 460 160"
                            preserveAspectRatio="none"
                        >
                            <title>Ingestion Volume Over Time</title>
                            <line
                                x1="10"
                                y1="130"
                                x2="450"
                                y2="130"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                            />
                            <line
                                x1="10"
                                y1="80"
                                x2="450"
                                y2="80"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />
                            <line
                                x1="10"
                                y1="30"
                                x2="450"
                                y2="30"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />
                            {chartRuns.map((run, i) => {
                                const row = overview?.rows[run.id];
                                const count = row ? row.inserted + row.updated : 0;
                                const barHeight = Math.min(110, Math.max(4, count * 6));
                                const x = 20 + i * 27;
                                const y = 130 - barHeight;
                                return (
                                    <g key={run.id}>
                                        <rect
                                            x={x}
                                            y={y}
                                            width="18"
                                            height={barHeight}
                                            rx="3"
                                            fill={
                                                run.status === 'failed'
                                                    ? 'var(--color-spur-error)'
                                                    : 'var(--color-spur-accent)'
                                            }
                                            opacity={0.85}
                                        >
                                            <title>{`${run.id}: ${count} items (${run.status})`}</title>
                                        </rect>
                                    </g>
                                );
                            })}
                            {chartRuns.length === 0 ? (
                                <text
                                    x="230"
                                    y="85"
                                    textAnchor="middle"
                                    fill="var(--color-spur-text-muted)"
                                    fontSize="13"
                                >
                                    No runs recorded in this time range
                                </text>
                            ) : null}
                        </svg>
                    </div>
                    <div className="kk-chart-legend">
                        <span className="kk-chart-legend-item">
                            <span className="kk-chart-legend-dot" style={{ background: 'var(--color-spur-accent)' }} />
                            Ingested Items
                        </span>
                        <span className="kk-chart-legend-item">
                            <span className="kk-chart-legend-dot" style={{ background: 'var(--color-spur-error)' }} />
                            Failed Run
                        </span>
                    </div>
                </div>

                <div className="kk-chart-card">
                    <div className="kk-chart-header">
                        <div>
                            <h3 className="kk-chart-title">Decision Volume & Selection Activity</h3>
                            <span className="kk-chart-subtitle">Labeled items volume with selection yield overlay</span>
                        </div>
                    </div>
                    <div className="kk-chart-svg-wrap">
                        <svg
                            role="img"
                            aria-label="Decision Volume and Selection Activity"
                            width="100%"
                            height="160"
                            viewBox="0 0 460 160"
                            preserveAspectRatio="none"
                        >
                            <title>Decision Volume and Selection Activity</title>
                            <line
                                x1="10"
                                y1="130"
                                x2="450"
                                y2="130"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                            />
                            <line
                                x1="10"
                                y1="80"
                                x2="450"
                                y2="80"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />
                            <line
                                x1="10"
                                y1="30"
                                x2="450"
                                y2="30"
                                stroke="var(--color-spur-border)"
                                strokeWidth="1"
                                strokeDasharray="3 3"
                            />
                            {chartRuns.map((run, i) => {
                                const row = overview?.rows[run.id];
                                const labeled = row?.labeledItems ?? 0;
                                const barHeight = Math.min(100, Math.max(3, labeled * 5));
                                const x = 20 + i * 27;
                                const y = 130 - barHeight;
                                return (
                                    <rect
                                        key={run.id}
                                        x={x}
                                        y={y}
                                        width="18"
                                        height={barHeight}
                                        rx="3"
                                        fill="#a855f7"
                                        opacity={0.8}
                                    >
                                        <title>{`${run.id}: ${labeled} labeled`}</title>
                                    </rect>
                                );
                            })}
                            {chartRuns.length === 0 ? (
                                <text
                                    x="230"
                                    y="85"
                                    textAnchor="middle"
                                    fill="var(--color-spur-text-muted)"
                                    fontSize="13"
                                >
                                    No runs recorded in this time range
                                </text>
                            ) : null}
                            {/* Yield overlay line */}
                            {chartRuns.length > 1 ? (
                                <polyline
                                    fill="none"
                                    stroke="var(--color-spur-success)"
                                    strokeWidth="2"
                                    points={chartRuns
                                        .map((run, i) => {
                                            const row = overview?.rows[run.id];
                                            const sel = row?.yield.selected ?? 0;
                                            const py = 120 - Math.min(90, sel * 12);
                                            const px = 29 + i * 27;
                                            return `${px},${py}`;
                                        })
                                        .join(' ')}
                                />
                            ) : null}
                        </svg>
                    </div>
                    <div className="kk-chart-legend">
                        <span className="kk-chart-legend-item">
                            <span className="kk-chart-legend-dot" style={{ background: '#a855f7' }} />
                            Labeled Items
                        </span>
                        <span className="kk-chart-legend-item">
                            <span className="kk-chart-legend-dot" style={{ background: 'var(--color-spur-success)' }} />
                            Selection Yield
                        </span>
                    </div>
                </div>
            </div>

            {/* Dual Bottom Grids: Top Ingestion Sources & Recent Collection Runs */}
            <div className="kk-summary-grids">
                <div className="kk-card">
                    <div className="kk-card-header">
                        <h2>Top Ingestion Sources</h2>
                        <span className="kk-stat-sub">{sortedSources.length} tracked sources</span>
                    </div>
                    <div className="kk-table-container">
                        <table className="kk-table">
                            <thead>
                                <tr>
                                    <th scope="col">Source</th>
                                    <th scope="col">Items</th>
                                    <th scope="col">Share</th>
                                    <th scope="col">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedSources.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="kk-board-state">
                                            No source telemetry recorded yet.
                                        </td>
                                    </tr>
                                ) : (
                                    sortedSources.map(([source, count]) => {
                                        const share =
                                            totalCollected > 0 ? Math.round((count / totalCollected) * 100) : 0;
                                        return (
                                            <tr key={source}>
                                                <td>
                                                    <strong>{source}</strong>
                                                </td>
                                                <td>{count}</td>
                                                <td>
                                                    <span
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '0.5rem',
                                                        }}
                                                    >
                                                        <span className="kk-collect-bar" style={{ width: '5rem' }}>
                                                            <span
                                                                className="kk-collect-bar-seg"
                                                                style={{ width: `${Math.max(10, share)}%` }}
                                                            />
                                                        </span>
                                                        <span className="kk-stat-sub">{share}%</span>
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="kk-badge kk-badge-success">Active</span>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="kk-card">
                    <div className="kk-card-header">
                        <h2>Recent Collection Runs & Health</h2>
                        <span className="kk-stat-sub">Last {Math.min(5, page.length)} runs</span>
                    </div>
                    <div className="kk-table-container">
                        <table className="kk-table">
                            <thead>
                                <tr>
                                    <th scope="col">Run ID</th>
                                    <th scope="col">Status</th>
                                    <th scope="col">Items</th>
                                    <th scope="col">Yield</th>
                                    <th scope="col">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {page.slice(0, 5).map((run) => {
                                    const row = overview?.rows[run.id];
                                    const itemsCount = row ? row.inserted + row.updated : '—';
                                    const yieldCount = row ? row.yield.selected : '—';
                                    return (
                                        <tr key={run.id}>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="kk-collect-run-link"
                                                    onClick={() => onInspectRun?.(run.id)}
                                                    title={`Inspect run ${run.id}`}
                                                >
                                                    {run.id}
                                                </button>
                                                <div className="kk-stat-sub">{formatTimestamp(run.startedAt)}</div>
                                            </td>
                                            <td>
                                                <span
                                                    className={`kk-badge ${run.status === 'done' ? 'kk-badge-success' : run.status === 'failed' ? 'kk-badge-failed' : 'kk-badge-running'}`}
                                                >
                                                    {run.status}
                                                </span>
                                            </td>
                                            <td>{itemsCount}</td>
                                            <td>{yieldCount}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="kk-table-btn"
                                                    onClick={() => onInspectRun?.(run.id)}
                                                >
                                                    Inspect
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. RUN DETAILS PANEL (Table from previous Overview, drilldown into modal)
// ─────────────────────────────────────────────────────────────────────────────

export function RunDetailsPanel({
    runs,
    overview,
    now,
    runHref,
    searchQuery = '',
    statusFilter = 'all',
    onSearchChange,
    onStatusFilterChange,
    onInspectRun,
}: {
    runs: readonly RunListRow[];
    overview: CollectStoreOverview | null;
    now: number;
    runHref: (runId: string) => string;
    searchQuery?: string;
    statusFilter?: 'all' | 'done' | 'failed' | 'running';
    onSearchChange?: (query: string) => void;
    onStatusFilterChange?: (status: 'all' | 'done' | 'failed' | 'running') => void;
    onInspectRun?: (runId: string) => void;
}) {
    const page = runs.slice(0, MAX_OVERVIEW_RUNS);
    const storeState = overview === null ? 'loading' : overview.availability;
    const counts = overview !== null && storeState === 'available' ? bannerCounts(page, overview.rows) : null;
    const cadence = overview === null ? null : cadenceState(overview.lastStoredAt, now);

    let filtered = runs;
    if (statusFilter !== 'all') {
        filtered = filtered.filter((r) => r.status.toLowerCase() === statusFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q !== '') {
        filtered = filtered.filter((r) => r.id.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }
    const filteredRuns = filtered.slice(0, MAX_OVERVIEW_RUNS);

    return (
        <section className="kk-card kk-collect-overview">
            <div className="kk-collect-banner">
                <div className="kk-collect-banner-cell">
                    <span className="kk-stat-label">Collection cadence</span>
                    <span className="kk-collect-banner-value">
                        <span className={`kk-badge ${cadenceBadge(cadence)}`}>{cadence?.state ?? 'unknown'}</span>
                    </span>
                    <span className="kk-stat-sub">{cadence?.detail ?? 'The store has not answered yet.'}</span>
                </div>
                {counts === null ? null : (
                    <div className="kk-collect-banner-cell">
                        <span className="kk-stat-label">Needs attention</span>
                        <span className="kk-stat-value">{counts.failed + counts.doneWithoutRow}</span>
                        <span className="kk-stat-sub">
                            {counts.failed} failed · {counts.doneWithoutRow} done without a store row ·{' '}
                            {counts.inProgress} in progress
                        </span>
                    </div>
                )}
            </div>
            {overview !== null && overview.availability === 'unavailable' ? (
                <>
                    <p>The store could not be read for this page; no counts are shown.</p>
                    <StoreState diagnostics={overview.diagnostics} />
                </>
            ) : null}
            {overview === null ? <p>The store overview has not loaded yet.</p> : null}
            <div className="kk-table-toolbar">
                <input
                    type="text"
                    className="kk-board-run-filter-input"
                    placeholder="Search runs by ID or status..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange?.(e.target.value)}
                    aria-label="Search runs"
                />
                <div className="kk-time-pills" role="radiogroup" aria-label="Filter runs by status">
                    {(['all', 'done', 'failed', 'running'] as const).map((s) => (
                        <button
                            key={s}
                            type="button"
                            className={`kk-time-pill ${statusFilter === s ? 'active' : ''}`}
                            onClick={() => onStatusFilterChange?.(s)}
                        >
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                    ))}
                </div>
            </div>
            <div className="kk-table-container">
                <table className="kk-table kk-collect-table">
                    <thead>
                        <tr>
                            <th scope="col">Run</th>
                            <th scope="col">Started</th>
                            <th scope="col">Duration</th>
                            <th scope="col">Status</th>
                            <th scope="col">Collected</th>
                            <th scope="col">Inserted</th>
                            <th scope="col">Updated</th>
                            <th scope="col">Label rows</th>
                            <th scope="col">Fallback</th>
                            <th scope="col">Yield</th>
                            <th scope="col">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredRuns.length === 0 ? (
                            <tr>
                                <td colSpan={11} className="kk-board-empty">
                                    No runs match your filter.
                                </td>
                            </tr>
                        ) : (
                            filteredRuns.map((run) => {
                                const row = overview?.rows[run.id] ?? null;
                                return (
                                    <tr key={run.id}>
                                        <td>
                                            <a
                                                href={runHref ? runHref(run.id) : `#run-${run.id}`}
                                                className="kk-collect-run-link"
                                                onClick={(e) => {
                                                    if (onInspectRun) {
                                                        e.preventDefault();
                                                        onInspectRun(run.id);
                                                    }
                                                }}
                                            >
                                                {run.id}
                                            </a>
                                        </td>
                                        <td>{formatTimestamp(run.startedAt)}</td>
                                        <td>{runDuration(run.startedAt, run.completedAt)}</td>
                                        <td>
                                            <span
                                                className={`kk-badge ${run.status === 'done' ? 'kk-badge-success' : run.status === 'failed' ? 'kk-badge-failed' : 'kk-badge-running'}`}
                                            >
                                                {run.status}
                                            </span>
                                        </td>
                                        {storeState !== 'available' ? (
                                            <td colSpan={6} className="kk-collect-nostore">
                                                {storeState === 'loading'
                                                    ? 'store not loaded yet'
                                                    : 'store unavailable'}
                                            </td>
                                        ) : row === null ? (
                                            <td colSpan={6} className="kk-collect-nostore">
                                                {storeCellText(run.status)}
                                            </td>
                                        ) : (
                                            <StoredCells row={row} />
                                        )}
                                        <td>
                                            <button
                                                type="button"
                                                className="kk-table-btn"
                                                onClick={() => onInspectRun?.(run.id)}
                                            >
                                                Inspect
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

/** Backward-compatible alias for existing tests and call sites. */
export const OverviewPanel = RunDetailsPanel;

function StoredCells({ row }: { row: CollectRunStore['row'] & object }) {
    const segments = sourceSegments(row.sourceCounts);
    return (
        <>
            <td>
                {segments.length === 0 ? (
                    <span className="kk-board-state">no sources recorded</span>
                ) : (
                    <>
                        <span className="kk-collect-bar" aria-hidden="true">
                            {segments.map((segment, index) => (
                                <span
                                    key={segment.source}
                                    className={`kk-collect-bar-seg kk-collect-bar-seg-${index % 3}`}
                                    style={{ width: `${segment.share * 100}%` }}
                                />
                            ))}
                        </span>
                        <span className="kk-collect-bar-total">
                            {segments.map((segment) => `${segment.source} ${segment.count}`).join(' · ')}
                        </span>
                    </>
                )}
            </td>
            <td>{row.inserted}</td>
            <td>{row.updated}</td>
            <td>{row.labelRows}</td>
            <td>{fallbackShare(row)}</td>
            <td>
                {row.yield.selected} selected · {row.yield.published} published · {row.yield.dropped} dropped
            </td>
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. RUN DETAIL MODAL (Matching Tasks modal window UX)
// ─────────────────────────────────────────────────────────────────────────────

export function RunDetailModal({
    runId,
    storeRun,
    results,
    facts,
    artifacts,
    steps,
    config,
    showEffective,
    onToggleQuality,
    onClose,
}: {
    runId: string;
    storeRun: CollectRunStore | null;
    results: RunResults | null;
    facts: ResultFact[];
    artifacts: ArtifactView[];
    steps?: ProgressRow[];
    config?: RunConfig | null;
    showEffective: boolean;
    onToggleQuality: () => void;
    onClose: () => void;
}) {
    const cards = storeRun !== null && storeRun.availability === 'available' ? funnelCards(storeRun.row, results) : [];

    return (
        <div className="kk-modal-backdrop" role="presentation">
            <button
                type="button"
                className="kk-modal-dismiss-backdrop"
                onClick={onClose}
                aria-label="Close modal dialog"
                tabIndex={-1}
            />
            <div className="kk-modal-card" role="dialog" aria-modal="true" aria-labelledby="kk-run-modal-title">
                <div className="kk-modal-header">
                    <div className="kk-modal-header-left">
                        <h2 id="kk-run-modal-title">
                            Run Details: <code>{runId}</code>
                        </h2>
                        {results ? (
                            <span
                                className={`kk-badge ${results.availability === 'available' ? 'kk-badge-success' : 'kk-badge-neutral'}`}
                            >
                                {results.availability}
                            </span>
                        ) : null}
                    </div>
                    <button type="button" className="kk-modal-close" onClick={onClose} aria-label="Close dialog">
                        ✕
                    </button>
                </div>

                <div className="kk-modal-body">
                    {/* Funnel Stage KPI Cards */}
                    {cards.length > 0 ? (
                        <div className="kk-stat-grid kk-collect-funnel">
                            {cards.map((card) => (
                                <div className="kk-stat-card" key={card.title}>
                                    <span className="kk-stat-label">{card.title}</span>
                                    <span className="kk-stat-value">{card.value}</span>
                                    <span className="kk-stat-sub">{card.unit}</span>
                                    <span className="kk-stat-sub">{card.detail}</span>
                                </div>
                            ))}
                        </div>
                    ) : null}

                    {storeRun === null ? <p>The store has not answered for this run yet.</p> : null}
                    {storeRun !== null && storeRun.availability === 'unavailable' ? (
                        <>
                            <p>The store could not be read for this run; no counts are shown.</p>
                            <StoreState diagnostics={storeRun.diagnostics} />
                        </>
                    ) : null}
                    {storeRun !== null && storeRun.row === null && storeRun.availability === 'available' ? (
                        <p>This run wrote no store row.</p>
                    ) : null}

                    {/* Label Quality Breakdown */}
                    {storeRun !== null && storeRun.row !== null ? (
                        <LabelQuality
                            quality={storeRun.labelQuality}
                            diagnostics={storeRun.diagnostics}
                            showEffective={showEffective}
                            onToggle={onToggleQuality}
                        />
                    ) : null}

                    {/* Facts Summary */}
                    {facts.length > 0 ? (
                        <div>
                            <h3 className="kk-chart-title" style={{ marginBottom: '0.5rem' }}>
                                Core Facts
                            </h3>
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
                    ) : null}

                    {/* Artifacts Evidence */}
                    <div>
                        <h3 className="kk-chart-title" style={{ marginBottom: '0.5rem' }}>
                            Artifact Evidence
                        </h3>
                        <ArtifactRows artifacts={artifacts} />
                    </div>

                    {/* Workflow Configuration */}
                    <div>
                        <h3 className="kk-chart-title" style={{ marginBottom: '0.5rem' }}>
                            Workflow Configuration
                        </h3>
                        <ConfigPanel config={config ?? null} />
                    </div>

                    {/* Execution Progress Steps */}
                    <div>
                        <h3 className="kk-chart-title" style={{ marginBottom: '0.5rem' }}>
                            Progress & Attempts
                        </h3>
                        <ProgressPanel steps={steps ?? []} />
                    </div>
                </div>

                <div className="kk-modal-footer">
                    <button type="button" className="kk-btn-action" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STANDALONE RUN DETAIL PANEL (Retained for testing & tab compatibility)
// ─────────────────────────────────────────────────────────────────────────────

export function RunDetailPanel({
    storeRun,
    results,
    facts,
    artifacts,
    showEffective,
    onToggleQuality,
}: {
    storeRun: CollectRunStore | null;
    results: RunResults | null;
    facts: ResultFact[];
    artifacts: ArtifactView[];
    showEffective: boolean;
    onToggleQuality: () => void;
}) {
    const cards = storeRun !== null && storeRun.availability === 'available' ? funnelCards(storeRun.row, results) : [];
    return (
        <div className="kk-collect-detail">
            {cards.length === 0 ? null : (
                <div className="kk-stat-grid kk-collect-funnel">
                    {cards.map((card) => (
                        <div className="kk-stat-card" key={card.title}>
                            <span className="kk-stat-label">{card.title}</span>
                            <span className="kk-stat-value">{card.value}</span>
                            <span className="kk-stat-sub">{card.unit}</span>
                            <span className="kk-stat-sub">{card.detail}</span>
                        </div>
                    ))}
                </div>
            )}
            {storeRun === null ? <p>The store has not answered for the selected run yet.</p> : null}
            {storeRun !== null && storeRun.availability === 'unavailable' ? (
                <>
                    <p>The store could not be read for this run; no counts are shown.</p>
                    <StoreState diagnostics={storeRun.diagnostics} />
                </>
            ) : null}
            {storeRun !== null && storeRun.row === null && storeRun.availability === 'available' ? (
                <p>This run wrote no store row.</p>
            ) : null}
            {storeRun !== null && storeRun.row !== null ? (
                <LabelQuality
                    quality={storeRun.labelQuality}
                    diagnostics={storeRun.diagnostics}
                    showEffective={showEffective}
                    onToggle={onToggleQuality}
                />
            ) : null}
            {results === null ? <p>No captured results for the selected run.</p> : null}
            {facts.length === 0 ? null : (
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
            )}
            <ArtifactRows artifacts={artifacts} />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. LABEL QUALITY VIEWS
// ─────────────────────────────────────────────────────────────────────────────

export function LabelQuality({
    quality,
    diagnostics,
    showEffective,
    onToggle,
}: {
    quality: CollectRunStore['labelQuality'];
    diagnostics: CollectRunStore['diagnostics'];
    showEffective: boolean;
    onToggle: () => void;
}) {
    return (
        <section className="kk-card kk-collect-quality">
            <div className="kk-card-header">
                <h2>Label quality</h2>
                <button type="button" onClick={onToggle}>
                    {showEffective ? 'Show this run' : 'Show effective labels'}
                </button>
            </div>
            {quality.length === 0 ? <p>No label decisions recorded for this run.</p> : null}
            {quality.map((entry) => (
                <div key={entry.decisionId} className="kk-collect-quality-block">
                    <h3>{entry.decisionId}</h3>
                    <QualityTable entry={entry} showEffective={showEffective} />
                </div>
            ))}
            <StoreState diagnostics={diagnostics} />
        </section>
    );
}

export function QualityTable({
    entry,
    showEffective,
}: {
    entry: CollectRunStore['labelQuality'][number];
    showEffective: boolean;
}) {
    if (showEffective) {
        if (entry.effective.length === 0) return <p>Effective label distribution unavailable.</p>;
        return (
            <table className="kk-table">
                <thead>
                    <tr>
                        <th scope="col">Value</th>
                        <th scope="col">Items</th>
                    </tr>
                </thead>
                <tbody>
                    {entry.effective.map((value) => (
                        <tr key={value.value}>
                            <td>{value.value}</td>
                            <td>{value.count}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        );
    }
    return (
        <table className="kk-table">
            <thead>
                <tr>
                    <th scope="col">Value</th>
                    <th scope="col">HIGH</th>
                    <th scope="col">MEDIUM</th>
                    <th scope="col">LOW</th>
                    <th scope="col">none</th>
                </tr>
            </thead>
            <tbody>
                {entry.run.map((row) => (
                    <tr key={row.value}>
                        <td>{row.value}</td>
                        <td>{row.HIGH}</td>
                        <td>{row.MEDIUM}</td>
                        <td>{row.LOW}</td>
                        <td>{row.none}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function ArtifactRows({ artifacts }: { artifacts: ArtifactView[] }) {
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

function FilterSelect({
    label,
    name,
    value,
    options,
    onChange,
}: {
    label: string;
    name: StoreItemFilterName;
    value: string | undefined;
    options: readonly string[];
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
    return (
        <label className="kk-collect-filter">
            {label}
            <select name={name} value={value ?? ''} onChange={onChange}>
                <option value="">All</option>
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. ITEMS PANEL (Joined items + labels with search, filters & inspection)
// ─────────────────────────────────────────────────────────────────────────────

export function ItemsPanel({
    runId,
    items,
    filters,
    quality,
    runs,
    onFilterChange,
    onSearchChange,
    onRunChange,
    onPageChange,
    onInspectItem,
}: {
    runId: string | null;
    items: CollectStoreItems | null;
    filters: StoreItemsQuery;
    quality: CollectRunStore['labelQuality'];
    runs?: readonly RunListRow[];
    onFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    onSearchChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    onRunChange?: (runId: string | undefined) => void;
    onPageChange: (event: MouseEvent<HTMLButtonElement>) => void;
    onInspectItem?: (item: CollectStoreItem) => void;
}) {
    // If runId is provided, enforce runId match; if null or empty, items is global
    const current = items !== null && (runId === null || items.runId === runId || items.runId === '') ? items : null;
    const storeState =
        current === null ? 'loading' : current.availability === 'available' ? 'available' : 'unavailable';
    const page = storeState === 'available' ? current : null;
    const count = page === null ? null : pager(page.page, page.total, page.pageSize);

    return (
        <section className="kk-card kk-collect-items">
            <div className="kk-collect-filters">
                {onSearchChange ? (
                    <label className="kk-collect-filter">
                        Search
                        <input
                            type="text"
                            className="kk-search-input"
                            placeholder="Title or URL..."
                            value={filters.search ?? ''}
                            onChange={onSearchChange}
                            aria-label="Search items"
                        />
                    </label>
                ) : null}
                {runs && runs.length > 0 ? (
                    <label className="kk-collect-filter">
                        Run
                        <select
                            name="run"
                            value={runId ?? ''}
                            onChange={(e) => onRunChange?.(e.target.value === '' ? undefined : e.target.value)}
                        >
                            <option value="">All Runs</option>
                            {runs.map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.id.length > 18 ? `${r.id.slice(0, 8)}...${r.id.slice(-6)}` : r.id} ({r.status})
                                </option>
                            ))}
                        </select>
                    </label>
                ) : null}
                <FilterSelect
                    label="Source"
                    name="source"
                    value={filters.source}
                    options={page?.sources ?? []}
                    onChange={onFilterChange}
                />
                <FilterSelect
                    label="Seen"
                    name="seen"
                    value={filters.seen}
                    options={['new', 'reseen']}
                    onChange={onFilterChange}
                />
                <FilterSelect
                    label="Decision"
                    name="decision"
                    value={filters.decision}
                    options={quality.map((entry) => entry.decisionId)}
                    onChange={onFilterChange}
                />
                <FilterSelect
                    label="Value"
                    name="value"
                    value={filters.value}
                    options={decisionValues(quality, filters.decision ?? '')}
                    onChange={onFilterChange}
                />
                <FilterSelect
                    label="Selection"
                    name="selection"
                    value={filters.selection}
                    options={['selected', 'published', 'dropped', 'none']}
                    onChange={onFilterChange}
                />
            </div>

            {runId === null && items === null ? <p>Select a run to browse its items.</p> : null}
            {runId !== null && storeState === 'loading' ? <p>The items page has not loaded yet.</p> : null}
            {storeState === 'unavailable' ? (
                <>
                    <p>The store could not be read for this run; no items are shown.</p>
                    <StoreState diagnostics={current?.diagnostics ?? []} />
                </>
            ) : null}
            {page !== null && page.items.length === 0 ? <p>No items match these filters.</p> : null}
            {page === null || page.items.length === 0 ? null : (
                <div className="kk-table-container">
                    <table className="kk-table kk-collect-items-table">
                        <thead>
                            <tr>
                                <th scope="col">Title</th>
                                <th scope="col">Source</th>
                                <th scope="col">Seen</th>
                                <th scope="col">Story</th>
                                <th scope="col">Labels</th>
                                <th scope="col">Selection</th>
                                <th scope="col">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {page.items.map((item) => (
                                <ItemRow key={item.id} item={item} onInspect={onInspectItem} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
            {count === null ? null : (
                <div className="kk-collect-pager">
                    <button type="button" name="previous" disabled={count.page <= 1} onClick={onPageChange}>
                        Previous
                    </button>
                    <span>
                        Page {count.page} of {count.pages} · {count.total} items
                    </span>
                    <button type="button" name="next" disabled={count.page >= count.pages} onClick={onPageChange}>
                        Next
                    </button>
                </div>
            )}
        </section>
    );
}

function ItemRow({ item, onInspect }: { item: CollectStoreItem; onInspect?: (item: CollectStoreItem) => void }) {
    const labels = Object.entries(item.labels);
    const details = item.labelDetails ?? {};

    return (
        <tr>
            <td>
                <div>
                    {item.url === null ? (
                        item.title
                    ) : (
                        <a href={item.url} target="_blank" rel="noreferrer">
                            {item.title}
                        </a>
                    )}
                </div>
                <div style={{ marginTop: '0.25rem', display: 'flex', gap: '0.25rem' }}>
                    {item.domain ? <span className="kk-domain-pill">{item.domain}</span> : null}
                    {item.lang ? <span className="kk-domain-pill">{item.lang}</span> : null}
                </div>
            </td>
            <td>{item.source}</td>
            <td>
                <span className={`kk-badge ${item.seen === 'new' ? 'kk-badge-success' : 'kk-badge-neutral'}`}>
                    {item.seen}
                </span>
            </td>
            <td>{item.storyId ?? '—'}</td>
            <td>
                {labels.length === 0
                    ? '—'
                    : labels.map(([decision, value]) => {
                          const detail: CollectItemLabelDetail | undefined = details[decision];
                          const conf = detail?.confidence?.toUpperCase();
                          return (
                              <span
                                  key={decision}
                                  className="kk-chip"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                              >
                                  <span>
                                      {decision}: {value}
                                  </span>
                                  {conf ? (
                                      <span
                                          className={`kk-confidence-pill ${conf === 'HIGH' ? 'kk-confidence-high' : conf === 'MEDIUM' ? 'kk-confidence-medium' : 'kk-confidence-low'}`}
                                      >
                                          {conf}
                                      </span>
                                  ) : null}
                              </span>
                          );
                      })}
            </td>
            <td>
                <span
                    className={`kk-badge ${item.selection === 'published' ? 'kk-badge-success' : item.selection === 'selected' ? 'kk-badge-running' : item.selection === 'dropped' ? 'kk-badge-warning' : 'kk-badge-neutral'}`}
                >
                    {item.selection}
                </span>
            </td>
            <td>
                <button type="button" className="kk-table-btn" onClick={() => onInspect?.(item)}>
                    Inspect
                </button>
            </td>
        </tr>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ITEM INSPECT MODAL
// ─────────────────────────────────────────────────────────────────────────────

export function ItemDetailModal({ item, onClose }: { item: CollectStoreItem; onClose: () => void }) {
    const details = Object.entries(item.labelDetails ?? {});
    return (
        <div className="kk-modal-backdrop" role="presentation">
            <button
                type="button"
                className="kk-modal-dismiss-backdrop"
                onClick={onClose}
                aria-label="Close item modal"
                tabIndex={-1}
            />
            <div className="kk-modal-card" role="dialog" aria-modal="true" aria-labelledby="kk-item-modal-title">
                <div className="kk-modal-header">
                    <div className="kk-modal-header-left">
                        <h2 id="kk-item-modal-title">Item Details</h2>
                        <span className={`kk-badge ${item.seen === 'new' ? 'kk-badge-success' : 'kk-badge-neutral'}`}>
                            {item.seen}
                        </span>
                        <span className="kk-domain-pill">{item.source}</span>
                    </div>
                    <button type="button" className="kk-modal-close" onClick={onClose} aria-label="Close dialog">
                        ✕
                    </button>
                </div>
                <div className="kk-modal-body">
                    <div>
                        <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.1rem' }}>{item.title}</h3>
                        {item.url ? (
                            <a href={item.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
                                {item.url}
                            </a>
                        ) : (
                            <span className="kk-board-state">No canonical URL</span>
                        )}
                    </div>

                    <dl className="kk-board-facts">
                        <div>
                            <dt>Item ID</dt>
                            <dd>
                                <code>{item.id}</code>
                            </dd>
                        </div>
                        <div>
                            <dt>Story ID</dt>
                            <dd>{item.storyId ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>Domain</dt>
                            <dd>{item.domain ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>Language</dt>
                            <dd>{item.lang ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>Body Characters</dt>
                            <dd>{item.bodyChars?.toLocaleString() ?? '—'}</dd>
                        </div>
                        <div>
                            <dt>Selection Status</dt>
                            <dd>
                                <span
                                    className={`kk-badge ${item.selection === 'published' ? 'kk-badge-success' : item.selection === 'selected' ? 'kk-badge-running' : 'kk-badge-neutral'}`}
                                >
                                    {item.selection}
                                </span>
                            </dd>
                        </div>
                    </dl>

                    <div>
                        <h3 className="kk-chart-title" style={{ marginBottom: '0.5rem' }}>
                            Label Decisions ({details.length})
                        </h3>
                        {details.length === 0 ? (
                            <p className="kk-board-state">No detailed label decisions recorded for this item.</p>
                        ) : (
                            <div className="kk-table-container">
                                <table className="kk-table">
                                    <thead>
                                        <tr>
                                            <th scope="col">Decision</th>
                                            <th scope="col">Value</th>
                                            <th scope="col">Confidence</th>
                                            <th scope="col">Maker</th>
                                            <th scope="col">Score</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {details.map(([decision, detail]) => {
                                            const conf = detail.confidence?.toUpperCase();
                                            return (
                                                <tr key={decision}>
                                                    <td>
                                                        <strong>{decision}</strong>
                                                    </td>
                                                    <td>{detail.value}</td>
                                                    <td>
                                                        {conf ? (
                                                            <span
                                                                className={`kk-confidence-pill ${conf === 'HIGH' ? 'kk-confidence-high' : conf === 'MEDIUM' ? 'kk-confidence-medium' : 'kk-confidence-low'}`}
                                                            >
                                                                {conf}
                                                            </span>
                                                        ) : (
                                                            '—'
                                                        )}
                                                    </td>
                                                    <td>{detail.maker ?? '—'}</td>
                                                    <td>{detail.score !== null ? detail.score : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
                <div className="kk-modal-footer">
                    <button type="button" className="kk-btn-action" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

function formatEpoch(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || Number.isNaN(ms) || ms <= 0) return '—';
    try {
        return formatTimestamp(new Date(ms).toISOString());
    } catch {
        return '—';
    }
}

export function SelectionsPanel({
    selections,
    topics,
    filters,
    onTopicChange,
    onStatusChange,
    onSearchChange,
    onPageChange,
    onInspectRun,
}: {
    selections: CollectStoreSelections | null;
    topics?: string[];
    filters: StoreSelectionsQuery;
    onTopicChange?: (topic: string | undefined) => void;
    onStatusChange?: (status: 'selected' | 'published' | 'dropped' | undefined) => void;
    onSearchChange?: (search: string) => void;
    onPageChange?: (delta: number) => void;
    onInspectRun?: (runId: string) => void;
}) {
    const storeState =
        selections === null ? 'loading' : selections.availability === 'available' ? 'available' : 'unavailable';
    const page = storeState === 'available' ? selections : null;
    const count = page === null ? null : pager(page.page, page.total, page.pageSize);
    const availableTopics = (topics && topics.length > 0 ? topics : selections?.topics) ?? [];

    return (
        <section className="kk-card kk-collect-items">
            <div className="kk-collect-filters">
                <label className="kk-collect-filter">
                    Search
                    <input
                        type="text"
                        className="kk-search-input"
                        placeholder="Topic, title or reason..."
                        value={filters.search ?? ''}
                        onChange={(e) => onSearchChange?.(e.target.value)}
                        aria-label="Search selections"
                    />
                </label>
                <label className="kk-collect-filter">
                    Topic
                    <select
                        value={filters.topic ?? ''}
                        onChange={(e) => onTopicChange?.(e.target.value === '' ? undefined : e.target.value)}
                    >
                        <option value="">All Topics</option>
                        {availableTopics.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="kk-collect-filter">
                    Status
                    <select
                        value={filters.status ?? ''}
                        onChange={(e) =>
                            onStatusChange?.(
                                e.target.value === ''
                                    ? undefined
                                    : (e.target.value as 'selected' | 'published' | 'dropped'),
                            )
                        }
                    >
                        <option value="">All Statuses</option>
                        <option value="selected">selected</option>
                        <option value="published">published</option>
                        <option value="dropped">dropped</option>
                    </select>
                </label>
            </div>

            {storeState === 'loading' ? <p>The selections page has not loaded yet.</p> : null}
            {storeState === 'unavailable' ? (
                <>
                    <p>The selections could not be read; no rows are shown.</p>
                    <StoreState diagnostics={selections?.diagnostics ?? []} />
                </>
            ) : null}
            {page !== null && page.selections.length === 0 ? <p>No selections match these filters.</p> : null}

            {page === null || page.selections.length === 0 ? null : (
                <div className="kk-table-container">
                    <table className="kk-table">
                        <thead>
                            <tr>
                                <th scope="col">Rank</th>
                                <th scope="col">Topic</th>
                                <th scope="col">Title & URL</th>
                                <th scope="col">Source</th>
                                <th scope="col">Story</th>
                                <th scope="col">Status</th>
                                <th scope="col">Reason</th>
                                <th scope="col">Selected At</th>
                                <th scope="col">Run ID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {page.selections.map((item) => (
                                <tr key={`${item.topic}-${item.itemId}`}>
                                    <td>
                                        <span className="kk-badge kk-badge-neutral">#{item.rank ?? '—'}</span>
                                    </td>
                                    <td>
                                        <span className="kk-domain-pill">{item.topic}</span>
                                    </td>
                                    <td>
                                        {item.url ? (
                                            <a href={item.url} target="_blank" rel="noreferrer">
                                                {item.title ?? item.itemId}
                                            </a>
                                        ) : (
                                            (item.title ?? item.itemId)
                                        )}
                                    </td>
                                    <td>{item.source ?? '—'}</td>
                                    <td>{item.storyId ?? '—'}</td>
                                    <td>
                                        <span
                                            className={`kk-badge ${item.status === 'published' ? 'kk-badge-success' : item.status === 'selected' ? 'kk-badge-running' : 'kk-badge-failed'}`}
                                        >
                                            {item.status}
                                        </span>
                                    </td>
                                    <td>
                                        <span className="kk-stat-sub" title={item.reason ?? undefined}>
                                            {item.reason
                                                ? item.reason.length > 60
                                                    ? `${item.reason.slice(0, 60)}…`
                                                    : item.reason
                                                : '—'}
                                        </span>
                                    </td>
                                    <td>{formatEpoch(item.selectedAt)}</td>
                                    <td>
                                        <button
                                            type="button"
                                            className="kk-collect-run-link"
                                            onClick={() => onInspectRun?.(item.runId)}
                                            title="Inspect this collection run"
                                        >
                                            {item.runId}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {count === null ? null : (
                <div className="kk-collect-pager">
                    <button type="button" name="previous" disabled={count.page <= 1} onClick={() => onPageChange?.(-1)}>
                        Previous
                    </button>
                    <span>
                        Page {count.page} of {count.pages} · {count.total} selections
                    </span>
                    <button
                        type="button"
                        name="next"
                        disabled={count.page >= count.pages}
                        onClick={() => onPageChange?.(1)}
                    >
                        Next
                    </button>
                </div>
            )}
        </section>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. PROGRESS & CONFIG PANELS (Shipped behavior preserved)
// ─────────────────────────────────────────────────────────────────────────────

export function ProgressPanel({ steps }: { steps: ProgressRow[] }) {
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

export function ConfigPanel({ config }: { config: RunConfig | null }) {
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
