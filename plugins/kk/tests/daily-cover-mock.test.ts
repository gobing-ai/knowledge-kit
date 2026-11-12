/**
 * 0349 R3: `daily-cover-mock.ts` integration tests. The runner is a script, not an in-process
 * library (same harness rule as kk-workflow-stages.ts — see that test's header), so tests
 * spawnSync it. Real-PNG assertions are mac-only (`sips`); the failure paths are
 * platform-neutral.
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const RUNNER = join(import.meta.dir, '../scripts/daily-cover-mock.ts');
const itMacOnly = it.skipIf(process.platform !== 'darwin');

function runMock(args: string[]) {
    return spawnSync('bun', [RUNNER, ...args], { encoding: 'utf-8' });
}

function withTempDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'kk-cover-mock-test-'));
    try {
        fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('daily-cover-mock runner (0349 R2/R3)', () => {
    itMacOnly('mock-bg run produces a valid 1344x576 composite PNG with headline and badge (AC2)', () => {
        withTempDir((dir) => {
            const out = join(dir, 'mock-out.png');
            const result = runMock(['--mock-bg', '--headline', '测试大标题：模型推理能力爆发', '--out', out]);
            expect(result.status).toBe(0);
            expect(result.stderr).toContain('composited');
            expect(existsSync(out)).toBe(true);
            const probe = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', out], { encoding: 'utf-8' });
            expect(probe.stdout).toContain('pixelWidth: 1344');
            expect(probe.stdout).toContain('pixelHeight: 576');
        });
    });

    it('fails loud when the output directory does not exist', () => {
        withTempDir((dir) => {
            const out = join(dir, 'missing-dir', 'mock-out.png');
            const result = runMock(['--mock-bg', '--headline', '标题', '--out', out]);
            expect(result.status).not.toBe(0);
            expect(result.stderr).toContain('output directory does not exist');
        });
    });

    it('rejects unknown flags', () => {
        const result = runMock(['--nope']);
        expect(result.status).not.toBe(0);
    });
});
