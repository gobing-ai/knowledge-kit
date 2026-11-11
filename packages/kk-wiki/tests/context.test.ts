import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packContext } from '../src/context';
import { buildVaultIndex } from '../src/graph';

/** The `context` verb packs a topic page and its graph neighbours into one Markdown block. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-ctx-')));
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

const page = (title: string, body: string) =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n---\n\n${body}\n`;

describe('packContext', () => {
    it('packs the topic page and both link directions at depth 1', async () => {
        const index = await buildVaultIndex(
            vault({
                'concepts/retrieval.md': page('Retrieval', 'links to [[Chunking]]'),
                'concepts/chunking.md': page('Chunking', 'split documents'),
                'concepts/unrelated.md': page('Unrelated', 'nothing here'),
            }),
        );
        const packed = packContext(index, 'Retrieval');
        expect(packed.pages).toContain('concepts/retrieval.md');
        expect(packed.pages).toContain('concepts/chunking.md');
        expect(packed.pages).not.toContain('concepts/unrelated.md');
        expect(packed.markdown.startsWith('## concepts/retrieval.md')).toBe(true);
    });

    it('resolves a topic by page path as well as by slug', async () => {
        const index = await buildVaultIndex(vault({ 'concepts/retrieval.md': page('Retrieval', 'x') }));
        expect(packContext(index, 'concepts/retrieval.md').pages).toEqual(['concepts/retrieval.md']);
    });
});
