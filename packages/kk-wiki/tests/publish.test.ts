import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { buildVaultIndex } from '../src/graph';
import { publishVault } from '../src/publish';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-pub-')));
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

const page = (title: string, body: string) =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n---\n\n${body}\n`;

describe('publishVault', () => {
    it('mirrors content/ one-to-one under <target>/content', async () => {
        const dir = vault({
            'content/index.md': page('Home', '[[Alpha]]'),
            'content/concepts/a.md': page('Alpha', 'alpha'),
        });
        const index = await buildVaultIndex(join(dir, 'content'));
        const target = join(dir, 'out', 'wiki');
        const result = await publishVault(index, { target, fileSystem: createNodeFileSystem() });
        expect(result.files).toEqual([join('content', 'concepts/a.md'), join('content', 'index.md')]);
        expect(readFileSync(join(target, 'content', 'concepts/a.md'), 'utf8')).toContain('alpha');
        expect(readFileSync(join(target, 'content', 'index.md'), 'utf8')).toContain('[[Alpha]]');
    });

    it('refuses a target inside the vault content tree', async () => {
        const dir = vault({ 'content/a.md': page('A', 'x') });
        const index = await buildVaultIndex(join(dir, 'content'));
        const result = await publishVault(index, {
            target: join(dir, 'content', 'out'),
            fileSystem: createNodeFileSystem(),
        });
        expect(result.refused).toBe('target-inside-vault');
        expect(result.files).toEqual([]);
    });
});
