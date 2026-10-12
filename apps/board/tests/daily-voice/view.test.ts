/**
 * G8/0253 — the Daily AI Voice view model: `RunResults.summary` narrowing without a DOM.
 *
 * Failure-first list:
 * 1. a malformed channel/node row is dropped, never rendered as a broken value;
 * 2. outcome/quality/safety unknowns stay explicit (the summary shows an empty string, never a 0);
 * 3. channel counts read from the reader's own counts, and an absent bag yields zeros;
 * 4. the progress bag maps edges only when the reader reported them as known;
 * 5. Summary facts keep execution status apart from result outcome and label every unknown.
 */

import { describe, expect, it } from 'bun:test';
import type { RunResults } from '../../src/contracts';
import {
    CONFIDENCE_LEVELS,
    type DailySummaryView,
    dailySummary,
    dailySummaryFacts,
    isChannelOutcome,
    isConfidenceLevel,
} from '../../src/daily-voice/view';

function results(summary: Record<string, unknown>, artifacts: RunResults['artifacts'] = []): RunResults {
    return {
        schemaVersion: 1,
        workflow: 'kk-daily-ai-voice2',
        runId: 'run-1',
        availability: 'available',
        summary,
        artifacts,
        diagnostics: [],
    };
}

describe('isChannelOutcome', () => {
    it('accepts the six channel outcomes and rejects anything else', () => {
        for (const value of ['live', 'draft', 'skipped', 'error', 'pending', 'unavailable']) {
            expect(isChannelOutcome(value)).toBe(true);
        }
        expect(isChannelOutcome('published')).toBe(false);
        expect(isChannelOutcome(null)).toBe(false);
    });
});

describe('dailySummary', () => {
    it('narrows a full summary bag and drops malformed rows', () => {
        const view = dailySummary(
            results({
                status: 'done',
                startedAt: '2026-10-11T12:00:00.000Z',
                completedAt: '2026-10-11T12:04:00.000Z',
                outcome: 'full',
                articleTitle: 'Daily title',
                channels: [
                    {
                        channel: 'surfdash',
                        label: 'SurfDash',
                        outcome: 'live',
                        url: 'https://x.example/p',
                        detail: '1/1 targets ok',
                    },
                    { channel: 'xhs', label: 'XHS', outcome: 'draft', url: null, detail: null },
                    { channel: 'broken', outcome: 'not-an-outcome' },
                    { outcome: 'live' },
                ],
                quality: { overallScore: 98, passed: true, criticalIssues: ['minor'] },
                safety: { verdict: 'PASS', confidence: 'HIGH' },
                progress: {
                    nodes: [
                        { id: 'article', status: 'passed', attempts: 1, timing: '2s' },
                        { id: 'plan-translate', status: 'failed', attempts: 2, timing: '1s' },
                        { status: 'passed' },
                    ],
                    edges: [{ from: 'article', to: 'script' }],
                    edgesKnown: true,
                    childRunId: 'safety-9',
                },
                counts: { live: 1, draft: 1, failed: 0, skipped: 0 },
            }),
        );
        expect(view.status).toBe('done');
        expect(view.outcome).toBe('full');
        expect(view.articleTitle).toBe('Daily title');
        // Two valid channel rows survive; the malformed two are dropped.
        expect(view.channels.map((c) => c.channel)).toEqual(['surfdash', 'xhs']);
        expect(view.channels[0]).toMatchObject({ state: 'Live', url: 'https://x.example/p' });
        expect(view.channels[1]).toMatchObject({ state: 'Draft', url: null, detail: null });
        expect(view.quality).toEqual({ overallScore: 98, passed: true, criticalIssues: ['minor'] });
        expect(view.safety).toEqual({ verdict: 'PASS', confidence: 'HIGH' });
        expect(view.progress?.nodes.map((n) => n.id)).toEqual(['article', 'plan-translate']);
        expect(view.progress?.edges).toEqual([{ from: 'article', to: 'script' }]);
        expect(view.progress?.edgesKnown).toBe(true);
        expect(view.progress?.childRunId).toBe('safety-9');
        expect(view.counts).toEqual({ live: 1, draft: 1, failed: 0, skipped: 0 });
    });

    it('keeps every unknown explicit for a sparse summary bag', () => {
        const view = dailySummary(results({ channels: 'not-an-array', quality: null }));
        expect(view.status).toBeNull();
        expect(view.outcome).toBeNull();
        expect(view.articleTitle).toBeNull();
        expect(view.channels).toEqual([]);
        expect(view.quality).toBeNull();
        expect(view.safety).toBeNull();
        expect(view.progress).toBeNull();
        expect(view.counts).toEqual({ live: 0, draft: 0, failed: 0, skipped: 0 });
    });

    it('tolerates a quality bag with the wrong field types and a null-edge progress bag', () => {
        const view = dailySummary(
            results({
                quality: { overallScore: 'high', passed: 'yes', criticalIssues: 'none' },
                progress: { nodes: [{ id: 'a' }], edges: null, childRunId: null },
            }),
        );
        expect(view.quality).toEqual({ overallScore: null, passed: null, criticalIssues: [] });
        expect(view.progress?.edges).toBeNull();
        expect(view.progress?.edgesKnown).toBe(false);
        expect(view.progress?.nodes[0]).toMatchObject({
            id: 'a',
            status: 'unknown',
            attempts: 0,
            timing: 'timing unknown',
        });
    });
});

describe('dailySummaryFacts', () => {
    const facts = (
        summary: Record<string, unknown>,
        artifacts: RunResults['artifacts'] = [],
    ): ReturnType<typeof dailySummaryFacts> =>
        dailySummaryFacts(results(summary, artifacts), Date.parse('2026-10-11T12:04:00.000Z'));

    it('keeps execution status apart from result outcome and labels unknowns', () => {
        const sparse = facts({ status: 'failed' });
        const byLabel = Object.fromEntries(sparse.map((fact) => [fact.label, fact]));
        expect(byLabel['Execution status']).toMatchObject({ value: 'failed', availability: 'available' });
        expect(byLabel['Result outcome']).toMatchObject({ value: 'unavailable', availability: 'unverified' });
        expect(byLabel['Audio QC score']).toMatchObject({ value: 'unavailable' });
        expect(byLabel['Content safety verdict']).toMatchObject({ value: 'not recorded' });
        // No counts bag in this fixture: the rows state the gap instead of inventing 0 failed.
        expect(byLabel['Channels failed / skipped']).toMatchObject({
            value: 'not recorded',
            availability: 'unverified',
        });
        expect(byLabel['Channels live / draft']).toMatchObject({ value: 'not recorded', availability: 'unverified' });
    });

    it('surfaces a partial outcome with failed channels and available artifacts', () => {
        const full = facts(
            {
                status: 'done',
                startedAt: '2026-10-11T12:00:00.000Z',
                outcome: 'partial',
                articleTitle: 'Title',
                counts: { live: 1, draft: 0, failed: 1, skipped: 0 },
                quality: { overallScore: 90, passed: true, criticalIssues: [] },
                safety: { verdict: 'PASS', confidence: 'HIGH' },
            },
            [
                {
                    id: 'audio',
                    label: 'Episode audio',
                    kind: 'audio',
                    availability: 'available',
                    producerNode: 'generate',
                },
                {
                    id: 'cover',
                    label: 'Cover image',
                    kind: 'image',
                    availability: 'missing',
                    producerNode: 'cover-normalize',
                },
            ],
        );
        const byLabel = Object.fromEntries(full.map((fact) => [fact.label, fact]));
        expect(byLabel['Result availability']).toMatchObject({ value: '1/2 artifacts available' });
        expect(byLabel.Elapsed).toMatchObject({ value: '4m 0s' });
        expect(byLabel['Channels live / draft']).toMatchObject({ value: '1 live, 0 draft' });
        expect(byLabel['Channels failed / skipped']).toMatchObject({ availability: 'missing' });
        expect(byLabel['Audio QC score']).toMatchObject({ value: '90' });
    });

    it('reads a summary with no status as an explicit unknown (typed shape)', () => {
        const view: DailySummaryView = dailySummary(results({}));
        expect(view.status).toBeNull();
    });
});

describe('confidence levels (HIGH/MEDIUM/LOW)', () => {
    it('accepts only the three recognized levels', () => {
        expect([...CONFIDENCE_LEVELS]).toEqual(['HIGH', 'MEDIUM', 'LOW']);
        for (const level of CONFIDENCE_LEVELS) expect(isConfidenceLevel(level)).toBe(true);
        expect(isConfidenceLevel('certain')).toBe(false);
        expect(isConfidenceLevel('high')).toBe(false);
        expect(isConfidenceLevel(undefined)).toBe(false);
    });

    it('surfaces a valid confidence and reports an out-of-vocabulary one as unknown', () => {
        expect(dailySummary(results({ safety: { verdict: 'PASS', confidence: 'MEDIUM' } })).safety?.confidence).toBe(
            'MEDIUM',
        );
        expect(
            dailySummary(results({ safety: { verdict: 'PASS', confidence: 'CERTAIN' } })).safety?.confidence,
        ).toBeNull();
    });

    it('renders the safety confidence as a Summary fact, explicit when unrecorded', () => {
        const recorded = dailySummaryFacts(results({ safety: { verdict: 'PASS', confidence: 'LOW' } }), 0).find(
            (fact) => fact.label === 'Safety confidence',
        );
        expect(recorded).toMatchObject({ value: 'LOW', availability: 'available' });
        const absent = dailySummaryFacts(results({}), 0).find((fact) => fact.label === 'Safety confidence');
        expect(absent).toMatchObject({ value: 'not recorded', availability: 'unverified' });
    });
});
