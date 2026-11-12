import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { runCompile, runGc, runMerge } from '../../src/wiki/maintenance';
import { captureOutput } from '../capture';

/** Feature I1 R10/R11/R14 (task 0358): merge, compile and gc. */

const dirs: string[] = [];
function vault(files: Record<string, string>): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-maint-')));
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

describe('kk wiki compile (CLI)', () => {
    it('writes index.md and MAP.md, then reports an up-to-date second run', async () => {
        const dir = vault({ 'content/concepts/a.md': page('Alpha', 'summary line') });
        const first = await run(['wiki', 'compile', '--json'], dir);
        expect(first.code).toBe(0);
        expect((JSON.parse(first.out) as { written: string[] }).written).toEqual(['index.md', 'MAP.md']);
        const second = await run(['wiki', 'compile'], dir);
        expect(second.out).toContain('already up to date');
        expect(readFileSync(join(dir, 'content/index.md'), 'utf8')).toContain('[[alpha|Alpha]]');
    });
});

describe('kk wiki merge (CLI)', () => {
    it('merges two pages and writes the redirect stub', async () => {
        const dir = vault({
            'content/a.md': page('Alpha', 'alpha body'),
            'content/b.md': page('Beta', 'beta body'),
            'content/c.md': page('Gamma', 'see [[Alpha]]'),
        });
        const result = await run(['wiki', 'merge', 'a.md', 'b.md', '--json'], dir);
        expect(result.code).toBe(0);
        expect(readFileSync(join(dir, 'content/b.md'), 'utf8')).toContain('alpha body');
        expect(readFileSync(join(dir, 'content/a.md'), 'utf8')).toContain('redirect_to: beta');
        expect(readFileSync(join(dir, 'content/c.md'), 'utf8')).toContain('[[beta]]');
    });

    it('refuses a guarded source page with exit 1', async () => {
        const dir = vault({
            'content/a.md': page('Alpha', 'operator', 'user_edited: true\n'),
            'content/b.md': page('Beta', 'beta body'),
        });
        const result = await run(['wiki', 'merge', 'a.md', 'b.md', '--json'], dir);
        expect(result.code).toBe(1);
        expect(result.out).toContain('merge refused');
    });
});

describe('kk wiki gc (CLI)', () => {
    it('prints the plan and deletes nothing without --yes', async () => {
        const dir = vault({ 'content/a.md': page('Alpha', 'x'), 'raw/html/orphan.md': 'y' });
        const result = await run(['wiki', 'gc', '--json'], dir);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { plan: { delete: string[] }; deleted: string[] };
        expect(payload.plan.delete).toHaveLength(1);
        expect(payload.deleted).toEqual([]);
        expect(readFileSync(join(dir, 'raw/html/orphan.md'), 'utf8')).toBe('y');
    });

    it('deletes with --yes and skips a declared mirror', async () => {
        const dir = vault({
            'content/a.md': page('Alpha', 'x'),
            'kk.config.json': JSON.stringify({ wiki: { mirrors: ['raw/karakeep'] } }),
            'raw/html/orphan.md': 'y',
            'raw/karakeep/item.md': 'mirror',
        });
        const result = await run(['wiki', 'gc', '--yes', '--json'], dir);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { deleted: string[]; plan: { skippedMirrors: string[] } };
        expect(payload.deleted).toHaveLength(1);
        expect(payload.plan.skippedMirrors).toEqual(['raw/karakeep']);
        expect(readFileSync(join(dir, 'raw/karakeep/item.md'), 'utf8')).toBe('mirror');
    });

    it('exposes outcomes to direct callers and reports config defects', async () => {
        const dir = vault({ 'content/a.md': page('Alpha', 'x') });
        expect((await runMerge({ cwd: dir, env: {}, from: 'a.md', to: 'a.md' })).code).toBe(0);
        expect((await runCompile({ cwd: dir, env: {} })).code).toBe(0);
        expect((await runGc({ cwd: dir, env: {} })).code).toBe(0);
        writeFileSync(join(dir, 'kk.config.json'), '{ bad');
        expect((await runGc({ cwd: dir, env: {} })).code).toBe(1);
    });
});
