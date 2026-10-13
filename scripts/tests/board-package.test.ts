/**
 * G8/0252 — the browser build/package contract.
 *
 * The native Collect entry must be emitted as standalone browser ESM into BOTH the browser
 * workspace and the CLI package tree, must externalize only the host React facades, and must
 * be reachable from the root build + CLI prepack path (plugin staging alone is not enough).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
    closeSync,
    existsSync,
    lstatSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    rmSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BOARD_ENTRIES, BOARD_EXTERNAL, BOARD_OUTPUT_DIRS, buildBoard } from '../build-board';

const REPO_ROOT = resolve(import.meta.dir, '../..');

/**
 * Serialize the shared workspace build/pack across test files with a cross-process lock. The
 * `buildBoard` / `bun pm pack` calls below write the SHARED `apps/cli/dist` + `apps/board/dist`
 * trees; under `bun test` another file (e.g. `apps/board/tests/installed-board.test.ts`) packs at
 * the same time and the two race over those files. The lock makes the suite correct across files.
 */
async function withBuildLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const lock = join(tmpdir(), 'kk-board-shared-build.lock');
    const deadline = Date.now() + 300_000;
    let fd: number | null = null;
    while (fd === null) {
        try {
            fd = openSync(lock, 'wx');
        } catch {
            try {
                if (Date.now() - statSync(lock).mtimeMs > 600_000) rmSync(lock, { force: true });
            } catch {
                // the lock vanished between attempts — just retry
            }
            if (Date.now() > deadline) throw new Error('timed out acquiring the board shared-build lock');
            await Bun.sleep(200);
        }
    }
    try {
        return await fn();
    } finally {
        closeSync(fd);
        rmSync(lock, { force: true });
    }
}

describe('buildBoard', () => {
    it.serial('emits index.js + index.css for collect into both distribution roots', async () => {
        const emitted = await withBuildLock(() => buildBoard(REPO_ROOT));
        for (const outRoot of BOARD_OUTPUT_DIRS) {
            for (const entry of BOARD_ENTRIES) {
                const dir = join(REPO_ROOT, outRoot, entry.name);
                expect(existsSync(join(dir, 'index.js'))).toBe(true);
                expect(existsSync(join(dir, 'index.css'))).toBe(true);
                expect(emitted).toContain(join(dir, 'index.js'));
            }
        }
    });

    it('externalizes only the manifest-advertised React facades and never calls createRoot', () => {
        const bundle = readFileSync(join(REPO_ROOT, 'apps/board/dist/collect/index.js'), 'utf-8');
        const imports = bundle
            .split('\n')
            .filter((line) => line.startsWith('import '))
            .map((line) => /from "([^"]+)"/.exec(line)?.[1] ?? '');
        // Exactly the two advertised facades — no bundled second React runtime and no dev runtime.
        expect(new Set(imports)).toEqual(new Set(['react', 'react/jsx-runtime']));
        expect(BOARD_EXTERNAL).toEqual(['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']);
        expect(bundle).toContain('webModule');
        expect(bundle).not.toContain('createRoot');
        expect(bundle).not.toContain('react-dom');
    });

    it('keeps workflow definitions in the canonical directory behind the legacy symlink (AC10)', () => {
        const canonical = join(REPO_ROOT, 'plugins/kk/workflows');
        const legacy = join(REPO_ROOT, '.spur/workflows');
        // `.spur/workflows` is the relative symlink to the canonical directory, not a copy.
        expect(lstatSync(legacy).isSymbolicLink()).toBe(true);
        expect(readlinkSync(legacy)).toBe('../plugins/kk/workflows');
        for (const name of ['kk-collect', 'kk-daily-ai-voice2', 'kk-itc']) {
            expect(existsSync(join(canonical, `${name}.yaml`))).toBe(true);
            expect(existsSync(join(legacy, `${name}.yaml`))).toBe(true);
        }
        expect(existsSync(join(legacy, 'feature-verification.yaml'))).toBe(true);
    });

    it('is wired into the root build and the CLI bundle/prepack path', () => {
        const root = readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8');
        expect(root).toContain('bun scripts/build-board.ts');
        const cli = readFileSync(join(REPO_ROOT, 'apps/cli/package.json'), 'utf-8');
        expect(cli).toContain('../../scripts/build-board.ts');
        expect(cli).toContain('"prepack": "bun run build:bundle"');
        // The CLI tarball ships dist/, which now contains the board assets.
        expect(cli).toContain('"dist/"');
    });
});

describe('buildBoard failure modes', () => {
    it('refuses a missing entry source instead of emitting an empty directory', async () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-board-missing-')));
        try {
            await expect(buildBoard(root)).rejects.toThrow(/board entry source missing/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

/** The CLI workspace whose `prepack` builds + ships the browser contributions. */
const CLI_DIR = join(REPO_ROOT, 'apps/cli');

/**
 * Pack the CLI exactly as an install would, honoring its `prepack` build hook, and expose the
 * tarball's file list plus a reader for any entry.
 */
function packCli(dest: string): { files: string[]; read: (entry: string) => string } {
    const packed = spawnSync('bun', ['pm', 'pack', '--destination', dest, '--quiet'], {
        cwd: CLI_DIR,
        encoding: 'utf-8',
        env: { ...process.env, NODE_ENV: 'production' },
        maxBuffer: 64 * 1024 * 1024,
    });
    if (packed.status !== 0) throw new Error(`bun pm pack failed: ${packed.stderr || packed.stdout}`);
    const tarball = packed.stdout.trim().split('\n').pop()?.trim() ?? '';
    if (!tarball.endsWith('.tgz') || !existsSync(tarball)) throw new Error(`unexpected pack artifact: ${tarball}`);
    const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (listing.status !== 0) throw new Error(`tar -tzf failed: ${listing.stderr}`);
    return {
        files: listing.stdout.split('\n').filter((line) => line.startsWith('package/')),
        read: (entry: string): string => {
            const extracted = spawnSync('tar', ['-xzOf', tarball, `package/${entry}`], {
                encoding: 'utf-8',
                maxBuffer: 64 * 1024 * 1024,
            });
            if (extracted.status !== 0) throw new Error(`tar extract failed for ${entry}: ${extracted.stderr}`);
            return extracted.stdout;
        },
    };
}

describe('packed CLI distribution (G8/0255 AC1/AC7)', () => {
    let packDir = '';
    let packed: { files: string[]; read: (entry: string) => string };
    const ENTRIES = ['collect', 'daily-voice', 'itc'];

    beforeAll(async () => {
        packDir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-cli-pack-')));
        packed = await withBuildLock(() => packCli(packDir));
    }, 120_000);

    afterAll(() => {
        if (packDir !== '') rmSync(packDir, { recursive: true, force: true, maxRetries: 3 });
    });

    it.serial('ships the three native board entry trees (assets + CSS) and the reader binary', () => {
        for (const entry of ENTRIES) {
            expect(packed.files, entry).toContain(`package/dist/board/${entry}/index.js`);
            expect(packed.files, entry).toContain(`package/dist/board/${entry}/index.css`);
        }
        expect(packed.files).toContain('package/dist/index.js');
    });

    it.serial('externalizes only the host React facades and bundles no second runtime', () => {
        for (const entry of ENTRIES) {
            const bundle = packed.read(`dist/board/${entry}/index.js`);
            const imports = bundle
                .split('\n')
                .filter((line) => line.startsWith('import '))
                .map((line) => /from "([^"]+)"/.exec(line)?.[1] ?? '');
            expect(new Set(imports), entry).toEqual(new Set(['react', 'react/jsx-runtime']));
            expect(bundle, entry).toContain('webModule');
            expect(bundle, entry).not.toContain('createRoot');
            expect(bundle, entry).not.toContain('react-dom');
        }
    });

    it.serial('lets the reader and module assets resolve outside the source checkout', () => {
        // The packed reader + entries are addressable by their own package-relative paths...
        expect(packed.files).toContain('package/dist/index.js');
        // ...and carry no reference back to the checkout they were built in.
        expect(packed.read('dist/index.js')).not.toContain(REPO_ROOT);
        for (const entry of ENTRIES) {
            expect(packed.read(`dist/board/${entry}/index.js`), entry).not.toContain(REPO_ROOT);
        }
    });
});
