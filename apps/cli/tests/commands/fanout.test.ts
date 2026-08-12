import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerFanoutCommand } from '../../src/commands/fanout';
import { main } from '../../src/main';

describe('registerFanoutCommand', () => {
    it('registers fanout with the shipped flags (--content/--out required)', () => {
        const program = new Command();
        registerFanoutCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'fanout');
        expect(cmd).toBeDefined();
        const longs = cmd?.options.map((o) => o.long) ?? [];
        expect(longs).toEqual(
            expect.arrayContaining(['--content', '--target', '--out', '--retry-from', '--plugins-root']),
        );
        for (const required of ['--content', '--out']) {
            expect(cmd?.options.find((o) => o.long === required)?.mandatory).toBe(true);
        }
        expect(cmd?.options.find((o) => o.long === '--target')?.mandatory).toBe(false);
    });

    it('main returns 2 when a target cannot be resolved (no process.exit in the module)', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanout-missing');
        await mkdir(tmpDir, { recursive: true });
        const contentFile = join(tmpDir, 'content.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        const originalError = logger.error;
        logger.error = () => {};
        try {
            const code = await main([
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
            expect(code).toBe(2);
        } finally {
            logger.error = originalError;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
