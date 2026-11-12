import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { runSummarize, runSynthesize } from '../../src/wiki/write-verbs';
import { captureOutput } from '../capture';

/** Feature I1 R5/R6/R7/R8/R9/R21 (task 0357): the two model-fed write verbs. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-write-cli-')));
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

describe('kk wiki synthesize (CLI)', () => {
    it('creates a page from a file-sourced body and reports it as created', async () => {
        const dir = vault({ 'index.md': page('Home', 'x') });
        writeFileSync(join(dir, 'text.md'), 'HNSW notes.\n');
        const result = await run(['wiki', 'synthesize', 'Vector index', '--from', 'text.md', '--json'], dir);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { created: boolean; path: string };
        expect(payload.created).toBe(true);
        expect(readFileSync(join(dir, 'content', payload.path), 'utf8')).toContain('HNSW notes.');
    });

    it('extends an existing page and prints the guard decision', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'intro') });
        writeFileSync(join(dir, 'text.md'), 'more\n');
        const result = await run(['wiki', 'synthesize', 'Alpha', '--from', 'text.md'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('guard: ');
    });

    it('reads stdin and keeps a guarded page body intact', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'operator prose', 'user_edited: true\n') });
        const outcome = await runSynthesize({
            cwd: dir,
            env: {},
            target: 'Alpha',
            from: '-',
            readStdin: async () => 'agent note\n',
        });
        expect(outcome.code).toBe(0);
        expect(outcome.payload).toMatchObject({ guard: 'appended', created: false });
        const text = readFileSync(join(dir, 'content', 'a.md'), 'utf8');
        expect(text).toContain('## AI Updates (');
        expect(text.split('## AI Updates')[0]).toContain('operator prose');
    });

    it('exits 1 for a config defect', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'x') });
        writeFileSync(join(dir, 'kk.config.json'), JSON.stringify({ wiki: { nope: 1 } }));
        const result = await run(['wiki', 'synthesize', 'Alpha', '--from', '-', '--json'], dir);
        expect(result.code).toBe(1);
        expect(result.out).toContain('unsupported key');
    });
});

describe('kk wiki summarize (CLI)', () => {
    it('places a summary into an existing page', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'body') });
        writeFileSync(join(dir, 'text.md'), 'short summary\n');
        const result = await run(['wiki', 'summarize', 'a.md', '--from', 'text.md', '--json'], dir);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out)).toMatchObject({ guard: 'clean', links: 0 });
        expect(readFileSync(join(dir, 'content', 'a.md'), 'utf8')).toContain('## Summary');
    });

    it('exits 1 when the target page does not exist', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'body') });
        writeFileSync(join(dir, 'text.md'), 'x\n');
        const result = await run(['wiki', 'summarize', 'missing.md', '--from', 'text.md', '--json'], dir);
        expect(result.code).toBe(1);
        expect(result.out).toContain("no page at 'missing.md'");
    });

    it('prints the missing-page error on stderr when --json is omitted', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'body') });
        writeFileSync(join(dir, 'text.md'), 'x\n');
        const result = await run(['wiki', 'summarize', 'missing.md', '--from', 'text.md'], dir);
        expect(result.code).toBe(1);
        expect(result.err).toContain("no page at 'missing.md'");
    });

    it('exposes outcomes to direct callers', async () => {
        const dir = vault({ 'a.md': page('Alpha', 'body') });
        writeFileSync(join(dir, 'text.md'), 'summary\n');
        const outcome = await runSummarize({ cwd: dir, env: {}, target: 'a.md', from: 'text.md' });
        expect(outcome.ok).toBe(true);
    });
});
