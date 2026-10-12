import { describe, expect, it } from 'bun:test';
import type { RunResults } from '../../src/contracts';
import { artifactViews, collectSummary, collectSummaryFacts, progressRows } from '../../src/shared/collect';

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
            'http://127.0.0.1:4340',
        );
        expect(views[0]?.href).toBe('http://127.0.0.1:4340/api/workflows/kk-collect/runs/r-1/artifacts/facts');
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
