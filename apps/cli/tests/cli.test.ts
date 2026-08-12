import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@gobing-ai/utils';
import { createProgram } from '../src/cli';

const FIXTURES_DIR = join(import.meta.dir, '../../../plugins');

describe('plugins subcommands', () => {
    it('plugins list prints discovered plugins and supports --json', async () => {
        const program = createProgram();
        program.exitOverride();

        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            await program.parseAsync(['node', 'test', 'plugins', 'list', '--plugins-root', FIXTURES_DIR, '--json']);
            const parsed = JSON.parse(outText);
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.some((p: { name: string }) => p.name === 'karakeep-local')).toBe(true);
        } finally {
            logger.out = originalOut;
        }
    });

    it('plugins list supports --kind filter and formatted text output', async () => {
        const program = createProgram();
        program.exitOverride();

        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            await program.parseAsync([
                'node',
                'test',
                'plugins',
                'list',
                '--kind',
                'ingestion',
                '--plugins-root',
                FIXTURES_DIR,
            ]);
            expect(outText).toContain('INGESTION PLUGINS');
            expect(outText).toContain('karakeep-local');
        } finally {
            logger.out = originalOut;
        }
    });

    it('plugins doctor reports clean status for healthy plugins root', async () => {
        const program = createProgram();
        program.exitOverride();

        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            await program.parseAsync(['node', 'test', 'plugins', 'doctor', '--plugins-root', FIXTURES_DIR]);
            expect(outText).toContain('healthy');
        } finally {
            logger.out = originalOut;
        }
    });

    it('plugins list exits 1 on invalid --kind argument', async () => {
        const exits: number[] = [];
        const originalExit = process.exit;
        const originalError = logger.error;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.error = () => {};

        try {
            const program = createProgram();
            program.exitOverride();
            try {
                await program.parseAsync(['node', 'test', 'plugins', 'list', '--kind', 'invalid-kind']);
            } catch {
                // Ignore process.exit mock
            }
            expect(exits).toContain(1);
        } finally {
            process.exit = originalExit;
            logger.error = originalError;
        }
    });

    it('plugins list outputs notice when no plugins are found', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-empty-plugins');
        await mkdir(tmpDir, { recursive: true });
        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            const program = createProgram();
            program.exitOverride();
            await program.parseAsync(['node', 'test', 'plugins', 'list', '--plugins-root', tmpDir]);
            expect(outText).toContain('No plugins found.');
        } finally {
            logger.out = originalOut;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugins doctor handles --json output mode for healthy and unhealthy states', async () => {
        const program = createProgram();
        program.exitOverride();
        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            await program.parseAsync(['node', 'test', 'plugins', 'doctor', '--plugins-root', FIXTURES_DIR, '--json']);
            const parsed = JSON.parse(outText);
            expect(parsed.healthy).toBe(true);
        } finally {
            logger.out = originalOut;
        }
    });

    it('plugins doctor detects missing entry file and handles unhealthy --json mode', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-doctor-missing-entry');
        const pluginDir = join(tmpDir, 'missing-entry-plugin');
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

        const exits: number[] = [];
        const originalExit = process.exit;
        let outText = '';
        const originalOut = logger.out;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.out = (msg: string) => {
            outText += msg;
        };

        try {
            const program = createProgram();
            program.exitOverride();
            try {
                await program.parseAsync(['node', 'test', 'plugins', 'doctor', '--plugins-root', tmpDir, '--json']);
            } catch {
                // Ignore process.exit mock
            }
            expect(exits).toContain(1);
            const parsed = JSON.parse(outText);
            expect(parsed.healthy).toBe(false);
            expect(parsed.diagnostics.some((d: { code: string }) => d.code === 'missing_entry')).toBe(true);
        } finally {
            process.exit = originalExit;
            logger.out = originalOut;
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
            const program = createProgram();
            program.exitOverride();
            await program.parseAsync(['node', 'test', 'fanin', '--in', aFile, '--in', bFile, '--out', outFile]);

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

        const exits: number[] = [];
        const originalExit = process.exit;
        const originalError = logger.error;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.error = () => {};

        try {
            const program = createProgram();
            program.exitOverride();
            try {
                await program.parseAsync([
                    'node',
                    'test',
                    'fanin',
                    '--in',
                    missing,
                    '--out',
                    join(tmpDir, 'merged.json'),
                ]);
            } catch {
                // Ignore process.exit mock
            }
            expect(exits).toContain(1);
        } finally {
            process.exit = originalExit;
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

        const exits: number[] = [];
        const originalExit = process.exit;
        const originalError = logger.error;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.error = () => {};

        try {
            const program = createProgram();
            program.exitOverride();
            try {
                await program.parseAsync([
                    'node',
                    'test',
                    'fanout',
                    '--content',
                    contentFile,
                    '--target',
                    'no-such-publish-plugin',
                    '--out',
                    join(tmpDir, 'result.json'),
                ]);
            } catch {
                // Ignore process.exit mock
            }
            expect(exits).toContain(2);
        } finally {
            process.exit = originalExit;
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('accepts --plugins-root and resolves publish targets under the given root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanout-plugins-root');
        await mkdir(join(tmpDir, 'fake-pub', 'src'), { recursive: true });
        await writeFile(
            join(tmpDir, 'fake-pub', 'plugin.json'),
            JSON.stringify({ name: 'fake-pub', kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
            'utf-8',
        );
        await writeFile(
            join(tmpDir, 'fake-pub', 'src', 'index.ts'),
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

        const exits: number[] = [];
        const originalExit = process.exit;
        const originalError = logger.error;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.error = () => {};

        try {
            const program = createProgram();
            program.exitOverride();
            await program.parseAsync([
                'node',
                'test',
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

            expect(exits).toEqual([]);
            const result = JSON.parse(await readFile(outFile, 'utf-8'));
            expect(result.ok).toBe(true);
            expect(result.targets[0]).toMatchObject({ target: 'fake-pub', status: 'published' });
        } finally {
            process.exit = originalExit;
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
