import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Task 0329 — the publish-path stages behind the voice3 repairs.
 *
 * `daily-stages.ts` is a spawned stage runner, not an in-process library (same reasoning as
 * kk-workflow-stages.test.ts: importing the body registers it with coverage and breaks the bunfig
 * threshold, and failing stages `process.exit` inside `timed`). Every call here goes out of
 * process, fully offline.
 *
 * Failure-first list:
 *  F06 — a duration refusal must invalidate the publish path (empty the pool-gate token to EMPTY,
 *        remove a stale bundle.json) so the token-gated tail cannot package a refused episode;
 *  F16 — daily-bundle-variants must wipe stale `30-variants/*.content.json` from a previous
 *        attempt and follow the cards_enabled/cover_enabled switches;
 *  F21 — daily-preflight must recognize `kk stage run <name>` spellings, the publish-matrix
 *        roster (dispatched by apps/cli, not the case map) and the new daily-quality-verdict;
 *  F23 — daily-quality-verdict: a passed audio QC exits 0; a failed/missing QC verdict exits 1
 *        naming the cause — the print-only daily-quality-report never gated anything.
 */
const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');
const DATE = '20261025';
const RUN_ID = 'run-0329';
const TOKEN = `.spur/run/${RUN_ID}-pool-gate.status`;

interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

/** Run a stage with cwd = `root` (token paths like .spur/run/… resolve against the workflow cwd). */
function stage(root: string, args: string[]): RunResult {
    const result = spawnSync('bun', [runner, ...args], { encoding: 'utf-8', cwd: root });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function tempRoot(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
}

/** Content file with a `metadata.duration` the measured gate reads. */
function seedAudio(root: string, durationSeconds: number, qc?: Record<string, unknown>): string {
    const dir = join(root, 'work', '30-audio');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${DATE}_11_generate_content.json`);
    writeFileSync(
        path,
        JSON.stringify({
            title: '每日AI乱炖',
            format: 'audio',
            body: '播客',
            metadata: { duration: durationSeconds, audioPath: '/tmp/x.mp3', ...(qc === undefined ? {} : { qc }) },
        }),
    );
    return path;
}

function seedCandidates(root: string, count: number): void {
    const dir = join(root, 'work', '21-plan');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, `${DATE}_04_quality-control-content_candidates.json`),
        JSON.stringify({ metadata: { docs: Array.from({ length: count }, (_, i) => ({ id: `d${i}` })) } }),
    );
}

function seedToken(root: string, value: string): void {
    mkdirSync(join(root, '.spur', 'run'), { recursive: true });
    writeFileSync(join(root, TOKEN), value);
}

describe('daily-episode-duration refusal invalidates the publish path (0329 F06)', () => {
    it('a below-floor episode writes the refusal, empties candidates, and overwrites the gate token to EMPTY', () => {
        const root = tempRoot('kk-0329-dur-');
        try {
            seedAudio(root, 5 * 60); // 5 min < 15 min floor
            seedCandidates(root, 4);
            seedToken(root, 'PASS\n');
            mkdirSync(join(root, 'work'), { recursive: true });
            writeFileSync(join(root, 'work', 'bundle.json'), '{"stale":true}\n');
            const result = stage(root, ['daily-episode-duration', 'work', DATE, '15', '25', 'voxcpm', RUN_ID]);
            expect(result.status).toBe(0);
            const refusal = join(root, 'work', '30-audio', `${DATE}_11_generate_content_duration-refusal.json`);
            expect(existsSync(refusal)).toBe(true);
            const candidates = JSON.parse(
                readFileSync(
                    join(root, 'work', '21-plan', `${DATE}_04_quality-control-content_candidates.json`),
                    'utf-8',
                ),
            ) as { metadata: { docs: unknown[] } };
            expect(candidates.metadata.docs).toEqual([]);
            expect(readFileSync(join(root, TOKEN), 'utf-8')).toBe('EMPTY\n');
            expect(existsSync(join(root, 'work', 'bundle.json'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('a rerun over an existing refusal stays exit 0 and keeps the publish path invalidated', () => {
        const root = tempRoot('kk-0329-dur2-');
        try {
            seedAudio(root, 5 * 60);
            seedCandidates(root, 4);
            seedToken(root, 'PASS\n');
            const first = stage(root, ['daily-episode-duration', 'work', DATE, '15', '25', 'voxcpm', RUN_ID]);
            expect(first.status).toBe(0);
            // Second run: candidates already emptied — no re-estimate, still exit 0, token still EMPTY.
            const second = stage(root, ['daily-episode-duration', 'work', DATE, '15', '25', 'voxcpm', RUN_ID]);
            expect(second.status).toBe(0);
            expect(second.stderr).toContain('already recorded');
            expect(readFileSync(join(root, TOKEN), 'utf-8')).toBe('EMPTY\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('a passing gate leaves the verdict artifact and does not touch the token or bundle', () => {
        const root = tempRoot('kk-0329-dur3-');
        try {
            seedAudio(root, 18 * 60);
            seedCandidates(root, 4);
            seedToken(root, 'PASS\n');
            mkdirSync(join(root, 'work'), { recursive: true });
            writeFileSync(join(root, 'work', 'bundle.json'), '{"keep":true}\n');
            const result = stage(root, ['daily-episode-duration', 'work', DATE, '15', '25', 'voxcpm', RUN_ID]);
            expect(result.status).toBe(0);
            expect(existsSync(join(root, 'work', '30-audio', `${DATE}_11_generate_content_duration.json`))).toBe(true);
            expect(readFileSync(join(root, TOKEN), 'utf-8')).toBe('PASS\n');
            expect(existsSync(join(root, 'work', 'bundle.json'))).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('the refusal estimate uses the recorded spoken/kept ratio, not the 1.4 raw-script default', () => {
        const root = tempRoot('kk-0329-dur4-');
        try {
            // 10,400 candidate chars at 0.30 spoken/kept ≈ 10 min of speech; the 1.4 default would
            // claim ~47 min beside a 5-minute episode (the 2026-11-24 artifact claimed 58.2).
            seedAudio(root, 5 * 60);
            const planDir = join(root, 'work', '21-plan');
            mkdirSync(planDir, { recursive: true });
            writeFileSync(
                join(planDir, `${DATE}_04_quality-control-content_candidates.json`),
                JSON.stringify({
                    metadata: {
                        docs: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, title: '', body: 'x'.repeat(2600) })),
                    },
                }),
            );
            const sibling = join(root, '20261024', '21-plan');
            mkdirSync(sibling, { recursive: true });
            writeFileSync(
                join(sibling, `20261024${'_09_spoken-ratio.json'}`),
                JSON.stringify({ poolChars: 20000, keptChars: 12000, keptRatio: 0.3, spokenChars: 3600, ratio: 0.18 }),
            );
            const result = stage(root, ['daily-episode-duration', 'work', DATE, '15', '25', 'voxcpm', RUN_ID]);
            expect(result.status).toBe(0);
            const refusal = JSON.parse(
                readFileSync(
                    join(root, 'work', '30-audio', `${DATE}_11_generate_content_duration-refusal.json`),
                    'utf-8',
                ),
            ) as { estimatedMinutes: number; candidateChars: number };
            expect(refusal.candidateChars).toBe(10400);
            // 8 s intro + 10,400 × 0.30 / 5.2 chars-per-second = 608 s ≈ 10.1 min (1.4 would say ≈ 46.7).
            expect(refusal.estimatedMinutes).toBe(10.1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('daily-quality-verdict gate (0329 F23)', () => {
    it('a passed audio qc verdict exits 0', () => {
        const root = tempRoot('kk-0329-qv1-');
        try {
            seedAudio(root, 18 * 60, { passed: true, overallScore: 92 });
            expect(stage(root, ['daily-quality-verdict', 'work', DATE]).status).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('a failed audio qc verdict exits 1 and names the critical issues', () => {
        const root = tempRoot('kk-0329-qv2-');
        try {
            seedAudio(root, 18 * 60, {
                passed: false,
                overallScore: 41,
                criticalIssues: ['speaker changed mid-episode'],
            });
            const result = stage(root, ['daily-quality-verdict', 'work', DATE]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('speaker changed mid-episode');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('a missing qc verdict exits 1 — the generator must grade what it rendered', () => {
        const root = tempRoot('kk-0329-qv3-');
        try {
            seedAudio(root, 18 * 60);
            const result = stage(root, ['daily-quality-verdict', 'work', DATE]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('no qc verdict');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('no audio at all exits 1 naming the path (script-refusal days are closed by the refusal artifact, not here)', () => {
        const root = tempRoot('kk-0329-qv4-');
        try {
            mkdirSync(join(root, 'work'), { recursive: true });
            const result = stage(root, ['daily-quality-verdict', 'work', DATE]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('no audio content');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('daily-bundle-variants stale wipe and run switches (0329 F16)', () => {
    const ARTICLE = { title: '今日AI', format: 'markdown', body: '正文' };

    function seedWork(root: string): void {
        const work = join(root, 'work');
        mkdirSync(join(work, '22-article'), { recursive: true });
        mkdirSync(join(work, '31-publish'), { recursive: true });
        mkdirSync(join(work, '30-variants'), { recursive: true });
        writeFileSync(join(work, '22-article', `${DATE}_06_article_content.json`), JSON.stringify(ARTICLE));
        writeFileSync(
            join(work, '31-publish', `${DATE}_13_publish-prep_content.json`),
            JSON.stringify({ title: 'ep', format: 'audio', body: '播客', metadata: { audioFile: '/tmp/x.mp3' } }),
        );
        // A stale variant from a previous attempt — the wipe must remove it.
        writeFileSync(join(work, '30-variants', 'social_weibo.content.json'), '{"stale":true}\n');
    }

    it('wipes stale variants and skips cards when cards_enabled=false even with a series on disk', () => {
        const root = tempRoot('kk-0329-bv1-');
        try {
            seedWork(root);
            mkdirSync(join(root, 'work', '25-xhs'), { recursive: true });
            writeFileSync(join(root, 'work', '25-xhs', 'content.json'), JSON.stringify({ title: 'cards', body: 'x' }));
            const result = stage(root, ['daily-bundle-variants', 'work', DATE, '', 'false', 'false']);
            expect(result.status).toBe(0);
            const variants = join(root, 'work', '30-variants');
            const files = existsSync(variants) ? readdirSync(variants) : [];
            expect(files.some((file) => file.startsWith('social_weibo'))).toBe(false);
            expect(files.some((file) => file.startsWith('article'))).toBe(true);
            expect(files.some((file) => file.startsWith('cards'))).toBe(false);
            expect(result.stdout).toContain('cards_enabled=false');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('emits the cards variant when cards_enabled=true and the series is on disk', () => {
        const root = tempRoot('kk-0329-bv2-');
        try {
            seedWork(root);
            mkdirSync(join(root, 'work', '25-xhs'), { recursive: true });
            writeFileSync(join(root, 'work', '25-xhs', 'content.json'), JSON.stringify({ title: 'cards', body: 'x' }));
            const result = stage(root, ['daily-bundle-variants', 'work', DATE, '', 'true', 'false']);
            expect(result.status).toBe(0);
            const variants = join(root, 'work', '30-variants');
            const files = existsSync(variants) ? readdirSync(variants) : [];
            expect(files.some((file) => file.startsWith('cards'))).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('daily-preflight recognizes the runners this graph invokes (0329 F21)', () => {
    const okYaml = [
        'states:',
        '  - id: a',
        '    action:',
        '      kind: shell',
        '      options:',
        '        command: kk stage run daily-quality-verdict "work" "2026-10-25"',
        '  - id: b',
        '    action:',
        '      kind: shell',
        '      options:',
        '        command: kk stage run publish-matrix-bundle "work" --run-date "2026-10-25" --run-id r',
        '  - id: c',
        '    action:',
        '      kind: shell',
        '      options:',
        '        command: kk stage daily-prepare "work"',
        '',
    ].join('\n');

    it('accepts run-spelled daily stages, the publish-matrix roster, and legacy spellings', () => {
        const root = tempRoot('kk-0329-pf1-');
        const yamlPath = join(root, 'wf.yaml');
        try {
            writeFileSync(yamlPath, okYaml);
            const result = stage(root, ['daily-preflight', yamlPath]);
            expect(result.status).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects a stage no runner owns (runner-stale)', () => {
        const root = tempRoot('kk-0329-pf2-');
        const yamlPath = join(root, 'wf.yaml');
        try {
            writeFileSync(
                yamlPath,
                `${okYaml.replace('command: kk stage run daily-quality-verdict', 'command: kk stage run daily-does-not-exist')}`,
            );
            const result = stage(root, ['daily-preflight', yamlPath]);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('daily-does-not-exist');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
