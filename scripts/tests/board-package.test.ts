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
    chmodSync,
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
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BOARD_ENTRIES, BOARD_EXTERNAL, BOARD_OUTPUT_DIRS, buildBoard } from '../build-board';

const REPO_ROOT = resolve(import.meta.dir, '../..');

/**
 * Every module specifier the bundle's `import` statements name.
 *
 * One pass over the WHOLE source, not per line: Bun wraps a multi-hook named import as
 * `import {\n  useCallback,\n  …\n} from "react";`, so a `line.startsWith('import ')` extractor
 * loses that specifier and yields `''` — the facade assertion then fails for the wrong reason.
 * Handles multi-line named imports and bare (`import "x"`) imports; a `;` never crosses a clause, so
 * the match cannot run into the next statement. Both the workspace and the packed-tarball
 * assertions use this, so the two cannot drift.
 */
function externalSpecifiers(bundle: string): string[] {
    const specifiers: string[] = [];
    for (const match of bundle.matchAll(/^import\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
        const specifier = match[1];
        if (typeof specifier === 'string') specifiers.push(specifier);
    }
    return specifiers;
}

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
            // Reclaim a crashed holder's lock after a grace that stays BELOW the 300s waiter deadline, else a
            // SIGKILLed holder's lock is never reclaimed. A real pack/build holds it for seconds.
            try {
                if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { force: true });
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
        const imports = externalSpecifiers(bundle);
        // Exactly the advertised facades — no bundled second React runtime and no dev runtime.
        // The UI kit facade is advertised by the host Board import map (ADR-150), so it stays
        // external alongside React; bundling it would ship a second kit instance.
        expect(new Set(imports)).toEqual(new Set(['react', 'react/jsx-runtime']));
        expect(BOARD_EXTERNAL).toEqual([
            'react',
            'react/jsx-runtime',
            'react/jsx-dev-runtime',
            '@gobing-ai/spur/board/ui',
        ]);
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
        for (const name of ['kk-collect', 'kk-daily-ai-voice2', 'kk-news-generate']) {
            expect(existsSync(join(canonical, `${name}.yaml`))).toBe(true);
            expect(existsSync(join(legacy, `${name}.yaml`))).toBe(true);
        }
    });

    it('is wired into install, the root build, and the CLI bundle/prepack path', () => {
        const root = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
            scripts: Record<string, string>;
        };
        // `prepare` is what makes the committed `enabled: true` module declarations safe: the host
        // validates every declared directory at server start, and `apps/cli/dist/board` is
        // gitignored, so a checkout that only ran `bun install` must already have the assets.
        expect(root.scripts.prepare).toContain('bun scripts/build-board.ts');
        expect(root.scripts.build).toContain('bun scripts/build-board.ts');
        const cli = JSON.parse(readFileSync(join(REPO_ROOT, 'apps/cli/package.json'), 'utf-8')) as {
            scripts: Record<string, string>;
            files: string[];
        };
        expect(cli.scripts['build:bundle']).toContain('../../scripts/build-board.ts');
        expect(cli.scripts.prepack).toBe('bun run build:bundle');
        // The CLI tarball ships dist/, which now contains the board assets.
        expect(cli.files).toContain('dist/');
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

/** Whether one Board entry's source imports the host UI kit facade, so its bundle must externalize it. */
function usesKit(entry: string): boolean {
    const row = BOARD_ENTRIES.find((candidate) => candidate.name === entry);
    if (row === undefined) throw new Error(`unknown board entry: ${entry}`);
    return readFileSync(join(REPO_ROOT, row.entry), 'utf-8').includes('@gobing-ai/spur/board/ui');
}

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
            const imports = externalSpecifiers(bundle);
            // Modules written on the host UI kit also externalize its facade (ADR-150).
            const expected = usesKit(entry)
                ? ['react', 'react/jsx-runtime', '@gobing-ai/spur/board/ui']
                : ['react', 'react/jsx-runtime'];
            expect(new Set(imports), entry).toEqual(new Set(expected));
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

/**
 * The other half of the root `prepare` script: hook installation must never fail a `bun install`.
 * It did (exit 127 with no `lefthook` on PATH), which callers that shell an install report as a
 * broken lockfile — `spur builder bump-ver` said "bun.lock is inconsistent" while the lockfile was
 * fine.
 */
describe('install-hooks (root `prepare` half)', () => {
    const script = join(REPO_ROOT, 'scripts/install-hooks.ts');

    /** Run the script against an empty PATH holding only the fake `lefthook` given here. */
    const run = (hook?: string, env: Record<string, string> = {}) => {
        const bin = mkdtempSync(join(tmpdir(), 'kk-hooks-bin-'));
        try {
            if (hook !== undefined) {
                writeFileSync(join(bin, 'lefthook'), `#!/bin/sh\n${hook}\n`);
                chmodSync(join(bin, 'lefthook'), 0o755);
            }
            return spawnSync(process.execPath, [script], {
                encoding: 'utf-8',
                env: { ...process.env, PATH: bin, ...env },
            });
        } finally {
            rmSync(bin, { recursive: true, force: true });
        }
    };

    it('skips instead of failing when lefthook is not on PATH', () => {
        const result = run();
        expect(result.status).toBe(0);
        expect(result.stderr).toContain('lefthook not on PATH');
    });

    it('runs a lefthook that is on PATH', () => {
        const marker = join(mkdtempSync(join(tmpdir(), 'kk-hooks-marker-')), 'ran');
        try {
            const result = run('echo install >> "$MARKER"', { MARKER: marker });
            expect(result.status).toBe(0);
            expect(existsSync(marker)).toBe(true);
        } finally {
            rmSync(dirname(marker), { recursive: true, force: true });
        }
    });

    it('propagates a lefthook failure, so a broken lefthook.yml stays loud', () => {
        expect(run('exit 3').status).toBe(3);
    });

    it('skips instead of failing when proto refuses the untrusted .prototools', () => {
        // A fresh clone or worktree has no trust record, so the lefthook shim exits 1 with this.
        const result = run('echo \'{"code":"proto::tool::untrusted_plugin"}\'; exit 1');
        expect(result.status).toBe(0);
        expect(result.stderr).toContain('proto trust .prototools');
    });
});
