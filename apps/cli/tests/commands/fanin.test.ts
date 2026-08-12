import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerFaninCommand } from '../../src/commands/fanin';
import { main } from '../../src/main';

describe('registerFaninCommand', () => {
    it('registers fanin with repeatable --in and required --out', () => {
        const program = new Command();
        registerFaninCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'fanin');
        expect(cmd).toBeDefined();
        const inOpt = cmd?.options.find((o) => o.long === '--in');
        const outOpt = cmd?.options.find((o) => o.long === '--out');
        expect(inOpt?.required).toBe(true);
        expect(outOpt?.required).toBe(true);
    });

    it('main returns 1 when an input file is missing (no process.exit in the module)', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanin-missing');
        await mkdir(tmpDir, { recursive: true });

        const originalError = logger.error;
        logger.error = () => {};
        try {
            const code = await main([
                'node',
                'test',
                'fanin',
                '--in',
                join(tmpDir, 'nope.json'),
                '--out',
                join(tmpDir, 'merged.json'),
            ]);
            expect(code).toBe(1);
        } finally {
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('main merges inputs and exits 0', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanin-merge');
        await mkdir(tmpDir, { recursive: true });
        const aFile = join(tmpDir, 'a.json');
        const outFile = join(tmpDir, 'merged.json');
        await writeFile(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]), 'utf-8');

        try {
            const code = await main(['node', 'test', 'fanin', '--in', aFile, '--out', outFile]);
            expect(code).toBe(0);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
