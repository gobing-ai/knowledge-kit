/**
 * G8/0254 — the IT Content view model: `RunResults.summary` narrowing without a DOM.
 *
 * Failure-first list:
 * 1. a malformed outline/target row is dropped, never rendered as a broken value;
 * 2. an out-of-vocabulary judge confidence is rendered as an explicit unknown, never echoed;
 * 3. revision counts stay null when the reader recorded none, never 0;
 * 4. the summary facts keep execution status apart from result outcome and label every unknown.
 */

import { describe, expect, it } from 'bun:test';
import type { RunResults } from '../../src/contracts';
import {
    CONFIDENCE_LEVELS,
    type ItcSummaryView,
    isConfidenceLevel,
    itcSummary,
    itcSummaryFacts,
} from '../../src/itc/view';

function results(summary: Record<string, unknown>, artifacts: RunResults['artifacts'] = []): RunResults {
    return {
        schemaVersion: 1,
        workflow: 'kk-itc',
        runId: 'run-1',
        availability: 'available',
        summary,
        artifacts,
        diagnostics: [],
    };
}

describe('isConfidenceLevel', () => {
    it('accepts the three recognized levels and rejects anything else', () => {
        expect([...CONFIDENCE_LEVELS]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
        for (const level of CONFIDENCE_LEVELS) expect(isConfidenceLevel(level)).toBe(true);
        expect(isConfidenceLevel('high')).toBe(false);
        expect(isConfidenceLevel('SURE')).toBe(false);
        expect(isConfidenceLevel(null)).toBe(false);
    });
});

describe('itcSummary', () => {
    it('narrows a full summary bag and drops malformed rows', () => {
        const view: ItcSummaryView = itcSummary(
            results({
                status: 'done',
                startedAt: '2026-10-11T12:00:00.000Z',
                completedAt: '2026-10-11T12:10:00.000Z',
                outcome: 'failed',
                outlines: [{ id: 'outline-a', label: 'Outline A', text: '# A', availability: 'available' }, { id: 42 }],
                selectedOutline: { id: 'outline-approved', label: 'Selected outline', availability: 'missing' },
                draft: { id: 'draft', label: 'Draft', text: '# draft', availability: 'available' },
                judge: { verdict: 'NEEDS_REVISION', confidence: 'MEDIUM', feedback: ['tighten', 7] },
                revisions: { revise: 1, autoRevise: 2, total: 3, budget: 2, recorded: true },
                targets: [
                    { target: 'medium-pub', transport: 'fanout', ok: true, url: 'https://m.example/p', detail: 'ok' },
                    { target: 'substack-pub', transport: 'browser', ok: null, detail: 'result missing' },
                    { ok: true },
                ],
                report: { outcome: 'failed', verdict: 'NEEDS_REVISION', revisions: 3 },
                counts: { artifactsAvailable: 4, artifactsTotal: 9, targetsOk: 1, targetsFailed: 0, targetsUnknown: 1 },
            }),
        );
        expect(view.outlines).toHaveLength(1);
        expect(view.targets).toHaveLength(2);
        expect(view.targets[0]).toMatchObject({ state: 'Published', url: 'https://m.example/p' });
        expect(view.targets[1]).toMatchObject({ ok: null, state: 'Not recorded' });
        expect(view.judge).toMatchObject({ verdict: 'NEEDS_REVISION', confidence: 'MEDIUM', feedback: ['tighten'] });
        expect(view.revisions).toMatchObject({ total: 3, budget: 2, recorded: true });
        expect(view.report).toMatchObject({ outcome: 'failed', revisions: 3 });
        expect(view.countsRecorded).toBe(true);
        expect(view.selectedOutline).toMatchObject({ availability: 'missing', text: null });
    });

    it('keeps an out-of-vocabulary confidence and empty revision evidence explicit', () => {
        const view = itcSummary(
            results({
                judge: { verdict: 'PASS', confidence: 'SURE', confidenceInvalid: true, feedback: [] },
                revisions: { revise: null, autoRevise: null, total: null, budget: 3, recorded: false },
            }),
        );
        expect(view.judge).toMatchObject({ verdict: 'PASS', confidence: null, confidenceInvalid: true });
        expect(view.revisions).toMatchObject({ total: null, recorded: false });
        expect(view.countsRecorded).toBe(false);
        expect(view.counts.artifactsTotal).toBe(0);
    });

    it('treats an absent summary bag as all-unknown, never zero', () => {
        const view = itcSummary(results({}));
        expect(view.status).toBeNull();
        expect(view.outcome).toBeNull();
        expect(view.judge).toBeNull();
        expect(view.report).toBeNull();
        expect(view.draft).toBeNull();
        expect(view.targets).toEqual([]);
        expect(view.outlines).toEqual([]);
    });
});

describe('itcSummaryFacts', () => {
    it('keeps execution status apart from result outcome and labels every unknown', () => {
        const facts = itcSummaryFacts(
            results({
                status: 'done',
                outcome: null,
                judge: { verdict: 'PASS', confidence: 'SURE', confidenceInvalid: true, feedback: [] },
                revisions: { revise: 0, autoRevise: 0, total: 0, budget: 2, recorded: true },
                counts: { artifactsAvailable: 1, artifactsTotal: 2, targetsOk: 1, targetsFailed: 1, targetsUnknown: 0 },
            }),
            Date.parse('2026-10-11T12:10:00.000Z'),
        );
        const of = (label: string): { value: string; availability: string } | undefined =>
            facts.find((fact) => fact.label === label);
        expect(of('Execution status')).toMatchObject({ value: 'done', availability: 'available' });
        expect(of('Result outcome')).toMatchObject({ value: 'unavailable', availability: 'unverified' });
        expect(of('Judge confidence')?.value).toContain('outside HIGH/MEDIUM/LOW');
        expect(of('Judge confidence')?.availability).toBe('unverified');
        expect(of('Revision rounds')).toMatchObject({ value: '0', availability: 'available' });
        // A recorded failed target never reads as fully successful.
        expect(of('Publish targets')?.availability).toBe('missing');
    });
});
