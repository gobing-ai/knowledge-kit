import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { applyGc, planGc } from '../src/gc';
import { buildVaultIndex } from '../src/graph';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-gc-')));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
        const full = join(dir, name);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, body);
    }
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const page = (title: string, sources: string[]) =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\nsources:\n${sources.map((s) => `  - ${s}`).join('\n')}\n---\n\nbody\n`;

describe('planGc / applyGc', () => {
    it('deletes an unreferenced snapshot and keeps a referenced one', async () => {
        const dir = vault({
            'content/a.md': page('Alpha', ['referenced123']),
            'raw/html/referenced123.md': 'x',
            'raw/html/orphan456.md': 'y',
            'raw/tmp/stale.json': 'z',
        });
        const index = await buildVaultIndex(join(dir, 'content'));
        const plan = await planGc(index, { rawDir: join(dir, 'raw'), fileSystem: createNodeFileSystem() });
        expect(plan.delete).toEqual([join(dir, 'raw/html/orphan456.md'), join(dir, 'raw/tmp/stale.json')]);
        expect(plan.keep).toEqual([join(dir, 'raw/html/referenced123.md')]);
        expect(plan.skippedMirrors).toEqual([]);
    });

    it('skips every configured mirror directory', async () => {
        const dir = vault({
            'content/a.md': page('Alpha', []),
            'raw/karakeep/older/item.md': 'mirror content',
            'raw/html/orphan.md': 'x',
        });
        const index = await buildVaultIndex(join(dir, 'content'));
        const plan = await planGc(index, {
            rawDir: join(dir, 'raw'),
            mirrors: ['raw/karakeep'],
            fileSystem: createNodeFileSystem(),
        });
        expect(plan.delete).toEqual([join(dir, 'raw/html/orphan.md')]);
        expect(plan.skippedMirrors).toEqual(['raw/karakeep']);
    });

    it('deletes only the planned files when applied', async () => {
        const dir = vault({ 'content/a.md': page('Alpha', []), 'raw/html/orphan.md': 'x' });
        const index = await buildVaultIndex(join(dir, 'content'));
        const plan = await planGc(index, { rawDir: join(dir, 'raw'), fileSystem: createNodeFileSystem() });
        const { deleted } = await applyGc(plan, createNodeFileSystem());
        expect(deleted).toEqual([join(dir, 'raw/html/orphan.md')]);
        expect(createNodeFileSystem().exists(join(dir, 'raw/html/orphan.md'))).toBe(false);
    });

    it('returns an empty plan for a vault with no raw tree', async () => {
        const dir = vault({ 'content/a.md': page('Alpha', []) });
        const index = await buildVaultIndex(join(dir, 'content'));
        const plan = await planGc(index, { rawDir: join(dir, 'raw'), fileSystem: createNodeFileSystem() });
        expect(plan).toEqual({ delete: [], keep: [], skippedMirrors: [] });
    });
});
