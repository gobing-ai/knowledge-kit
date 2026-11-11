import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { runContext, runPublish, runQuery, runSync } from '../../src/wiki/retrieval';
import { captureOutput } from '../capture';

/** Feature I1 R15/R16/R24/R17/R18 (task 0354): publish, sync, query and context. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-retr-')));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files)) {
        const full = join(dir, name);
        mkdirSync(join(full, '..'), { recursive: true });
        writeFileSync(full, body);
    }
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const page = (title: string, body: string) =>
    `---\ntitle: ${title}\ntype: concept\nupdated_at: 2026-11-10\n---\n\n${body}\n`;

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
    'content/index.md': page('Home', '[[Vector index]]'),
    'content/concepts/vector-index.md': page('Vector index', 'Retrieval structures.'),
    'content/concepts/chunking.md': page('Chunking', 'Retrieval splits documents.'),
    'content/entities/publisher.md': page('Publisher', 'Publishing pipeline.'),
    'kk.config.json': JSON.stringify({
        wiki: { remotes: { r2: { command: 'rclone sync {content} {remote}', remote: 'r2:treasury/raw' } } },
    }),
};

describe('kk wiki publish (CLI)', () => {
    it('writes the tree under <target>/content and keeps wikilinks', async () => {
        const dir = vault(fixture);
        const target = join(dir, 'out', 'wiki');
        const result = await run(['wiki', 'publish', '--target', target, '--json'], dir);
        expect(result.code).toBe(0);
        expect(readFileSync(join(target, 'content', 'index.md'), 'utf8')).toContain('[[Vector index]]');
    });

    it('refuses a target inside content/ with a usage exit', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'publish', '--target', join(dir, 'content', 'out'), '--json'], dir);
        expect(result.code).toBe(2);
        expect(result.out).toContain('target is inside the vault');
    });
});

describe('kk wiki sync (CLI)', () => {
    it('resolves the declared remote without transferring', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'sync', 'r2', '--dry-run', '--json'], dir);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { command: string; dryRun: boolean };
        expect(payload.command).toContain('rclone sync');
        expect(payload.dryRun).toBe(true);
    });

    it('exits 2 naming an undeclared remote', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'sync', 'dropbox', '--json'], dir);
        expect(result.code).toBe(2);
        expect(result.out).toContain("unknown remote 'dropbox'");
    });
});

describe('kk wiki query / context (CLI)', () => {
    it('ranks pages with their paths', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'query', 'retrieval', '--json'], dir);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { hits: { path: string }[] };
        expect(payload.hits.map((hit) => hit.path)).toContain('concepts/vector-index.md');
    });

    it('packs the topic page with its neighbours', async () => {
        const dir = vault(fixture);
        const result = await run(['wiki', 'context', 'Vector index'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('## concepts/vector-index.md');
        expect(result.out).toContain('## index.md');
    });

    it('exposes outcomes to direct callers', async () => {
        const dir = vault(fixture);
        expect((await runQuery({ cwd: dir, env: {}, value: 'retrieval' })).code).toBe(0);
        expect((await runContext({ cwd: dir, env: {}, value: 'Chunking' })).code).toBe(0);
        expect((await runSync({ cwd: dir, env: {}, value: 'r2' })).code).toBe(0);
        expect((await runPublish({ cwd: dir, env: {}, value: join(dir, 'out2') })).code).toBe(0);
    });
});

describe('retrieval error paths', () => {
    it('reports a config defect as exit 1 for every retrieval verb', async () => {
        const dir = vault({ 'content/a.md': page('Alpha', 'x'), 'kk.config.json': '{ bad' });
        const query = await run(['wiki', 'query', 'alpha', '--json'], dir);
        expect(query.code).toBe(1);
        expect(query.out).toContain('invalid JSON');
        const context = await run(['wiki', 'context', 'Alpha', '--json'], dir);
        expect(context.code).toBe(1);
        const publish = await run(['wiki', 'publish', '--target', join(dir, 'out'), '--json'], dir);
        expect(publish.code).toBe(1);
        const sync = await run(['wiki', 'sync', 'r2', '--json'], dir);
        expect(sync.code).toBe(1);
    });

    it('reports a publish write failure as exit 1', async () => {
        const dir = vault(fixture);
        const outcome = await runPublish({ cwd: dir, env: {}, value: join(dir, 'content', 'index.md') });
        expect(outcome.ok).toBe(false);
        expect(outcome.code).toBe(2);
    });

    it('prints the human-readable branch for each verb', async () => {
        const dir = vault(fixture);
        expect((await run(['wiki', 'publish', '--target', join(dir, 'out3')], dir)).out).toContain('published');
        expect((await run(['wiki', 'sync', 'r2'], dir)).out).toContain('remote: rclone sync');
        expect((await run(['wiki', 'query', 'retrieval'], dir)).out).toContain('concepts/vector-index.md');
        expect((await run(['wiki', 'sync', 'nope'], dir)).err).toContain('kk.wiki:');
    });
});
