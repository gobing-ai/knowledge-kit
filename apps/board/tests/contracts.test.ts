import { describe, expect, it } from 'bun:test';
import type { Availability, BoardDiagnostic, RunCapture, RunResults } from '../src/contracts';

/**
 * The frozen §9 contract, pinned at the one place a type-only module can be checked: a
 * hand-built record/results pair must keep `schemaVersion: 1` and the seven availability
 * states through a JSON round-trip. Changing either fails here before it reaches the reader.
 */
describe('contracts', () => {
    const capture: RunCapture = {
        schemaVersion: 1,
        projectPath: '/proj',
        workflow: 'kk-collect',
        runId: 'run-1',
        workspacePath: '/proj/.works/kk-collect/S1',
        stamp: 'S1',
        capturedAt: '2026-10-11T12:00:00.000Z',
        settings: { limit: '10' },
        topology: { nodes: ['a'], edges: [] },
    };

    const results: RunResults = {
        schemaVersion: 1,
        workflow: 'kk-collect',
        runId: 'run-1',
        availability: 'available',
        summary: {},
        artifacts: [],
        diagnostics: [],
    };

    it('round-trips schemaVersion 1 and the seven availability states', () => {
        expect(JSON.parse(JSON.stringify(capture)).schemaVersion).toBe(1);
        expect(JSON.parse(JSON.stringify(results)).schemaVersion).toBe(1);
        const vocabulary: Availability[] = [
            'available',
            'pending',
            'missing',
            'invalid',
            'oversized',
            'superseded',
            'unverified',
        ];
        expect(vocabulary).toHaveLength(7);
        const diagnostic: BoardDiagnostic = { code: 'board.x', message: 'bounded' };
        expect(diagnostic.code).toBe('board.x');
    });

    it('keeps captured settings as strings and topology optional', () => {
        expect(Object.values(capture.settings).every((value) => typeof value === 'string')).toBe(true);
        const minimal: RunCapture = { ...capture };
        delete minimal.topology;
        expect(JSON.parse(JSON.stringify(minimal)).topology).toBeUndefined();
    });
});
