import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { findPackageRoot, resolvePackageRoot } from '../src/package-root';

const REPO = resolve(import.meta.dir, '../../..');

async function withTempTree(fn: (dir: string) => Promise<void> | void): Promise<void> {
    // Canonical path: process.cwd() after chdir reports /private/var on macOS, not tmpdir()'s /var.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-pkgroot-test-')));
    try {
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('package-root resolution (item 6)', () => {
    const fs = createNodeFileSystem();

    it('findPackageRoot walks up to the nearest directory with the shipped plugins/kk tree', async () => {
        await withTempTree(async (dir) => {
            mkdirSync(join(dir, 'pkg/plugins/kk'), { recursive: true });
            expect(await findPackageRoot(fs, join(dir, 'pkg/nested/deeper'))).toBe(join(dir, 'pkg'));
        });
    });

    it('findPackageRoot returns undefined outside any kk tree', async () => {
        await withTempTree(async (dir) => {
            expect(await findPackageRoot(fs, dir)).toBeUndefined();
        });
    });

    it('resolvePackageRoot walks the cwd tree first (project shadows install)', async () => {
        await withTempTree(async (dir) => {
            const cwd = process.cwd();
            mkdirSync(join(dir, 'tree/plugins/kk'), { recursive: true });
            mkdirSync(join(dir, 'tree/nested'), { recursive: true });
            process.chdir(join(dir, 'tree/nested'));
            try {
                // An unrelated script root would lose against the cwd tree.
                expect(await resolvePackageRoot(fs, join(dir, 'elsewhere'))).toBe(join(dir, 'tree'));
            } finally {
                process.chdir(cwd);
            }
        });
    });

    it('resolvePackageRoot falls back to the script tree when the cwd has no kk tree', async () => {
        await withTempTree(async (dir) => {
            const cwd = process.cwd();
            mkdirSync(join(dir, 'empty'), { recursive: true });
            process.chdir(dir);
            try {
                expect(await resolvePackageRoot(fs, REPO)).toBe(REPO);
            } finally {
                process.chdir(cwd);
            }
        });
    });

    it('resolvePackageRoot returns the cwd when neither walk finds a kk tree', async () => {
        await withTempTree(async (dir) => {
            const cwd = process.cwd();
            process.chdir(dir);
            try {
                expect(await resolvePackageRoot(fs, join(dir, 'nowhere'))).toBe(dir);
            } finally {
                process.chdir(cwd);
            }
        });
    });

    it('resolvePackageRoot from the checkout resolves this repo (bun test argv[1] is the test file)', () => {
        // The zero-arg default mixes two process-global inputs (cwd, argv[1]), and several suites
        // chdir process-wide, so in-process this assertion passed or failed depending on which file
        // ran first. A child with an explicit cwd states the contract without that coupling.
        const entry = join(REPO, 'apps/cli/src/package-root.ts');
        const child = Bun.spawnSync({
            cmd: [
                process.execPath,
                '-e',
                `import { resolvePackageRoot } from ${JSON.stringify(entry)}; process.stdout.write(await resolvePackageRoot());`,
            ],
            cwd: REPO,
        });
        expect(child.stderr.toString()).not.toContain('error');
        expect(child.stdout.toString()).toBe(REPO);
    });
});
