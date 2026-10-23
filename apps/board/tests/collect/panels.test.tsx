/**
 * G81/0308 — the Collect store panels, rendered to static markup.
 *
 * No DOM library is installed, so the panels are asserted the way the module ships them: as React
 * elements rendered to HTML (`react-dom/server`). Each test ties to one requirement — unavailable
 * data shows its diagnostic (R7), an item title is a text node (R6), the funnel counts are the
 * route's numbers (R4/R5).
 */

import { describe, expect, it } from 'bun:test';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
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
    CollectChannelYield,
    CollectRunStore,
    CollectStoreItem,
    CollectStoreItems,
    CollectStoreOverview,
    CollectStoreSelections,
    RunConfig,
    RunResults,
} from '../../src/contracts';
import type { StoreItemsQuery } from '../../src/shared/api';
import { ChannelYieldTable } from '../../src/shared/channel-yield';
import { requestSequence } from '../../src/shared/refresh';

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

function channels(overrides: Partial<CollectChannelYield> = {}): CollectChannelYield {
    return {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        fromMs: 0,
        untilMs: 0,
        timeZone: 'UTC',
        page: 1,
        pageSize: 30,
        totalDays: 1,
        sources: ['aihot-ingest', 'hn-ingest'],
        plugins: ['aihot-ingest', 'horizon-ingest', 'last30days-ingest'],
        byDay: [{ day: '2026-10-16', total: 10, sources: { 'aihot-ingest': 6, 'hn-ingest': 4 } }],
        bySource: { 'aihot-ingest': 6, 'hn-ingest': 4 },
        runsByDay: [
            {
                day: '2026-10-16',
                runs: 2,
                plugins: { 'aihot-ingest': 6, 'horizon-ingest': 0, 'last30days-ingest': 0 },
            },
        ],
        lastPositiveAt: { 'aihot-ingest': 0, 'horizon-ingest': null, 'last30days-ingest': null },
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

/**
 * Depth-first search over the element tree a panel returns. No DOM library is installed, so a
 * handler is exercised by finding its element and invoking the prop React would have called.
 */
type AnyElement = ReactElement<Record<string, unknown>>;

function findElement(node: ReactNode, predicate: (element: AnyElement) => boolean): AnyElement | null {
    if (!isValidElement(node)) return null;
    const element = node as AnyElement;
    if (predicate(element)) return element;
    const children = (element.props as { children?: ReactNode }).children;
    for (const child of Array.isArray(children) ? children : [children]) {
        const found = findElement(child as ReactNode, predicate);
        if (found !== null) return found;
    }
    return null;
}

/** The element a predicate must find, or a loud failure instead of a null dereference. */
function mustFind(node: ReactNode, predicate: (element: AnyElement) => boolean): AnyElement {
    const found = findElement(node, predicate);
    if (found === null) throw new Error('element not found');
    return found;
}

/** An element's text children, which is how a filter's label reads here. */
function textOf(node: ReactNode): string {
    if (typeof node === 'string') return node;
    if (!isValidElement(node)) return '';
    const children = (node.props as { children?: ReactNode }).children;
    return Array.isArray(children) ? children.map(textOf).join('') : textOf(children as ReactNode);
}

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

describe('SummaryPanel (channel yield + plugin counts)', () => {
    it('renders the time pills and the two aggregate tables, with no label/yield tiles', () => {
        const html = renderToStaticMarkup(
            <SummaryPanel channels={channels()} timeRange="14d" onTimeRangeChange={() => {}} />,
        );
        // Time pills
        expect(html).toContain('24h');
        expect(html).toContain('14d');
        expect(html).toContain('kk-time-pill active');

        // The two aggregate tables, driven by the channels route.
        expect(html).toContain('New items by day and source');
        expect(html).toContain('Collection ticks and plugin contributions');
        expect(html).toContain('aihot-ingest');
        expect(html).toContain('hn-ingest');
        expect(html).toContain('kk-channel-yield-table');
        expect(html).toContain('kk-plugin-run-table');
        // R2/AC2: a zero is a recorded zero, never a claim that the plugin ran or failed.
        expect(html).toContain('Zero recorded contributions');
        expect(html).toContain('plugin invocation health unknown');

        // R5: unsupported native label/yield totals, ratios and trends are gone.
        expect(html).not.toContain('Label Decisions');
        expect(html).not.toContain('Selection Yield');
        expect(html).not.toContain('Ingestion Volume Over Time');
        expect(html).not.toContain('Top Ingestion Sources');
    });

    it('renders loading and unavailable states without inventing counts', () => {
        const loadingHtml = renderToStaticMarkup(<SummaryPanel channels={null} timeRange="14d" />);
        expect(loadingHtml).toContain('The channel-yield aggregate has not loaded yet.');
        expect(loadingHtml).not.toContain('kk-channel-yield-table');

        const unavailHtml = renderToStaticMarkup(
            <SummaryPanel
                channels={channels({
                    availability: 'unavailable',
                    diagnostics: [{ code: 'board.store.missing', message: 'No store is present.' }],
                    byDay: [],
                    runsByDay: [],
                    sources: [],
                    bySource: {},
                    totalDays: 0,
                })}
                timeRange="14d"
            />,
        );
        expect(unavailHtml).toContain('The store could not be read for this range; no counts are shown.');
        expect(unavailHtml).toContain('board.store.missing: No store is present.');
        expect(unavailHtml).not.toContain('kk-channel-yield-table');
    });

    it('labels a malformed plugin day unknown and shows last-positive contribution times', () => {
        const html = renderToStaticMarkup(
            <SummaryPanel
                channels={channels({
                    runsByDay: [{ day: '2026-10-16', runs: 1, plugins: null }],
                    diagnostics: [{ code: 'board.store.channel-invalid', message: 'bad plugin counts' }],
                })}
                timeRange="14d"
            />,
        );
        expect(html).toContain('unknown');
        expect(html).toContain('board.store.channel-invalid: bad plugin counts');
        expect(html).toContain('Last positive aihot-ingest');
    });

    it('pages the aggregate when the interval spans more than one 30-day page', () => {
        const deltas: number[] = [];
        const html = renderToStaticMarkup(
            <SummaryPanel
                channels={channels({ totalDays: 60 })}
                timeRange="All"
                channelsPage={1}
                onChannelsPageChange={(delta) => deltas.push(delta)}
            />,
        );
        expect(html).toContain('Page 1 of 2 · 60 days');
        const tree = SummaryPanel({
            channels: channels({ totalDays: 60 }),
            timeRange: 'All',
            channelsPage: 1,
            onChannelsPageChange: (delta) => deltas.push(delta),
        });
        const pager = mustFind(tree, (element) => element.props.className === 'kk-collect-pager');
        for (const label of ['Previous', 'Next']) {
            const button = mustFind(pager, (element) => element.type === 'button' && textOf(element) === label);
            (button.props as { onClick: () => void }).onClick();
        }
        expect(deltas).toEqual([-1, 1]);
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

describe('0317 drilldown surfaces', () => {
    /** The modal props every case shares; only the store/results envelope varies. */
    const modal = (overrides: Partial<Parameters<typeof RunDetailModal>[0]> = {}): string =>
        renderToStaticMarkup(
            <RunDetailModal
                runId="r-stored"
                storeRun={runStore()}
                results={null}
                facts={[]}
                artifacts={[]}
                showEffective={false}
                onToggleQuality={noop}
                onClose={noop}
                {...overrides}
            />,
        );

    it('badges the captured results availability in the run modal header', () => {
        expect(modal({ results: results() })).toContain('kk-badge-success');
        const missing = modal({ results: { ...results(), availability: 'missing' } });
        expect(missing).toContain('kk-badge-neutral');
        expect(missing).toContain('missing');
    });

    it('states an unreadable store instead of a funnel, and renders the core facts it has', () => {
        const unreadable = modal({
            storeRun: runStore({
                availability: 'unavailable',
                row: null,
                diagnostics: [{ code: 'board.store.unreadable', message: 'Database busy' }],
            }),
        });
        expect(unreadable).toContain('The store could not be read for this run; no counts are shown.');
        expect(unreadable).toContain('board.store.unreadable: Database busy');
        expect(unreadable).not.toContain('kk-collect-funnel');

        const withFacts = modal({
            facts: [{ label: 'Safety confidence', value: 'HIGH', availability: 'available' }],
        });
        expect(withFacts).toContain('Core Facts');
        expect(withFacts).toContain('Safety confidence');
        expect(withFacts).toContain('HIGH');
        expect(withFacts).toContain('available');
    });

    it("offers the items search box and each label's own confidence pill", () => {
        const html = renderToStaticMarkup(
            <ItemsPanel
                runId="r-stored"
                items={items({
                    items: [
                        {
                            id: 'i-3',
                            title: 'Quantum error correction',
                            url: 'https://example.com/q',
                            source: 'aihot-ingest',
                            storyId: 's-3',
                            seen: 'new',
                            labels: { 'kk-item-quality': 'HIGH', 'kk-item-category': 'ai-news' },
                            labelDetails: {
                                'kk-item-quality': { value: 'HIGH', confidence: 'HIGH', maker: 'model', score: 0.9 },
                                'kk-item-category': { value: 'ai-news', confidence: 'MEDIUM', maker: 'fm', score: 0.6 },
                            },
                            selection: 'selected',
                        },
                    ],
                    total: 1,
                })}
                filters={{ page: 1, search: 'quantum' }}
                quality={runStore().labelQuality}
                onFilterChange={noop}
                onSearchChange={noop}
                onPageChange={noop}
            />,
        );
        expect(html).toContain('aria-label="Search items"');
        expect(html).toContain('value="quantum"');
        expect(html).toContain('kk-confidence-pill');
        expect(html).toContain('kk-confidence-high');
        expect(html).toContain('kk-confidence-medium');
    });

    it('drills into the run from its row link instead of navigating away', () => {
        const inspected: string[] = [];
        const tree = RunDetailsPanel({
            runs,
            overview: overview(),
            now: NOW,
            runHref: (id) => `/board?runId=${id}`,
            onInspectRun: (id) => inspected.push(id),
        });
        const link = mustFind(
            tree,
            (element) => element.type === 'a' && element.props.className === 'kk-collect-run-link',
        );
        let prevented = false;
        (link.props as { onClick: (event: { preventDefault: () => void }) => void }).onClick({
            preventDefault: () => {
                prevented = true;
            },
        });
        expect(prevented).toBe(true);
        expect(inspected).toEqual(['r-stored']);
    });

    it('sends the chosen selection status, and an empty one as no filter', () => {
        const statuses: (string | undefined)[] = [];
        const tree = SelectionsPanel({
            selections: null,
            filters: { page: 1 },
            onStatusChange: (status) => statuses.push(status),
            onSearchChange: noop,
            onPageChange: noop,
        });
        const statusSelect = mustFind(
            tree,
            (element) =>
                element.type === 'select' && findElement(element, (child) => textOf(child) === 'All Statuses') !== null,
        );
        const onChange = (statusSelect.props as { onChange: (event: { target: { value: string } }) => void }).onChange;
        onChange({ target: { value: 'published' } });
        onChange({ target: { value: '' } });
        expect(statuses).toEqual(['published', undefined]);
    });

    it('routes a Summary time-range pill to its handler', () => {
        const ranges: string[] = [];
        const tree = SummaryPanel({
            channels: channels(),
            onTimeRangeChange: (range) => ranges.push(range),
        });
        const pill = mustFind(
            tree,
            (element) =>
                element.type === 'button' &&
                String(element.props.className).includes('kk-time-pill') &&
                textOf(element) === '7d',
        );
        (pill.props as { onClick: () => void }).onClick();
        expect(ranges).toEqual(['7d']);
    });

    it('opens the item inspector from the items table row', () => {
        const inspected: string[] = [];
        const tree = ItemsPanel({
            runId: 'r-stored',
            items: items(),
            filters: { page: 1 },
            quality: runStore().labelQuality,
            onFilterChange: noop,
            onPageChange: noop,
            onInspectItem: (item) => inspected.push(item.id),
        });
        // The table renders one `<ItemRow>` per item; render that row to reach its Inspect button.
        const row = mustFind(
            tree,
            (element) => typeof element.type === 'function' && element.props.onInspect !== undefined,
        );
        const rowTree = (row.type as (props: unknown) => ReactNode)(row.props);
        const button = mustFind(
            rowTree,
            (element) => element.type === 'button' && element.props.className === 'kk-table-btn',
        );
        (button.props as { onClick: () => void }).onClick();
        expect(inspected).toEqual(['i-1']);
    });

    it('sends the chosen selections topic, and an empty one as no filter', () => {
        const topics: (string | undefined)[] = [];
        const tree = SelectionsPanel({
            selections: null,
            filters: { page: 1 },
            onTopicChange: (topic) => topics.push(topic),
            onSearchChange: noop,
            onPageChange: noop,
        });
        const topicSelect = mustFind(
            tree,
            (element) =>
                element.type === 'select' && findElement(element, (child) => textOf(child) === 'All Topics') !== null,
        );
        const onChange = (topicSelect.props as { onChange: (event: { target: { value: string } }) => void }).onChange;
        onChange({ target: { value: 'ai-news' } });
        onChange({ target: { value: '' } });
        expect(topics).toEqual(['ai-news', undefined]);
    });

    it('pages the selections table one page at a time', () => {
        const deltas: number[] = [];
        const tree = SelectionsPanel({
            selections: {
                schemaVersion: 1,
                availability: 'available',
                diagnostics: [],
                page: 2,
                pageSize: 25,
                total: 60,
                topics: [],
                selections: [],
            },
            filters: { page: 2 },
            onSearchChange: noop,
            onPageChange: (delta) => deltas.push(delta),
        });
        const pager = mustFind(tree, (element) => element.props.className === 'kk-collect-pager');
        const buttons = ['Previous', 'Next'].map((label) =>
            mustFind(pager, (element) => element.type === 'button' && textOf(element) === label),
        );
        for (const button of buttons) (button.props as { onClick: () => void }).onClick();
        expect(deltas).toEqual([-1, 1]);
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

    it('renders selections status filter and invokes onStatusChange', () => {
        const statuses: (string | undefined)[] = [];
        const tree = SelectionsPanel({
            selections: sampleSelections,
            filters: { page: 1 },
            onStatusChange: (status) => statuses.push(status),
            onSearchChange: noop,
            onPageChange: noop,
        });
        const statusSelect = mustFind(
            tree,
            (element) =>
                element.type === 'select' && findElement(element, (child) => textOf(child) === 'All Statuses') !== null,
        );
        const onChange = (statusSelect.props as { onChange: (event: { target: { value: string } }) => void }).onChange;
        onChange({ target: { value: 'published' } });
        onChange({ target: { value: '' } });
        expect(statuses).toEqual(['published', undefined]);
    });

    it('renders SummaryPanel with an empty aggregate as an explicit empty state', () => {
        const html = renderToStaticMarkup(
            <SummaryPanel
                channels={channels({ byDay: [], runsByDay: [], bySource: {}, sources: [], totalDays: 0 })}
                timeRange="14d"
                onTimeRangeChange={() => {}}
            />,
        );
        expect(html).toContain('No new items in this range.');
        expect(html).toContain('No collection ticks in this range.');
    });

    it('filters RunDetailsPanel by search and status, showing empty message when none match', () => {
        const html = renderToStaticMarkup(
            <RunDetailsPanel
                runs={runs}
                overview={null}
                now={NOW}
                runHref={(id) => `#${id}`}
                statusFilter="failed"
                searchQuery="nonexistent-run-id"
            />,
        );
        expect(html).toContain('No runs match your filter.');
    });

    it('renders ItemsPanel with run dropdown and invokes onRunChange', () => {
        const selectedRuns: (string | undefined)[] = [];
        const tree = ItemsPanel({
            runId: 'r-stored',
            items: null,
            filters: { page: 1 },
            quality: [],
            runs,
            onRunChange: (r) => selectedRuns.push(r),
            onFilterChange: noop,
            onPageChange: noop,
        });
        const runSelect = mustFind(
            tree,
            (element) => element.type === 'select' && (element.props as { name?: string }).name === 'run',
        );
        const onChange = (runSelect.props as { onChange: (event: { target: { value: string } }) => void }).onChange;
        onChange({ target: { value: 'r-failed' } });
        onChange({ target: { value: '' } });
        expect(selectedRuns).toEqual(['r-failed', undefined]);
    });
});

describe('channel-yield table partial-day labels (0319 AC1)', () => {
    const partialFixture: CollectChannelYield = {
        schemaVersion: 1,
        availability: 'available',
        diagnostics: [],
        fromMs: Date.parse('2026-01-01T12:00:00Z'),
        untilMs: Date.parse('2026-01-02T12:00:00Z'),
        timeZone: 'UTC',
        page: 1,
        pageSize: 30,
        totalDays: 2,
        sources: ['aihot'],
        plugins: [],
        byDay: [
            { day: '2026-01-02', total: 1, sources: { aihot: 1 } },
            { day: '2026-01-01', total: 1, sources: { aihot: 1 } },
        ],
        bySource: { aihot: 2 },
        runsByDay: [],
        lastPositiveAt: {},
    };

    it('labels a boundary day partial when the interval cuts into it', () => {
        const html = renderToStaticMarkup(<ChannelYieldTable data={partialFixture} />);
        expect(html).toContain('2026-01-02 (partial)');
        expect(html).toContain('2026-01-01 (partial)');
    });

    it('does not label a whole-day boundary partial', () => {
        const whole = renderToStaticMarkup(
            <ChannelYieldTable
                data={{
                    ...partialFixture,
                    fromMs: Date.parse('2026-01-01T00:00:00Z'),
                    untilMs: Date.parse('2026-01-02T00:00:00Z'),
                }}
            />,
        );
        expect(whole).not.toContain('(partial)');
    });
});

describe('channels stale-range guard (0319 AC6)', () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((settle) => {
            resolve = settle;
        });
        return { promise, resolve };
    }

    it('applies only the newest range when an older range resolves after it', async () => {
        const sequence = requestSequence();
        const applied: string[] = [];
        const older = deferred<{ fromMs: number }>();
        const newer = deferred<{ fromMs: number }>();

        // The channels loader's shape: begin a token, await the page, apply only while current.
        const load = async (payload: Promise<{ fromMs: number }>): Promise<void> => {
            const token = sequence.begin();
            const value = await payload;
            if (sequence.isCurrent(token)) applied.push(`range ${value.fromMs}`);
        };

        const first = load(older.promise); // 14d range, resolves last
        const second = load(newer.promise); // 7d range, resolves first
        newer.resolve({ fromMs: 7 });
        await second;
        older.resolve({ fromMs: 14 });
        await first;

        expect(applied).toEqual(['range 7']);
    });
});
