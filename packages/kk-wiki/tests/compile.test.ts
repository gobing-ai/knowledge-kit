import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileIndex, needsWrite } from '../src/compile';
import { buildVaultIndex } from '../src/graph';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-compile-')));
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

const page = (title: string, type: string, body: string, tags = '') =>
    `---\ntitle: ${title}\ntype: ${type}\nupdated_at: 2026-11-10\n${tags}---\n\n${body}\n`;

describe('compileIndex', () => {
    it('lists every page with a wikilink and a summary, grouped by type', async () => {
        const index = await buildVaultIndex(
            vault({
                'index.md': page('Home', 'index', 'welcome'),
                'concepts/a.md': page('Alpha', 'concept', 'first line summary\n\nmore'),
                'entities/b.md': page('Beta', 'entity', 'tool body', 'tags:\n  - tooling\n'),
            }),
        );
        const compiled = compileIndex(index.pages, { date: '2026-11-10' });
        expect(compiled.index).toContain('- [[alpha|Alpha]] — first line summary');
        expect(compiled.index).toContain('## entity');
        expect(compiled.map).toContain('concepts/a.md → alpha (tags: —)');
        expect(compiled.map).toContain('entities/b.md → beta (tags: tooling)');
    });

    it('is byte-identical across consecutive renders', async () => {
        const index = await buildVaultIndex(vault({ 'concepts/a.md': page('Alpha', 'concept', 'x') }));
        const first = compileIndex(index.pages, { date: '2026-11-10' });
        const second = compileIndex(index.pages, { date: '2026-11-10' });
        expect(first).toEqual(second);
    });

    it('falls back to a placeholder summary for an empty body', async () => {
        const index = await buildVaultIndex(vault({ 'concepts/a.md': page('Alpha', 'concept', '') }));
        expect(compileIndex(index.pages, { date: '2026-11-10' }).index).toContain('No summary yet.');
    });

    it('reports whether a write is needed', () => {
        expect(needsWrite('same', 'same')).toBe(false);
        expect(needsWrite(null, 'x')).toBe(true);
    });
});
