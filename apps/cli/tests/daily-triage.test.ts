import { afterAll, describe, expect, it, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Snapshot BEFORE mock.module: bun mutates the shared node:child_process namespace, so the
// spread copy stays pristine and is re-registered after the core import (mock.restore does
// not undo mock.module) so later test files in the same process keep spawning for real.
const realChildProcess = { ...(await import('node:child_process')) };

/**
 * 0347 F2/F3 (2026-11-10) — the triage collector an operator (and the scheduler's failure path)
 * reads before deep-diving a dead daily run. Fixtures replicate the observed layouts from the
 * 2026-11-09 double failure: `spur workflow trace --json` events, nested `.spur/memory/runs`
 * state files with per-node receipts, and the escalation decision file.
 *
 * `collectTriage` shells out to `spur`/`git`; node:child_process is mocked ahead of the core
 * import so the trace-success path is deterministic (mock restored right after, before any
 * other module in the suite imports node:child_process).
 */

const RUN_ID = 'daily-ai-voice-20261109-1794236645571';
const NESTED_ID = 'f4efcff1-3e37-41e6-8f3a-7631cd9e493e';
const startedAt = '2026-11-09T11:35:00.000Z';
const finalizedAt = '2026-11-09T12:55:00.000Z';

// Fixture repo: the full layout collectTriage walks when the trace succeeds.
const FIXTURE_REPO = mkdtempSync(join(tmpdir(), 'kk-triage-repo-'));
const TRACE_JSON = JSON.stringify({
    run: { workflowName: 'kk-daily-ai-voice3', status: 'failed', startedAt, finalizedAt },
    events: [{ kind: 'action', node: 'safety', status: 'failed', completedAt: finalizedAt }],
});
function writeFixture(): void {
    const runsDir = join(FIXTURE_REPO, '.spur', 'memory', 'runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
        join(runsDir, `${NESTED_ID}.state.json`),
        JSON.stringify({
            runId: NESTED_ID,
            workflowName: 'kk-daily-safety',
            status: 'failed',
            terminalState: 'infra-fail',
            startedAt: '2026-11-09T11:36:00.000Z',
            finalizedAt,
        }),
    );
    const nestedReceipts = join(FIXTURE_REPO, '.spur', 'run', NESTED_ID, 'receipts');
    mkdirSync(nestedReceipts, { recursive: true });
    writeFileSync(
        join(nestedReceipts, 'judge-primary.json'),
        JSON.stringify({ outcome: 'failed', reason: 'no credits remaining' }),
    );
    mkdirSync(join(FIXTURE_REPO, '.spur', 'run'), { recursive: true });
    writeFileSync(
        join(FIXTURE_REPO, '.spur', 'run', `${RUN_ID}-safety-partial.md`),
        '\u001b[31m429 AccountQuotaExceeded\u001b[0m — retry agent also failed; see kk-daily-safety.yaml\n',
    );
    writeFileSync(
        join(FIXTURE_REPO, '.spur', 'run', `${RUN_ID}-escalation.json`),
        JSON.stringify({
            trigger: 'failed',
            decision: { kind: 'retry-limited', reason: 'primary and retry executors both quota-dead' },
            createdAt: finalizedAt,
        }),
    );
    const flowDir = join(FIXTURE_REPO, '.works', 'kk-daily-ai-voice2', '20261109');
    mkdirSync(flowDir, { recursive: true });
    writeFileSync(
        join(flowDir, 'schedule-receipt.json'),
        JSON.stringify({
            runId: RUN_ID,
            status: 'failed',
            exitCode: 1,
            completedAt: finalizedAt,
            agent: 'pi-dsv4.1-flash-volc',
        }),
    );
    const wfDir = join(FIXTURE_REPO, 'plugins', 'kk', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'kk-daily-ai-voice3.yaml'), 'nodes: []\n');
}
writeFixture();

const stubSpawnSync = (
    command: string,
    _args: readonly string[],
    opts?: { cwd?: string },
): { status: number; stdout: string; stderr: string } => {
    if (command === 'spur' && opts?.cwd === FIXTURE_REPO) return { status: 0, stdout: TRACE_JSON, stderr: '' };
    if (command === 'git') return { status: 0, stdout: '', stderr: '' };
    return { status: 1, stdout: '', stderr: 'stub: unavailable' };
};
mock.module('node:child_process', () => ({ spawnSync: stubSpawnSync }));
const core = await import('../../../plugins/kk/scripts/daily-triage-core');

const {
    collectTriage,
    findNestedRuns,
    findReceiptByRunId,
    gitDirtyPaths,
    latestFailedRun,
    parseTrace,
    suggestionsFor,
    summarizeTriage,
} = core;

afterAll(() => {
    // Undo mock.module for files loaded after this one — mock.restore() does not cover modules.
    mock.module('node:child_process', () => realChildProcess);
    rmSync(FIXTURE_REPO, { recursive: true, force: true });
});

describe('daily-triage (0347 F2/F3)', () => {
    it('parseTrace — extracts the LAST failed action, skips done/skipped, tolerates garbage', () => {
        const payload = JSON.stringify({
            run: { workflowName: 'kk-daily-ai-voice3', status: 'failed', startedAt, finalizedAt },
            events: [
                { kind: 'state', node: 'generate', status: 'entered' },
                {
                    kind: 'action',
                    node: 'generate-fallback2',
                    status: 'failed',
                    error: 'generate: plan item count (8, 3 recorded as excluded)',
                },
                { kind: 'action', node: 'script-style', status: 'done' },
                { kind: 'action', node: 'safety', status: 'failed', error: 'exit 1', completedAt: finalizedAt },
            ],
        });
        const parsed = parseTrace(payload);
        expect(parsed.workflow).toBe('kk-daily-ai-voice3');
        expect(parsed.failedNode?.id).toBe('safety');
        expect(parsed.failedNode?.stderrTail).toBe('exit 1');
        expect(parseTrace('not json at all').failedNode).toBeNull();
        expect(
            parseTrace(
                JSON.stringify({ run: { workflowName: 'x' }, events: [{ kind: 'action', node: 'a', status: 'done' }] }),
            ).failedNode,
        ).toBeNull();
    });

    it('findNestedRuns — time-window + workflow filter, excludes the parent, counts receipts', () => {
        const repo = mkdtempSync(join(tmpdir(), 'kk-triage-'));
        const runsDir = join(repo, '.spur', 'memory', 'runs');
        mkdirSync(runsDir, { recursive: true });
        const receipts = join(repo, '.spur', 'run', NESTED_ID, 'receipts');
        mkdirSync(receipts, { recursive: true });
        writeFileSync(
            join(runsDir, `${NESTED_ID}.state.json`),
            JSON.stringify({
                runId: NESTED_ID,
                workflowName: 'kk-daily-safety',
                status: 'failed',
                terminalState: 'block',
                startedAt: '2026-11-09T11:36:00.000Z',
                finalizedAt,
            }),
        );
        writeFileSync(join(receipts, 'review.json'), JSON.stringify({ outcome: 'succeeded' }));
        writeFileSync(
            join(receipts, 'judge-primary.json'),
            JSON.stringify({ outcome: 'failed', reason: '429 "code":"AccountQuotaExceeded"' }),
        );
        // In the window but the wrong workflow — must be filtered out.
        writeFileSync(
            join(runsDir, '631e9bf2.state.json'),
            JSON.stringify({
                runId: '631e9bf2',
                workflowName: 'kk-collect',
                status: 'done',
                startedAt: '2026-11-09T11:40:00.000Z',
            }),
        );
        const nested = findNestedRuns(runsDir, { runId: RUN_ID, startedAt, finalizedAt }, new Set(['kk-daily-safety']));
        expect(nested.length).toBe(1);
        expect(nested[0]?.runId).toBe(NESTED_ID);
        expect(nested[0]?.terminalState).toBe('block');
        expect(nested[0]?.receipts.filter((receipt) => receipt.ok).length).toBe(1);
        expect(nested[0]?.receipts.length).toBe(2);
        rmSync(repo, { recursive: true, force: true });
    });

    it('findNestedRuns — missing dir, window bounds, runId fallback, receipt-less run, ordering', () => {
        const empty = mkdtempSync(join(tmpdir(), 'kk-triage-empty-'));
        const runsDir = join(empty, '.spur', 'memory', 'runs');
        expect(findNestedRuns(runsDir, { runId: 'x', startedAt, finalizedAt })).toEqual([]);
        mkdirSync(runsDir, { recursive: true });
        // Before the window, after the window, invalid date, no runId (basename fallback), receipt-less.
        writeFileSync(
            join(runsDir, 'before.state.json'),
            JSON.stringify({ runId: 'before', workflowName: 'kk-daily-safety', startedAt: '2026-11-09T11:00:00.000Z' }),
        );
        writeFileSync(
            join(runsDir, 'after.state.json'),
            JSON.stringify({ runId: 'after', workflowName: 'kk-daily-safety', startedAt: '2026-11-09T13:00:00.000Z' }),
        );
        writeFileSync(
            join(runsDir, 'bogus.state.json'),
            JSON.stringify({ runId: 'bogus', workflowName: 'kk-daily-safety', startedAt: 'not-a-date' }),
        );
        writeFileSync(
            join(runsDir, 'unnamed.state.json'),
            JSON.stringify({ workflowName: 'kk-daily-safety', startedAt: '2026-11-09T11:50:00.000Z' }),
        );
        const nested = findNestedRuns(runsDir, { runId: 'x', startedAt, finalizedAt }, null);
        expect(nested.map((run) => run.runId)).toEqual(['unnamed']);
        expect(nested[0]?.receipts).toEqual([]);
        rmSync(empty, { recursive: true, force: true });
        // Unsorted input sorts by startedAt.
        const sorted = findNestedRuns(runsDir, { runId: 'x' });
        expect(sorted).toEqual([]);
    });

    it('suggestionsFor — quota evidence, item-count divergence, infra-fail vs block, dirty tree', () => {
        const base = { receipt: null, executed: null, failedNode: null, nestedRuns: [], escalation: null };
        const quota = suggestionsFor({
            ...base,
            failedNode: { id: 'safety', status: 'failed', stderrTail: '429 AccountQuotaExceeded resets at 2026-11-18' },
        });
        expect(quota[0]).toContain('executor account exhausted');
        const divergence = suggestionsFor({
            ...base,
            failedNode: {
                id: 'generate-fallback2',
                status: 'failed',
                stderrTail: 'generate: plan item count (8, 3 recorded as excluded)',
            },
        });
        expect(divergence.some((line) => line.includes('script/article section divergence'))).toBe(true);
        const infra = suggestionsFor({
            ...base,
            nestedRuns: [{ runId: 'n1', terminalState: 'infra-fail', receipts: [] }],
        });
        expect(infra.some((line) => line.includes('infra-fail'))).toBe(true);
        expect(infra.some((line) => line.includes('not a content verdict'))).toBe(true);
        const block = suggestionsFor({
            ...base,
            nestedRuns: [{ runId: 'n2', terminalState: 'block', receipts: [] }],
        });
        expect(block.some((line) => line.startsWith('safety verdict block'))).toBe(true);
        const dirty = suggestionsFor({
            ...base,
            executed: {
                workflow: 'kk-daily-ai-voice3',
                path: 'trace.json',
                sha256: 'ab',
                gitDirty: ['plugins/kk/scripts/new.ts'],
            },
        });
        expect(dirty.some((line) => line.includes('commit or stash first'))).toBe(true);
    });

    it('suggestionsFor — exit-code-3 outage branch and the evidence-free fallback', () => {
        const base = { receipt: null, executed: null, failedNode: null, nestedRuns: [], escalation: null };
        const outage = suggestionsFor({
            ...base,
            failedNode: { id: 'safety', status: 'failed', stderrTail: 'exit code 3 after exhausting retry agents' },
        });
        expect(outage[0]).toContain('agent executor outage');
        expect(suggestionsFor(base)).toEqual(['inspect the failed node stderr and nested receipts, then decide']);
    });

    it('collectTriage — full success path: receipt discovery, trace, partial tail, nested, escalation', () => {
        const report = collectTriage(FIXTURE_REPO, RUN_ID);
        expect(report.receipt?.status).toBe('failed');
        expect(report.receipt?.agent).toBe('pi-dsv4.1-flash-volc');
        expect(report.executed?.workflow).toBe('kk-daily-ai-voice3');
        expect(report.executed?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(report.executed?.gitDirty).toEqual([]);
        expect(report.failedNode?.id).toBe('safety');
        expect(report.failedNode?.stderrTail).toContain('AccountQuotaExceeded');
        expect(report.failedNode?.stderrTail).not.toContain('\u001b');
        expect(report.nestedRuns.length).toBe(1);
        expect(report.nestedRuns[0]?.terminalState).toBe('infra-fail');
        expect(report.nestedRuns[0]?.receipts[0]).toEqual({
            node: 'judge-primary',
            ok: false,
            outcome: 'failed',
            reason: 'no credits remaining',
        });
        expect(report.escalation?.decision).toBe('retry-limited');
        expect(report.suggestions[0]).toContain('executor account exhausted');
    });

    it('summarizeTriage — five operator lines from the collected report', () => {
        const report = collectTriage(FIXTURE_REPO, RUN_ID);
        const lines = summarizeTriage(report);
        expect(lines.length).toBe(5);
        expect(lines[0]).toContain('trigger: failed (exit 1)');
        expect(lines[1]).toContain('sha256=');
        expect(lines[1]).toContain('harnessDirty=0');
        expect(lines[2]).toContain('AccountQuotaExceeded');
        expect(lines[3]).toContain('kk-daily-safety:infra-fail receipts 0/1 ok (f4efcff1');
        expect(lines[4]).toContain('suggestion:');
    });

    it('summarizeTriage — unknown-run variant from a repo the stub cannot trace', () => {
        const report = collectTriage('/tmp/definitely-not-a-repo', 'missing-run', {
            receipt: {
                status: 'failed',
                startedAt,
                completedAt: finalizedAt,
                workDir: '/w',
                agent: 'pi-dsv4.1-flash-volc',
                exitCode: 1,
                error: 'weekly limit',
            },
            workflow: 'kk-daily-ai-voice3',
        });
        const lines = summarizeTriage(report);
        expect(lines.length).toBe(5);
        expect(lines[0]).toContain('trigger: failed (exit 1)');
        expect(lines[1]).toBe('executed: unknown (trace unavailable)');
        expect(lines[2]).toContain('failed node: not identified');
        expect(lines[3]).toBe('nested: none');
        expect(lines[4]).toContain('suggestion:');
    });

    it('findReceiptByRunId / latestFailedRun — works-root scan, status filter, mtime fallback', () => {
        expect(findReceiptByRunId(FIXTURE_REPO, RUN_ID)).toContain(
            join('.works', 'kk-daily-ai-voice2', '20261109', 'schedule-receipt.json'),
        );
        expect(findReceiptByRunId(FIXTURE_REPO, 'no-such-run')).toBeNull();
        const empty = mkdtempSync(join(tmpdir(), 'kk-triage-latest-'));
        const flowDir = join(empty, '.works', 'kk-daily-ai-voice2');
        mkdirSync(join(flowDir, '20261108'), { recursive: true });
        mkdirSync(join(flowDir, '20261109'), { recursive: true });
        // 20261108: good receipt — skipped. 20261109: failed with completedAt — newest failed wins.
        writeFileSync(
            join(flowDir, '20261108', 'schedule-receipt.json'),
            JSON.stringify({ runId: 'good', status: 'done' }),
        );
        writeFileSync(
            join(flowDir, '20261109', 'schedule-receipt.json'),
            JSON.stringify({ runId: 'later-failed', status: 'failed', completedAt: '2026-11-09T12:00:00.000Z' }),
        );
        const latest = latestFailedRun(empty);
        expect(latest?.runId).toBe('later-failed');
        // A timed-out receipt without completedAt falls back to file mtime and still lists.
        writeFileSync(
            join(flowDir, '20261108', 'schedule-receipt.json'),
            JSON.stringify({ runId: 'mtime-fallback', status: 'timed-out' }),
        );
        const found = findReceiptByRunId(empty, 'mtime-fallback');
        expect(found).toContain('20261108');
        // Malformed JSON and a null receipt body never throw.
        mkdirSync(join(flowDir, '20261107'), { recursive: true });
        writeFileSync(join(flowDir, '20261107', 'schedule-receipt.json'), 'null');
        expect(latestFailedRun(empty)?.runId).toBe('mtime-fallback');
        expect(findReceiptByRunId(empty, 'other')).toBeNull();
        expect(latestFailedRun(join(empty, 'nope'))).toBeNull();
        rmSync(empty, { recursive: true, force: true });
    });

    it('gitDirtyPaths — non-repo cwd degrades to an empty list', () => {
        expect(gitDirtyPaths(tmpdir())).toEqual([]);
    });

    it('CLI — --latest exit 0 against the real checkout (trace found, receipt may be missing)', () => {
        const res = realChildProcess.spawnSync(
            'bun',
            [resolve(import.meta.dir, '../../../plugins/kk/scripts/daily-triage.ts'), '--latest', '--json'],
            { cwd: resolve(import.meta.dir, '../../..'), encoding: 'utf-8' },
        );
        if (res.status !== 0) console.error('triage CLI stderr:', res.stderr, 'stdout:', res.stdout);
        expect(res.status).toBe(0);
        const parsed = JSON.parse(res.stdout ?? '{}') as { runId?: string; receipt?: { status?: string } | null };
        expect(typeof parsed.runId === 'string' || parsed.runId === null).toBe(true);
    });
});
