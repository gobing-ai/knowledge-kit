import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex } from '../src/graph';
import { parsePage } from '../src/page';
import { synthesizePage } from '../src/synthesize';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-syn-')));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
        const full = join(dir, 'content', name);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, body);
    }
    return join(dir, 'content');
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const page = (title: string, body: string, extra = '') =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n${extra}---\n\n${body}\n`;

describe('synthesizePage', () => {
    it('creates a concept page with schema-valid frontmatter', async () => {
        const dir = vault({ 'index.md': page('Home', 'x') });
        const index = await buildVaultIndex(dir);
        const result = synthesizePage(index, { target: 'Vector index', material: 'HNSW notes.', date: '2026-11-10' });
        expect(result.created).toBe(true);
        expect(result.path).toBe('concepts/vector-index.md');
        const parsed = parsePage(result.text, result.path);
        expect(parsed.frontmatter.title).toBe('Vector index');
        expect(parsed.frontmatter.type).toBe('concept');
        expect(parsed.body).toContain('HNSW notes.');
    });

    it('honours an entity type for the folder', async () => {
        const dir = vault({ 'index.md': page('Home', 'x') });
        const index = await buildVaultIndex(dir);
        const result = synthesizePage(index, {
            target: 'Karakeep',
            material: 'capture tool',
            type: 'entity',
            date: '2026-11-10',
        });
        expect(result.path).toBe('entities/karakeep.md');
    });

    it('extends an existing page without discarding its sections', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'intro\n\n## Detail\n\nkept') });
        const index = await buildVaultIndex(dir);
        const result = synthesizePage(index, { target: 'Alpha', material: 'more', date: '2026-11-10' });
        expect(result.created).toBe(false);
        expect(result.text).toContain('## Detail');
        expect(result.text).toContain('kept');
        expect(result.text).toContain('more');
    });

    it('yields identical bytes for identical input', async () => {
        const dir = vault({ 'index.md': page('Home', 'x') });
        const index = await buildVaultIndex(dir);
        const input = { target: 'Stable topic', material: 'same text', date: '2026-11-10' };
        expect(synthesizePage(index, input).text).toBe(synthesizePage(index, input).text);
    });

    it('links mentioned titles in the new body', async () => {
        const dir = vault({ 'k.md': page('Karakeep', 'x'), 'index.md': page('Home', 'y') });
        const index = await buildVaultIndex(dir);
        const result = synthesizePage(index, {
            target: 'Capture tools',
            material: 'Karakeep is one.',
            date: '2026-11-10',
        });
        expect(result.text).toContain('[[karakeep|Karakeep]]');
    });
});
