/**
 * Build the native Board module entries as standalone browser ESM.
 *
 * The installed Spur Board serves each declared module's `directory` as static files and
 * resolves the manifest-advertised React facades itself (`web/board-runtime.json`), so the
 * emitted bundle must:
 *
 *  - be a single ESM file per entry that exports `webModule` (no `createRoot`);
 *  - import React ONLY through the three advertised facade specifiers, never bundle it;
 *  - ship a scoped `index.css` beside `index.js`.
 *
 * Assets are emitted twice — into the browser workspace (`apps/board/dist`) and into the CLI
 * package (`apps/cli/dist/board`) — because the CLI tarball is what an installed user runs.
 * Plugin staging alone does not build browser contributions, so the root `build` script and
 * the CLI `build:bundle`/`prepack` path both invoke this file explicitly (§3/§9).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Repo root — this script sits at `<root>/scripts/`. */
const REPO_ROOT = resolve(import.meta.dir, '..');

/** One buildable contribution entry: the ESM source and its optional scoped stylesheet. */
export interface BoardEntry {
    /** Entry name; the emitted directory is also named after it. */
    name: string;
    /** Repo-relative entry module. */
    entry: string;
    /** Repo-relative scoped stylesheet copied beside `index.js`, when the entry ships one. */
    css?: string;
}

/**
 * The registered entries. 0252 ships Collect; 0253/0254 append `daily-voice`/`itc` here, and a
 * module must not be declared in `spur.yaml` until its assets exist (§9).
 */
export const BOARD_ENTRIES: readonly BoardEntry[] = [
    { name: 'collect', entry: 'apps/board/src/collect/index.tsx', css: 'apps/board/src/collect/index.css' },
    {
        name: 'daily-voice',
        entry: 'apps/board/src/daily-voice/index.tsx',
        css: 'apps/board/src/daily-voice/index.css',
    },
    { name: 'itc', entry: 'apps/board/src/itc/index.tsx', css: 'apps/board/src/itc/index.css' },
];

/** The host facades the bundle must externalize (never inline a second React runtime). */
export const BOARD_EXTERNAL: readonly string[] = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'];

/** Root-relative directories every entry is emitted into. */
export const BOARD_OUTPUT_DIRS: readonly string[] = ['apps/board/dist', 'apps/cli/dist/board'];

/** Absolute output directory for one entry under one root. */
export function outputDir(root: string, outRoot: string, name: string): string {
    return join(root, outRoot, name);
}

/**
 * Build every {@link BOARD_ENTRIES} entry into every {@link BOARD_OUTPUT_DIRS} root, copying
 * the scoped stylesheet beside the bundle.
 *
 * @returns the absolute emitted directories, for logging and package assertions.
 */
export async function buildBoard(root: string = REPO_ROOT): Promise<string[]> {
    const emitted: string[] = [];
    for (const entry of BOARD_ENTRIES) {
        const entryPath = join(root, entry.entry);
        if (!existsSync(entryPath)) {
            // A stale declaration (an entry deleted without its build row) must fail loudly
            // rather than emit an empty module directory.
            throw new Error(`board entry source missing: ${entryPath}`);
        }
        for (const outRoot of BOARD_OUTPUT_DIRS) {
            const dir = outputDir(root, outRoot, entry.name);
            mkdirSync(dir, { recursive: true });
            const built = await Bun.build({
                entrypoints: [entryPath],
                outdir: dir,
                target: 'browser',
                format: 'esm',
                naming: '[name].[ext]',
                external: [...BOARD_EXTERNAL],
                // Production JSX: the entry must import `react/jsx-runtime`, not the dev
                // runtime the host does not advertise as a production facade.
                define: { 'process.env.NODE_ENV': '"production"' },
            });
            if (!built.success) {
                throw new Error(`board build failed for ${entry.name}: ${built.logs.map(String).join('; ')}`);
            }
            emitted.push(...built.outputs.map((output) => output.path));
            if (entry.css !== undefined) {
                const cssTarget = join(dir, 'index.css');
                await copyFile(join(root, entry.css), cssTarget);
                emitted.push(cssTarget);
            }
        }
    }
    return emitted;
}

if (import.meta.main) {
    const emitted = await buildBoard();
    console.log(`board: emitted ${emitted.length} assets`);
    for (const path of emitted) console.log(`  ${path}`);
}
