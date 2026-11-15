import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    collectTriage,
    findNestedRuns,
    findReceiptByRunId,
    gitDirtyPaths,
    latestFailedRun,
    parseTrace,
    suggestionsFor,
    summarizeTriage,
    type TriageReport,
} from '../scripts/daily-triage-core';

/**
 * 0347 F2/F3 (2026-11-10) — the triage collector an operator (and the scheduler's failure path)
 * reads before deep-diving a dead daily run. Fixtures replicate the observed layouts from the
 * 2026-11-09 double failure: `spur workflow trace --json` events, nested `.spur/memory/runs`
 * state files with per-node receipts, and the escalation decision file.
 */
describe('daily-triage (0347 F2/F3)', () => {
    const startedAt = '2026-11-09T11:35:00.000Z';
    const finalizedAt = '2026-11-09T12:55:00.000Z';

    it('parseTrace — extracts the LAST failed action, skips done/skipped, tolerates garbage', () => {
        const payload = JSON.stringify({
            run: { workflowName: 'kk-news-generate', status: 'failed', startedAt, finalizedAt },
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
        expect(parsed.workflow).toBe('kk-news-generate');
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
        const nestedId = 'f4efcff1-3e37-41e6-8f3a-7631cd9e493e';
        const receipts = join(repo, '.spur', 'run', nestedId, 'receipts');
        mkdirSync(receipts, { recursive: true });
        writeFileSync(
            join(runsDir, `${nestedId}.state.json`),
            JSON.stringify({
                runId: nestedId,
                workflowName: 'kk-daily-safety',
                status: 'failed',
                terminalState: 'block',
                startedAt: '2026-11-09T11:36:00.000Z',
                finalizedAt: '2026-11-09T12:55:00.000Z',
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
        const nested = findNestedRuns(
            runsDir,
            { runId: 'daily-ai-voice-20261109-1794236645571', startedAt, finalizedAt },
            new Set(['kk-daily-safety']),
        );
        expect(nested.length).toBe(1);
        expect(nested[0]?.runId).toBe(nestedId);
        expect(nested[0]?.terminalState).toBe('block');
        expect(nested[0]?.receipts.filter((receipt) => receipt.ok).length).toBe(1);
        expect(nested[0]?.receipts.length).toBe(2);
        rmSync(repo, { recursive: true, force: true });
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
                workflow: 'kk-news-generate',
                path: 'trace.json',
                sha256: 'ab',
                gitDirty: ['plugins/kk/scripts/new.ts'],
            },
        });
        expect(dirty.some((line) => line.includes('commit or stash first'))).toBe(true);
    });

    it('summarizeTriage — five operator lines from a collected report', () => {
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
            workflow: 'kk-news-generate',
        });
        const lines = summarizeTriage(report);
        expect(lines.length).toBe(5);
        expect(lines[0]).toContain('trigger: failed (exit 1)');
        expect(lines[2]).toContain('failed node: not identified');
        expect(lines[3]).toBe('nested: none');
        expect(lines[4]).toContain('suggestion:');
    });

    it('CLI — --latest exit 0 against the real checkout (trace found, receipt may be missing)', () => {
        const res = spawnSync('bun', [resolve(import.meta.dir, '../scripts/daily-triage.ts'), '--latest', '--json'], {
            cwd: resolve(import.meta.dir, '../..'),
            encoding: 'utf-8',
        });
        const text = (res.stdout ?? '').trim();
        expect(res.status).toBe(0);
        // The checkout's works root state varies (a failed run may or may not exist).
        if (text.startsWith('{')) {
            const parsed = JSON.parse(text) as { runId?: string; receipt?: { status?: string } | null };
            expect(typeof parsed.runId === 'string' || parsed.runId === null).toBe(true);
        } else {
            expect(text).toContain('nothing to triage');
        }
    });

    // Coverage-gap suite: the paths below were only reachable when the collector actually ran
    // against a real failed run. A PATH shim for `spur` replays the observed trace payload.
    const shimDir = (repo: string): NodeJS.ProcessEnv => {
        const bin = join(repo, 'bin');
        mkdirSync(bin, { recursive: true });
        const shim = join(bin, 'spur');
        writeFileSync(shim, '#!/usr/bin/env bun\nconsole.log(process.env.FAKE_TRACE ?? "{}")\n');
        chmodSync(shim, 0o755);
        return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    };

    it('collectTriage — full happy path with a fake spur: trace, executed digest, nested receipts, escalation', () => {
        const repo = mkdtempSync(join(tmpdir(), 'kk-triage-collect-'));
        const runId = 'daily-ai-voice-20261109-1794292648364';
        const nestedId = '1460a334-e9e9-4398-a0ef-52c455d66063';
        mkdirSync(join(repo, 'plugins', 'kk', 'workflows'), { recursive: true });
        writeFileSync(join(repo, 'plugins', 'kk', 'workflows', 'kk-news-generate.yaml'), 'nodes: []\n');
        const receipts = join(repo, '.spur', 'run', nestedId, 'receipts');
        mkdirSync(receipts, { recursive: true });
        writeFileSync(
            join(repo, '.spur', 'run', `${runId}-escalation.json`),
            JSON.stringify({
                trigger: 'timed-out',
                decision: { kind: 'retry', reason: 'executor outage' },
                createdAt: finalizedAt,
            }),
        );
        const runsDir = join(repo, '.spur', 'memory', 'runs');
        mkdirSync(runsDir, { recursive: true });
        writeFileSync(
            join(runsDir, `${nestedId}.state.json`),
            JSON.stringify({
                runId: nestedId,
                workflowName: 'kk-daily-safety',
                status: 'done',
                terminalState: 'done',
                startedAt: '2026-11-09T11:36:00.000Z',
                finalizedAt: '2026-11-09T12:00:00.000Z',
            }),
        );
        writeFileSync(join(receipts, 'review.json'), JSON.stringify({ outcome: 'succeeded' }));
        writeFileSync(join(receipts, 'judge-primary.json'), JSON.stringify({ outcome: 'failed', reason: '429 quota' }));
        const trace = JSON.stringify({
            run: { workflowName: 'kk-news-generate', status: 'failed', startedAt, finalizedAt },
            events: [
                {
                    kind: 'action',
                    node: 'generate',
                    status: 'failed',
                    completedAt: finalizedAt,
                    error: 'kk-daily-safety.yaml exited 1',
                },
            ],
        });
        const env = shimDir(repo);
        env.FAKE_TRACE = trace;
        const report = collectTriage(repo, runId, {
            env,
            receipt: {
                status: 'timed-out',
                startedAt,
                completedAt: finalizedAt,
                workDir: '/w',
                agent: 'pi-dsv4.1-flash-volc',
                exitCode: 124,
                error: 'timeout after 2700000ms',
            },
        });
        expect(report.executed?.workflow).toBe('kk-news-generate');
        expect(report.executed?.sha256).toBeString();
        expect(report.failedNode?.id).toBe('generate');
        expect(report.nestedRuns.length).toBe(1);
        expect(report.nestedRuns[0]?.receipts.length).toBe(2);
        expect(report.escalation?.decision).toBe('retry');
        const lines = summarizeTriage(report);
        expect(lines[1]).toContain('executed: kk-news-generate sha256=');
        expect(lines[2]).toContain('failed node: generate (failed)');
        expect(lines[3]).toContain('kk-daily-safety:done receipts 1/2 ok');
        rmSync(repo, { recursive: true, force: true });
    });

    it('receipt discovery — findReceiptByRunId walks stamps newest-first, latestFailedRun ranks by completedAt', () => {
        const repo = mkdtempSync(join(tmpdir(), 'kk-triage-stamps-'));
        const write = (stamp: string, receipt: Record<string, unknown>): void => {
            const dir = join(repo, '.works', 'kk-daily-ai-voice2', stamp);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'schedule-receipt.json'), JSON.stringify(receipt));
        };
        write('20261108', { runId: 'older-run', status: 'failed', completedAt: '2026-11-08T12:00:00.000Z' });
        write('20261109', { runId: 'newer-run', status: 'timed-out', completedAt: '2026-11-09T12:00:00.000Z' });
        expect(findReceiptByRunId(repo, 'newer-run')).toContain('20261109');
        expect(findReceiptByRunId(repo, 'missing-run')).toBeNull();
        const latest = latestFailedRun(repo);
        expect(latest?.runId).toBe('newer-run');
        // done/no-content receipts are good, not triage candidates.
        write('20261110', { runId: 'good-run', status: 'done', completedAt: '2026-11-10T12:00:00.000Z' });
        expect(latestFailedRun(repo)?.runId).toBe('newer-run');
        // Garbage receipt files and a missing works root never throw.
        writeFileSync(join(repo, '.works', 'kk-daily-ai-voice2', '20261110', 'schedule-receipt.json'), 'not json');
        expect(latestFailedRun(repo)?.runId).toBe('newer-run');
        expect(latestFailedRun(join(repo, 'nowhere'))).toBeNull();
        expect(findReceiptByRunId(join(repo, 'nowhere'), 'x')).toBeNull();
        // 0369 AC5: runs of the configured news workflow are found beside the pre-cut-over directory.
        const writeNews = (workflow: string, stamp: string, receipt: Record<string, unknown>): void => {
            const dir = join(repo, '.works', workflow, stamp);
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'schedule-receipt.json'), JSON.stringify(receipt));
        };
        const savedConfig = process.env.KK_CONFIG;
        try {
            process.env.KK_CONFIG = join(repo, 'absent.yaml');
            writeNews('kk-news-generate', '20261111', {
                runId: 'cutover-run',
                status: 'failed',
                finishedAt: '2026-11-11T12:00:00.000Z',
            });
            expect(latestFailedRun(repo)?.runId).toBe('cutover-run');
            expect(findReceiptByRunId(repo, 'cutover-run')).toContain(join('kk-news-generate', '20261111'));
            expect(findReceiptByRunId(repo, 'newer-run')).toContain(join('kk-daily-ai-voice2', '20261109'));
            process.env.KK_CONFIG = join(repo, 'config.yaml');
            writeFileSync(process.env.KK_CONFIG, 'content_types:\n  news:\n    workflow: my-news\n');
            writeNews('my-news', '20261112', { runId: 'custom-run', status: 'failed' });
            expect(findReceiptByRunId(repo, 'custom-run')).toContain(join('my-news', '20261112'));
            expect(findReceiptByRunId(repo, 'cutover-run')).toBeNull();
        } finally {
            if (savedConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = savedConfig;
        }
        // collectTriage without opts.receipt discovers it from the stamps walk instead.
        const discovered = collectTriage(repo, 'newer-run');
        expect(discovered.receipt?.status).toBe('timed-out');
        expect(summarizeTriage(discovered)[0]).toContain('trigger: timed-out');
        rmSync(repo, { recursive: true, force: true });
    });

    it('guards — trace events without a node id are skipped; empty report suggests inspection', () => {
        expect(parseTrace(JSON.stringify({ events: [{ kind: 'action', status: 'failed' }] })).failedNode).toBeNull();
        const empty: Omit<TriageReport, 'suggestions' | 'collectedAt' | 'runId'> = {
            receipt: null,
            executed: null,
            failedNode: null,
            nestedRuns: [],
            escalation: null,
        };
        expect(suggestionsFor(empty)[0]).toContain('inspect the failed node stderr');
    });

    it('helpers — executor-outage suggestion, missing runs dir, partial-stderr tail, git parse, unreadable workflow', () => {
        // suggestionsFor: quota regex misses but "exhausted" hits the executor-outage branch.
        const outage = suggestionsFor({
            receipt: null,
            executed: null,
            failedNode: { id: 'curate', status: 'failed', stderrTail: 'agent run exhausted; exit code 3' },
            nestedRuns: [],
            escalation: null,
        });
        expect(outage[0]).toContain('agent executor outage');
        // findNestedRuns: a missing runs dir is an empty result, never a throw.
        expect(findNestedRuns('/definitely/not/there', { runId: 'x' })).toEqual([]);

        const repo = mkdtempSync(join(tmpdir(), 'kk-triage-helpers-'));
        // gitDirtyPaths: a real git repo with one dirty harness path parses the porcelain lines.
        spawnSync('git', ['init', '-q', repo]);
        mkdirSync(join(repo, 'plugins', 'kk'), { recursive: true });
        writeFileSync(join(repo, 'plugins', 'kk', 'dirty.ts'), 'export {};\n');
        const dirty = gitDirtyPaths(repo);
        expect(dirty.length).toBe(1);
        expect(dirty[0]).toContain('plugins/kk');

        // traceStderrTail via collectTriage: a failed node without stderr falls back to the
        // partial file (ANSI stripped, tail-truncated); no partial file yields undefined and
        // exercises the readText miss.
        const workflows = join(repo, 'plugins', 'kk', 'workflows');
        mkdirSync(workflows, { recursive: true });
        writeFileSync(join(workflows, 'kk-news-generate.yaml'), 'nodes: []\n');
        mkdirSync(join(repo, '.spur', 'run'), { recursive: true });
        writeFileSync(join(repo, '.spur', 'run', 'run-p1-generate-partial.md'), '\u001b[31mboom\u001b[0m\n');
        const trace = (): string =>
            JSON.stringify({
                run: { workflowName: 'kk-news-generate', status: 'failed' },
                events: [{ kind: 'action', node: 'generate', status: 'failed' }],
            });
        const env: NodeJS.ProcessEnv = { ...process.env };
        const bin = join(repo, 'bin2');
        mkdirSync(bin, { recursive: true });
        const shim = join(bin, 'spur');
        writeFileSync(shim, '#!/usr/bin/env bun\nconsole.log(process.env.FAKE_TRACE ?? "{}")\n');
        chmodSync(shim, 0o755);
        env.PATH = `${bin}:${env.PATH}`;
        env.FAKE_TRACE = trace();
        const withPartial = collectTriage(repo, 'run-p1', { env });
        expect(withPartial.failedNode?.stderrTail).toBe('boom');
        env.FAKE_TRACE = trace();
        const withoutPartial = collectTriage(repo, 'run-p2', { env });
        expect(withoutPartial.failedNode?.stderrTail).toBeUndefined();

        // sha256File: a workflow "file" that is a directory fails the read and hashes to null.
        rmSync(join(workflows, 'kk-news-generate.yaml'));
        mkdirSync(join(workflows, 'kk-news-generate.yaml'));
        env.FAKE_TRACE = trace();
        expect(collectTriage(repo, 'run-p3', { env }).executed?.sha256).toBeNull();
        rmSync(repo, { recursive: true, force: true });
    });
});
