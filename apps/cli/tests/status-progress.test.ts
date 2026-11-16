import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { gatePayload, progressPayload, recordedSteps } from '../src/status-progress';

/** 0378 — the status surface's two payload builders, against artifacts only (no CLI). */

function workDir(): string {
    return mkdtempSync(join(tmpdir(), 'kk-status-mod-'));
}

function write(dir: string, relPath: string, body: string): void {
    const path = join(dir, relPath);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
}

const fs = createNodeFileSystem();

describe('recordedSteps (0378)', () => {
    it('reads one JSON object per line and skips malformed or blank lines', async () => {
        const dir = workDir();
        write(
            dir,
            'step-timing.json',
            '{"step":"extract","startedAt":"2026-11-16T04:30:00Z","endedAt":"2026-11-16T04:31:00Z"}\n\nnot json\n{"noStep":true}\n',
        );
        const steps = await recordedSteps(fs, dir);
        expect(steps.map((step) => step.step)).toEqual(['extract']);
        rmSync(dir, { recursive: true, force: true });
    });

    it('returns nothing when the run has recorded no stage', async () => {
        const dir = workDir();
        expect(await recordedSteps(fs, dir)).toEqual([]);
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('progressPayload (0378)', () => {
    it('reports not-started with a null elapsed instead of inventing one', async () => {
        const dir = workDir();
        expect(await progressPayload(fs, dir)).toMatchObject({ stages: 0, state: 'not-started', elapsedMs: null });
        rmSync(dir, { recursive: true, force: true });
    });

    it('marks a run running when its last stage has no endedAt, and settled when it does', async () => {
        const dir = workDir();
        write(
            dir,
            'step-timing.json',
            '{"step":"a","startedAt":"2026-11-16T04:30:00Z","endedAt":"2026-11-16T04:30:30Z"}\n{"step":"b","startedAt":"2026-11-16T04:30:30Z"}\n',
        );
        const running = await progressPayload(fs, dir);
        expect(running).toMatchObject({ stages: 2, completed: 1, current: 'b', state: 'running' });
        expect(running.elapsedMs as number).toBeGreaterThan(0);

        write(
            dir,
            'step-timing.json',
            '{"step":"a","startedAt":"2026-11-16T04:30:00Z","endedAt":"2026-11-16T04:30:30Z"}\n',
        );
        expect((await progressPayload(fs, dir)).state).toBe('settled');
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('gatePayload (0378)', () => {
    it('is all nulls for a run that has not reached the gate', async () => {
        const dir = workDir();
        expect(await gatePayload(fs, dir)).toEqual({ pool: null, floorRefusal: null, ladder: null });
        rmSync(dir, { recursive: true, force: true });
    });

    it('carries the pool verdict, the floor refusal and the ladder rung', async () => {
        const dir = workDir();
        write(dir, 'pool-gate.json', JSON.stringify({ status: 'EMPTY' }));
        write(dir, '10-collect/ladder.json', JSON.stringify({ chosen: '96h', ratioUsed: 0.28, rungs: [] }));
        write(
            dir,
            '21-plan/20261116_04_quality-control-content_floor-refusal.json',
            JSON.stringify({ estimatedMinutes: 9.4, minMinutes: 15, expansion: 0.28, reason: 'thin day' }),
        );
        expect(await gatePayload(fs, dir)).toMatchObject({
            pool: 'EMPTY',
            floorRefusal: { estimatedMinutes: 9.4, minMinutes: 15, expansion: 0.28, reason: 'thin day' },
            ladder: { chosen: '96h', ratioUsed: 0.28 },
        });
        rmSync(dir, { recursive: true, force: true });
    });

    it('survives a malformed artifact instead of failing the command', async () => {
        const dir = workDir();
        write(dir, 'pool-gate.json', 'not json');
        expect((await gatePayload(fs, dir)).pool).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });
});
