import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex } from '../src/graph';
import { findMentions, fixLinks } from '../src/link';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-link-')));
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

describe('findMentions', () => {
    it('reports a prose mention of an existing title', async () => {
        const dir = vault({
            'a.md': page('Alpha', 'x'),
            'k.md': page('Karakeep', 'x'),
            'b.md': page('Beta', 'Karakeep stores captures.'),
        });
        const mentions = findMentions(await buildVaultIndex(dir));
        expect(mentions).toEqual([{ path: 'b.md', line: 7, slug: 'karakeep', surface: 'Karakeep', text: 'Karakeep' }]);
    });

    it('ignores an already linked mention, fenced blocks and inline code', async () => {
        const dir = vault({
            'k.md': page('Karakeep', 'x'),
            'b.md': page('Beta', 'see [[Karakeep]]\n```\nKarakeep\n```\n`Karakeep`'),
        });
        expect(findMentions(await buildVaultIndex(dir))).toEqual([]);
    });

    it('does not match a title inside a longer word', async () => {
        const dir = vault({ 'k.md': page('Alpha', 'x'), 'b.md': page('Beta', 'Alphabet soup.') });
        expect(findMentions(await buildVaultIndex(dir))).toEqual([]);
    });
});

describe('fixLinks', () => {
    it('injects the wikilink and reports the changed page', async () => {
        const dir = vault({ 'k.md': page('Karakeep', 'x'), 'b.md': page('Beta', 'Karakeep stores captures.') });
        const index = await buildVaultIndex(dir);
        const result = await fixLinks(index, { date: '2026-11-10', contentDir: dir });
        expect(result.changed).toEqual(['b.md']);
        expect(readFileSync(join(dir, 'b.md'), 'utf8')).toContain('[[karakeep|Karakeep]] stores captures.');
    });

    it('never rewrites a guarded page body; the change lands under the dated section', async () => {
        const dir = vault({
            'k.md': page('Karakeep', 'x'),
            'b.md': page('Beta', 'Karakeep stores captures.', 'user_edited: true\n'),
        });
        const index = await buildVaultIndex(dir);
        const result = await fixLinks(index, { date: '2026-11-10', contentDir: dir });
        expect(result.refused).toEqual(['b.md']);
        const text = readFileSync(join(dir, 'b.md'), 'utf8');
        expect(text).toContain('Karakeep stores captures.');
        expect(text).toContain('## AI Updates (2026-11-10)');
    });

    it('reports the plan without writing in dry-run mode', async () => {
        const dir = vault({ 'k.md': page('Karakeep', 'x'), 'b.md': page('Beta', 'Karakeep stores captures.') });
        const index = await buildVaultIndex(dir);
        const result = await fixLinks(index, { date: '2026-11-10', dryRun: true, contentDir: dir });
        expect(result.changed).toEqual(['b.md']);
        expect(readFileSync(join(dir, 'b.md'), 'utf8')).not.toContain('[[');
    });
});
