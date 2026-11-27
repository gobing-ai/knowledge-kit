import { describe, expect, it } from 'bun:test';
import type { CollectRunStore, CollectRunStoreRow, RunResults } from '../../src/contracts';
import {
    artifactViews,
    bannerCounts,
    cadenceState,
    collectSummary,
    collectSummaryFacts,
    decisionValues,
    fallbackShare,
    funnelCards,
    makerBreakdown,
    pager,
    progressRows,
    runDuration,
    sourceSegments,
} from '../../src/shared/collect';
import type { RunListRow } from '../../src/shared/run-selection';

function results(overrides: Partial<RunResults> = {}): RunResults {
    return {
        schemaVersion: 1,
        workflow: 'kk-collect',
        runId: 'r-1',
        availability: 'available',
        summary: {
            status: 'done',
            startedAt: '2026-10-11T12:00:00Z',
            completedAt: '2026-10-11T12:05:00Z',
            sourceCounts: { 'aihot-ingest': 3 },
            inserted: 3,
            updated: 1,
            unchanged: 0,
            labeled: 3,
            model: 1,
            fallback: 0,
            verdict: 'PASS',
            confidence: 'HIGH',
            factsPreview: '# Facts',
        },
        artifacts: [],
        diagnostics: [],
        ...overrides,
    };
}

describe('collectSummary', () => {
    it('reads the recorded counts and never invents a missing one', () => {
        const summary = collectSummary(results({ summary: { inserted: 2 } }));
        expect(summary.inserted).toBe(2);
        expect(summary.updated).toBeNull();
        expect(summary.sourceCounts).toBeNull();
    });
});

describe('collectSummaryFacts', () => {
    it('marks uncaptured counts unavailable instead of zero', () => {
        const facts = collectSummaryFacts(results({ summary: { inserted: 2 } }), Date.now());
        expect(facts.find((fact) => fact.label === 'Updated')).toEqual({
            label: 'Updated',
            value: 'unavailable',
            availability: 'unverified',
        });
        expect(facts.find((fact) => fact.label === 'Label verdict')?.value).toBe(undefined);
    });

    it('separates execution status from the result outcome', () => {
        const facts = collectSummaryFacts(results(), Date.parse('2026-10-11T12:05:00Z'));
        const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
        expect(byLabel.get('Execution status')?.value).toBe('done');
        expect(byLabel.get('Elapsed')?.value).toBe('5m 0s');
        expect(byLabel.get('Result availability')?.value).toBe('0/0 artifacts available');
        expect(facts.map((fact) => fact.label)).toContain('Source aihot-ingest');
        expect(byLabel.get('Label verdict')?.value).toBe('PASS (HIGH)');
    });

    it('states an unknown execution status explicitly', () => {
        const facts = collectSummaryFacts(results({ summary: {} }), Date.now());
        const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
        expect(byLabel.get('Execution status')?.value).toBe('unavailable');
        expect(byLabel.get('Execution status')?.availability).toBe('unverified');
    });
});

describe('progressRows', () => {
    it('passes recorded visits and attempts through, and invents nothing from junk', () => {
        expect(
            progressRows({
                states: [
                    {
                        state: 'collect',
                        visit: 1,
                        status: 'passed',
                        actions: [{ actionKey: 'collect:onEnter:0', status: 'passed' }],
                    },
                    { state: 'collect', visit: 2, status: 'failed', actions: [] },
                    'junk',
                ],
            }),
        ).toEqual([
            {
                state: 'collect',
                visit: 1,
                status: 'passed',
                timing: 'timing unknown',
                operatorWait: false,
                actions: ['collect:onEnter:0 — passed'],
            },
            {
                state: 'collect',
                visit: 2,
                status: 'failed',
                timing: 'timing unknown',
                operatorWait: false,
                actions: [],
            },
        ]);
        expect(progressRows(null)).toEqual([]);
        expect(progressRows({ schemaVersion: 1 })).toEqual([]);
    });
});

describe('artifactViews', () => {
    it('links only an available artifact and states every other reason', () => {
        const views = artifactViews(
            results({
                artifacts: [
                    {
                        id: 'facts',
                        label: 'Core facts',
                        kind: 'text',
                        availability: 'available',
                        producerNode: 'collect',
                        producerActionKey: 'collect:onEnter:1',
                    },
                    {
                        id: 'label-result',
                        label: 'Label pass result',
                        kind: 'text',
                        availability: 'superseded',
                        producerNode: 'label',
                        producerActionKey: 'label:onEnter:0',
                    },
                ],
            }),
            (workflow, runId, artifactId) =>
                `/api/modules/kk-collect/api/workflows/${workflow}/runs/${runId}/artifacts/${artifactId}`,
        );
        expect(views[0]?.href).toBe('/api/modules/kk-collect/api/workflows/kk-collect/runs/r-1/artifacts/facts');
        expect(views[1]?.href).toBeNull();
        expect(views[1]?.state).toBe('Superseded by a later run');
    });
});

describe('progressRows action normalization', () => {
    it('drops a non-object action and defaults a missing actionKey or status', () => {
        expect(
            progressRows({
                states: [
                    {
                        state: 'collect',
                        visit: 1,
                        status: 'passed',
                        actions: ['raw', {}, { actionKey: 'collect:onEnter:0' }, { status: 'failed' }],
                    },
                ],
            }),
        ).toEqual([
            {
                state: 'collect',
                visit: 1,
                status: 'passed',
                timing: 'timing unknown',
                operatorWait: false,
                actions: ['action — unknown', 'collect:onEnter:0 — unknown', 'action — failed'],
            },
        ]);
    });
});

describe('collectSummaryFacts source rows', () => {
    it('orders the source rows by file name', () => {
        const facts = collectSummaryFacts(results({ summary: { sourceCounts: { zeta: 1, alpha: 2 } } }), Date.now());
        const rows = facts.filter((fact) => fact.label.startsWith('Source ')).map((fact) => [fact.label, fact.value]);
        expect(rows).toEqual([
            ['Source alpha', '2'],
            ['Source zeta', '1'],
        ]);
    });
});

describe('collectSummaryFacts artifact roll-up', () => {
    it('counts only the artifacts the run marked available', () => {
        const facts = collectSummaryFacts(
            results({
                artifacts: [
                    {
                        id: 'facts',
                        label: 'Core facts',
                        kind: 'text',
                        availability: 'available',
                        producerNode: 'collect',
                        producerActionKey: 'collect:onEnter:1',
                    },
                    {
                        id: 'label-result',
                        label: 'Label pass result',
                        kind: 'text',
                        availability: 'missing',
                        producerNode: 'label',
                        producerActionKey: 'label:onEnter:0',
                    },
                ],
            }),
            Date.now(),
        );
        expect(facts.find((fact) => fact.label === 'Result availability')?.value).toBe('1/2 artifacts available');
    });
});

describe('AC3 — labeling and facts evidence reach the panels', () => {
    it('renders model/fallback counts and a bounded, reported facts preview', () => {
        const facts = collectSummaryFacts(
            results({
                summary: { ...results().summary, model: 2, fallback: 1, factsPreview: '# Core facts\n- one\n' },
            }),
            Date.now(),
        );
        const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
        expect(byLabel.get('Model labeled')?.value).toBe('2');
        expect(byLabel.get('Fallback labeled')?.value).toBe('1');
        // Whitespace is collapsed so the row stays one line; the full text stays in the artifact.
        expect(byLabel.get('Core facts')?.value).toBe('# Core facts - one');
        expect(byLabel.get('Core facts')?.availability).toBe('available');
    });

    it('reports truncation instead of silently cutting the preview', () => {
        const long = `# Core facts\n- ${'x'.repeat(400)}\n`;
        const facts = collectSummaryFacts(
            results({ summary: { ...results().summary, factsPreview: long } }),
            Date.now(),
        );
        const preview = facts.find((fact) => fact.label === 'Core facts');
        expect(preview?.availability).toBe('oversized');
        expect(preview?.value).toContain('(truncated — the facts artifact holds the full text)');
        expect(preview?.value.length).toBeGreaterThan(160);
    });

    it('states unknown counts as unverified rather than inventing a zero', () => {
        const summary = { ...results().summary, model: null, fallback: null, factsPreview: null };
        const facts = collectSummaryFacts(results({ summary }), Date.now());
        const byLabel = new Map(facts.map((fact) => [fact.label, fact]));
        expect(byLabel.get('Model labeled')?.value).toBe('unavailable');
        expect(byLabel.get('Model labeled')?.availability).toBe('unverified');
        expect(byLabel.has('Core facts')).toBe(false);
    });
});

describe('AC4 — progress carries recorded timings and operator waits', () => {
    it('projects durationMs, a started→completed pair, and leaves the gap stated', () => {
        const rows = progressRows({
            states: [
                { state: 'collect', visit: 1, status: 'done', durationMs: 1500 },
                { state: 'store', visit: 1, status: 'done', startedAt: 'a', completedAt: 'b' },
                { state: 'label', visit: 1, status: 'done' },
            ],
        });
        expect(rows.map((row) => row.timing)).toEqual(['2s', 'a → b', 'timing unknown']);
    });

    it('labels an operator wait only when the recorded evidence names one', () => {
        const rows = progressRows({
            states: [
                { state: 'approve', visit: 1, status: 'paused', durationMs: 10 },
                { state: 'review', visit: 1, status: 'done', actions: [{ actionKey: 'hitl.confirm', status: 'done' }] },
                { state: 'collect', visit: 1, status: 'done', durationMs: 5000 },
            ],
        });
        expect(rows.map((row) => row.operatorWait)).toEqual([true, true, false]);
    });

    it('keeps pending, skipped and a repeated visit distinct (state-machine retries)', () => {
        const rows = progressRows({
            states: [
                {
                    state: 'collect',
                    visit: 1,
                    status: 'failed',
                    durationMs: 10,
                    actions: [{ actionKey: 'collect:x', status: 'failed' }],
                },
                {
                    state: 'collect',
                    visit: 2,
                    status: 'done',
                    durationMs: 20,
                    actions: [{ actionKey: 'collect:x', status: 'done' }],
                },
                { state: 'store', visit: 1, status: 'skipped' },
                { state: 'label', visit: 1, status: 'pending' },
            ],
        });
        expect(rows.map((row) => `${row.state}/${row.visit}/${row.status}`)).toEqual([
            'collect/1/failed',
            'collect/2/done',
            'store/1/skipped',
            'label/1/pending',
        ]);
        expect(rows[1]?.actions).toEqual(['collect:x — done']);
    });
});

/** One run's stored facts, as the 0307 route serves them. */
function storeRow(overrides: Partial<CollectRunStoreRow> = {}): CollectRunStoreRow {
    return {
        runId: 'r-1',
        sourceCounts: { 'aihot-ingest': 6, 'hn-ingest': 4 },
        inserted: 7,
        updated: 2,
        labelRows: 20,
        labeledItems: 9,
        labelRowsBySource: { heuristic: 12, model: 6, default: 2 },
        yield: { selected: 5, published: 3, dropped: 1 },
        ...overrides,
    };
}

const NOW = Date.parse('2026-10-16T12:00:00Z');

describe('cadenceState', () => {
    it('states on schedule up to the 6 h schedule and late up to 12 h', () => {
        expect(cadenceState('2026-10-16T07:00:00Z', NOW).state).toBe('on schedule');
        expect(cadenceState('2026-10-16T06:00:00Z', NOW).state).toBe('on schedule');
        expect(cadenceState('2026-10-16T05:59:00Z', NOW).state).toBe('late');
        expect(cadenceState('2026-10-16T00:00:00Z', NOW).state).toBe('late');
        expect(cadenceState('2026-10-15T23:59:00Z', NOW).state).toBe('stalled');
    });

    it('reports the age in hours, and unknown without a readable stamp', () => {
        const cadence = cadenceState('2026-10-16T09:00:00Z', NOW);
        expect(cadence.sinceHours).toBeCloseTo(3);
        expect(cadence.detail).toContain('3.0 h since the last stored collection (schedule 6 h)');
        expect(cadenceState(null, NOW)).toEqual({
            state: 'unknown',
            sinceHours: null,
            detail: 'No stored collection recorded.',
        });
        expect(cadenceState('not a date', NOW).state).toBe('unknown');
    });

    it('never reports a future stamp as negative: a clock skew stays on schedule', () => {
        expect(cadenceState('2026-10-16T13:00:00Z', NOW).sinceHours).toBe(0);
    });
});

describe('fallbackShare', () => {
    it('is default rows over label rows', () => {
        expect(fallbackShare(storeRow())).toBe('10%');
        expect(fallbackShare(storeRow({ labelRows: 4, labelRowsBySource: { heuristic: 3, default: 1 } }))).toBe('25%');
    });

    it('is `—` when the run recorded no label rows, never a zero share', () => {
        expect(fallbackShare(storeRow({ labelRows: 0, labelRowsBySource: {} }))).toBe('—');
    });
});

describe('sourceSegments', () => {
    it('turns per-source counts into alphabetical shares summing to 1', () => {
        const segments = sourceSegments({ b: 3, a: 1 });
        expect(segments).toEqual([
            { source: 'a', count: 1, share: 0.25 },
            { source: 'b', count: 3, share: 0.75 },
        ]);
    });

    it('drops non-positive counts and yields nothing for an empty record', () => {
        expect(sourceSegments({ a: 0, b: -1 })).toEqual([]);
        expect(sourceSegments({})).toEqual([]);
    });
});

describe('bannerCounts', () => {
    const runs: RunListRow[] = [
        { id: 'failed-no-row', workflowName: 'kk-collect', status: 'failed' },
        { id: 'done-no-row', workflowName: 'kk-collect', status: 'done' },
        { id: 'running-no-row', workflowName: 'kk-collect', status: 'running' },
        { id: 'done-with-row', workflowName: 'kk-collect', status: 'done' },
    ];

    it('counts failed and done-without-a-row runs; a running run is in progress', () => {
        expect(bannerCounts(runs, { 'done-with-row': storeRow(), 'running-no-row': null })).toEqual({
            failed: 1,
            doneWithoutRow: 1,
            inProgress: 1,
        });
    });

    it('counts a run whose row is present as stored, whatever its status', () => {
        const counts = bannerCounts(runs.slice(3), { 'done-with-row': storeRow() });
        expect(counts).toEqual({ failed: 0, doneWithoutRow: 0, inProgress: 0 });
    });
});

describe('funnelCards', () => {
    it('names the unit of every stage and states unchanged from the results projection', () => {
        const cards = funnelCards(storeRow(), results());
        expect(cards.map((card) => card.title)).toEqual(['Collected', 'Stored', 'Labeled', 'Downstream']);
        expect(cards.map((card) => card.unit)).toEqual(['items', 'items', 'items', 'items']);
        expect(cards[0]?.value).toBe('10');
        expect(cards[0]?.detail).toBe('aihot-ingest 6 · hn-ingest 4');
        expect(cards[1]?.value).toBe('9');
        expect(cards[1]?.detail).toBe('7 inserted · 2 updated · 0 unchanged');
        expect(cards[2]?.value).toBe('9');
        expect(cards[2]?.detail).toBe('20 label rows: 12 heuristic · 6 model · 2 default');
        expect(cards[3]?.value).toBe('9');
        expect(cards[3]?.detail).toBe('5 selected · 3 published · 1 dropped');
    });

    it('states unavailable rather than a zero when the run wrote no store row', () => {
        const cards = funnelCards(null, results());
        expect(cards).toHaveLength(1);
        expect(cards[0]).toMatchObject({ value: 'unavailable', availability: 'unavailable' });
    });

    it('leaves `unchanged` unavailable when the shipped projection does not carry it', () => {
        expect(funnelCards(storeRow(), null)[1]?.detail).toBe('7 inserted · 2 updated · unavailable');
    });
});

describe('makerBreakdown', () => {
    it('renders the three named makers and `other` only when present', () => {
        expect(makerBreakdown({ heuristic: 1, model: 2, default: 3 })).toBe('1 heuristic · 2 model · 3 default');
        expect(makerBreakdown({ heuristic: 1, model: 0, default: 0, llm: 4 })).toBe(
            '1 heuristic · 0 model · 0 default · 4 other',
        );
    });
});

describe('decisionValues', () => {
    const quality: CollectRunStore['labelQuality'] = [
        {
            decisionId: 'kk-item-quality',
            run: [
                { value: 'HIGH', HIGH: 2, MEDIUM: 0, LOW: 0, none: 0 },
                { value: 'LOW', HIGH: 0, MEDIUM: 0, LOW: 1, none: 0 },
            ],
            effective: [],
        },
    ];

    it('reads the value domain of one decision from its own rows', () => {
        expect(decisionValues(quality, 'kk-item-quality')).toEqual(['HIGH', 'LOW']);
        expect(decisionValues(quality, 'kk-item-category')).toEqual([]);
    });
});

describe('runDuration', () => {
    it('is the Spur span, and `—` while the run is running', () => {
        expect(runDuration('2026-10-11T12:00:00Z', '2026-10-11T12:05:00Z')).toBe('5m 0s');
        expect(runDuration('2026-10-11T12:00:00Z', null)).toBe('—');
        expect(runDuration(null, '2026-10-11T12:05:00Z')).toBe('—');
        expect(runDuration('not a date', '2026-10-11T12:05:00Z')).toBe('—');
    });
});

describe('pager', () => {
    it('freezes the 25-row page size and always shows at least one page', () => {
        expect(pager(1, 0)).toEqual({ page: 1, total: 0, pages: 1 });
        expect(pager(2, 26)).toEqual({ page: 2, total: 26, pages: 2 });
        expect(pager(1, 25)).toEqual({ page: 1, total: 25, pages: 1 });
    });
});
