/**
 * Failure-first contract for the global-Spur environment adapter.
 *
 * Failure matrix:
 * 1. no child command must return a usage error instead of silently succeeding;
 * 2. a missing global `spur` must fail closed rather than passing an incomplete NODE_PATH;
 * 3. the active Spur package must resolve through the child environment — for a published install
 *    AND for a source checkout whose `spur` on PATH is a working copy;
 * 4. the adapter must preserve the child's non-zero exit code;
 * 5. a directory that carries no `@gobing-ai/spur` manifest, or one whose install link is missing,
 *    must fail closed with the reason named.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { packageNameOf, SPUR_PACKAGE, spurModulesOf, spurPackageRootOf } from '../spur-env';

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

/** A throwaway directory tree; `files` maps a relative path to its content. */
function fixture(files: Record<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'kk-spur-env-'));
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), body);
    }
    return root;
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
            // `require.resolve` honours NODE_PATH, which is exactly what the adapter injects;
            // `import.meta.resolve` does not exist under `bun -e`.
            "console.log(require(require.resolve('@gobing-ai/spur/package.json')).name);" + 'process.exit(7)',
        ]);
        expect(result.status).toBe(7);
        expect(result.stdout.trim()).toBe(SPUR_PACKAGE);
    });
});

describe('spur-env resolution', () => {
    it('reads a manifest name and tolerates a missing or malformed one', () => {
        const hover = fixture({ 'package.json': '{"name":"@gobing-ai/spur","version":"0.0.0"}' });
        const broken = fixture({ 'package.json': '{not-json' });
        const empty = fixture({ 'README.md': 'no manifest\n' });
        try {
            expect(packageNameOf(hover)).toBe(SPUR_PACKAGE);
            expect(packageNameOf(broken)).toBeUndefined();
            expect(packageNameOf(empty)).toBeUndefined();
        } finally {
            for (const dir of [hover, broken, empty]) rmSync(dir, { recursive: true, force: true });
        }
    });

    it('finds an installed package by the manifest name and its sibling node_modules', () => {
        const root = fixture({
            'node_modules/@gobing-ai/spur/package.json': '{"name":"@gobing-ai/spur"}',
            'node_modules/@gobing-ai/spur/spur.js': '#!/usr/bin/env bun\n',
        });
        try {
            const packageRoot = spurPackageRootOf(join(root, 'node_modules', '@gobing-ai', 'spur'));
            expect(packageRoot).toBe(join(root, 'node_modules', '@gobing-ai', 'spur'));
            expect(spurModulesOf(packageRoot as string)).toBe(join(root, 'node_modules'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('finds a source checkout through its workspace self-link', () => {
        // `spur` on PATH is `<repo>/apps/cli/spur.js`; the self-link is what carries the schemas.
        const root = fixture({
            'apps/cli/package.json': '{"name":"@gobing-ai/spur"}',
            'apps/cli/spur.js': '#!/usr/bin/env bun\n',
            'node_modules/@gobing-ai/spur/package.json': '{"name":"@gobing-ai/spur"}',
        });
        try {
            const packageRoot = spurPackageRootOf(join(root, 'apps', 'cli'));
            expect(packageRoot).toBe(join(root, 'apps', 'cli'));
            expect(spurModulesOf(packageRoot as string)).toBe(join(root, 'node_modules'));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('names the failure when a checkout has no install link', () => {
        const root = fixture({ 'apps/cli/package.json': '{"name":"@gobing-ai/spur"}' });
        try {
            const packageRoot = spurPackageRootOf(join(root, 'apps', 'cli')) as string;
            expect(spurModulesOf(packageRoot)).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not adopt an unrelated package as spur', () => {
        const root = fixture({ 'apps/cli/package.json': '{"name":"@gobing-ai/other"}' });
        try {
            expect(spurPackageRootOf(join(root, 'apps', 'cli'))).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
