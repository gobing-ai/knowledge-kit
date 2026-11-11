import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packContext } from '../src/context';
import { buildVaultIndex } from '../src/graph';
import { rankPages } from '../src/query';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-query-')));
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

const page = (title: string, body: string, tags = '') =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n${tags}---\n\n${body}\n`;

const fixture = {
    'concepts/vector-index.md': page('Vector index', 'Retrieval structures for embeddings.', 'tags:\n  - retrieval\n'),
    'concepts/hybrid-retrieval.md': page('Hybrid retrieval', 'Retrieval combining BM25 and vectors.'),
    'concepts/chunking.md': page('Chunking', 'How retrieval splits documents.'),
    'entities/publisher.md': page('Publisher', 'Publishing pipeline for articles.'),
    'index.md': page('Home', '[[Vector index]] and [[Publisher]]'),
};

describe('rankPages', () => {
    it('ranks retrieval pages ahead of a publishing page', async () => {
        const index = await buildVaultIndex(vault(fixture));
        const hits = rankPages(index, 'retrieval publishing');
        const paths = hits.map((hit) => hit.path);
        const publisher = paths.indexOf('entities/publisher.md');
        expect(publisher).toBeGreaterThan(-1);
        for (const path of ['concepts/vector-index.md', 'concepts/hybrid-retrieval.md', 'concepts/chunking.md']) {
            expect(paths.indexOf(path)).toBeLessThan(publisher);
        }
        expect(['Vector index', 'Hybrid retrieval', 'Chunking']).toContain(hits[0]?.title ?? '');
    });

    it('breaks ties on slug ascending and honours the limit', async () => {
        const index = await buildVaultIndex(vault(fixture));
        const hits = rankPages(index, 'retrieval', { limit: 2 });
        expect(hits).toHaveLength(2);
        expect(hits.map((hit) => hit.path)).toEqual([...hits.map((hit) => hit.path)].sort());
    });

    it('returns an empty list for a prompt with no match', async () => {
        const index = await buildVaultIndex(vault(fixture));
        expect(rankPages(index, 'zzz')).toEqual([]);
    });
});

describe('packContext', () => {
    it('packs the topic page with its neighbours, each introduced by its path', async () => {
        const index = await buildVaultIndex(vault(fixture));
        const packed = packContext(index, 'Vector index');
        expect(packed.pages).toContain('concepts/vector-index.md');
        expect(packed.pages).toContain('index.md');
        expect(packed.markdown).toContain('## concepts/vector-index.md');
        expect(packed.markdown).toContain('## index.md');
    });

    it('returns an empty block for an unknown topic', async () => {
        const index = await buildVaultIndex(vault(fixture));
        expect(packContext(index, 'nope')).toEqual({ markdown: '', pages: [] });
    });
});
