import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

/** Feature I1 R2/R3/R4/R19/R20 (task 0355): the `kk wiki ingest` CLI surface, exit codes and config seam. */

const dirs: string[] = [];
function tempVault(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-ingest-')));
    dirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

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

describe('kk wiki ingest (CLI)', () => {
    it('writes a raw snapshot from a file with an explicit type and prints JSON', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'note.md'), '# Feed item\n\nBody.\n');
        const result = await run(['wiki', 'ingest', 'note.md', '--type', 'rss', '--json'], vault);
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.out) as { path: string; type: string; title: string };
        expect(payload.type).toBe('rss');
        expect(payload.title).toBe('Feed item');
        expect(readFileSync(payload.path, 'utf8')).toContain('source_uri: note.md');
        expect(payload.path).toStartWith(join(vault, 'raw', 'rss'));
    });

    it('prints a one-line summary without --json', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'note.md'), '# Plain\n');
        const result = await run(['wiki', 'ingest', 'note.md', '--type', 'rss'], vault);
        expect(result.code).toBe(0);
        expect(result.out).toContain('raw snapshot: ');
    });

    it('reads the real stdin stream through the CLI', async () => {
        const vault = tempVault();
        const proc = Bun.spawn(
            [
                'bun',
                join(import.meta.dir, '..', '..', 'src', 'index.ts'),
                'wiki',
                'ingest',
                '-',
                '--type',
                'rss',
                '--json',
            ],
            {
                cwd: vault,
                stdin: new TextEncoder().encode('# From stdin\n\nbody\n'),
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(code).toBe(0);
        const payload = JSON.parse(stdout) as { path: string };
        expect(readFileSync(payload.path, 'utf8')).toContain('source_uri: stdin');
    });

    it('exits 2 naming the unsupported source type', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'blob.bin'), 'x');
        const result = await run(['wiki', 'ingest', 'blob.bin'], vault);
        expect(result.code).toBe(2);
        expect(result.err).toContain('unsupported source type');
    });

    it('exits 2 for an unknown --type value and writes nothing', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'note.md'), '# x\n');
        const result = await run(['wiki', 'ingest', 'note.md', '--type', 'docx'], vault);
        expect(result.code).toBe(2);
        expect(result.err).toContain("unsupported --type 'docx'");
    });

    it('honours --out and the KK_WIKI_RAW environment override over kk.config.json', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'note.md'), '# x\n');
        writeFileSync(join(vault, 'kk.config.json'), JSON.stringify({ wiki: { raw: 'from-file' } }));

        const fromFile = await run(['wiki', 'ingest', 'note.md', '--type', 'rss', '--json'], vault);
        expect((JSON.parse(fromFile.out) as { path: string }).path).toContain(join(vault, 'from-file'));

        process.env.KK_WIKI_RAW = 'from-env';
        try {
            const fromEnv = await run(['wiki', 'ingest', 'note.md', '--type', 'rss', '--json'], vault);
            expect((JSON.parse(fromEnv.out) as { path: string }).path).toContain(join(vault, 'from-env'));
            const fromFlag = await run(
                ['wiki', 'ingest', 'note.md', '--type', 'rss', '--out', 'from-flag', '--json'],
                vault,
            );
            expect((JSON.parse(fromFlag.out) as { path: string }).path).toContain(join(vault, 'from-flag'));
        } finally {
            delete process.env.KK_WIKI_RAW;
        }
    });

    it('exits 1 with a JSON error when the config file is invalid', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'note.md'), '# x\n');
        writeFileSync(join(vault, 'kk.config.json'), JSON.stringify({ wiki: { nope: 1 } }));
        const result = await run(['wiki', 'ingest', 'note.md', '--type', 'rss', '--json'], vault);
        expect(result.code).toBe(1);
        expect(JSON.parse(result.out)).toEqual({
            ok: false,
            error: expect.stringContaining('unsupported key wiki.nope'),
        });
    });
});
