import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 0434 — the extract ladder and the floor gate must estimate ONE denominator.
 *
 * 2026-11-24 measured on one run: the ladder multiplied the raw pool (42,925 chars x 0.165 =
 * 22.8 min, "clears"), the floor gate multiplied the QC-admitted set (12,937 chars x 0.313 =
 * 13.1 min), and the writer delivered 12.6. The 10x gap is a denominator gap: the pool-denominated
 * ratio is only the gate's arithmetic when today's QC admission rate matches the day the ratio was
 * recorded, and that rate had moved.
 *
 * Failures enumerated before the fix:
 *  1. the ladder's rung minutes are the POOL arithmetic (pool chars x the pool ratio) while the gate
 *     reports the KEPT arithmetic, so two artifacts for one episode disagree by the admission rate
 *     (the cold-start fixture below: 36.0 min vs 10.9 min);
 *  2. the ladder artifact names no keep rate and no kept-set size, so an operator cannot tell which
 *     set it estimated (`rungs[].keptChars`, `keepRate`, `keptRatio` were absent);
 *  3. the estimate artifacts do not print the ratio's source path beside the ratio, so a measured
 *     number and the cold-start constant read the same;
 *  4. a QC admission rate that moved several points below the recorded day is absorbed silently:
 *     nothing on stderr names the assumption the estimate was built from.
 */

const RUNNER = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const RATE = 5.2; // voiced chars per second at the voxcpm rate the gates divide by
const INTRO_SECONDS = 8;
const DATE = '20261124';

interface Doc {
    id: string;
    title: string;
    body: string;
}

/** Minutes the ONE shared arithmetic yields for `chars` spoken characters at `expansion`. */
function minutesOf(chars: number, expansion: number): number {
    return Math.round(((INTRO_SECONDS + (chars * expansion) / RATE) / 60) * 10) / 10;
}

/**
 * A `Doc[]` whose title+body characters total exactly `chars`. Titles come from distinct CJK word
 * triples: QC's title dedup drops near-duplicates, so numbered titles collapse the fixture to one
 * document and the gate never sees the set under test (learnings 2026-11-16).
 */
function docs(count: number, chars: number): Doc[] {
    const words = [
        '模型',
        '研究',
        '资本',
        '安全',
        '供应链',
        '隐私',
        '价格',
        '创作',
        '开源',
        '芯片',
        '监管',
        '算力',
        '评测',
    ];
    const perDoc = Math.floor(chars / count);
    const remainder = chars - perDoc * count;
    return Array.from({ length: count }, (_, i) => {
        const title = `${words[i % words.length]}${words[(i + 1) % words.length]}${words[(i + 4) % words.length]}`;
        const total = perDoc + (i < remainder ? 1 : 0);
        return { id: `item-${i}`, title, body: '字'.repeat(Math.max(0, total - title.length)) };
    });
}

function rawChars(documents: Doc[]): number {
    return documents.reduce((sum, doc) => sum + doc.title.length + doc.body.length, 0);
}

interface Fixture {
    root: string;
    workDir: string;
    ladder: () => Record<string, unknown>;
    floorRefusal: () => Record<string, unknown> | null;
    runExtract: () => ReturnType<typeof spawnSync>;
    runQcContent: () => ReturnType<typeof spawnSync>;
}

/**
 * One workflow parent holding today's run directory and, optionally, the sibling run whose
 * `21-plan/<date>_09_spoken-ratio.json` the gates calibrate from — the shape both stages read.
 */
function withFixture(options: {
    poolDocs: Doc[];
    keptDocs: Doc[];
    floor: string;
    recordedRatio?: Record<string, unknown>;
}): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-estimate-denominator-'));
    const workDir = join(root, `kk-news-generate-${DATE}-1`);
    const binDir = join(root, 'bin');
    mkdirSync(join(workDir, '10-collect'), { recursive: true });
    mkdirSync(join(workDir, '21-plan'), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    if (options.recordedRatio !== undefined) {
        const sibling = join(root, '20261123', '21-plan');
        mkdirSync(sibling, { recursive: true });
        writeFileSync(join(sibling, `20261123_09_spoken-ratio.json`), JSON.stringify(options.recordedRatio));
    }
    // The plan the QC filter reads (its own input artifact, not the pool under test).
    writeFileSync(
        join(workDir, '21-plan', `${DATE}_03_plan_content.json`),
        JSON.stringify({ metadata: { docs: options.keptDocs.map((doc) => ({ ...doc })) } }),
    );
    const shimPath = join(binDir, 'kk');
    writeFileSync(
        shimPath,
        `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
if (args[0] === 'store') writeFileSync(outPath, process.env.KK_SHIM_POOL ?? '[]');
else writeFileSync(outPath, process.env.KK_SHIM_CANDIDATES ?? '{}');
`,
    );
    chmodSync(shimPath, 0o755);
    const env = () => ({
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        KK_SHIM_POOL: JSON.stringify(options.poolDocs),
        KK_SHIM_CANDIDATES: JSON.stringify({ metadata: { docs: options.keptDocs } }),
    });
    const ladderPath = join(workDir, '10-collect', 'ladder.json');
    const refusalPath = join(workDir, '21-plan', `${DATE}_04_quality-control-content_floor-refusal.json`);
    return {
        root,
        workDir,
        ladder: () => JSON.parse(readFileSync(ladderPath, 'utf-8')) as Record<string, unknown>,
        floorRefusal: () => {
            try {
                return JSON.parse(readFileSync(refusalPath, 'utf-8')) as Record<string, unknown>;
            } catch {
                return null;
            }
        },
        runExtract: () =>
            spawnSync('bun', [RUNNER, 'daily-extract', workDir, 'ai-news', '24h', options.floor, 'voxcpm'], {
                encoding: 'utf-8',
                env: env(),
            }),
        // The floor gate the QC stage runs last: it sees exactly the set QC admitted.
        runQcContent: () =>
            spawnSync(
                'bun',
                [
                    RUNNER,
                    'daily-qc-content',
                    workDir,
                    DATE,
                    '',
                    'ai-news',
                    '2',
                    '3',
                    '2',
                    '1',
                    '1',
                    options.floor,
                    'voxcpm',
                ],
                { encoding: 'utf-8', env: env() },
            ),
    };
}

/** The rationing record a run writes, read back by both gates on the next day (0377). */
function recorded(options: { poolChars: number; keptChars: number; spokenChars: number }): Record<string, unknown> {
    return {
        runDate: '20261123',
        poolChars: options.poolChars,
        keptChars: options.keptChars,
        spokenChars: options.spokenChars,
        ratio: Math.round((options.spokenChars / options.poolChars) * 1000) / 1000,
        keptRatio: Math.round((options.spokenChars / options.keptChars) * 1000) / 1000,
    };
}

interface Rung {
    window: string;
    items: number;
    chars: number;
    keptChars: number;
    minutes: number;
    clears: boolean;
}

interface Ladder {
    ratioUsed: number;
    ratioSource: string;
    keptRatio: number;
    keptRatioSource: string;
    keepRate: number;
    keepRateSource: string;
    chosen: string;
    rungs: Rung[];
}

describe('the extract ladder and the floor gate estimate one denominator (0434)', () => {
    it('AC1 — both artifacts report the same minutes from the cold-start admission rate', () => {
        const poolDocs = docs(13, 40_000);
        const keptDocs = docs(13, 12_000);
        const fixture = withFixture({ poolDocs, keptDocs, floor: '15' });
        try {
            const extract = fixture.runExtract();
            expect(extract.status, extract.stderr).toBe(0);
            const ladder = fixture.ladder() as unknown as Ladder;
            const qc = fixture.runQcContent();
            expect(qc.status, qc.stderr).toBe(0);
            const refusal = fixture.floorRefusal();

            // Both sides estimate THE ADMITTED SET: the ladder projects it (pool x keep rate), the
            // gate measures it (candidates x the kept ratio).
            expect(rawChars(poolDocs)).toBe(40_000);
            expect(rawChars(keptDocs)).toBe(12_000);
            expect(ladder.keepRate).toBe(0.3);
            expect(ladder.keepRateSource).toContain('default');
            expect(ladder.keptRatio).toBe(0.28);
            expect(ladder.rungs[0]?.keptChars).toBe(12_000);
            expect(ladder.rungs[0]?.chars).toBe(40_000);

            const projected = minutesOf(ladder.rungs[0]?.keptChars ?? 0, ladder.keptRatio);
            expect(ladder.rungs[0]?.minutes).toBe(projected);
            expect(refusal?.estimatedMinutes).toBe(projected);
            expect(Math.abs(Number(refusal?.estimatedMinutes) - (ladder.rungs[0]?.minutes ?? 0))).toBeLessThanOrEqual(
                0.1,
            );

            // The pool-denominated estimate the ladder used to print (40,000 x 0.28) is 3.3x larger:
            // a denominator switch on either side cannot pass this test.
            const poolDenominated = minutesOf(40_000, 0.28);
            expect(poolDenominated).toBe(36);
            expect(ladder.rungs[0]?.minutes).toBeLessThan(poolDenominated / 2);
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('AC1 — a recorded keep rate drives the projection, and both artifacts name it with its source', () => {
        const poolDocs = docs(13, 40_000);
        const keptDocs = docs(13, 12_000);
        const calibration = recorded({ poolChars: 40_000, keptChars: 12_000, spokenChars: 6_180 });
        const fixture = withFixture({ poolDocs, keptDocs, floor: '20', recordedRatio: calibration });
        try {
            const extract = fixture.runExtract();
            expect(extract.status, extract.stderr).toBe(0);
            const ladder = fixture.ladder() as unknown as Ladder;
            const qc = fixture.runQcContent();
            expect(qc.status, qc.stderr).toBe(0);
            const refusal = fixture.floorRefusal();

            expect(ladder.keepRate).toBe(0.3);
            expect(ladder.keepRateSource).toContain('20261123_09_spoken-ratio.json');
            expect(ladder.keptRatio).toBe(0.515);
            expect(ladder.keptRatioSource).toContain('20261123_09_spoken-ratio.json');
            expect(ladder.rungs[0]?.keptChars).toBe(12_000);

            const projected = minutesOf(12_000, 0.515);
            expect(projected).toBe(19.9);
            expect(ladder.rungs[0]?.minutes).toBe(projected);
            // Same set, same ratio, same minutes: the two artifacts compare without recomputation.
            expect(refusal?.estimatedMinutes).toBe(projected);
            expect(refusal?.candidateChars).toBe(ladder.rungs[0]?.keptChars);
            expect(refusal?.expansion).toBe(0.515);
            expect(String(refusal?.expansionSource)).toContain('20261123_09_spoken-ratio.json');
            expect(refusal?.keepRate).toBe(0.3);
            // The gate names the assumption the ladder made, and the ladder's own artifact is the
            // provenance chain: gate ← ladder.json ← the recorded (or default) day.
            expect(refusal?.keepRateAssumed).toBe(0.3);
            expect(refusal?.keepRateAssumedSource).toBe(ladder.keepRateSource);
            expect(String(refusal?.keepRateAssumedSource)).toContain('20261123_09_spoken-ratio.json');
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('AC2 — a keep rate 20 points below the recorded day is reported, not absorbed', () => {
        const poolDocs = docs(13, 40_000);
        // The recorded day admitted 50% of its pool; today QC admits 30%.
        const calibration = recorded({ poolChars: 40_000, keptChars: 20_000, spokenChars: 10_300 });
        const fixture = withFixture({
            poolDocs,
            keptDocs: docs(13, 12_000),
            floor: '15',
            recordedRatio: calibration,
        });
        try {
            const extract = fixture.runExtract();
            expect(extract.status, extract.stderr).toBe(0);
            const ladder = fixture.ladder() as unknown as Ladder;
            // The ladder records the assumption it projected with (R3), not the outcome.
            expect(ladder.keepRate).toBe(0.5);
            expect(ladder.keepRateSource).toContain('20261123_09_spoken-ratio.json');
            expect(ladder.rungs[0]?.keptChars).toBe(20_000);

            const qc = fixture.runQcContent();
            expect(qc.status, qc.stderr).toBe(0);
            // The gate measures the real admission rate and names the drift on stderr.
            expect(qc.stderr).toContain('keep rate drifted');
            expect(qc.stderr).toContain('30%');
            expect(qc.stderr).toContain('50%');
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('AC2 — a keep rate inside the bound is not reported as drift', () => {
        const poolDocs = docs(13, 40_000);
        const calibration = recorded({ poolChars: 40_000, keptChars: 13_200, spokenChars: 6_800 });
        const fixture = withFixture({
            poolDocs,
            keptDocs: docs(13, 12_000),
            floor: '15',
            recordedRatio: calibration,
        });
        try {
            const extract = fixture.runExtract();
            expect(extract.status, extract.stderr).toBe(0);
            const qc = fixture.runQcContent();
            expect(qc.status, qc.stderr).toBe(0);
            // 33% recorded vs 30% measured is 3 points: inside the stated 5-point bound.
            expect(qc.stderr).not.toContain('keep rate drifted');
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });

    it('R4/R2 — one fixture, three estimates: ladder, floor gate and post-spend refusal agree', () => {
        // The recorded day admitted 30% of a 40,000-char pool at a 0.515 spoken/kept ratio, and today's
        // QC admits the same 30% (12,000 chars) — so all three estimates must land on one number:
        // 12,000 x 0.515 / 5.2 + 8 s = 1,196 s = 19.9 min. A denominator switch on ANY side (the ladder
        // back to the raw pool, the gate to the pool ratio, the refusal to the 1.4 expansion) breaks
        // the equality, which is the whole point of the pin (R4).
        const poolDocs = docs(13, 40_000);
        const keptDocs = docs(13, 12_000);
        const calibration = recorded({ poolChars: 40_000, keptChars: 12_000, spokenChars: 6_180 });
        const fixture = withFixture({ poolDocs, keptDocs, floor: '15', recordedRatio: calibration });
        try {
            const extract = fixture.runExtract();
            expect(extract.status, extract.stderr).toBe(0);
            const ladder = fixture.ladder() as unknown as Ladder;
            const qc = fixture.runQcContent();
            expect(qc.status, qc.stderr).toBe(0);
            const projected = minutesOf(12_000, 0.515);
            expect(projected).toBe(19.9);
            expect(ladder.rungs[0]?.minutes).toBe(projected);
            expect(qc.stdout).toContain(`estimated ${projected} min from 12000 chars`);

            // The post-spend refusal: a 5-minute episode under a 15-minute floor, estimated from the
            // same candidate set the gate admitted.
            mkdirSync(join(fixture.workDir, '30-audio'), { recursive: true });
            writeFileSync(
                join(fixture.workDir, '30-audio', `${DATE}_11_generate_content.json`),
                JSON.stringify({ title: '每日AI乱炖', format: 'audio', body: '播客', metadata: { duration: 300 } }),
            );
            const settle = spawnSync(
                'bun',
                [RUNNER, 'daily-episode-duration', fixture.workDir, DATE, '15', '25', 'voxcpm', 'run-0434'],
                { encoding: 'utf-8', cwd: fixture.root },
            );
            expect(settle.status, settle.stderr).toBe(0);
            const refusal = JSON.parse(
                readFileSync(
                    join(fixture.workDir, '30-audio', `${DATE}_11_generate_content_duration-refusal.json`),
                    'utf-8',
                ),
            ) as Record<string, unknown>;
            expect(refusal.estimatedMinutes).toBe(projected);
            expect(refusal.candidateChars).toBe(12_000);
            // R2: the post-spend artifact carries the same three measures with the same sources.
            expect(refusal.expansion).toBe(0.515);
            expect(String(refusal.expansionSource)).toContain('20261123_09_spoken-ratio.json');
            expect(refusal.keepRate).toBe(0.3);
            expect(refusal.keepRateAssumed).toBe(ladder.keepRate);
            expect(refusal.keepRateAssumedSource).toBe(ladder.keepRateSource);
        } finally {
            rmSync(fixture.root, { recursive: true, force: true });
        }
    });
});
