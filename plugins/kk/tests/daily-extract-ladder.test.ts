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
 *
 * 0434: the ladder no longer multiplies the WHOLE pool — it projects the set QC will admit (pool
 * chars × the recorded admission rate) and converts that at the spoken/kept ratio, which is the
 * floor gate's arithmetic. `rungs[].chars` stays the raw pool, `rungs[].keptChars` is what the
 * rung's minutes were computed from. Fixtures here therefore carry either a recorded calibration
 * or a pool large enough for the cold-start 0.30 admission rate to clear the floor.
 */
describe('daily-extract floor ladder uses the authored-script measure (0377)', () => {
    const runner = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');

    /** A pool of `docs` documents whose title+body chars total `chars`, split evenly. */
    function pool(docs: number, chars: number): unknown[] {
        const title = 't'.repeat(10);
        const perDoc = Math.floor(chars / docs) - title.length;
        return Array.from({ length: docs }, (_, i) => ({ id: `doc-${i}`, title, body: 'b'.repeat(perDoc) }));
    }

    function withFixture(
        docs: unknown[],
        calibration?: Record<string, unknown>,
    ): {
        root: string;
        workDir: string;
        windows: () => string[];
        limits: () => string[];
        run: (limit?: string) => ReturnType<typeof spawnSync>;
    } {
        const root = mkdtempSync(join(tmpdir(), 'kk-extract-ladder-'));
        const workDir = join(root, 'works');
        const binDir = join(root, 'bin');
        const logFile = join(root, 'windows.log');
        const limitLog = join(root, 'limits.log');
        mkdirSync(binDir, { recursive: true });
        mkdirSync(join(workDir, '10-collect'), { recursive: true });
        // The sibling run whose `21-plan/<date>_09_spoken-ratio.json` the ladder calibrates from
        // (`workDir`'s parent is the workflow directory, so this lands where the reader looks).
        if (calibration !== undefined) {
            const sibling = join(root, '20261120', '21-plan');
            mkdirSync(sibling, { recursive: true });
            writeFileSync(join(sibling, '20261120_09_spoken-ratio.json'), JSON.stringify(calibration));
        }
        const body = JSON.stringify(docs);
        const shimPath = join(binDir, 'kk');
        writeFileSync(
            shimPath,
            `#!/usr/bin/env bun
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
const window = args[args.indexOf('--window') + 1] ?? '';
const limitArg = args.indexOf('--limit') >= 0 ? (args[args.indexOf('--limit') + 1] ?? '') : '';
if (process.env.KK_SHIM_LOG) appendFileSync(process.env.KK_SHIM_LOG, window + '\\n');
if (process.env.KK_SHIM_LIMIT_LOG && limitArg !== '') appendFileSync(process.env.KK_SHIM_LIMIT_LOG, limitArg + '\\n');
writeFileSync(outPath, process.env.KK_SHIM_POOL ?? '[]');
`,
        );
        chmodSync(shimPath, 0o755);
        writeFileSync(join(root, 'pool.json'), body);
        const run = (limit?: string) =>
            spawnSync(
                'bun',
                [
                    runner,
                    'daily-extract',
                    workDir,
                    'ai-news',
                    '24h',
                    '15',
                    'voxcpm',
                    ...(limit === undefined ? [] : [limit]),
                ],
                {
                    encoding: 'utf-8',
                    env: {
                        ...process.env,
                        PATH: `${binDir}:${process.env.PATH}`,
                        KK_SHIM_LOG: logFile,
                        KK_SHIM_LIMIT_LOG: limitLog,
                        KK_SHIM_POOL: body,
                    },
                },
            );
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
            limits: () => {
                try {
                    return readFileSync(limitLog, 'utf-8').trim().split('\n').filter(Boolean);
                } catch {
                    return [];
                }
            },
            run,
        };
    }

    it('caps each rung at the plan size, so the pool is not pre-trimmed to the extract default (2026-11-20)', () => {
        // Measured on the production store: 56 category-allowed, importance>=3, unpublished items sat
        // in the 168h window while `daily-extract` passed no `--limit` at all, so the store default
        // (~20) capped the pool at 24 — the run kept 3 items, authored 5.3 min and refused at the TTS
        // gate. The plan cap (40) has to reach the extract, or the plan can never use it.
        const fixture = withFixture(pool(20, 27704));
        const res = fixture.run('40');
        expect(res.status, res.stderr).toBe(0);
        // The cap rides on EVERY rung: a 27,704-char pool projects ≈2,300 admitted chars at the
        // cold-start 0.30 keep rate, so this fixture walks the ladder and each store call needs it.
        expect(fixture.limits().length).toBeGreaterThan(0);
        expect([...new Set(fixture.limits())]).toEqual(['40']);
        rmSync(fixture.root, { recursive: true, force: true });
    });

    it('omits --limit when the caller passes none, keeping the store default', () => {
        const fixture = withFixture(pool(20, 27704));
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.limits()).toEqual([]);
        rmSync(fixture.root, { recursive: true, force: true });
    });

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

    it('stops at the configured window when the projected admitted set is rich', () => {
        // 27,704 pool chars at the recorded day's 60% admission and 0.60 spoken/kept ratio ≈ 33 min,
        // so the first rung clears the 15 min floor and the ladder never widens.
        const { root, windows, run } = withFixture(pool(20, 27704), {
            poolChars: 40000,
            keptChars: 24000,
            spokenChars: 12000,
            ratio: 0.3,
            keptRatio: 0.6,
        });
        const res = run();
        expect(res.status, res.stderr).toBe(0);
        expect(windows()).toEqual(['24h']);
        rmSync(root, { recursive: true, force: true });
    });

    it('projects the admitted set from the recorded keep rate, not from the pool alone (R1)', () => {
        // The SAME 27,704-char pool, two recorded days: 2026-11-15 admitted 33% of its pool at a 0.515
        // spoken/kept ratio (27,704 x 0.34 x 0.52 ≈ 4,800 spoken chars ≈ 15.5 min ⇒ clears), while a
        // day that admitted 10% at 0.30 (≈ 830 spoken chars ≈ 2.8 min) makes it a thin day. A ladder
        // that multiplied the pool alone could not tell these two days apart.
        const rich = withFixture(pool(20, 27704), {
            poolChars: 55242,
            keptChars: 18525,
            spokenChars: 9540,
            ratio: 0.173,
            keptRatio: 0.515,
        });
        const richRun = rich.run();
        expect(richRun.status, richRun.stderr).toBe(0);
        expect(rich.windows()).toEqual(['24h']);
        rmSync(rich.root, { recursive: true, force: true });

        const thin = withFixture(pool(20, 27704), {
            poolChars: 20000,
            keptChars: 2000,
            spokenChars: 600,
            ratio: 0.03,
            keptRatio: 0.3,
        });
        const thinRun = thin.run();
        expect(thinRun.status, thinRun.stderr).toBe(0);
        expect(thin.windows().length).toBeGreaterThan(1);
        rmSync(thin.root, { recursive: true, force: true });
    });

    it('writes the ladder decision as an artifact the run report can explain (R3)', () => {
        const fixture = withFixture(pool(4, 7244));
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        const ladder = JSON.parse(readFileSync(join(fixture.workDir, '10-collect', 'ladder.json'), 'utf-8')) as {
            ratioUsed: number;
            ratioSource: string;
            keptRatio: number;
            keptRatioSource: string;
            keepRate: number;
            keepRateSource: string;
            spokenPerPoolChar: number;
            chosen: string;
            rungs: Array<{ window: string; chars: number; keptChars: number; minutes: number; clears: boolean }>;
        };
        expect(ladder.ratioUsed).toBeGreaterThan(0);
        expect(ladder.ratioSource).toContain('default');
        // 0434 R2: the artifact names the ratio, its source AND the admission rate it projected with,
        // so a reader can rebuild the rung minutes without recomputing either side's denominator.
        expect(ladder.keptRatio).toBe(0.28);
        expect(ladder.keptRatioSource).toContain('default');
        expect(ladder.keepRate).toBe(0.3);
        expect(ladder.keepRateSource).toContain('default');
        expect(ladder.spokenPerPoolChar).toBe(0.084);
        expect(ladder.chosen).not.toBe('24h');
        expect(ladder.rungs.length).toBeGreaterThan(1);
        expect(ladder.rungs[0]?.clears).toBe(false);
        // `chars` is the raw pool, `keptChars` the projected admitted set the minutes came from.
        expect(ladder.rungs[0]?.chars).toBe(7244);
        expect(ladder.rungs[0]?.keptChars).toBe(Math.round(7244 * 0.3));
        // The shim returns the same pool at every rung, so the ladder walks to its ceiling and keeps
        // the widest attempt: the artifact must name the rung it actually chose.
        expect(ladder.rungs.at(-1)?.window).toBe(ladder.chosen);
        rmSync(fixture.root, { recursive: true, force: true });
    });
});
