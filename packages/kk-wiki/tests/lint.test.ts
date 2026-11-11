import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildVaultIndex } from '../src/graph';
import { lintExitCode, lintPages } from '../src/lint';

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-lint-')));
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

describe('lintPages', () => {
    it('reports a broken link with its line', async () => {
        const dir = vault({ 'a.md': page('A', 'see [[missing-page]]') });
        const findings = lintPages(await buildVaultIndex(dir));
        const broken = findings.find((finding) => finding.code === 'broken-link');
        expect(broken).toMatchObject({ path: 'a.md', message: '[[missing-page]] resolves to no page' });
        expect(broken?.line).toBeGreaterThan(1); // file-relative, not body-relative
    });

    it('reports an orphan page but exempts index', async () => {
        const dir = vault({ 'index.md': page('Home', 'no links'), 'concepts/orphan.md': page('Orphan', 'x') });
        const findings = lintPages(await buildVaultIndex(dir));
        expect(findings.filter((finding) => finding.code === 'orphan').map((finding) => finding.path)).toEqual([
            'concepts/orphan.md',
        ]);
    });

    it('returns a clean list for a linked vault and exits 0', async () => {
        const dir = vault({ 'index.md': page('Home', '[[a]]'), 'a.md': page('A', 'back to [[Home]]') });
        const findings = lintPages(await buildVaultIndex(dir));
        expect(findings).toEqual([]);
        expect(lintExitCode(findings)).toBe(0);
    });

    it('exits 1 when any finding exists', async () => {
        const dir = vault({ 'a.md': page('A', '[[nope]]') });
        expect(lintExitCode(lintPages(await buildVaultIndex(dir)))).toBe(1);
    });
});
