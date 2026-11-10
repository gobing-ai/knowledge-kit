import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { runLint } from '../../src/wiki/lint';
import { captureOutput } from '../capture';

/** Feature I1 R13/R23 (task 0351): `kk wiki lint` findings and exit code. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-lint-cli-')));
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

describe('kk wiki lint (CLI)', () => {
    it('exits 0 and prints a clean vault', async () => {
        const dir = vault({ 'index.md': page('Home', '[[a]]'), 'a.md': page('A', 'back to [[Home]]') });
        const result = await run(['wiki', 'lint'], dir);
        expect(result.code).toBe(0);
        expect(result.out).toContain('vault is clean');
    });

    it('exits 1 listing each finding with its path and line', async () => {
        const dir = vault({ 'a.md': page('A', 'see [[missing]]') });
        const result = await run(['wiki', 'lint'], dir);
        expect(result.code).toBe(1);
        expect(result.out).toContain('a.md:');
        expect(result.out).toContain('broken-link');
    });

    it('prints one JSON document with the findings and page count', async () => {
        const dir = vault({ 'a.md': page('A', 'see [[missing]]') });
        const result = await run(['wiki', 'lint', '--json'], dir);
        expect(result.code).toBe(1);
        const payload = JSON.parse(result.out) as { ok: boolean; pages: number; findings: { code: string }[] };
        expect(payload.ok).toBe(false);
        expect(payload.pages).toBe(1);
        expect(payload.findings.map((finding) => finding.code)).toContain('broken-link');
    });

    it('reports a config error as exit 1', async () => {
        const dir = vault({});
        writeFileSync(join(dir, 'kk.config.json'), JSON.stringify({ wiki: { nope: true } }));
        const result = await run(['wiki', 'lint', '--json'], dir);
        expect(result.code).toBe(1);
        expect(result.out).toContain('unsupported key wiki.nope');
    });

    it('exposes the outcome to direct callers', async () => {
        const dir = vault({ 'a.md': page('A', 'x') });
        const outcome = await runLint({ cwd: dir, env: {} });
        expect(outcome.code).toBe(1);
    });
});
