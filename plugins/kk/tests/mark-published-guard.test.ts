import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '../../..');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice2.yaml');
const STAMP = '20261101';
const tempDirs: string[] = [];

interface ShellAction {
    options?: { command?: string };
}

interface DagNode {
    id: string;
    condition?: ShellAction;
    action?: ShellAction;
}

interface DagWorkflow {
    nodes: DagNode[];
}

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

function writeExecutable(path: string, body: string): void {
    writeFileSync(path, `${body}\n`);
    chmodSync(path, 0o755);
}

function authoredMarkPublishedCommands(): { condition: string; action: string } {
    const workflow = Bun.YAML.parse(readFileSync(WORKFLOW, 'utf8')) as DagWorkflow;
    const node = workflow.nodes.find((candidate) => candidate.id === 'mark-published');
    const condition = node?.condition?.options?.command;
    const action = node?.action?.options?.command;
    if (typeof condition !== 'string' || typeof action !== 'string') {
        throw new Error('staged voice2 mark-published node is missing shell condition/action');
    }
    return { condition, action };
}

function substitute(command: string, workDir: string): string {
    return command
        .replaceAll(`\${vars.work_dir}`, workDir)
        .replaceAll(`\${vars.run_date}`, STAMP)
        .replaceAll(`\${vars.publish_enabled}`, 'true')
        .replaceAll(`\${vars.__runId}`, 'guard-test-run');
}

describe('staged voice2 mark-published guard (0338)', () => {
    afterAll(() => {
        for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    });

    it('dispatches settlement only for an exact full publish status', () => {
        const { condition, action } = authoredMarkPublishedCommands();
        for (const status of [null, 'partial', 'none', 'full'] as const) {
            const root = tempDir(`kk-mark-published-guard-${status ?? 'missing'}-`);
            const workDir = join(root, 'work');
            const publishDir = join(workDir, '31-publish');
            mkdirSync(join(workDir, '21-plan'), { recursive: true });
            mkdirSync(publishDir, { recursive: true });
            writeFileSync(
                join(workDir, '21-plan', `${STAMP}_04_quality-control-content_candidates.json`),
                '{"metadata":{"docs":[{"id":"doc-1"}]}}',
            );
            const statusPath = join(publishDir, `${STAMP}_17_publish_publish-status.txt`);
            if (status !== null) writeFileSync(statusPath, `${status}\n`);
            const binDir = join(root, 'bin');
            mkdirSync(binDir, { recursive: true });
            const calls = join(root, 'kk-calls.log');
            writeFileSync(calls, '');
            writeExecutable(join(binDir, 'kk'), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$KK_GUARD_CALLS"\nexit 0');

            const guard = substitute(condition, workDir);
            const settle = substitute(action, workDir);
            const result = Bun.spawnSync(['/bin/sh', '-c', `if ${guard}; then ${settle}; fi`], {
                cwd: root,
                env: {
                    ...process.env,
                    PATH: `${binDir}:${process.env.PATH ?? ''}`,
                    KK_GUARD_CALLS: calls,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            });
            expect(result.exitCode, result.stderr.toString()).toBe(0);
            const invoked = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) : [];
            if (status === 'full') {
                expect(invoked).toHaveLength(2);
                expect(invoked[0]).toContain('store pool-count');
                expect(invoked[1]).toContain('store mark-published');
            } else {
                expect(invoked).toEqual([]);
            }
        }
    });
});
