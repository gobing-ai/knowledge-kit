import type { ChangeEvent, MouseEvent } from 'react';
import type { CollectRunStore, CollectStoreItems, CollectStoreOverview, RunConfig, RunResults } from '../contracts';
import { MAX_OVERVIEW_RUNS, type StoreItemFilterName, type StoreItemsQuery } from '../shared/api';
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
 * The Collect module's five panels: props in, markup out, no local state and no local handlers.
 *
 * Kept out of `collect/index.tsx` so they render (and are asserted on) without a DOM or a live
 * reader, and so the entry file stays the one place that owns interaction. Store strings render as
 * React text nodes, never HTML; unavailable data renders as its diagnostic, never as a zero.
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
function StoreState({ diagnostics }: { diagnostics: CollectStoreOverview['diagnostics'] }) {
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

/** Overview (AC1, AC2): cadence health and per-run yield across the loaded Spur run page. */
export function OverviewPanel({
    runs,
    overview,
    now,
    runHref,
}: {
    runs: readonly RunListRow[];
    overview: CollectStoreOverview | null;
    now: number;
    /** The Run detail deep link for one run (the container owns the module path and query). */
    runHref: (runId: string) => string;
}) {
    const page = runs.slice(0, MAX_OVERVIEW_RUNS);
    // R7/AC1: a count exists only for a store that answered. `overview === null` is "not loaded yet";
    // `availability: 'unavailable'` is "could not be read" — neither may render a number or a
    // per-row store claim (Spur status/timing still render: they come from the run list).
    const storeState = overview === null ? 'loading' : overview.availability;
    const counts = overview !== null && storeState === 'available' ? bannerCounts(page, overview.rows) : null;
    const cadence = overview === null ? null : cadenceState(overview.lastStoredAt, now);
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
                        </tr>
                    </thead>
                    <tbody>
                        {page.map((run) => {
                            const row = overview?.rows[run.id] ?? null;
                            return (
                                <tr key={run.id}>
                                    <td>
                                        <a className="kk-collect-run-link" href={runHref(run.id)}>
                                            {run.id}
                                        </a>
                                    </td>
                                    <td>{formatTimestamp(run.startedAt)}</td>
                                    {/* Spur's own timings: `collect_runs` is stamped at ingest (§1). */}
                                    <td>{runDuration(run.startedAt, run.completedAt)}</td>
                                    <td>{run.status}</td>
                                    {storeState !== 'available' ? (
                                        <td colSpan={6} className="kk-collect-nostore">
                                            {storeState === 'loading' ? 'store not loaded yet' : 'store unavailable'}
                                        </td>
                                    ) : row === null ? (
                                        <td colSpan={6} className="kk-collect-nostore">
                                            {storeCellText(run.status)}
                                        </td>
                                    ) : (
                                        <StoredCells row={row} />
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

/** The six stored columns of one Overview row: per-source bar, counts, fallback share, yield. */
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

/** Run detail (AC3, AC4): the stage funnel, label quality, then the shipped facts and downloads. */
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
    // P3: an unanswered (`null`) or unreadable store proves nothing about this run, so no stage is
    // rendered — only a loaded `available` response may claim a row exists or does not.
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

/** The label-quality card: this run's own rows, or the effective distribution behind the toggle. */
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

/** One decision's histogram: the run's own rows by confidence level, or the effective counts. */
export function QualityTable({
    entry,
    showEffective,
}: {
    entry: CollectRunStore['labelQuality'][number];
    showEffective: boolean;
}) {
    if (showEffective) {
        // A label-policy read failure only empties `effective` (design §3): state it, never a zero.
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

/** The shipped allowlisted downloads, kept under Run detail (Results folds in here). */
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

/** One filter dropdown; its first entry clears the filter. The container owns the change handler. */
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

/** Items (AC5): a paged, filtered browser over one run's store items. */
export function ItemsPanel({
    runId,
    items,
    filters,
    quality,
    onFilterChange,
    onPageChange,
}: {
    runId: string | null;
    items: CollectStoreItems | null;
    filters: StoreItemsQuery;
    quality: CollectRunStore['labelQuality'];
    onFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    onPageChange: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
    // A page fetched for a previous run must never render under the current one.
    const current = items !== null && items.runId === runId ? items : null;
    // R7/AC1, same discipline as the Overview and the funnel: the unavailable envelope still carries
    // `runId` with `total: 0 · items: []`, so its numbers are NOT facts. Only a loaded, available
    // response may produce a pager, an item count, a "no matches" line or a table.
    const storeState =
        current === null ? 'loading' : current.availability === 'available' ? 'available' : 'unavailable';
    const page = storeState === 'available' ? current : null;
    const count = page === null ? null : pager(page.page, page.total, page.pageSize);
    return (
        <section className="kk-card kk-collect-items">
            <div className="kk-collect-filters">
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
            {runId === null ? <p>Select a run to browse its items.</p> : null}
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
                            </tr>
                        </thead>
                        <tbody>
                            {page.items.map((item) => (
                                <ItemRow key={item.id} item={item} />
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

/** One item row: every store string is a React text node, never markup. */
function ItemRow({ item }: { item: CollectStoreItems['items'][number] }) {
    const labels = Object.entries(item.labels);
    return (
        <tr>
            <td>
                {item.url === null ? (
                    item.title
                ) : (
                    <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title}
                    </a>
                )}
            </td>
            <td>{item.source}</td>
            <td>{item.seen}</td>
            <td>{item.storyId ?? '—'}</td>
            <td>
                {labels.length === 0
                    ? '—'
                    : labels.map(([decision, value]) => (
                          <span key={decision} className="kk-chip">
                              {decision}: {value}
                          </span>
                      ))}
            </td>
            <td>{item.selection}</td>
        </tr>
    );
}

/** Execution progress: recorded state visits and attempts; never an execution action. */
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

/** Workflow Config Summary: captured run values only; current definitions stay in Settings. */
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
