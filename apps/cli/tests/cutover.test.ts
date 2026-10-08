/**
 * `kk ledger cutover-check` (task 0212 R1 / AC1).
 *
 * Failure-first list — written before the implementation; each entry names how the
 * check can fail and is covered by a test below.
 *
 *  1. Fewer than `--runs` candidate sections recorded → not ready, reason names the shortfall.
 *  2. A red (non-`done`) run inside the newest N → streak stops at it, reason names the run.
 *  3. Candidate section without a classify step (e.g. a publish-disabled run) → not ready.
 *  4. Classify Result cell that is not a target set (pre-cutover `ok` cells) → not ready.
 *  5. No baseline run on the candidate run's day → not ready.
 *  6. Baseline same-day run without a comparable target set → not ready.
 *  7. Same-day target-set mismatch (`full:2/2` vs `partial:1/2`) → not ready.
 *  8. Malformed ledger section (heading without a run marker) → reported as a reason, never fatal.
 *  9. `--runs 0` (or non-integer) → not ready via an args reason, still exit 0.
 * 10. Green path: N `done` runs, each matching its same-day baseline target set → ready.
 * 11. Command level: missing ledger files → exit 0 with file reasons; green fixtures → exit 0
 *     with `ready: true` (R1's "exit 0 always"); a hostile workflow name still exits 1 (guard).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyTargetSet, cutoverCheck, type LedgerRun, ledgerHeading, parseLedger } from '../src/ledger';
import { main } from '../src/main';
import { captureOutput } from './capture';

const tempDirs: string[] = [];
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-cutover-')));
    tempDirs.push(dir);
    return dir;
}

/** One 0207-format ledger section, exactly as `renderLedgerSection` writes it. */
function section(startedAt: string, runId: string, status: string, steps: [string, string, string][]): string {
    const rows = steps.map(([node, stepStatus, result]) => `| ${node} | ${stepStatus} | 5s | n/a | ${result} |`);
    return [
        `## ${startedAt} · run ${runId.slice(0, 8)} · ${status} · 5s · tokens: —`,
        `<!-- run:${runId} -->`,
        '',
        '| Step | Status | Duration | Tokens in/out | Result |',
        '| --- | --- | --- | --- | --- |',
        ...rows,
        '',
    ].join('\n');
}

/** Ledger for `runs`, each done unless `red` says otherwise; classify cells from `classify`. */
function ledgerFile(runs: number, classify: (index: number) => string, red: number[] = []): string {
    const sections: string[] = [];
    for (let index = 0; index < runs; index++) {
        const day = `2026-10-0${index + 1}`;
        const status = red.includes(index) ? 'failed' : 'done';
        const steps: [string, string, string][] =
            status === 'done' ? [['publish-classify', 'done', classify(index)]] : [['extract', 'failed', 'boom']];
        sections.push(
            section(
                `${day}T14:0${index}Z`,
                `run-${String(index).padStart(4, '0')}-aaaa-bbbb-cccccccccccc`,
                status,
                steps,
            ),
        );
    }
    return [`# w ledger`, '', ...sections, ''].join('\n');
}

const FULL = '{"status":"full","published":2,"targets":2}';
const PARTIAL = '{"status":"partial","published":1,"targets":2}';

/** Green candidate/baseline pair: every day matches `full:2/2`. */
function greenCandidate(runs: number): LedgerRun[] {
    return parseLedger(ledgerFile(runs, () => FULL)).runs;
}
function greenBaseline(runs: number): LedgerRun[] {
    return parseLedger(ledgerFile(runs, () => FULL)).runs;
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('parseLedger', () => {
    it('round-trips a rendered 0207 section into run fields and steps', () => {
        const parsed = parseLedger(
            `# w ledger\n\n${section('2026-10-07T14:05Z', 'run-0001-aaaa-bbbb-cccccccccccc', 'done', [
                ['publish-classify', 'done', FULL],
                ['extract', 'done', 'ok'],
            ])}`,
        );
        expect(parsed.malformed).toEqual([]);
        const run = parsed.runs[0];
        expect(parsed.runs).toHaveLength(1);
        expect(run?.runId).toBe('run-0001-aaaa-bbbb-cccccccccccc');
        expect(run?.startedAt).toBe('2026-10-07T14:05Z');
        expect(run?.status).toBe('done');
        expect(run?.steps.map((step) => step.node)).toEqual(['publish-classify', 'extract']);
        expect(classifyTargetSet(run?.steps[0]?.result ?? '')).toBe('full:2/2');
    });

    it('reports a heading without a run marker as malformed, keeping the parseable runs', () => {
        const parsed = parseLedger(
            [
                '## 2026-10-07T14:05Z · no marker here',
                '',
                '| Step | Status | Duration | Tokens in/out | Result |',
                '',
            ].join('\n'),
        );
        expect(parsed.runs).toHaveLength(0);
        expect(parsed.malformed).toEqual(['2026-10-07T14:05Z · no marker here']);
    });

    it('survives escaped pipes inside a Result cell', () => {
        const parsed = parseLedger(
            section('2026-10-07T14:05Z', 'run-0001-aaaa-bbbb-cccccccccccc', 'done', [['extract', 'done', 'a \\| b']]),
        );
        expect(parsed.runs[0]?.steps[0]?.result).toBe('a | b');
    });
});

describe('cutoverCheck', () => {
    it('is ready when the newest N runs are all done and match their same-day baseline (10)', () => {
        const verdict = cutoverCheck(greenCandidate(5), greenBaseline(5), 5);
        expect(verdict).toEqual({ ready: true, streak: 5, required: 5, reasons: [] });
    });

    it('is not ready with fewer candidate runs than required (1)', () => {
        const verdict = cutoverCheck(greenCandidate(3), greenBaseline(3), 5);
        expect(verdict.ready).toBe(false);
        expect(verdict.streak).toBe(3);
        expect(verdict.reasons).toEqual(['candidate: 3 of 5 required runs recorded']);
    });

    it('stops the streak at a red run inside the window (2)', () => {
        const red = parseLedger(ledgerFile(5, () => FULL, [2])).runs; // oldest = index 0 … red at index 2
        const withRed = [...greenCandidate(5).slice(0, 2), ...red.slice(2)];
        const actual = cutoverCheck(withRed, greenBaseline(5), 5);
        expect(actual.streak).toBe(2);
        expect(actual.ready).toBe(false);
        expect(actual.reasons.some((reason) => reason.startsWith('candidate run-0002'))).toBe(true);
    });

    it('is not ready when a candidate run has no classify step (3)', () => {
        const candidate = parseLedger(ledgerFile(2, () => FULL)).runs;
        const noClassify = candidate[1];
        if (noClassify !== undefined) {
            noClassify.steps = [];
        }
        const verdict = cutoverCheck(candidate, greenBaseline(2), 2);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toContain('candidate run-0001: no classify step');
    });

    it('is not ready when the classify cell is not a target set — pre-cutover ok cells (4)', () => {
        const candidate = parseLedger(ledgerFile(2, () => FULL)).runs;
        const step = candidate[0]?.steps[0];
        if (step !== undefined) {
            step.result = 'ok';
        }
        const verdict = cutoverCheck(candidate, greenBaseline(2), 2);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toContain('candidate run-0000: classify result is not a target set');
    });

    it('is not ready when the baseline has no run on that day (5)', () => {
        const candidate = greenCandidate(2);
        const baseline = parseLedger(ledgerFile(1, () => FULL)).runs; // only 2026-10-01
        const verdict = cutoverCheck(candidate, baseline, 2);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toContain('baseline: no 2026-10-02 run');
    });

    it('is not ready when the baseline same-day run has no comparable target set (6)', () => {
        const candidate = greenCandidate(2);
        const baseline = greenBaseline(2);
        const peerStep = baseline[1]?.steps[0];
        if (peerStep !== undefined) {
            peerStep.result = 'ok';
        }
        const verdict = cutoverCheck(candidate, baseline, 2);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toContain('baseline run-0001: no comparable target set');
    });

    it('is not ready on a same-day target-set mismatch (7)', () => {
        const candidate = greenCandidate(2);
        const baseline = parseLedger(ledgerFile(2, (index) => (index === 1 ? PARTIAL : FULL))).runs;
        const verdict = cutoverCheck(candidate, baseline, 2);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toContain('2026-10-02: target set mismatch candidate full:2/2 vs baseline partial:1/2');
    });

    it('rejects a non-positive --runs via the args reason (9)', () => {
        const verdict = cutoverCheck(greenCandidate(5), greenBaseline(5), 0);
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons).toEqual(['args: --runs must be a positive integer, got 0']);
    });
});

describe('kk ledger cutover-check command (11)', () => {
    it('exits 0 with file reasons when a ledger file is missing', async () => {
        const works = tempDir();
        const captured = captureOutput();
        let code: number;
        try {
            code = await main([
                'node',
                'kk',
                'ledger',
                'cutover-check',
                '--candidate',
                'w2',
                '--baseline',
                'w',
                '--runs',
                '5',
                '--works-dir',
                works,
            ]);
        } finally {
            captured.restore();
        }
        expect(code).toBe(0);
        const verdict = JSON.parse(captured.read()) as { ready: boolean; reasons: string[] };
        expect(verdict.ready).toBe(false);
        expect(verdict.reasons.some((reason) => reason.startsWith('candidate: no ledger at'))).toBe(true);
    });

    it('exits 0 with ready true over green fixture ledgers', async () => {
        const works = tempDir();
        mkdirSync(join(works, 'w'), { recursive: true });
        mkdirSync(join(works, 'w2'), { recursive: true });
        writeFileSync(
            join(works, 'w', 'ledger.md'),
            ledgerFile(5, () => FULL),
        );
        writeFileSync(
            join(works, 'w2', 'ledger.md'),
            ledgerFile(5, () => FULL),
        );
        const captured = captureOutput();
        let code: number;
        try {
            code = await main([
                'node',
                'kk',
                'ledger',
                'cutover-check',
                '--candidate',
                'w2',
                '--baseline',
                'w',
                '--runs',
                '5',
                '--works-dir',
                works,
            ]);
        } finally {
            captured.restore();
        }
        expect(code).toBe(0);
        expect(JSON.parse(captured.read())).toEqual({ ready: true, streak: 5, required: 5, reasons: [] });
    });

    it('still exits 1 for a hostile workflow name (path-traversal guard)', async () => {
        const works = tempDir();
        const captured = captureOutput();
        let code: number;
        try {
            code = await main([
                'node',
                'kk',
                'ledger',
                'cutover-check',
                '--candidate',
                '../escape',
                '--baseline',
                'w',
                '--runs',
                '5',
                '--works-dir',
                works,
            ]);
        } catch {
            code = 1; // CommanderError is thrown through main's rethrow path in tests
        } finally {
            captured.restore();
        }
        expect(code).not.toBe(0);
        expect(captured.readErr()).toContain('is not a workflow name');
    });

    it('leaves a repeatable artifact under .works/test-artifacts/0212', () => {
        const artifactDir = join(process.cwd(), '.works/test-artifacts/0212');
        mkdirSync(artifactDir, { recursive: true });
        writeFileSync(
            join(artifactDir, 'cutover-fixtures.md'),
            ledgerFile(5, () => FULL),
        );
        writeFileSync(
            join(artifactDir, 'README.md'),
            [
                '# Task 0212 cutover-check fixtures',
                '',
                'Repeatable artifact: the green fixture ledger this test suite drives through',
                '`kk ledger cutover-check --runs 5` (candidate = baseline copy). Re-run:',
                '',
                '```',
                'bun test apps/cli/tests/cutover.test.ts',
                'bun apps/cli/src/index.ts ledger cutover-check \\',
                '  --candidate w2 --baseline w --runs 5 --works-dir <a dir holding these ledgers>',
                '```',
                '',
                `Ledger heading format reference: \`${ledgerHeading('w')}\`.`,
                '',
            ].join('\n'),
        );
        expect(true).toBe(true);
    });
});
