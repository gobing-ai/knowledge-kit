import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex, extractLinks, scanLines } from '../src/graph';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-graph-')));
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

describe('scanLines / extractLinks', () => {
    it('finds both link forms', () => {
        const links = extractLinks('see [[a]] and [[b|B page]]');
        expect(links).toEqual([
            { target: 'a', surface: null, line: 1 },
            { target: 'b', surface: 'B page', line: 1 },
        ]);
    });

    it('skips fenced blocks and inline code spans', () => {
        const body = 'real [[a]]\n```\n[[inside-fence]]\n```\ninline `[[in-code]]` end\n';
        expect(extractLinks(body).map((link) => link.target)).toEqual(['a']);
    });

    it('numbers lines from the body', () => {
        expect(scanLines('one\ntwo [[x]]').map((line) => line.line)).toEqual([1, 2]);
    });
});

describe('buildVaultIndex', () => {
    it('indexes pages, resolves links and counts inbound references', async () => {
        const dir = vault({
            'index.md': page('Home', '[[alpha]] and [[Beta Page]]'),
            'concepts/alpha.md': page('Alpha', 'no links'),
            'concepts/beta.md': page('Beta Page', 'links to [[alpha]]'),
        });
        const index = await buildVaultIndex(dir);
        expect(index.pages).toHaveLength(3);
        expect(index.bySlug.get('alpha')?.inbound).toBe(2);
        expect(index.bySlug.get('beta-page')?.inbound).toBe(1);
        expect(index.findings).toEqual([]);
    });

    it('records missing frontmatter as a finding and keeps the other pages', async () => {
        const dir = vault({ 'a.md': '# no frontmatter\n', 'b.md': page('B', 'ok') });
        const index = await buildVaultIndex(dir);
        expect(index.pages).toHaveLength(1);
        expect(index.findings.map((finding) => finding.code)).toContain('missing-frontmatter');
    });

    it('records invalid frontmatter as a finding', async () => {
        const dir = vault({ 'a.md': '---\ntitle: A\n---\n\nbody\n' });
        const index = await buildVaultIndex(dir);
        expect(index.findings[0]?.code).toBe('invalid-frontmatter');
    });

    it('flags a duplicate slug across folders', async () => {
        const dir = vault({ 'concepts/x.md': page('Same', 'a'), 'entities/y.md': page('Same', 'b') });
        const index = await buildVaultIndex(dir);
        expect(index.findings.filter((finding) => finding.code === 'duplicate-slug')).toHaveLength(2);
    });

    it('derives the slug from the title regardless of the file name', async () => {
        const dir = vault({ 'concepts/file-name.md': page('My Page', 'x') });
        const index = await buildVaultIndex(dir);
        expect(index.bySlug.has('my-page')).toBe(true);
        expect(index.bySlug.has('file-name')).toBe(false);
    });
});
