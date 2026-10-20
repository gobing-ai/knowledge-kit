/**
 * G81/0308 — the Collect store panels, rendered to static markup.
 *
 * No DOM library is installed, so the panels are asserted the way the module ships them: as React
 * elements rendered to HTML (`react-dom/server`). Each test ties to one requirement — unavailable
 * data shows its diagnostic (R7), an item title is a text node (R6), the funnel counts are the
 * route's numbers (R4/R5).
 */

import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    ArtifactRows,
    ConfigPanel,
    ItemDetailModal,
    ItemsPanel,
    LabelQuality,
    OverviewPanel,
    ProgressPanel,
    QualityTable,
    RunDetailModal,
    RunDetailPanel,
    RunDetailsPanel,
    SelectionsPanel,
    SummaryPanel,
} from '../../src/collect/panels';
import type {
    CollectRunStore,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    RunConfig,
    RunResults,
} from '../../src/contracts';
import type { StoreItemsQuery } from '../../src/shared/api';

const NOW = Date.parse('2026-10-16T12:00:00Z');

const runs = [
    {
        id: 'r-stored',
        workflowName: 'kk-collect',
        status: 'done',
        startedAt: '2026-10-16T09:00:00Z',
        completedAt: '2026-10-16T09:04:00Z',
    },
    {
        id: 'r-failed',
        workflowName: 'kk-collect',
        status: 'failed',
        startedAt: '2026-10-16T03:00:00Z',
        completedAt: null,
    },
    { id: 'r-running', workflowName: 'kk-collect', status: 'running', startedAt: '2026-10-16T11:59:00Z' },
    {
        id: 'r-done-empty',
        workflowName: 'kk-collect',
        status: 'done',
        startedAt: '2026-10-15T21:00:00Z',
        completedAt: '2026-10-15T21:01:00Z',
    },
];

const storeRow = {
    runId: 'r-stored',
    sourceCounts: { 'aihot-ingest': 6, 'hn-ingest': 4 },
    inserted: 7,
    updated: 2,
    labelRows: 20,
    labeledItems: 9,
    labelRowsBySource: { heuristic: 12, model: 6, default: 2 },
    yield: { selected: 5, published: 3, dropped: 1 },
};

function overview(overrides: Partial<CollectStoreOverview> = {}): CollectStoreOverview {
    return {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        lastStoredAt: '2026-10-16T09:00:00Z',
        rows: { 'r-stored': storeRow, 'r-failed': null, 'r-running': null, 'r-done-empty': null },
        ...overrides,
    };
}

function runStore(overrides: Partial<CollectRunStore> = {}): CollectRunStore {
    return {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        runId: 'r-stored',
        row: storeRow,
        labelQuality: [
            {
                decisionId: 'kk-item-quality',
                run: [
                    { value: 'HIGH', HIGH: 2, MEDIUM: 0, LOW: 0, none: 0 },
                    { value: 'LOW', HIGH: 0, MEDIUM: 1, LOW: 3, none: 0 },
                ],
                effective: [{ value: 'HIGH', count: 2 }],
            },
        ],
        ...overrides,
    };
}

function results(): RunResults {
    return {
        schemaVersion: 1,
        workflow: 'kk-collect',
        runId: 'r-stored',
        availability: 'available',
        summary: { unchanged: 1, factsPreview: '# Facts' },
        artifacts: [],
        diagnostics: [],
    };
}

function items(overrides: Partial<CollectStoreItems> = {}): CollectStoreItems {
    return {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        runId: 'r-stored',
        page: 1,
        pageSize: 25,
        total: 26,
        sources: ['aihot-ingest', 'hn-ingest'],
        items: [
            {
                id: 'i-1',
                title: '<script>alert(1)</script>',
                url: 'https://example.com/a',
                source: 'hn-ingest',
                storyId: 's-1',
                seen: 'new',
                labels: { 'kk-item-quality': 'HIGH' },
                selection: 'published',
            },
            {
                id: 'i-2',
                title: 'Untitled draft',
                url: null,
                source: 'aihot-ingest',
                storyId: null,
                seen: 'reseen',
                labels: {},
                selection: 'none',
            },
        ],
        ...overrides,
    };
}

const noop = (): void => undefined;

describe('OverviewPanel (AC1)', () => {
    it('states cadence, attention counts and one row per Spur run', () => {
        const html = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={overview()}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        // 3 h since the last stored collection: on schedule, with its own sentence.
        expect(html).toContain('on schedule');
        expect(html).toContain('3.0 h since the last stored collection (schedule 6 h).');
        // One failed tick and one `done` tick without a row; the running one is in progress.
        expect(html).toContain('1 failed · 1 done without a store row · 1');
        expect(html).toContain('no store row');
        expect(html).toContain('in progress');
        // Duration comes from Spur, never from collect_runs.
        expect(html).toContain('4m 0s');
    });

    it('trends collection per source, fallback share and yield for a stored run', () => {
        const html = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={overview()}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        expect(html).toContain('kk-collect-bar-seg');
        expect(html).toContain('aihot-ingest 6 · hn-ingest 4');
        expect(html).toContain('10%'); // 2 default rows of 20 label rows
        expect(html).toContain('5 selected · 3 published · 1 dropped');
    });

    it('shows the store diagnostic instead of counts when the store is unreadable', () => {
        const html = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={overview({
                    availability: 'unavailable',
                    lastStoredAt: null,
                    rows: {},
                    diagnostics: [{ code: 'board.store.missing', message: 'No store is present.' }],
                })}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        expect(html).toContain('board.store.missing: No store is present.');
        expect(html).toContain('The store could not be read for this page; no counts are shown.');
        expect(html).toContain('unknown');
        // R7/AC1: no count is derived from an unreadable store — not `0`, not `no store row`.
        expect(html).not.toContain('Needs attention');
        expect(html).not.toContain('done without a store row');
        expect(html).not.toContain('no store row');
        expect(html).not.toContain('in progress');
        expect(html).not.toContain('kk-stat-value');
    });

    it('tones a late and a stalled collection distinctly, with the state as text', () => {
        const late = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={overview({ lastStoredAt: '2026-10-16T03:00:00Z' })}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        expect(late).toContain('kk-badge-warning');
        expect(late).toContain('late');
        const stalled = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={overview({ lastStoredAt: '2026-10-14T03:00:00Z' })}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        expect(stalled).toContain('kk-badge-failed');
        expect(stalled).toContain('stalled');
    });

    it('states that the overview has not loaded yet without inventing a cadence or counts', () => {
        const html = renderToStaticMarkup(
            <OverviewPanel
                runs={runs}
                overview={null}
                now={NOW}
                runHref={(runId) => `/board/modules/kk-collect?run=${runId}&tab=summary`}
            />,
        );
        expect(html).toContain('The store overview has not loaded yet.');
        expect(html).toContain('The store has not answered yet.');
        // R7/AC1: an unanswered store yields no counts and no per-row store claim.
        expect(html).not.toContain('Needs attention');
        expect(html).not.toContain('done without a store row');
        expect(html).not.toContain('no store row');
        expect(html).not.toContain('in progress');
        expect(html).not.toContain('kk-stat-value');
    });
});

describe('RunDetailPanel (AC3, AC4)', () => {
    it('names every funnel stage unit and both label-quality views', () => {
        const html = renderToStaticMarkup(
            <RunDetailPanel
                storeRun={runStore()}
                results={results()}
                facts={[]}
                artifacts={[]}
                showEffective={false}
                onToggleQuality={noop}
            />,
        );
        expect(html).toContain('Collected');
        expect(html).toContain('Stored');
        expect(html).toContain('Labeled');
        expect(html).toContain('Downstream');
        expect(html).toContain('7 inserted · 2 updated · 1 unchanged');
        expect(html).toContain('kk-item-quality');
        expect(html).toContain('Show effective labels');
        expect(html).toContain('No artifact evidence for the selected run.');
    });

    it('shows the store diagnostic and no counts when the store is unreadable', () => {
        const html = renderToStaticMarkup(
            <RunDetailPanel
                storeRun={runStore({
                    availability: 'unavailable',
                    row: null,
                    labelQuality: [],
                    diagnostics: [{ code: 'board.store.newer', message: 'The store is newer than this build.' }],
                })}
                results={null}
                facts={[]}
                artifacts={[]}
                showEffective={false}
                onToggleQuality={noop}
            />,
        );
        expect(html).toContain('board.store.newer: The store is newer than this build.');
        expect(html).toContain('The store could not be read for this run; no counts are shown.');
        // No funnel card at all: the stages cannot be counted from an unreadable store.
        expect(html).not.toContain('kk-stat-grid');
        expect(html).not.toContain('wrote no store row');
        expect(html).not.toContain('kk-stat-value">0<');
        expect(html).toContain('No captured results for the selected run.');
    });

    it('states a run with no store row instead of a zero funnel', () => {
        const html = renderToStaticMarkup(
            <RunDetailPanel
                storeRun={runStore({ row: null, labelQuality: [] })}
                results={null}
                facts={[]}
                artifacts={[]}
                showEffective={false}
                onToggleQuality={noop}
            />,
        );
        expect(html).toContain('This run wrote no store row.');
    });

    it('keeps the shipped core-facts rows below the funnel', () => {
        const html = renderToStaticMarkup(
            <RunDetailPanel
                storeRun={runStore()}
                results={results()}
                facts={[{ label: 'Core facts', value: '3 inserted', availability: 'available' }]}
                artifacts={[]}
                showEffective={true}
                onToggleQuality={noop}
            />,
        );
        expect(html).toContain('Core facts');
        expect(html).toContain('3 inserted');
        expect(html).toContain('Show this run');
    });

    it('states that the store has not answered yet', () => {
        const html = renderToStaticMarkup(
            <RunDetailPanel
                storeRun={null}
                results={null}
                facts={[]}
                artifacts={[]}
                showEffective={false}
                onToggleQuality={noop}
            />,
        );
        expect(html).toContain('The store has not answered for the selected run yet.');
        // Loading is not evidence: no funnel, no "wrote no store row", no stage units.
        expect(html).not.toContain('wrote no store row');
        expect(html).not.toContain('kk-stat-grid');
        expect(html).not.toContain('Downstream');
    });
});

describe('ItemsPanel (AC5)', () => {
    const filters: StoreItemsQuery = { page: 1 };

    it('renders store text as text nodes and links only an http(s) title', () => {
        const html = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items()}
                filters={filters}
                quality={runStore().labelQuality}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        // R6: a store-supplied title is escaped, never markup.
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('rel="noreferrer"');
        expect(html).toContain('kk-chip');
        expect(html).toContain('Page 1 of 2 · 26 items');
    });

    it('offers the route-backed filters, incl. the decision value domain', () => {
        const html = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items()}
                filters={{ page: 1, decision: 'kk-item-quality' }}
                quality={runStore().labelQuality}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        expect(html).toContain('aihot-ingest');
        expect(html).toContain('reseen');
        expect(html).toContain('kk-item-quality');
        expect(html).toContain('HIGH');
        expect(html).toContain('published');
    });

    it('shows the store diagnostic instead of items when the store is unreadable', () => {
        const html = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items({
                    availability: 'unavailable',
                    items: [],
                    sources: [],
                    total: 0,
                    diagnostics: [{ code: 'board.store.unreadable', message: 'The store could not be opened.' }],
                })}
                filters={filters}
                quality={[]}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        expect(html).toContain('board.store.unreadable: The store could not be opened.');
        expect(html).toContain('The store could not be read for this run; no items are shown.');
        // The unavailable envelope's `total: 0 · items: [] · sources: []` is not a fact: no pager,
        // no item count, no "no matches", no table.
        expect(html).not.toContain('Page ');
        expect(html).not.toMatch(/\d+ items/);
        expect(html).not.toContain('No items match these filters.');
        expect(html).not.toContain('kk-collect-pager');
        expect(html).not.toContain('kk-table');
    });

    it('states an empty page and an unloaded page distinctly, claiming facts only when loaded', () => {
        const empty = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items({ items: [], total: 0 })}
                filters={filters}
                quality={[]}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        // An available page that matched nothing IS a fact: it may say so, and it keeps its pager.
        expect(empty).toContain('No items match these filters.');
        expect(empty).toContain('Page 1 of 1 · 0 items');

        const unloaded = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={null}
                filters={filters}
                quality={[]}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        expect(unloaded).toContain('The items page has not loaded yet.');
        expect(unloaded).not.toContain('Page ');
        expect(unloaded).not.toMatch(/\d+ items/);
        expect(unloaded).not.toContain('No items match these filters.');

        const unreadable = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items({
                    availability: 'unavailable',
                    items: [],
                    sources: [],
                    total: 0,
                    diagnostics: [{ code: 'board.store.missing', message: 'No store is present.' }],
                })}
                filters={filters}
                quality={[]}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        // Not loaded and could-not-be-read are distinct states, and neither states an item count.
        expect(unreadable).toContain('The store could not be read for this run; no items are shown.');
        expect(unreadable).toContain('board.store.missing: No store is present.');
        expect(unreadable).not.toContain('has not loaded yet');
        expect(unreadable).not.toContain('No items match these filters.');
        expect(unreadable).not.toContain('Page ');
        expect(unreadable).not.toMatch(/\d+ items/);

        expect(
            renderToStaticMarkup(
                <ItemsPanel
                    runId={null}
                    items={null}
                    filters={filters}
                    quality={[]}
                    onFilterChange={noop}
                    onPageChange={noop}
                />,
            ),
        ).toContain('Select a run to browse its items.');
    });

    it('never renders a previous run’s page under the selected run', () => {
        const html = renderToStaticMarkup(
            <ItemsPanel
                runId="r-other"
                items={items()}
                filters={filters}
                quality={[]}
                onFilterChange={noop}
                onPageChange={noop}
            />,
        );
        expect(html).not.toContain('Untitled draft');
        expect(html).toContain('The items page has not loaded yet.');
    });
});

describe('label quality views (AC4)', () => {
    const entry = runStore().labelQuality[0] as CollectRunStore['labelQuality'][number];

    it('keeps HIGH, MEDIUM, LOW and none in their own columns, per value', () => {
        const html = renderToStaticMarkup(<QualityTable entry={entry} showEffective={false} />);
        // Column order is frozen: value, HIGH, MEDIUM, LOW, none — a level never collapses into another.
        expect(html).toContain('<th scope="col">HIGH</th><th scope="col">MEDIUM</th><th scope="col">LOW</th>');
        expect(html).toContain('<th scope="col">none</th>');
        expect(html).toContain('<td>HIGH</td><td>2</td><td>0</td><td>0</td><td>0</td>');
        expect(html).toContain('<td>LOW</td><td>0</td><td>1</td><td>3</td><td>0</td>');
    });

    it('counts rows with no recorded confidence level under `none`, never as a level', () => {
        const html = renderToStaticMarkup(
            <QualityTable
                entry={{ ...entry, run: [{ value: 'ai-news', HIGH: 0, MEDIUM: 0, LOW: 0, none: 5 }] }}
                showEffective={false}
            />,
        );
        expect(html).toContain('<td>ai-news</td><td>0</td><td>0</td><td>0</td><td>5</td>');
    });

    it('keeps each decision’s HIGH/MEDIUM/LOW counts in that decision’s own histogram', () => {
        const html = renderToStaticMarkup(
            <LabelQuality
                showEffective={false}
                onToggle={noop}
                diagnostics={[]}
                quality={[
                    {
                        decisionId: 'kk-item-category',
                        run: [{ value: 'ai-news', HIGH: 0, MEDIUM: 2, LOW: 1, none: 1 }],
                        effective: [],
                    },
                    {
                        decisionId: 'kk-item-quality',
                        run: [{ value: '4', HIGH: 3, MEDIUM: 0, LOW: 0, none: 0 }],
                        effective: [],
                    },
                ]}
            />,
        );
        // One block per decision, in the order the route served them.
        const [, category = '', quality = ''] = html.split('class="kk-collect-quality-block"');
        expect(category).toContain('<h3>kk-item-category</h3>');
        expect(category).toContain('<td>ai-news</td><td>0</td><td>2</td><td>1</td><td>1</td>');
        expect(category).not.toContain('<td>4</td>');
        expect(quality).toContain('<h3>kk-item-quality</h3>');
        expect(quality).toContain('<td>4</td><td>3</td><td>0</td><td>0</td><td>0</td>');
        // A level counted under one decision is never folded into another decision's row.
        expect(quality).not.toContain('ai-news');
    });

    it('renders the effective distribution, and states an unreadable one', () => {
        expect(renderToStaticMarkup(<QualityTable entry={entry} showEffective={true} />)).toContain('Items');
        expect(
            renderToStaticMarkup(<QualityTable entry={{ ...entry, effective: [] }} showEffective={true} />),
        ).toContain('Effective label distribution unavailable.');
    });

    it('states an empty label-quality set and carries the policy diagnostic', () => {
        const html = renderToStaticMarkup(
            <LabelQuality
                showEffective={false}
                onToggle={noop}
                quality={[]}
                diagnostics={[{ code: 'board.store.policy', message: 'The label policy could not be read.' }]}
            />,
        );
        expect(html).toContain('No label decisions recorded for this run.');
        expect(html).toContain('board.store.policy: The label policy could not be read.');
        expect(html).toContain('Show effective labels');
    });
});

describe('artifact rows', () => {
    it('links an available artifact and states an unavailable one', () => {
        const html = renderToStaticMarkup(
            <ArtifactRows
                artifacts={[
                    {
                        id: 'a-1',
                        label: 'facts',
                        kind: 'text',
                        availability: 'available',
                        state: 'Available',
                        href: 'http://127.0.0.1:4340/a',
                    },
                    { id: 'a-2', label: 'digest', kind: 'text', availability: 'missing', state: 'Missing', href: null },
                ]}
            />,
        );
        expect(html).toContain('http://127.0.0.1:4340/a');
        expect(html).toContain('digest — Missing');
    });
});

describe('shipped panels (AC6)', () => {
    it('keeps progress and config rendering their recorded evidence', () => {
        const progress = renderToStaticMarkup(
            <ProgressPanel
                steps={[
                    { state: 'store', visit: 1, status: 'done', timing: '4s', operatorWait: false, actions: [] },
                    {
                        state: 'review',
                        visit: 1,
                        status: 'waiting',
                        timing: 'timing unknown',
                        operatorWait: true,
                        actions: ['approve — done'],
                    },
                ]}
            />,
        );
        expect(progress).toContain('store');
        expect(progress).toContain('operator wait');
        expect(progress).toContain('approve — done');
        expect(renderToStaticMarkup(<ProgressPanel steps={[]} />)).toContain(
            'Recorded progress is unavailable for the selected run.',
        );
        const config: RunConfig = {
            schemaVersion: 1,
            workflow: 'kk-collect',
            runId: 'r-stored',
            capturedAt: '2026-10-16T09:00:00Z',
            settings: { topic: 'ai-news' },
            unavailableKeys: [],
            diagnostics: [],
        };
        expect(renderToStaticMarkup(<ConfigPanel config={config} />)).toContain('topic');
        expect(
            renderToStaticMarkup(<ConfigPanel config={{ ...config, settings: {}, unavailableKeys: ['topic'] }} />),
        ).toContain('Uncaptured keys: topic');
        expect(renderToStaticMarkup(<ConfigPanel config={null} />)).toContain(
            'No captured configuration for the selected run.',
        );
    });
});

describe('SummaryPanel (Redesigned Executive Dashboard)', () => {
    it('renders KPI stat cards, time pills, charts, and breakdown tables', () => {
        const html = renderToStaticMarkup(
            <SummaryPanel
                runs={runs}
                overview={overview()}
                now={NOW}
                timeRange="24h"
                onTimeRangeChange={() => {}}
                onInspectRun={() => {}}
            />,
        );
        // Time pills
        expect(html).toContain('24h');
        expect(html).toContain('kk-time-pill active');

        // KPI stat cards
        expect(html).toContain('Total Ingested Items');
        expect(html).toContain('Ingestion Success Rate');
        expect(html).toContain('Label Decisions');
        expect(html).toContain('Selection Yield');

        // Timeline charts
        expect(html).toContain('Ingestion Volume Over Time');
        expect(html).toContain('Decision Volume &amp; Selection Activity');
        expect(html).toContain('kk-chart-svg');

        // Breakdowns
        expect(html).toContain('Top Ingestion Sources');
        expect(html).toContain('Recent Collection Runs');
        expect(html).toContain('aihot-ingest');
        expect(html).toContain('hn-ingest');
        expect(html).toContain('r-stored');
    });

    it('renders fallback states when overview is loading or unavailable', () => {
        const loadingHtml = renderToStaticMarkup(<SummaryPanel runs={runs} overview={null} now={NOW} timeRange="4h" />);
        expect(loadingHtml).toContain('Total Ingested Items');
        expect(loadingHtml).toContain('The store overview has not loaded yet.');

        const unavailHtml = renderToStaticMarkup(
            <SummaryPanel
                runs={runs}
                overview={overview({
                    availability: 'unavailable',
                    diagnostics: [{ code: 'board.store.unavailable', message: 'Database busy' }],
                })}
                now={NOW}
                timeRange="4h"
            />,
        );
        expect(unavailHtml).toContain('The store could not be read for this page');
        expect(unavailHtml).toContain('Database busy');
    });
});

describe('RunDetailsPanel and RunDetailModal', () => {
    it('renders the run list table with inspect buttons and links', () => {
        const html = renderToStaticMarkup(
            <RunDetailsPanel
                runs={runs}
                overview={overview()}
                now={NOW}
                runHref={(id) => `/board?runId=${id}`}
                onInspectRun={() => {}}
            />,
        );
        expect(html).toContain('Collection cadence');
        expect(html).toContain('href="/board?runId=r-stored"');
        expect(html).toContain('Inspect');
    });

    it('renders RunDetailModal with funnel cards and quality breakdown', () => {
        const html = renderToStaticMarkup(
            <RunDetailModal
                runId="r-stored"
                storeRun={runStore()}
                results={null}
                facts={[]}
                artifacts={[]}
                steps={[{ state: 'store', visit: 1, status: 'done', timing: '2s', operatorWait: false, actions: [] }]}
                showEffective={false}
                onToggleQuality={() => {}}
                onClose={() => {}}
            />,
        );
        expect(html).toContain('Run Details:');
        expect(html).toContain('r-stored');
        expect(html).toContain('Collected');
        expect(html).toContain('Stored');
        expect(html).toContain('Label quality');
        expect(html).toContain('kk-modal-card');
        expect(html).toContain('Close');
    });
});

describe('ItemDetailModal', () => {
    const sampleItem: CollectStoreItem = {
        id: 'item-99',
        source: 'aihot-ingest',
        title: 'Quantum Computing Advance',
        url: 'https://example.com/qc',
        storyId: 'story-101',
        seen: 'new',
        labels: { 'kk-item-quality': 'HIGH' },
        labelDetails: {
            'kk-item-quality': {
                value: 'HIGH',
                confidence: 'HIGH',
                score: 0.98,
                maker: 'model',
            },
        },
        selection: 'selected',
        domain: 'example.com',
        lang: 'en',
        bodyChars: 1500,
    };

    it('renders item details, confidence badges, and metadata table', () => {
        const html = renderToStaticMarkup(<ItemDetailModal item={sampleItem} onClose={() => {}} />);
        expect(html).toContain('Item Details');
        expect(html).toContain('Quantum Computing Advance');
        expect(html).toContain('aihot-ingest');
        expect(html).toContain('https://example.com/qc');
        expect(html).toContain('kk-badge-success');
        expect(html).toContain('model');
        expect(html).toContain('0.98');
    });
});

describe('SelectionsPanel', () => {
    const sampleSelections: CollectStoreSelections = {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        page: 1,
        pageSize: 25,
        total: 1,
        topics: ['ai-news', 'tech-radar'],
        selections: [
            {
                topic: 'ai-news',
                itemId: 'item-99',
                runId: 'r-stored',
                storyId: 'story-101',
                workflow: 'kk-collect',
                rank: 1,
                reason: 'Groundbreaking research',
                status: 'selected',
                selectedAt: 1776330300000,
                publishedAt: null,
                title: 'Quantum Computing Advance',
                source: 'aihot-ingest',
                url: 'https://example.com/qc',
            },
        ],
    };

    it('renders the selections table with rank, topic, and status', () => {
        const html = renderToStaticMarkup(
            <SelectionsPanel
                selections={sampleSelections}
                filters={{ page: 1 }}
                onTopicChange={() => {}}
                onStatusChange={() => {}}
                onSearchChange={() => {}}
                onPageChange={() => {}}
            />,
        );
        expect(html).toContain('Quantum Computing Advance');
        expect(html).toContain('ai-news');
        expect(html).toContain('selected');
        expect(html).toContain('Groundbreaking research');
        expect(html).toContain('story-101');
        expect(html).toContain('r-stored');
    });

    it('renders empty, loading, and unavailable states properly', () => {
        const emptyHtml = renderToStaticMarkup(
            <SelectionsPanel
                selections={{ ...sampleSelections, selections: [], total: 0 }}
                filters={{ page: 1 }}
                onTopicChange={() => {}}
                onStatusChange={() => {}}
                onSearchChange={() => {}}
                onPageChange={() => {}}
            />,
        );
        expect(emptyHtml).toContain('No selections match these filters.');

        const loadingHtml = renderToStaticMarkup(
            <SelectionsPanel
                selections={null}
                filters={{ page: 1 }}
                onTopicChange={() => {}}
                onStatusChange={() => {}}
                onSearchChange={() => {}}
                onPageChange={() => {}}
            />,
        );
        expect(loadingHtml).toContain('The selections page has not loaded yet.');

        const unavailHtml = renderToStaticMarkup(
            <SelectionsPanel
                selections={{
                    schemaVersion: 1,
                    availability: 'unavailable',
                    diagnostics: [{ code: 'board.store.selections-unavailable', message: 'Reader timeout' }],
                    page: 1,
                    pageSize: 25,
                    total: 0,
                    topics: [],
                    selections: [],
                }}
                filters={{ page: 1 }}
                onTopicChange={() => {}}
                onStatusChange={() => {}}
                onSearchChange={() => {}}
                onPageChange={() => {}}
            />,
        );
        expect(unavailHtml).toContain('The selections could not be read; no rows are shown.');
        expect(unavailHtml).toContain('Reader timeout');
    });
});
