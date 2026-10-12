/**
 * G8/0252 — the Collect projection: source counts, the facts preview, availability roll-up and
 * the `projectCollectResults` summary. Pure inputs and outputs; the HTTP boundary is
 * reader.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import type { RunCapture } from '@gobing-ai/kk-board/contracts';
import { factsPreview, overallAvailability, projectCollectResults, sourceCountsOf } from '../../src/board/collect';

const record: RunCapture = {
    schemaVersion: 1,
    projectPath: '/proj',
    workflow: 'kk-collect',
    runId: 'run-1',
    workspacePath: '/proj/.works/kk-collect/20261011T1200Z',
    stamp: '20261011T1200Z',
    capturedAt: '2026-10-11T12:00:00.000Z',
    settings: { limit: '10' },
};

const detail = {
    id: 'run-1',
    workflowName: 'kk-collect',
    status: 'done',
    startedAt: '2026-10-11T12:00:00.000Z',
    completedAt: '2026-10-11T12:04:00.000Z',
};

describe('sourceCountsOf', () => {
    it('counts one hit per metadata.sources[].file and ignores unattributed docs', () => {
        expect(
            sourceCountsOf([
                { metadata: { sources: [{ file: 'a' }, { file: 'b' }] } },
                { metadata: { sources: [{ file: 'a' }] } },
                { metadata: {} },
                'not-a-doc',
            ]),
        ).toEqual({ a: 2, b: 1 });
    });
});

describe('factsPreview', () => {
    it('bounds the preview and reports nothing for absent evidence', () => {
        expect(factsPreview(undefined)).toBeNull();
        expect(factsPreview('a\nb\nc', 2)).toBe('a\nb');
    });
});

describe('overallAvailability', () => {
    it('is available only when EVERY artifact is available (AC2), else the most specific failure', () => {
        expect(overallAvailability([])).toBe('unverified');
        expect(overallAvailability(['available', 'available'])).toBe('available');
        // A partial run is never rolled up to the OK tone (1-of-4 must not read as success).
        expect(overallAvailability(['missing', 'available'])).toBe('missing');
        expect(overallAvailability(['unverified', 'unverified'])).toBe('unverified');
        expect(overallAvailability(['superseded', 'missing'])).toBe('superseded');
        expect(overallAvailability(['invalid', 'missing'])).toBe('invalid');
        expect(overallAvailability(['pending', 'missing'])).toBe('pending');
        expect(overallAvailability(['missing', 'missing'])).toBe('missing');
    });
});

describe('projectCollectResults', () => {
    it('exposes only the evidence the run recorded', () => {
        const results = projectCollectResults({
            record,
            detail,
            marker: 'owned',
            producerOf: () => 'success',
            observationOf: (spec) =>
                spec.id === 'store-result'
                    ? { state: 'present', bytes: 12, text: JSON.stringify({ inserted: 3, updated: 1, unchanged: 0 }) }
                    : spec.id === 'facts'
                      ? { state: 'present', bytes: 4, text: '# ok' }
                      : { state: 'absent' },
        });
        // Two of four artifacts are present: the run-level roll-up is not `available` (AC2).
        expect(results.availability).toBe('missing');
        expect(results.summary).toMatchObject({
            // Execution status and times stay separate from the result counts (AC2).
            status: 'done',
            startedAt: '2026-10-11T12:00:00.000Z',
            completedAt: '2026-10-11T12:04:00.000Z',
            inserted: 3,
            updated: 1,
            labeled: null,
            verdict: null,
            factsPreview: '# ok',
        });
        expect(results.artifacts.map((artifact) => artifact.availability)).toEqual([
            'missing',
            'available',
            'available',
            'missing',
        ]);
    });

    it('labels a foreign owner as superseded even with all files present', () => {
        const results = projectCollectResults({
            record,
            detail,
            marker: 'foreign',
            producerOf: () => 'success',
            observationOf: () => ({ state: 'present' }),
        });
        expect(results.availability).toBe('superseded');
        expect(results.artifacts.every((artifact) => artifact.availability === 'superseded')).toBe(true);
        expect(results.diagnostics.map((diagnostic) => diagnostic.code)).toContain('board.artifact.superseded');
    });
});
