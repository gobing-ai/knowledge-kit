import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    collectTriage,
    findNestedRuns,
    parseTrace,
    suggestionsFor,
    summarizeTriage,
} from '../../../plugins/kk/scripts/daily-triage-core';

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
                workflow: 'kk-daily-ai-voice3',
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
            workflow: 'kk-daily-ai-voice3',
        });
        const lines = summarizeTriage(report);
        expect(lines.length).toBe(5);
        expect(lines[0]).toContain('trigger: failed (exit 1)');
        expect(lines[2]).toContain('failed node: not identified');
        expect(lines[3]).toBe('nested: none');
        expect(lines[4]).toContain('suggestion:');
    });

    it('CLI — --latest exit 0 against the real checkout (trace found, receipt may be missing)', () => {
        const res = spawnSync(
            'bun',
            [resolve(import.meta.dir, '../../../plugins/kk/scripts/daily-triage.ts'), '--latest', '--json'],
            { cwd: resolve(import.meta.dir, '../../..'), encoding: 'utf-8' },
        );
        expect(res.status).toBe(0);
        const parsed = JSON.parse(res.stdout ?? '{}') as { runId?: string; receipt?: { status?: string } | null };
        expect(typeof parsed.runId === 'string' || parsed.runId === null).toBe(true);
    });
});
