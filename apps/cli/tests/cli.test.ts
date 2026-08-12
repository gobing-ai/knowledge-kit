import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionForKind } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { main } from '../src/main';

const FIXTURES_DIR = join(import.meta.dir, '../../../plugins');

interface RunResult {
    code: number;
    out: string;
    err: string;
}

/** Run main with captured stdout/stderr; argv omits node/script (main slices them). */
async function run(args: string[]): Promise<RunResult> {
    let out = '';
    let err = '';
    const code = await main(['node', 'test', ...args], {
        stdout: (text: string) => {
            out += text;
        },
        stderr: (text: string) => {
            err += text;
        },
    });
    return { code, out, err };
}

/** Capture logger.out (command action stdout) into a string. */
function captureOut(): { read: () => string; restore: () => void } {
    let text = '';
    const originalOut = logger.out;
    logger.out = (msg: string) => {
        text += msg;
    };
    return { read: () => text, restore: () => (logger.out = originalOut) };
}

describe('plugins subcommands', () => {
    it('plugins list prints discovered plugins and supports --json', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'list', '--plugins-root', FIXTURES_DIR, '--json']);
            expect(code).toBe(0);
            const parsed = JSON.parse(read());
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.some((p: { name: string }) => p.name === 'karakeep-local')).toBe(true);
        } finally {
            restore();
        }
    });

    it('plugins list supports --kind filter and formatted text output', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'list', '--kind', 'ingestion', '--plugins-root', FIXTURES_DIR]);
            expect(code).toBe(0);
            expect(read()).toContain('INGESTION PLUGINS');
            expect(read()).toContain('karakeep-local');
        } finally {
            restore();
        }
    });

    it('plugins doctor reports clean status for healthy plugins root', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'doctor', '--plugins-root', FIXTURES_DIR]);
            expect(code).toBe(0);
            expect(read()).toContain('healthy');
        } finally {
            restore();
        }
    });

    it('plugins list exits 1 on invalid --kind argument', async () => {
        const originalError = logger.error;
        let errText = '';
        logger.error = (msg: string) => {
            errText += msg;
        };
        try {
            const { code } = await run(['plugins', 'list', '--kind', 'invalid-kind']);
            expect(code).toBe(1);
            expect(errText).toContain('Invalid plugin kind');
        } finally {
            logger.error = originalError;
        }
    });

    it('plugins list outputs notice when no plugins are found', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-empty-plugins');
        await mkdir(tmpDir, { recursive: true });
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'list', '--plugins-root', tmpDir]);
            expect(code).toBe(0);
            expect(read()).toContain('No plugins found.');
        } finally {
            restore();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugins doctor handles --json output mode for healthy and unhealthy states', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'doctor', '--plugins-root', FIXTURES_DIR, '--json']);
            expect(code).toBe(0);
            const parsed = JSON.parse(read());
            expect(parsed.healthy).toBe(true);
        } finally {
            restore();
        }
    });

    it('plugins doctor detects missing entry file and handles unhealthy --json mode', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-doctor-missing-entry');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'missing-entry-plugin');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({
                name: 'missing-entry-plugin',
                kind: 'ingestion',
                entry: './non-existent-file.js',
                version: '1.0.0',
            }),
            'utf-8',
        );

        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'doctor', '--plugins-root', tmpDir, '--json']);
            expect(code).toBe(1);
            const parsed = JSON.parse(read());
            expect(parsed.healthy).toBe(false);
            expect(parsed.diagnostics.some((d: { code: string }) => d.code === 'missing_entry')).toBe(true);
        } finally {
            restore();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugins doctor exits 1 with text diagnostics for an unhealthy root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-doctor-missing-entry-text');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'missing-entry-plugin');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({
                name: 'missing-entry-plugin',
                kind: 'ingestion',
                entry: './non-existent-file.js',
                version: '1.0.0',
            }),
            'utf-8',
        );

        const originalError = logger.error;
        let errText = '';
        logger.error = (msg: string) => {
            errText += msg;
        };
        try {
            const { code } = await run(['plugins', 'doctor', '--plugins-root', tmpDir]);
            expect(code).toBe(1);
            expect(errText).toContain('missing_entry');
        } finally {
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('fanin subcommand', () => {
    it('merges repeated --in inputs into one deduplicated --out file', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanin-merge');
        await mkdir(tmpDir, { recursive: true });
        const aFile = join(tmpDir, 'a.json');
        const bFile = join(tmpDir, 'b.json');
        const outFile = join(tmpDir, 'merged.json');
        await writeFile(
            aFile,
            JSON.stringify([
                { id: 'd1', body: 'alpha' },
                { id: 'd2', body: 'first' },
            ]),
            'utf-8',
        );
        await writeFile(bFile, JSON.stringify([{ id: 'd2', body: 'second' }]), 'utf-8');

        try {
            const { code } = await run(['fanin', '--in', aFile, '--in', bFile, '--out', outFile]);
            expect(code).toBe(0);

            const merged = JSON.parse(await readFile(outFile, 'utf-8'));
            expect(merged.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
            expect(merged[1].metadata.sources).toEqual([{ file: aFile }, { file: bFile }]);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('propagates a non-zero exit when an input file is missing', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanin-missing');
        await mkdir(tmpDir, { recursive: true });
        const missing = join(tmpDir, 'nope.json');

        const originalError = logger.error;
        logger.error = () => {};
        try {
            const { code } = await run(['fanin', '--in', missing, '--out', join(tmpDir, 'merged.json')]);
            expect(code).toBe(1);
        } finally {
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('fanout subcommand', () => {
    it('propagates a non-zero exit when a target cannot be resolved to a publish plugin', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanout-missing');
        await mkdir(tmpDir, { recursive: true });
        const contentFile = join(tmpDir, 'content.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        const originalError = logger.error;
        logger.error = () => {};
        try {
            const { code } = await run([
                'fanout',
                '--content',
                contentFile,
                '--target',
                'no-such-publish-plugin',
                '--out',
                join(tmpDir, 'result.json'),
            ]);
            expect(code).toBe(2);
        } finally {
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('accepts --plugins-root and resolves publish targets under the given root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanout-plugins-root');
        const pluginDir = join(tmpDir, collectionForKind('publish'), 'fake-pub');
        await mkdir(join(pluginDir, 'src'), { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'fake-pub', kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
            'utf-8',
        );
        await writeFile(
            join(pluginDir, 'src', 'index.ts'),
            [
                "import { readFileSync, writeFileSync } from 'node:fs';",
                'const argv = process.argv.slice(2);',
                "const inPath = argv[argv.indexOf('--in') + 1];",
                "const outPath = argv[argv.indexOf('--out') + 1];",
                "readFileSync(inPath, 'utf-8');",
                "writeFileSync(outPath, JSON.stringify({ ok: true, target: 'fake-pub', url: 'https://example.com/fake', id: 'fake-1', message: 'published' }));",
            ].join('\n'),
            'utf-8',
        );
        const contentFile = join(tmpDir, 'content.json');
        const outFile = join(tmpDir, 'result.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        try {
            const { code } = await run([
                'fanout',
                '--content',
                contentFile,
                '--target',
                'fake-pub',
                '--out',
                outFile,
                '--plugins-root',
                tmpDir,
            ]);
            expect(code).toBe(0);

            const result = JSON.parse(await readFile(outFile, 'utf-8'));
            expect(result.ok).toBe(true);
            expect(result.targets[0]).toMatchObject({ target: 'fake-pub', status: 'published' });
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
