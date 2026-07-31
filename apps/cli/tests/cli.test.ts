import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
