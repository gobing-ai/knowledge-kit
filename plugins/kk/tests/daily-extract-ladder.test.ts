import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 0377 — the pre-spend floor ladder must judge a pool by the measure the writer actually produces.
 *
 * Measured on the production host 2026-11-15 (run `kk-news-generate-20261115-1794773860762`): a
 * 7,244-char pool passed the pre-spend estimate at 32.6 min, the writer then produced a 2,053-char
 * spoken script (6.2 min) and the TTS gate refused it after a full authoring pass. The ratio the
 * writer delivers is 2,053 / 7,244 = 0.28x, not the 1.4x the estimate assumed, so the ladder that
 * exists to fill a thin day from the backlog never climbed a single rung.
 */
describe('daily-extract floor ladder uses the authored-script measure (0377)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');

    /** A pool of `docs` documents whose title+body chars total `chars`, split evenly. */
    function pool(docs: number, chars: number): unknown[] {
        const title = 't'.repeat(10);
        const perDoc = Math.floor(chars / docs) - title.length;
        return Array.from({ length: docs }, (_, i) => ({ id: `doc-${i}`, title, body: 'b'.repeat(perDoc) }));
    }

    function withFixture(docs: unknown[]): {
        root: string;
        workDir: string;
        windows: () => string[];
        run: () => ReturnType<typeof spawnSync>;
    } {
        const root = mkdtempSync(join(tmpdir(), 'kk-extract-ladder-'));
        const workDir = join(root, 'works');
        const binDir = join(root, 'bin');
        const logFile = join(root, 'windows.log');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '10-collect'), { recursive: true });
        const body = JSON.stringify(docs);
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
const window = args[args.indexOf('--window') + 1] ?? '';
if (process.env.KK_SHIM_LOG) appendFileSync(process.env.KK_SHIM_LOG, window + '\\n');
writeFileSync(outPath, process.env.KK_SHIM_POOL ?? '[]');
`,
        );
        chmodSync(shimPath, 0o755);
        writeFileSync(join(root, 'pool.json'), body);
        const run = () =>
            spawnSync('bun', [runner, 'daily-extract', workDir, 'ai-news', '24h', '15', 'voxcpm'], {
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    PATH: `${binDir}:${process.env.PATH}`,
                    KK_SHIM_LOG: logFile,
                    KK_SHIM_POOL: body,
                },
            });
        return {
            root,
            workDir,
            windows: () => {
                try {
                    return readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
                } catch {
                    return [];
                }
            },
            run,
        };
    }

    it('widens to the next rung when the earned spoken length misses the floor', () => {
        // 7,244 raw chars is the production pool from 2026-11-15: it cleared the old 1.4x estimate
        // (32.6 min) while the writer delivered 6.2 min. At the measured ratio it is a thin day.
        const { root, workDir, windows, run } = withFixture(pool(4, 7244));
        const res = run();
        expect(res.status, res.stderr).toBe(0);
        expect(windows().length).toBeGreaterThan(1);
        expect(windows().at(-1)).not.toBe('24h');
        // The widest attempt is what the run keeps, so authoring works from the backlog.
        expect(JSON.parse(readFileSync(join(workDir, '10-collect', 'pool.json'), 'utf-8'))).toHaveLength(4);
        rmSync(root, { recursive: true, force: true });
    });

    it('stops at the configured window when the pool is rich', () => {
        const { root, windows, run } = withFixture(pool(20, 27704));
        const res = run();
        expect(res.status, res.stderr).toBe(0);
        expect(windows()).toEqual(['24h']);
        rmSync(root, { recursive: true, force: true });
    });
});
