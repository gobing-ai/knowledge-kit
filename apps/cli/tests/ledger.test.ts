/**
 * Failure-first list for `kk ledger` (task 0207 R1–R7 / AC1 / AC2).
 *
 * Written before the implementation. Every entry names how the unit can fail; each
 * is covered by a test below or by the fixture it uses (see the per-test comments).
 *
 *  1. `kk ledger append` for a run still `running` → exits 1 with `kk.ledger.run.running`
 *     and does not touch `ledger.md` (R7).
 *  2. Unknown run id → the `spur workflow trace` spawn exits non-zero with "Run not found"
 *     → exits 1 with `kk.ledger.trace.not-found`, `ledger.md` untouched (R7).
 *  3. Trace JSON without `run` or without `events` → exits 1 with `kk.ledger.trace.invalid`,
 *     `ledger.md` untouched (R7).
 *  4. Trace stdout that is not JSON at all → same `kk.ledger.trace.invalid` exit-1 path (R7).
 *  5. `spur` binary cannot be spawned (missing binary) → exits 1, `ledger.md` untouched; the
 *     raw executor/JSON error must not leak as an uncaught exception.
 *  6. An agent step whose actions carry no `cost` key → `unknown`, never `0/0` (R4/AC2).
 *  7. An agent step whose `cost.exact` is null but `cost.estimated` is present → `unknown`;
 *     the estimated totals must never be rendered (R4/AC2).
 *  8. A step with no `agent.run` action → `—`, not `0/0` (R4).
 *  9. A step whose two actions both have exact cost → one row with summed in/out, and the
 *     step duration is the sum of `durationMs` (R3/R4).
 * 10. A step with several actions, one of them failed → status `failed` even when the last
 *     action succeeded (R3).
 * 11. `Result` fallback chain: summary file first line > first failing action's `error` > `ok`;
 *     pipes escaped, first line only, cut to 120 chars (R5).
 * 12. `--work-dir` without the `<node>.summary.txt` file → falls back to error/`ok`, no crash (R5).
 * 13. `--work-dir` given for a step with a summary file → its first line is the cell (R5).
 * 14. Repeat append of the same run id → no second section (idempotency marker, R2).
 * 15. `kk ledger sync` where the newest entry is already in the ledger → only the missing run
 *     ids are appended, oldest first (R6).
 * 16. `kk ledger sync` entry still `running` → skipped, never appended (R6).
 * 17. Ledger file absent → created with exactly one `# <workflow> ledger` heading; a second
 *     append adds no second heading (R1).
 * 18. Duration formatting at the 0s / <1m / exactly-1m / >1h boundaries (R2/R3).
 * 19. `kk ledger append` missing `--workflow` or `--run` → non-zero exit (commander required
 *     options); no ledger file written.
 * 20. `kk ledger sync` with a list whose `.entries` is missing → exits 1, no file written (R6/R7).
 * 21. `kk ledger sync` whose `spur workflow trace --workflow` call fails → exits 1 with
 *     `kk.ledger.trace.spawn-failed`, no file written (R6/R7). * 22. Unwritable ledger path (the `--works-dir` path is a regular file) → exits 1 with
 *     `kk.ledger.write.failed`, no partial section left behind (R1/R7).
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    formatDuration,
    LedgerError,
    ledgerHasRun,
    ledgerHeading,
    parseTrace,
    renderLedgerSection,
    selectMissingRuns,
} from '../src/ledger';
import { main } from '../src/main';
import { captureOutput } from './capture';

const FIXTURES = join(import.meta.dir, 'fixtures');
const ARTIFACT_DIR = join(import.meta.dir, '../../..', '.works/test-artifacts/0207');
const AGENT_DONE_RUN = 'b419ba8d-71cf-4a28-93f1-d064d2c712d0';
const TOKEN_MODES_RUN = '3f2a4b5c-1111-4222-8333-444455556666';
const FAILED_RUN = '9e8d7c6b-aaaa-4bbb-8ccc-ddddeeeeffff';

function fixture(name: string): string {
    return readFileSync(join(FIXTURES, name), 'utf-8');
}

const tempDirs: string[] = [];
let stubSeq = 0;
function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-ledger-')));
    tempDirs.push(dir);
    return dir;
}

/**
 * Write an executable `spur` stub that answers `workflow trace <run-id> --json` and
 * `workflow trace --workflow <name> --json` from recorded fixtures. Returns its path,
 * meant for `KK_SPUR_BIN`.
 */
function stubSpur(dir: string, runs: Record<string, string>, list = ''): string {
    const seq = stubSeq++;
    const listPath = join(dir, `trace-list-${seq}.json`);
    const lines = ['#!/bin/sh', 'case "$3" in'];
    for (const [runId, file] of Object.entries(runs)) {
        lines.push(`  ${runId}) cat "${join(FIXTURES, file)}" ;;`);
    }
    lines.push(`  --workflow) cat "${listPath}" ;;`);
    lines.push('  *) echo "Run not found: $3" >&2; exit 1 ;;');
    lines.push('esac');
    const stub = join(dir, `spur-stub-${seq}.sh`);
    writeFileSync(stub, `${lines.join('\n')}\n`);
    chmodSync(stub, 0o755);
    writeFileSync(listPath, list);
    return stub;
}

/** Run `kk …` in-process with a stubbed `spur`, returning exit code plus captured output. */
async function run(
    args: string[],
    env: { KK_SPUR_BIN?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    const previous = process.env.KK_SPUR_BIN;
    if (env.KK_SPUR_BIN !== undefined) {
        process.env.KK_SPUR_BIN = env.KK_SPUR_BIN;
    }
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
        if (previous === undefined) {
            delete process.env.KK_SPUR_BIN;
        } else {
            process.env.KK_SPUR_BIN = previous;
        }
    }
}

afterAll(() => {
    for (const dir of tempDirs) {
        rmSync(dir, { recursive: true, force: true });
    }
    delete process.env.KK_SPUR_BIN;
});

describe('ledger renderer', () => {
    it('renders a recorded done run: header, marker, one row per node in first-seen order (R1/R2/R3)', () => {
        const section = renderLedgerSection(parseTrace(JSON.parse(fixture('trace-agent-done.json'))));

        expect(section.split('\n')[0]).toBe(
            '## 2026-10-07T07:00Z · run b419ba8d · done · 14m04s · tokens: 0/0 (+3 unknown)',
        );
        expect(section.split('\n')[1]).toBe(`<!-- run:${AGENT_DONE_RUN} -->`);
        expect(section).toContain('| Step | Status | Duration | Tokens in/out | Result |');

        const rows = section
            .split('\n')
            .filter((line) => line.startsWith('| ') && !line.startsWith('| Step') && !line.startsWith('| ---'));
        expect(rows.map((row) => row.split(' | ')[0]?.slice(2))).toEqual([
            'precheck',
            'implement',
            'test',
            'triage',
            'review',
            'verify',
            'record',
            'done',
        ]);
        // 3 agent steps with unreported usage: implement, review, verify (R4/AC2).
        expect(rows.filter((row) => row.includes('unknown'))).toHaveLength(3);
        // Shell-only steps render the em dash, never 0/0.
        expect(rows[0]).toBe('| precheck | done | 0s | — | ok |');
        // A failed action inside an otherwise done run marks the step failed (R3).
        expect(rows[3]).toBe('| triage | failed | 0s | — | ok |');
        expect(rows[2]).toBe('| test | done | 1m52s | — | ok |');
        expect(rows[5]).toBe('| verify | done | 4m22s | unknown | ok |');
    });

    it('renders tokens: sums exact totals, marks unknown for null/estimated/absent cost (R4/AC2)', () => {
        const section = renderLedgerSection(parseTrace(JSON.parse(fixture('trace-token-modes.json'))));

        expect(section).toBe(
            [
                `## 2026-10-07T13:00Z · run 3f2a4b5c · done · 41m12s · tokens: 2000/400 (+2 unknown)`,
                `<!-- run:${TOKEN_MODES_RUN} -->`,
                '',
                '| Step | Status | Duration | Tokens in/out | Result |',
                '| --- | --- | --- | --- | --- |',
                '| collect | done | 4s | — | ok |',
                // One unreported action poisons the whole step: `unknown`, and its exact figure
                // is not folded into the header — the header states only fully-reported usage.
                '| translate | done | 6m03s | unknown | ok |',
                '| article-write | done | 2s | 2000/400 | ok |',
                '| summarize | done | 1s | unknown | ok |',
            ].join('\n'),
        );
        // The estimated-only action's 999/111 must never surface as a rendered figure.
        expect(section).not.toContain('999');
    });

    it('uses the summary file first line, else the failing action error, escaped and cut to 120 (R5)', () => {
        const trace = parseTrace(JSON.parse(fixture('trace-failed.json')));

        const withoutSummary = renderLedgerSection(trace);
        const failedRow = withoutSummary.split('\n').find((line) => line.startsWith('| publish ')) ?? '';
        expect(failedRow.startsWith('| publish | failed | 0s | — | spur publish: exit 3 \\| channel')).toBe(true);
        expect(failedRow).not.toContain('rotated mid-request');
        const cell = failedRow.slice('| publish | failed | 0s | — | '.length, -2);
        expect(cell).toHaveLength(120); // cut to 120 chars after escaping
        expect(cell).not.toContain('\n');

        const withSummary = renderLedgerSection(trace, {
            summaries: new Map([['publish', 'published 3 channels\nsecond line ignored']]),
        });
        expect(withSummary.split('\n').find((line) => line.startsWith('| publish '))).toContain(
            '| published 3 channels |',
        );
    });

    it('formats durationMs as XhYmZs at the unit boundaries (R2/R3)', () => {
        expect(formatDuration(0)).toBe('0s');
        expect(formatDuration(999)).toBe('0s');
        expect(formatDuration(41_000)).toBe('41s');
        expect(formatDuration(61_000)).toBe('1m01s');
        expect(formatDuration(2_472_000)).toBe('41m12s');
        expect(formatDuration(3_600_000)).toBe('1h00m00s');
        expect(formatDuration(3_723_000)).toBe('1h02m03s');
        expect(formatDuration(null)).toBe('0s');
    });

    it('rejects trace JSON without run or events with kk.ledger.trace.invalid (R7)', () => {
        for (const raw of [JSON.parse(fixture('trace-missing-events.json')), { events: [] }, { run: {} }, 42, null]) {
            expect(() => parseTrace(raw)).toThrow(LedgerError);
            try {
                parseTrace(raw);
            } catch (error) {
                expect((error as LedgerError).code).toBe('kk.ledger.trace.invalid');
            }
        }
    });

    it('detects existing run markers and selects missing, non-running runs oldest first (R2/R6)', () => {
        const markdown = `# kk-itc ledger\n\n<!-- run:${FAILED_RUN} -->\n`;
        expect(ledgerHasRun(markdown, FAILED_RUN)).toBe(true);
        expect(ledgerHasRun(markdown, TOKEN_MODES_RUN)).toBe(false);
        expect(ledgerHeading('kk-itc')).toBe('# kk-itc ledger');

        const entries = [
            { runId: 'newest', status: 'done', startedAt: '2026-10-07T03:00:00.000Z' },
            { runId: FAILED_RUN, status: 'done', startedAt: '2026-10-07T02:00:00.000Z' },
            { runId: 'still-running', status: 'running', startedAt: '2026-10-07T01:00:00.000Z' },
            { runId: 'oldest', status: 'failed', startedAt: '2026-10-07T00:00:00.000Z' },
        ];
        expect(selectMissingRuns(entries, markdown)).toEqual(['oldest', 'newest']);
    });
});

describe('kk ledger', () => {
    it('appends one section for a done run and is idempotent on repeat (R1/R2/AC1)', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const stub = stubSpur(dir, { [AGENT_DONE_RUN]: 'trace-agent-done.json' });

        const first = await run(
            ['ledger', 'append', '--workflow', 'task-pipeline', '--run', AGENT_DONE_RUN, '--works-dir', works],
            { KK_SPUR_BIN: stub },
        );
        expect(first.code).toBe(0);
        const ledgerPath = join(works, 'task-pipeline/ledger.md');
        const content = readFileSync(ledgerPath, 'utf-8');
        expect(content.startsWith('# task-pipeline ledger\n')).toBe(true);
        expect(content.match(/# task-pipeline ledger/g)).toHaveLength(1);
        expect(content).toContain(`<!-- run:${AGENT_DONE_RUN} -->`);
        expect(JSON.parse(first.out)).toEqual({
            workflow: 'task-pipeline',
            ledger: ledgerPath,
            appended: [AGENT_DONE_RUN],
        });

        const second = await run(
            ['ledger', 'append', '--workflow', 'task-pipeline', '--run', AGENT_DONE_RUN, '--works-dir', works],
            { KK_SPUR_BIN: stub },
        );
        expect(second.code).toBe(0);
        expect(second.out).toContain('"appended":[]');
        expect(readFileSync(ledgerPath, 'utf-8')).toBe(content);

        // Repeatable artifact for the run (task testing contract).
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(join(ARTIFACT_DIR, 'ledger-task-pipeline.md'), content);
    });

    it('reads the work-dir summary file for a step result cell (R5)', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const workDir = join(dir, 'work');
        mkdirSync(workDir, { recursive: true });
        writeFileSync(join(workDir, 'collect.summary.txt'), '38 items\nmore detail\n');
        const stub = stubSpur(dir, { [TOKEN_MODES_RUN]: 'trace-token-modes.json' });

        const result = await run(
            [
                'ledger',
                'append',
                '--workflow',
                'kk-collect',
                '--run',
                TOKEN_MODES_RUN,
                '--works-dir',
                works,
                '--work-dir',
                workDir,
            ],
            { KK_SPUR_BIN: stub },
        );
        expect(result.code).toBe(0);
        const content = readFileSync(join(works, 'kk-collect/ledger.md'), 'utf-8');
        expect(content).toContain('| collect | done | 4s | — | 38 items |');
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(join(ARTIFACT_DIR, 'ledger-kk-collect.md'), content);
    });

    it('syncs missing runs oldest first, skipping ones already recorded (R6/AC1)', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const list = JSON.stringify({
            entries: [
                { runId: FAILED_RUN, status: 'done', startedAt: '2026-10-07T02:00:00.000Z' },
                { runId: AGENT_DONE_RUN, status: 'done', startedAt: '2026-10-07T01:00:00.000Z' },
                { runId: 'live-run', status: 'running', startedAt: '2026-10-07T00:00:00.000Z' },
            ],
            total: 3,
        });
        const stub = stubSpur(
            dir,
            { [AGENT_DONE_RUN]: 'trace-agent-done.json', [FAILED_RUN]: 'trace-failed.json' },
            list,
        );

        const result = await run(['ledger', 'sync', '--workflow', 'kk-itc', '--works-dir', works], {
            KK_SPUR_BIN: stub,
        });
        expect(result.code).toBe(0);
        const content = readFileSync(join(works, 'kk-itc/ledger.md'), 'utf-8');
        expect(JSON.parse(result.out).appended).toEqual([AGENT_DONE_RUN, FAILED_RUN]);
        expect(content.indexOf(AGENT_DONE_RUN)).toBeLessThan(content.indexOf(FAILED_RUN));
        expect(content).not.toContain('live-run');

        const again = await run(['ledger', 'sync', '--workflow', 'kk-itc', '--works-dir', works], {
            KK_SPUR_BIN: stub,
        });
        expect(again.code).toBe(0);
        expect(again.out).toContain('"appended":[]');
        expect(readFileSync(join(works, 'kk-itc/ledger.md'), 'utf-8')).toBe(content);
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(join(ARTIFACT_DIR, 'ledger-kk-itc.md'), content);
    });

    it('exits 1 without touching the ledger for running, unknown or malformed traces (R7)', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const stub = stubSpur(dir, { [TOKEN_MODES_RUN]: 'trace-running.json' });
        const missingEvents = stubSpur(dir, { [TOKEN_MODES_RUN]: 'trace-missing-events.json' }, '{"entries":[]}');
        const ledgerPath = join(works, 'kk-collect/ledger.md');

        const running = await run(
            ['ledger', 'append', '--workflow', 'kk-collect', '--run', TOKEN_MODES_RUN, '--works-dir', works],
            { KK_SPUR_BIN: stub },
        );
        expect(running.code).toBe(1);
        expect(running.err).toContain('kk.ledger.run.running');
        expect(existsSync(ledgerPath)).toBe(false);

        const unknown = await run(
            ['ledger', 'append', '--workflow', 'kk-collect', '--run', 'does-not-exist', '--works-dir', works],
            { KK_SPUR_BIN: stub },
        );
        expect(unknown.code).toBe(1);
        expect(unknown.err).toContain('kk.ledger.trace.not-found');
        expect(existsSync(ledgerPath)).toBe(false);

        const malformed = await run(
            ['ledger', 'append', '--workflow', 'kk-collect', '--run', TOKEN_MODES_RUN, '--works-dir', works],
            { KK_SPUR_BIN: missingEvents },
        );
        expect(malformed.code).toBe(1);
        expect(malformed.err).toContain('kk.ledger.trace.invalid');
        expect(existsSync(ledgerPath)).toBe(false);

        const noBinary = await run(
            ['ledger', 'append', '--workflow', 'kk-collect', '--run', TOKEN_MODES_RUN, '--works-dir', works],
            { KK_SPUR_BIN: join(dir, 'no-such-spur') },
        );
        expect(noBinary.code).toBe(1);
        expect(noBinary.err).toContain('kk.ledger.trace.spawn-failed');
        expect(existsSync(ledgerPath)).toBe(false);

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR, 'ledger-failure-reasons.txt'),
            [
                `running: exit ${running.code} ${running.err.trim()}`,
                `unknown: exit ${unknown.code} ${unknown.err.trim()}`,
                `malformed: exit ${malformed.code} ${malformed.err.trim()}`,
                `no-binary: exit ${noBinary.code} ${noBinary.err.trim()}`,
                `ledger created: ${existsSync(ledgerPath)}`,
            ].join('\n') + '\n',
        );
    });

    it('exits 1 for a failing sync list and for an unwritable ledger path, writing nothing (R6/R7)', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const failingList = stubSpur(dir, {}, '{ not json');
        const goodRun = stubSpur(dir, { [TOKEN_MODES_RUN]: 'trace-token-modes.json' });
        const deadSpur = join(dir, 'spur-stub-dead.sh');
        writeFileSync(deadSpur, '#!/bin/sh\necho "spur: run registry unavailable" >&2\nexit 1\n');
        chmodSync(deadSpur, 0o755);

        const badList = await run(['ledger', 'sync', '--workflow', 'kk-collect', '--works-dir', works], {
            KK_SPUR_BIN: failingList,
        });
        expect(badList.code).toBe(1);
        expect(badList.err).toContain('kk.ledger.list.invalid');
        expect(existsSync(join(works, 'kk-collect/ledger.md'))).toBe(false);

        // The list call itself fails: no per-run section is even attempted.
        const deadList = await run(['ledger', 'sync', '--workflow', 'kk-collect', '--works-dir', works], {
            KK_SPUR_BIN: deadSpur,
        });
        expect(deadList.code).toBe(1);
        expect(deadList.err).toContain('kk.ledger.trace.spawn-failed');
        expect(existsSync(join(works, 'kk-collect/ledger.md'))).toBe(false);

        // `--works-dir` pointing at a regular file makes the ledger write fail.
        const notADir = join(dir, 'not-a-dir');
        writeFileSync(notADir, 'x');
        const writeFail = await run(
            ['ledger', 'append', '--workflow', 'kk-collect', '--run', TOKEN_MODES_RUN, '--works-dir', notADir],
            { KK_SPUR_BIN: goodRun },
        );
        expect(writeFail.code).toBe(1);
        expect(writeFail.err).toContain('kk.ledger.write.failed');
        expect(existsSync(join(works, 'kk-collect/ledger.md'))).toBe(false);
    });

    it('exits non-zero when --workflow or --run is missing and writes no ledger', async () => {
        const dir = tempDir();
        const works = join(dir, '.works');
        const stub = stubSpur(dir, {});

        const noRun = await run(['ledger', 'append', '--workflow', 'kk-itc', '--works-dir', works], {
            KK_SPUR_BIN: stub,
        });
        expect(noRun.code).not.toBe(0);
        const noWorkflow = await run(['ledger', 'sync', '--works-dir', works], { KK_SPUR_BIN: stub });
        expect(noWorkflow.code).not.toBe(0);
        expect(existsSync(join(works, 'kk-itc/ledger.md'))).toBe(false);
    });
});
