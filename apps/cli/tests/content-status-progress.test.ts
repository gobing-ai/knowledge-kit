import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

/**
 * 0378 — `kk news status` answers "how far along is this day" without a caller reading
 * `step-timing.json`, a workflow trace or the stage logs.
 *
 * The five run states are the contract: fresh, mid-flight, done, no-content and failed. Every
 * pre-existing key keeps its shape (`workDir`, `type`, `generate`, `bundle`, `windows`); `progress`
 * and `gate` are additive.
 */

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: capture.read(), stderr: capture.readErr() };
    } finally {
        capture.restore();
    }
}

interface Fixture {
    root: string;
    workDir: string;
    write: (relPath: string, body: string) => void;
    steps: (steps: Array<{ step: string; startedAt?: string; endedAt?: string }>) => void;
    status: () => Promise<{ code: number; payload: Record<string, unknown> }>;
    cleanup: () => void;
}

/** One news run directory. `--work-dir` pins it, so no config or works root is needed. */
function fixture(): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-status-progress-'));
    const workDir = join(root, '20261116');
    mkdirSync(workDir, { recursive: true });
    const write = (relPath: string, body: string): void => {
        const path = join(workDir, relPath);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, body);
    };
    return {
        root,
        workDir,
        write,
        steps: (steps) => write('step-timing.json', `${steps.map((step) => JSON.stringify(step)).join('\n')}\n`),
        status: async () => {
            const result = await run(['news', 'status', '--run-date', '20261116', '--work-dir', workDir]);
            return { code: result.code, payload: JSON.parse(result.stdout) as Record<string, unknown> };
        },
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

describe('kk news status progress surface (0378)', () => {
    it('reports a fresh run as not-started instead of inventing progress', async () => {
        const fx = fixture();
        const { code, payload } = await fx.status();
        expect(code).toBe(0);
        expect(payload.progress).toMatchObject({ stages: 0, current: null, state: 'not-started', elapsedMs: null });
        expect(payload.gate).toMatchObject({ pool: null, floorRefusal: null, ladder: null });
        expect(payload.bundle).toBeNull();
        fx.cleanup();
    });

    it('reports a mid-flight run: current stage, stages so far, and elapsed from the first step', async () => {
        const fx = fixture();
        fx.steps([
            { step: 'extract', startedAt: '2026-11-16T04:30:00Z', endedAt: '2026-11-16T04:31:00Z' },
            { step: 'plan', startedAt: '2026-11-16T04:31:00Z', endedAt: '2026-11-16T04:32:00Z' },
            { step: 'quality-control-content', startedAt: '2026-11-16T04:32:00Z' },
        ]);
        const { payload } = await fx.status();
        const progress = payload.progress as Record<string, unknown>;
        expect(progress.stages).toBe(3);
        expect(progress.completed).toBe(2);
        expect(progress.current).toBe('quality-control-content');
        expect(progress.state).toBe('running');
        expect(progress.elapsedMs as number).toBeGreaterThan(0);
        fx.cleanup();
    });

    it('reports a settled run with the pool gate verdict and the bundle', async () => {
        const fx = fixture();
        fx.steps([
            { step: 'extract', startedAt: '2026-11-16T04:30:00Z', endedAt: '2026-11-16T04:31:00Z' },
            { step: 'bundle-freeze', startedAt: '2026-11-16T05:10:00Z', endedAt: '2026-11-16T05:11:00Z' },
        ]);
        fx.write('pool-gate.json', JSON.stringify({ status: 'PASS' }));
        fx.write('4-publish/bundle.json', JSON.stringify({ frozen: true, runId: 'gen-1', variants: ['zh'] }));
        const { payload } = await fx.status();
        expect((payload.progress as Record<string, unknown>).state).toBe('settled');
        expect((payload.gate as Record<string, unknown>).pool).toBe('PASS');
        expect(payload.bundle).toMatchObject({ frozen: true, runId: 'gen-1' });
        fx.cleanup();
    });

    it('explains a no-content day through the pool gate and the floor refusal (with the ladder rung)', async () => {
        const fx = fixture();
        fx.write('pool-gate.json', JSON.stringify({ status: 'EMPTY' }));
        fx.write('10-collect/ladder.json', JSON.stringify({ chosen: '96h', ratioUsed: 0.28, rungs: [] }));
        fx.write(
            '21-plan/20261116_04_quality-control-content_floor-refusal.json',
            JSON.stringify({ estimatedMinutes: 9.4, minMinutes: 15, expansion: 0.28, reason: 'thin day' }),
        );
        const { payload } = await fx.status();
        const gate = payload.gate as Record<string, unknown>;
        expect(gate.pool).toBe('EMPTY');
        expect(gate.floorRefusal).toMatchObject({ estimatedMinutes: 9.4, minMinutes: 15 });
        expect(gate.ladder).toMatchObject({ chosen: '96h', ratioUsed: 0.28 });
        fx.cleanup();
    });

    it('reports a failed run honestly: last stage settled, no outcome files invented', async () => {
        const fx = fixture();
        fx.steps([
            { step: 'extract', startedAt: '2026-11-16T04:30:00Z', endedAt: '2026-11-16T04:31:00Z' },
            { step: 'generate', startedAt: '2026-11-16T04:40:00Z', endedAt: '2026-11-16T04:41:00Z' },
        ]);
        const { code, payload } = await fx.status();
        expect(code).toBe(0);
        expect((payload.progress as Record<string, unknown>).current).toBe('generate');
        expect(payload.windows).toBeNull();
        expect(payload.generate).toBeNull();
        fx.cleanup();
    });

    it('keeps every pre-existing key so existing callers do not break (R3)', async () => {
        const fx = fixture();
        const { payload } = await fx.status();
        for (const key of ['workDir', 'type', 'generate', 'bundle', 'windows']) expect(payload).toHaveProperty(key);
        expect(payload.type).toBe('news');
        fx.cleanup();
    });
});
