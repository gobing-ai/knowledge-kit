import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MissingNormalizerError } from '@gobing-ai/kk-wiki';
import { detectSourceType, readStdin, runIngest } from '../../src/wiki/ingest';

/** Feature I1 R2/R3/R5 (task 0355): the ingest engine behind `kk wiki ingest`. */

const dirs: string[] = [];
function tempVault(): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-wiki-ingest-')));
    dirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe('detectSourceType', () => {
    it('maps extensions and http(s) schemes, and refuses everything else', () => {
        expect(detectSourceType('a.html')).toBe('html');
        expect(detectSourceType('a.HTM')).toBe('html');
        expect(detectSourceType('a.pdf')).toBe('pdf');
        expect(detectSourceType('https://example.com/a')).toBe('url');
        expect(detectSourceType('a.bin')).toBeUndefined();
        expect(detectSourceType('-')).toBeUndefined();
    });
});

describe('readStdin', () => {
    it('joins every chunk of the supplied stream', async () => {
        async function* chunks(): AsyncIterable<Uint8Array> {
            yield new TextEncoder().encode('# Part one\n');
            yield new TextEncoder().encode('body\n');
        }
        expect(await readStdin(chunks())).toBe('# Part one\nbody\n');
    });
});

describe('runIngest', () => {
    it('reads stdin when the source is -', async () => {
        const vault = tempVault();
        const outcome = await runIngest(
            { source: '-', type: 'rss' },
            { cwd: vault, env: {}, readStdin: async () => '# Piped\n' },
        );
        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
            expect(outcome.payload.path).toContain(join(vault, 'raw', 'rss'));
            expect(readFileSync(outcome.payload.path, 'utf8')).toContain('source_uri: stdin');
        }
    });

    it('exits 2 when stdin is used without --type', async () => {
        const outcome = await runIngest({ source: '-' }, { cwd: tempVault(), env: {} });
        expect(outcome).toMatchObject({ ok: false, code: 2 });
    });

    it('routes html through the injected normaliser', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'a.html'), '<h1>Raw html</h1>');
        const outcome = await runIngest(
            { source: 'a.html' },
            { cwd: vault, env: {}, markitdown: async () => '# Converted html\n' },
        );
        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
            expect(outcome.payload.type).toBe('html');
            expect(readFileSync(outcome.payload.path, 'utf8')).toContain('# Converted html');
        }
    });

    it('exits 1 naming the missing normaliser instead of writing an empty snapshot', async () => {
        const vault = tempVault();
        writeFileSync(join(vault, 'a.pdf'), '%PDF');
        const outcome = await runIngest(
            { source: 'a.pdf' },
            {
                cwd: vault,
                env: {},
                markitdown: async () => {
                    throw new MissingNormalizerError('markitdown');
                },
            },
        );
        expect(outcome).toMatchObject({ ok: false, code: 1 });
        if (!outcome.ok) expect(outcome.payload.error).toContain('missing normaliser');
    });

    it('exits 1 for a read failure on a declared source', async () => {
        const outcome = await runIngest({ source: 'missing.md', type: 'rss' }, { cwd: tempVault(), env: {} });
        expect(outcome.ok).toBe(false);
        if (!outcome.ok) expect(outcome.payload.error).toContain('ingest failed');
    });
});
