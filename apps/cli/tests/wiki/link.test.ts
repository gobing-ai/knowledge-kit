import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { runLink } from '../../src/wiki/link';
import { captureOutput } from '../capture';

/** Feature I1 R12/R22 (task 0356): `kk wiki link` report and `--fix`. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-link-cli-')));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
        const full = join(dir, 'content', name);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, body);
    }
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const page = (title: string, body: string, extra = '') =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n${extra}---\n\n${body}\n`;

async function run(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
    const previous = process.cwd();
    const capture = captureOutput();
    process.chdir(cwd);
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        process.chdir(previous);
        capture.restore();
    }
}

const fixture = {
    'k.md': page('Karakeep', 'captures bookmarks'),
    'b.md': page('Beta', 'Karakeep stores captures.'),
};

describe('kk wiki link (CLI)', () => {
    it('reports the mention without editing the file', async () => {
        const dir = vault(fixture);
        const before = readFileSync(join(dir, 'content', 'b.md'), 'utf8');
        const result = await run(['wiki', 'link'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('Karakeep -> [[karakeep]]');
        expect(readFileSync(join(dir, 'content', 'b.md'), 'utf8')).toBe(before);
    });

    it('injects the wikilink with --fix and names the changed page', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'link', '--fix'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('linked: b.md');
        expect(readFileSync(join(dir, 'content', 'b.md'), 'utf8')).toContain('[[karakeep|Karakeep]]');
    });

    it('sends a guarded page to the dated section instead of rewriting it', async () => {
        const dir = vault({
            'k.md': page('Karakeep', 'captures bookmarks'),
            'b.md': page('Beta', 'Karakeep stores captures.', 'user_edited: true\n'),
        });
        const result = await run(['wiki', 'link', '--fix'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('guard: b.md');
        const text = readFileSync(join(dir, 'content', 'b.md'), 'utf8');
        expect(text).toContain('## AI Updates (');
        expect(text.split('## AI Updates')[0]).toContain('Karakeep stores captures.');
    });

    it('prints one JSON document in both modes', async () => {
        const dir = vault(fixture);
        const report = await run(['wiki', 'link', '--json'], dir);
        expect((JSON.parse(report.out) as { mentions: unknown[] }).mentions).toHaveLength(1);
        const fixed = await run(['wiki', 'link', '--fix', '--json'], dir);
        expect((JSON.parse(fixed.out) as { changed: string[] }).changed).toEqual(['b.md']);
    });

    it('reports a config error as exit 1 for direct callers', async () => {
        const dir = vault(fixture);
        writeFileSync(join(dir, 'kk.config.json'), '{ bad json');
        const outcome = await runLink({ cwd: dir, env: {} });
        expect(outcome.code).toBe(1);
    });
});
