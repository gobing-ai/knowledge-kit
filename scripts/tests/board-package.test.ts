/**
 * G8/0252 — the browser build/package contract.
 *
 * The native Collect entry must be emitted as standalone browser ESM into BOTH the browser
 * workspace and the CLI package tree, must externalize only the host React facades, and must
 * be reachable from the root build + CLI prepack path (plugin staging alone is not enough).
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BOARD_ENTRIES, BOARD_EXTERNAL, BOARD_OUTPUT_DIRS, buildBoard } from '../build-board';

const REPO_ROOT = resolve(import.meta.dir, '../..');

describe('buildBoard', () => {
    it('emits index.js + index.css for collect into both distribution roots', async () => {
        const emitted = await buildBoard(REPO_ROOT);
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
