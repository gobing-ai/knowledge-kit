import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex, type VaultIndex } from '../src/graph';
import { parsePage } from '../src/page';
import { SUMMARY_HEADING, summarizePage } from '../src/summarize';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-sum-')));
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

/** Fetches a slug from the index or fails the test instead of asserting non-null. */
function requireSlug(index: VaultIndex, slug: string) {
    const page = index.bySlug.get(slug);
    if (!page) throw new Error(`page "${slug}" missing from vault index`);
    return page;
}

const page = (title: string, body: string, extra = '') =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n${extra}---\n\n${body}\n`;

describe('summarizePage', () => {
    it('adds a summary section and links mentioned titles', async () => {
        const dir = vault({ 'k.md': page('Karakeep', 'x'), 'a.md': page('Alpha', 'body only') });
        const index = await buildVaultIndex(dir);
        const result = summarizePage(index, requireSlug(index, 'alpha'), 'Karakeep stores captures.', {
            date: '2026-11-10',
        });
        expect(result.text).toContain(SUMMARY_HEADING);
        expect(result.text).toContain('[[karakeep|Karakeep]] stores captures.');
        expect(result.links).toBe(1);
        expect(result.guard).toBe('clean');
    });

    it('replaces an existing summary section instead of adding a second one', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'intro\n\n## Summary\n\nold summary\n\n## Detail\n\nkept') });
        const index = await buildVaultIndex(dir);
        const result = summarizePage(index, requireSlug(index, 'alpha'), 'new summary', { date: '2026-11-10' });
        expect(result.text.split(SUMMARY_HEADING)).toHaveLength(2);
        expect(result.text).not.toContain('old summary');
        expect(result.text).toContain('## Detail');
        expect(result.text).toContain('kept');
    });

    it('sends the summary to the dated section on a guarded page', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'operator prose', 'user_edited: true\n') });
        const index = await buildVaultIndex(dir);
        const result = summarizePage(index, requireSlug(index, 'alpha'), 'agent summary', { date: '2026-11-10' });
        expect(result.guard).toBe('appended');
        expect(result.text).toContain('## AI Updates (2026-11-10)');
        expect(parsePage(result.text, 'a.md').body).toContain('operator prose');
    });
});

describe('summarizePage coverage of the section rebuild', () => {
    it('places the summary before an existing later section', async () => {
        const dir = vault({ 'a.md': page('Alpha', '## Summary\n\nold\n\n## Detail\n\nkept') });
        const index = await buildVaultIndex(dir);
        const result = summarizePage(index, requireSlug(index, 'alpha'), 'fresh', { date: '2026-11-10' });
        expect(result.text.indexOf('fresh')).toBeLessThan(result.text.indexOf('## Detail'));
        expect(result.text).toContain('kept');
    });

    it('appends a summary section when the page already ends with one', async () => {
        const dir = vault({ 'a.md': page('Alpha', '## Summary\n\nonly') });
        const index = await buildVaultIndex(dir);
        const result = summarizePage(index, requireSlug(index, 'alpha'), 'replacement', { date: '2026-11-10' });
        expect(result.text).toContain('replacement');
        expect(result.text).not.toContain('only');
    });
});
