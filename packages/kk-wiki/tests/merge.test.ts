import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex } from '../src/graph';
import { mergePages } from '../src/merge';
import { parsePage } from '../src/page';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-merge-')));
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

const fixture = {
    'a.md': page('Alpha', 'alpha body'),
    'b.md': page('Beta', 'beta body'),
    'c.md': page('Gamma', 'links to [[Alpha]] and [[Alpha|the alpha page]]'),
};

describe('mergePages', () => {
    it('unions both bodies and sources into the target', async () => {
        const index = await buildVaultIndex(vault(fixture));
        const result = mergePages(index, 'a.md', 'b.md', { date: '2026-11-10' });
        expect(result.guard).toBe('clean');
        const merged = parsePage(result.targetText, 'b.md');
        expect(merged.body).toContain('alpha body');
        expect(merged.body).toContain('beta body');
        expect(merged.frontmatter.sources).toContain('alpha');
    });

    it('rewrites inbound links and leaves a redirect stub', async () => {
        const index = await buildVaultIndex(vault(fixture));
        const result = mergePages(index, 'a.md', 'b.md', { date: '2026-11-10' });
        expect(result.redirects).toBe(2);
        expect(result.rewritten).toEqual(['c.md']);
        const stub = parsePage(result.sourceText, 'a.md');
        expect(stub.frontmatter.redirect_to).toBe('beta');
        expect(stub.body).toContain('[[beta|Beta]]');
    });

    it('refuses a guarded source page and leaves both bodies intact', async () => {
        const index = await buildVaultIndex(
            vault({ ...fixture, 'a.md': page('Alpha', 'operator words', 'user_edited: true\n') }),
        );
        const result = mergePages(index, 'a.md', 'b.md', { date: '2026-11-10' });
        expect(result.guard).toBe('refused');
        expect(parsePage(result.sourceText, 'a.md').body).toContain('operator words');
        expect(parsePage(result.targetText, 'b.md').body).toContain('beta body');
    });

    it('throws a named error for a missing page', async () => {
        const index = await buildVaultIndex(vault(fixture));
        expect(() => mergePages(index, 'missing', 'b.md', { date: '2026-11-10' })).toThrow(/no source page/);
        expect(() => mergePages(index, 'a.md', 'missing', { date: '2026-11-10' })).toThrow(/no target page/);
    });
});
