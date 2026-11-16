/**
 * Failure-first contract for the kk checkout-vs-install section of `bun run tools:fresh`
 * (incident 2026-11-16: commit 5fd38638 changed `plugins/kk/scripts/daily-stages.ts`, the install
 * was never re-synced, and the 04:30 `kk news generate` tick was refused with exit 5).
 *
 * Ways this report can betray the operator — each one is a case below:
 *  1. identical trees report a divergence (a guard that cries wolf gets ignored);
 *  2. the same relative path with different content is not reported (the actual incident);
 *  3. a file present only in the checkout — the NEW stage body — is not reported;
 *  4. a file present only in the install is not reported;
 *  5. `.DS_Store`/editor debris or a stray run log is reported as a divergence;
 *  6. `installRootOf` trusts a shim: a `kk` binary belonging to another package resolves to a root
 *     that is not the kk package, so the report compares the wrong tree;
 *  7. the same install reached through several PATH entries is counted as a second install.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installRootOf, kkDivergenceWarnings, kkInstallRoots, main, treeDiffs } from '../check-tool-freshness';

const dirs: string[] = [];

function tempDir(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-freshness-')));
    dirs.push(dir);
    return dir;
}

function write(base: string, rel: string, content: string): void {
    mkdirSync(join(base, rel, '..'), { recursive: true });
    writeFileSync(join(base, rel), content);
}

/** A package root shaped like an installed `kk`: `<root>/package.json` + `<root>/dist/index.js`. */
function fakeInstall(name: string): string {
    const root = join(tempDir(), 'pkg');
    write(root, 'package.json', JSON.stringify({ name }));
    write(root, 'dist/index.js', 'console.log("kk");\n');
    write(root, 'dist/kk', '#!/bin/sh\necho kk\n');
    chmodSync(join(root, 'dist/index.js'), 0o755);
    chmodSync(join(root, 'dist/kk'), 0o755);
    return root;
}

afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('treeDiffs', () => {
    it('reports nothing when the two trees are identical', () => {
        const checkout = tempDir();
        const install = tempDir();
        write(checkout, 'plugins/kk/scripts/daily-stages.ts', 'export const a = 1;\n');
        write(install, 'plugins/kk/scripts/daily-stages.ts', 'export const a = 1;\n');
        expect(treeDiffs(checkout, install)).toEqual([]);
    });

    it('reports the relative path when a file matches by name but not by content', () => {
        const checkout = tempDir();
        const install = tempDir();
        write(checkout, 'daily-stages.ts', 'export const ladder = 119;\n');
        write(install, 'daily-stages.ts', 'export const ladder = 0;\n');
        expect(treeDiffs(checkout, install)).toEqual(['daily-stages.ts']);
    });

    it('reports a checkout-only file — the stage body the install never received', () => {
        const checkout = tempDir();
        const install = tempDir();
        write(checkout, 'daily-stages.ts', 'export const a = 1;\n');
        expect(treeDiffs(checkout, install)).toEqual(['daily-stages.ts']);
    });

    it('reports an install-only file, so a removed script is not silently skipped', () => {
        const checkout = tempDir();
        const install = tempDir();
        write(install, 'retired-stage.ts', 'export const gone = true;\n');
        expect(treeDiffs(checkout, install)).toEqual(['retired-stage.ts']);
    });

    it('ignores dotfiles and run logs, which never reach the install', () => {
        const checkout = tempDir();
        const install = tempDir();
        write(checkout, '.DS_Store', 'noise');
        write(checkout, 'run.log', 'noise');
        write(checkout, 'daily-stages.ts', 'same\n');
        write(install, 'daily-stages.ts', 'same\n');
        expect(treeDiffs(checkout, install)).toEqual([]);
    });

    it('treats a missing directory on either side as empty rather than throwing', () => {
        const root = tempDir();
        expect(treeDiffs(join(root, 'absent'), root)).toEqual([]);
    });
});

describe('installRootOf', () => {
    it('resolves the package root that owns <root>/dist/index.js', () => {
        const root = fakeInstall('@gobing-ai/knowledge-kit');
        expect(installRootOf(join(root, 'dist/index.js'))).toBe(root);
    });

    it('refuses a binary that belongs to another package instead of comparing the wrong tree', () => {
        const root = fakeInstall('some-other-tool');
        expect(installRootOf(join(root, 'dist/index.js'))).toBeNull();
    });

    it('returns null for a path that does not exist', () => {
        expect(installRootOf(join(tempDir(), 'nope', 'dist', 'index.js'))).toBeNull();
    });
});

describe('kkInstallRoots', () => {
    it('counts one install once, however many PATH entries point at it', () => {
        const root = fakeInstall('@gobing-ai/knowledge-kit');
        const bin = join(root, 'dist/index.js');
        const link = join(tempDir(), 'kk');
        symlinkSync(bin, link);
        expect(kkInstallRoots([bin, link])).toEqual([root]);
    });
});

describe('kkDivergenceWarnings', () => {
    it('names a missing install without comparing paths', () => {
        expect(kkDivergenceWarnings(tempDir(), null)).toEqual([
            'kk not found on PATH (or not an installed @gobing-ai/knowledge-kit package)',
        ]);
    });

    it('names every drifted stage tree and the exact sync command', () => {
        const checkout = tempDir();
        const install = fakeInstall('@gobing-ai/knowledge-kit');
        write(checkout, 'plugins/kk/scripts/daily-stages.ts', 'new\n');
        write(install, 'plugins/kk/scripts/daily-stages.ts', 'old\n');
        write(checkout, 'plugins/kk/workflows/new.yaml', 'kind: dag\n');
        expect(kkDivergenceWarnings(checkout, install)).toEqual([
            `checkout diverges from installed kk (${install}): plugins/kk/workflows/new.yaml, plugins/kk/scripts/daily-stages.ts`,
            `  the scheduled run refuses (exit 5) until these are synced: rsync -a plugins/kk/scripts/ "${install}/plugins/kk/scripts/" && rsync -a plugins/kk/workflows/ "${install}/plugins/kk/workflows/"`,
        ]);
    });

    it('returns no warning when the installed trees match', () => {
        const checkout = tempDir();
        const install = fakeInstall('@gobing-ai/knowledge-kit');
        write(checkout, 'plugins/kk/scripts/daily-stages.ts', 'same\n');
        write(install, 'plugins/kk/scripts/daily-stages.ts', 'same\n');
        expect(kkDivergenceWarnings(checkout, install)).toEqual([]);
    });

    it('returns null for a malformed package manifest', () => {
        const root = tempDir();
        write(root, 'package.json', '{not json');
        write(root, 'dist/index.js', '');
        expect(installRootOf(join(root, 'dist/index.js'))).toBeNull();
    });
});

function executable(path: string, body: string): void {
    write(path, '', body);
    chmodSync(path, 0o755);
}

function fakeNpm(version: string): string {
    const dir = tempDir();
    executable(join(dir, 'npm'), `#!/bin/sh\necho '${version}'\n`);
    return dir;
}

function runMain(argv: string[], checkoutRoot: string, path: string): { code: number; output: string } {
    const previousPath = process.env.PATH;
    const previousLog = console.log;
    const lines: string[] = [];
    process.env.PATH = path;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(' '));
    try {
        return { code: main(argv, checkoutRoot), output: lines.join('\n') };
    } finally {
        console.log = previousLog;
        process.env.PATH = previousPath;
    }
}

describe('main', () => {
    it('reports missing tools and makes only --strict fail', () => {
        const empty = tempDir();
        const checkout = tempDir();
        const path = `${empty}:/usr/bin:/bin`;
        const relaxed = runMain([], checkout, path);
        expect(relaxed.code, relaxed.output).toBe(0);
        expect(relaxed.output).toContain('spur: resolved not found');
        expect(relaxed.output).toContain('superskill: resolved not found');
        expect(relaxed.output).toContain('kk: install unresolved');
        expect(runMain(['--strict'], checkout, path).code).toBe(1);
    });

    it('warns on stale shadows, old npm versions, multiple installs, and checkout drift', () => {
        const old = tempDir();
        const current = tempDir();
        for (const [dir, version] of [
            [old, '1.0.0'],
            [current, '2.0.0'],
        ] as const) {
            executable(join(dir, 'spur'), `#!/bin/sh\necho '${version}'\n`);
            executable(join(dir, 'superskill'), `#!/bin/sh\necho '${version}'\n`);
        }
        const npm = fakeNpm('3.0.0');
        const installA = fakeInstall('@gobing-ai/knowledge-kit');
        const installB = fakeInstall('@gobing-ai/knowledge-kit');
        const checkout = tempDir();
        write(checkout, 'plugins/kk/scripts/daily-stages.ts', 'new\n');
        write(installA, 'plugins/kk/scripts/daily-stages.ts', 'old\n');
        write(installB, 'plugins/kk/scripts/daily-stages.ts', 'new\n');
        const result = runMain(
            ['--strict'],
            checkout,
            `${old}:${current}:${npm}:${installA}/dist:${installB}/dist:/usr/bin:/bin`,
        );
        expect(result.code).toBe(1);
        expect(result.output).toContain('stale shadow');
        expect(result.output).toContain('behind npm latest 3.0.0');
        expect(result.output).toContain('checkout diverges from installed kk');
        expect(result.output).toContain('2 installs on PATH');
    });

    it('returns zero when every tool is current and the install is clean', () => {
        const tools = tempDir();
        executable(join(tools, 'spur'), '#!/bin/sh\necho 3.0.0\n');
        executable(join(tools, 'superskill'), '#!/bin/sh\necho 3.0.0\n');
        const npm = fakeNpm('3.0.0');
        const install = fakeInstall('@gobing-ai/knowledge-kit');
        const checkout = tempDir();
        write(checkout, 'plugins/kk/scripts/daily-stages.ts', 'same\n');
        write(install, 'plugins/kk/scripts/daily-stages.ts', 'same\n');
        const result = runMain(['--strict'], checkout, `${tools}:${npm}:${install}/dist:/usr/bin:/bin`);
        expect(result.code).toBe(0);
        expect(result.output).not.toContain('WARN');
    });
});
