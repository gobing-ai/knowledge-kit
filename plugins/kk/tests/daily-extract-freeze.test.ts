import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 0347 F6 (2026-11-10) — a next-day rerun of a failed daily episode must resume the frozen
 * material instead of re-extracting a grown store. `dailyExtract` re-reads the store on every
 * run, so overnight collects used to overwrite pool.json, invalidate the plan stage's cache
 * fingerprint, and trip the plan stage's fail-closed guard ("refusing to pair a new plan with
 * stale outputs"). Once a plan has authored in 21-plan, the pool is frozen byte-for-byte; with
 * no authored plan the extract proceeds and the pool refreshes.
 */
describe('daily-extract pool freeze after plan authoring (0347 F6)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');

    function withFixture(): {
        root: string;
        workDir: string;
        binDir: string;
        logFile: string;
        run: () => ReturnType<typeof spawnSync>;
    } {
        const root = mkdtempSync(join(tmpdir(), 'kk-extract-freeze-'));
        const workDir = join(root, 'works');
        const binDir = join(root, 'bin');
        const logFile = join(root, 'shim.jsonl');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '10-collect'), { recursive: true });
        // The kk shim records that store extract ran and writes a fresh (different) pool attempt.
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
if (process.env.KK_SHIM_LOG) appendFileSync(process.env.KK_SHIM_LOG, 'extract\\n');
writeFileSync(outPath, JSON.stringify([{ id: 'fresh-from-store' }]));
`,
        );
        chmodSync(shimPath, 0o755);
        const run = () =>
            spawnSync('bun', [runner, 'daily-extract', workDir, 'AI news', '72h', '90', 'gemini'], {
                encoding: 'utf-8',
                env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, KK_SHIM_LOG: logFile },
            });
        return { root, workDir, binDir, logFile, run };
    }

    it('keeps the pool byte-for-byte when a plan has already authored', () => {
        const { root, workDir, logFile, run } = withFixture();
        const frozen = JSON.stringify([{ id: 'nov-9-item' }, { id: 'nov-9-item-2' }]);
        writeFileSync(join(workDir, '10-collect', 'pool.json'), frozen);
        mkdirSync(join(workDir, '21-plan'), { recursive: true });
        writeFileSync(join(workDir, '21-plan', '20261109_03_plan_content.json'), '{"plan":true}');

        const res = run();
        expect(res.status, res.stderr).toBe(0);
        expect(res.stderr).toContain('keeping the frozen pool');
        expect(readFileSync(join(workDir, '10-collect', 'pool.json'), 'utf-8')).toBe(frozen);
        // The store was never consulted — the freeze precedes the ladder.
        expect(existsSync(logFile)).toBe(false);
        rmSync(root, { recursive: true, force: true });
    });

    it('refreshes the pool from the store when no plan has authored yet', () => {
        const { root, workDir, logFile, run } = withFixture();

        const res = run();
        expect(res.status, res.stderr).toBe(0);
        expect(readFileSync(logFile, 'utf-8')).toContain('extract');
        expect(readFileSync(join(workDir, '10-collect', 'pool.json'), 'utf-8')).toContain('fresh-from-store');
        rmSync(root, { recursive: true, force: true });
    });
});
