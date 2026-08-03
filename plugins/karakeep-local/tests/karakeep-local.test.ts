import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runInvoke } from '../../../apps/cli/src/invoke';
import { main, processKarakeepFolder } from '../src/index';

const FIXTURES_DIR = join(import.meta.dir, 'fixtures');
const OUT_FILE = join(import.meta.dir, 'output.json');

describe('karakeep-local plugin', () => {
    test('processKarakeepFolder parses sample fixtures accurately', async () => {
        const docs = await processKarakeepFolder(FIXTURES_DIR);
        expect(docs.length).toBeGreaterThanOrEqual(2);

        const sample1 = docs.find((d) => d.title === 'Sample Article Title');
        expect(sample1).toBeDefined();
        expect(sample1?.body).toContain('sample markdown body');
        expect(sample1?.sourceUri).toBe('https://example.com/articles/sample-1');
        expect(sample1?.metadata?.author).toBe('Test Author');

        const sample2 = docs.find((d) => d.title === 'Standalone JSON Note');
        expect(sample2).toBeDefined();
        expect(sample2?.body).toBe('Body inside JSON note.');
    });

    test('Doc IDs are deterministic across re-runs', async () => {
        const docs1 = await processKarakeepFolder(FIXTURES_DIR);
        const docs2 = await processKarakeepFolder(FIXTURES_DIR);

        expect(docs1.map((d) => d.id)).toEqual(docs2.map((d) => d.id));
    });

    test('invocable via knowledge-kit invoke (runInvoke)', async () => {
        try {
            await runInvoke({
                plugin: 'karakeep-local',
                inPath: FIXTURES_DIR,
                outPath: OUT_FILE,
                pluginsRoot: join(import.meta.dir, '../..'),
            });

            const content = await readFile(OUT_FILE, 'utf-8');
            const parsed = JSON.parse(content);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThanOrEqual(2);
        } finally {
            await rm(OUT_FILE, { force: true });
        }
    });
});

const ORIGINAL_ARGV = process.argv;

afterEach(() => {
    process.argv = ORIGINAL_ARGV;
});

describe('karakeep-local failure semantics', () => {
    test('corrupt standalone JSON is skipped, valid items still emitted', async () => {
        const dir = join(import.meta.dir, 'tmp-corrupt');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'broken.json'), '{ not valid json', 'utf-8');
        await writeFile(join(dir, 'good.json'), JSON.stringify({ body: 'ok', title: 'Good' }), 'utf-8');
        // Negative path: plugin warns on the corrupt file intentionally; silence so --dots stays clean.
        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        try {
            const docs = await processKarakeepFolder(dir);
            expect(docs.length).toBe(1);
            expect(docs[0]?.title).toBe('Good');
        } finally {
            errorSpy.mockRestore();
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('standalone markdown file is parsed as a Doc', async () => {
        const dir = join(import.meta.dir, 'tmp-standalone-md');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'standalone.md'), '# Standalone Content', 'utf-8');
        try {
            const docs = await processKarakeepFolder(dir);
            expect(docs.length).toBe(1);
            expect(docs[0]?.title).toBe('standalone.md');
            expect(docs[0]?.mediaType).toBe('text/markdown');
            expect(docs[0]?.body).toBe('# Standalone Content');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('empty source folder yields empty array', async () => {
        const dir = join(import.meta.dir, 'tmp-empty');
        await mkdir(dir, { recursive: true });
        try {
            const docs = await processKarakeepFolder(dir);
            expect(docs).toEqual([]);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('corrupt meta.json falls back to defaults for a paired content.md', async () => {
        const dir = join(import.meta.dir, 'tmp-corrupt-meta', 'item1');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'content.md'), '# Body', 'utf-8');
        await writeFile(join(dir, 'meta.json'), '{ broken', 'utf-8');
        // Negative path: plugin warns on the corrupt meta intentionally; silence so --dots stays clean.
        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        try {
            const docs = await processKarakeepFolder(join(import.meta.dir, 'tmp-corrupt-meta'));
            expect(docs.length).toBe(1);
            expect(docs[0]?.title).toBe('item1');
            expect(docs[0]?.mediaType).toBe('text/markdown');
        } finally {
            errorSpy.mockRestore();
            await rm(join(import.meta.dir, 'tmp-corrupt-meta'), { recursive: true, force: true });
        }
    });

    test('main writes docs for --in/--out argv', async () => {
        const out = join(import.meta.dir, 'tmp-main-out.json');
        process.argv = ['bun', 'index.ts', '--in', FIXTURES_DIR, '--out', out];
        try {
            await main();
            const parsed = JSON.parse(await readFile(out, 'utf-8'));
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThanOrEqual(2);
        } finally {
            await rm(out, { force: true });
        }
    });

    test('main exits 1 on missing args', async () => {
        process.argv = ['bun', 'index.ts'];
        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        try {
            await expect(main()).rejects.toThrow('exit:1');
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
            exitSpy.mockRestore();
        }
    });

    test('main exits 1 on unreadable source', async () => {
        const out = join(import.meta.dir, 'tmp-main-out2.json');
        process.argv = ['bun', 'index.ts', '--in', join(import.meta.dir, 'no-such-dir'), '--out', out];
        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);
        try {
            await expect(main()).rejects.toThrow('exit:1');
        } finally {
            errorSpy.mockRestore();
            exitSpy.mockRestore();
            await rm(out, { force: true });
        }
    });

    test('processKarakeepFolder throws if inDir is a file not a directory', async () => {
        const filePath = join(import.meta.dir, 'tmp-not-a-dir.txt');
        await writeFile(filePath, 'hello', 'utf-8');
        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(processKarakeepFolder(filePath)).rejects.toThrow('Inaccessible source path');
        } finally {
            errorSpy.mockRestore();
            await rm(filePath, { force: true });
        }
    });

    test('main exits 1 on non-empty source yielding zero docs', async () => {
        const dir = join(import.meta.dir, 'tmp-all-rejected');
        const out = join(import.meta.dir, 'tmp-rejected-out.json');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'bad1.json'), JSON.stringify({ title: 'No body' }), 'utf-8');
        process.argv = ['bun', 'index.ts', '--in', dir, '--out', out];

        const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
        const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit:${code}`);
        }) as never);

        try {
            await expect(main()).rejects.toThrow('exit:1');
            expect(errorSpy).toHaveBeenCalled();
            expect(errorSpy.mock.calls.some((call) => call[0].includes('zero ingestible documents'))).toBe(true);
        } finally {
            errorSpy.mockRestore();
            exitSpy.mockRestore();
            await rm(dir, { recursive: true, force: true });
            await rm(out, { force: true });
        }
    });

    test('main creates nested --out parent directory if it does not exist', async () => {
        const outDir = join(import.meta.dir, 'tmp-nested-dir');
        const out = join(outDir, 'output.json');
        process.argv = ['bun', 'index.ts', '--in', FIXTURES_DIR, '--out', out];

        try {
            await main();
            const parsed = JSON.parse(await readFile(out, 'utf-8'));
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBeGreaterThanOrEqual(2);
        } finally {
            await rm(outDir, { recursive: true, force: true });
        }
    });
});
