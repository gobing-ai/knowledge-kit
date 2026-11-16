import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 0377 follow-up — the pre-spend floor gate must measure the set it estimates.
 *
 * Incident 2026-11-16 (`kk-news-generate-20261116-1794852605948`): the extract ladder judged the raw
 * pool (38,241 chars × 0.28 → 34.5 min, "clears") while the floor gate judged the QC-admitted
 * candidates (13,963 chars × 0.28 → 12.7 min, "refusing"). The writer then delivered 7,194 spoken
 * characters ≈ 23 min, so the gate refused an episode that comfortably cleared the 15 min floor: the
 * planning shrink (37% admit rate) was discounted twice by one ratio with two denominators.
 *
 * Failures enumerated before the fix:
 *  1. a kept set that clears the floor at the recorded spoken/kept ratio is still refused (the
 *     regression itself: 13,963 chars must read ≈ 23 min, not 12.7);
 *  2. the refusal artifact reports the ratio it used but not where it came from, so an operator
 *     cannot tell a measured gate from the cold-start constant;
 *  3. a kept set that misses the floor at the recorded ratio is NOT refused (a gate that only
 *     passes is not a gate);
 *  4. a pre-2026-11-16 record (no `keptRatio`) is read as a kept ratio anyway, or crashes the stage;
 *  5. `minMinutes` empty ⇒ the gate refuses (it must be off when the floor gate is off).
 */

const RUNNER = resolve(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const RATE = 5.2; // voiced chars per second the gate divides by (voxcpm floor rate)

interface Fixture {
    root: string;
    workDir: string;
    candidates: () => { id: string; title: string; body: string }[];
    refusal: () => Record<string, unknown> | null;
    run: () => ReturnType<typeof spawnSync>;
}

/**
 * A `Doc[]` whose title+body characters total ≈ `chars`. Titles come from distinct CJK word triples:
 * QC's title dedup drops near-duplicates, so numbered titles (`title-0001` vs `title-0002`) collapse
 * the fixture to one document and the gate never sees the set under test.
 */
function docs(count: number, chars: number): { id: string; title: string; body: string }[] {
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
    return Array.from({ length: count }, (_, i) => {
        const title = `${words[i % words.length]}${words[(i + 1) % words.length]}${words[(i + 4) % words.length]}`;
        const bodyLen = Math.max(8, perDoc - title.length);
        return { id: `item-${i}`, title, body: `正文${i}-${'字'.repeat(Math.max(0, bodyLen - 4))}` };
    });
}

/**
 * Drive `daily-quality-control-content` with a shim `kk` whose executor run writes the candidate
 * set, exactly as the real `episode-plan-gen` would. `floor` is the `min_minutes` argument — empty
 * turns the pre-spend gate off.
 */
function withFixture(
    keptDocs: { id: string; title: string; body: string }[],
    floor: string,
    siblingRatio?: object,
): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-floor-gate-'));
    const workDir = join(root, 'kk-news-generate-20261116-1');
    const binDir = join(root, 'bin');
    mkdirSync(join(workDir, '21-plan'), { recursive: true });
    mkdirSync(join(workDir, '10-collect'), { recursive: true });
    mkdirSync(binDir, { recursive: true });
    if (siblingRatio !== undefined) {
        const sibling = join(root, 'kk-news-generate-20261115-1', '21-plan');
        mkdirSync(sibling, { recursive: true });
        writeFileSync(join(sibling, '20261115_09_spoken-ratio.json'), JSON.stringify(siblingRatio));
    }
    // The plan input and the annotated docs the stage reads before the executor call.
    const planContent = { metadata: { docs: keptDocs.map((doc) => ({ ...doc })) } };
    writeFileSync(join(workDir, '21-plan', '20261116_03_plan_content.json'), JSON.stringify(planContent));
    const shimPath = join(binDir, 'kk');
    writeFileSync(
        shimPath,
        `#!/usr/bin/env bun
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args[args.indexOf('--out') + 1] ?? '';
if (outPath) writeFileSync(outPath, process.env.KK_SHIM_CANDIDATES ?? '{}');
`,
    );
    chmodSync(shimPath, 0o755);
    const candidatesPath = join(workDir, '21-plan', '20261116_04_quality-control-content_candidates.json');
    const refusalPath = join(workDir, '21-plan', '20261116_04_quality-control-content_floor-refusal.json');
    const run = () =>
        spawnSync(
            'bun',
            [RUNNER, 'daily-qc-content', workDir, '20261116', '', 'ai-news', '2', '3', '2', '1', '1', floor, 'voxcpm'],
            {
                encoding: 'utf-8',
                env: {
                    ...process.env,
                    PATH: `${binDir}:${process.env.PATH}`,
                    KK_SHIM_CANDIDATES: JSON.stringify({ metadata: { docs: keptDocs } }),
                },
            },
        );
    return {
        root,
        workDir,
        candidates: () =>
            (JSON.parse(readFileSync(candidatesPath, 'utf-8')) as { metadata: { docs: unknown[] } }).metadata.docs as {
                id: string;
                title: string;
                body: string;
            }[],
        refusal: () => {
            try {
                return JSON.parse(readFileSync(refusalPath, 'utf-8')) as Record<string, unknown>;
            } catch {
                return null;
            }
        },
        run,
    };
}

describe('pre-spend floor gate measures the kept set (2026-11-16)', () => {
    // 13,963 kept chars is the production candidate set from the incident run.
    const KEPT_CHARS = 13_963;

    it('passes a kept set that clears the floor at the recorded spoken/kept ratio', () => {
        // 7,194 spoken / 13,963 kept = 0.515 ⇒ 13,963 × 0.515 / 5.2 = 1,383 s ≈ 23 min ≥ 15.
        const fixture = withFixture(docs(13, KEPT_CHARS), '15', {
            runDate: '20261115',
            poolChars: 55_242,
            keptChars: 18_525,
            spokenChars: 9_540,
            ratio: 0.173,
            keptRatio: 0.515,
        });
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.refusal()).toBeNull();
        expect(fixture.candidates()).toHaveLength(13);
        rmSync(fixture.root, { recursive: true, force: true });
    });

    it('refuses a kept set that misses the floor at that ratio, naming the ratio and its source', () => {
        // 6,000 kept chars × 0.515 / 5.2 = 594 s ≈ 9.9 min < 15 ⇒ refused.
        const fixture = withFixture(docs(6, 6_000), '15', {
            runDate: '20261115',
            poolChars: 55_242,
            keptChars: 18_525,
            spokenChars: 9_540,
            ratio: 0.173,
            keptRatio: 0.515,
        });
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        const refusal = fixture.refusal();
        expect(refusal).not.toBeNull();
        expect(refusal?.expansion).toBe(0.515);
        expect(String(refusal?.expansionSource)).toContain('spoken-ratio.json');
        expect(refusal?.candidateChars).toBeGreaterThan(5_000);
        expect(fixture.candidates()).toHaveLength(0);
        rmSync(fixture.root, { recursive: true, force: true });
    });

    it('falls back to the cold-start constant when the only records predate keptRatio', () => {
        // The old record shape carries no keptRatio: reading its pool ratio here would be the bug.
        const fixture = withFixture(docs(13, KEPT_CHARS), '15', {
            runDate: '20261114',
            poolChars: 20_000,
            spokenChars: 2_000,
            ratio: 0.1,
        });
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        const refusal = fixture.refusal();
        expect(refusal).not.toBeNull();
        expect(refusal?.expansion).toBe(0.28);
        expect(String(refusal?.expansionSource)).toContain('default 0.28');
        rmSync(fixture.root, { recursive: true, force: true });
    });

    it('is off when the floor is unset, even for a one-item kept set', () => {
        const fixture = withFixture(docs(1, 300), '');
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.refusal()).toBeNull();
        expect(fixture.candidates()).toHaveLength(1);
        rmSync(fixture.root, { recursive: true, force: true });
    });

    it('turns the recorded ratio into minutes at the driver rate, not into a pool estimate', () => {
        // Guard the arithmetic itself: 10,000 kept chars at 0.515 over 5.2 chars/s ≈ 16.5 min, so it
        // clears a 15 min floor by a thin margin — a gate using the pool ratio would refuse it.
        const fixture = withFixture(docs(10, 10_000), '15', {
            runDate: '20261115',
            poolChars: 55_242,
            keptChars: 18_525,
            spokenChars: 9_540,
            ratio: 0.173,
            keptRatio: 0.515,
        });
        const res = fixture.run();
        expect(res.status, res.stderr).toBe(0);
        expect(fixture.refusal()).toBeNull();
        expect((10_000 * 0.515) / RATE / 60).toBeGreaterThan(15);
        rmSync(fixture.root, { recursive: true, force: true });
    });
});
