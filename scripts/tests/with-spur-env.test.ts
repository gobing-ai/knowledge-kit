/**
 * Failure-first contract for the global-Spur environment adapter.
 *
 * Failure matrix:
 * 1. no child command must return a usage error instead of silently succeeding;
 * 2. a missing global `spur` must fail closed rather than passing an incomplete NODE_PATH;
 * 3. the active Spur package must resolve through the child environment;
 * 4. the adapter must preserve the child's non-zero exit code.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../..');
const SCRIPT = join(REPO, 'scripts/with-spur-env.ts');

interface ChildResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

function run(args: string[], env: Record<string, string> = {}): ChildResult {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: REPO,
        env: { ...process.env, ...env },
        encoding: 'utf-8',
        maxBuffer: 1_000_000,
    });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

describe('with-spur-env', () => {
    it('rejects a missing child command with usage status 2', () => {
        const result = run([]);
        expect(result.status).toBe(2);
        expect(result.stderr).toContain('usage: bun scripts/with-spur-env.ts');
    });

    it('fails closed when the global Spur binary is unavailable', () => {
        const emptyPath = mkdtempSync(join(tmpdir(), 'kk-with-spur-env-'));
        try {
            const result = run(['--', process.execPath, '-e', 'process.exit(0)'], { PATH: emptyPath });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('cannot resolve `spur` on PATH');
        } finally {
            rmSync(emptyPath, { recursive: true, force: true });
        }
    });

    it('injects the active Spur package and forwards the child exit code', () => {
        const result = run([
            '--',
            process.execPath,
            '-e',
            "console.log(import.meta.resolve('@gobing-ai/spur/package.json')); process.exit(7)",
        ]);
        expect(result.status).toBe(7);
        expect(result.stdout).toContain('@gobing-ai/spur/package.json');
    });
});
