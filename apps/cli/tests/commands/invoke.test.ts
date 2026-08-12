import { describe, expect, it } from 'bun:test';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerInvokeCommand } from '../../src/commands/invoke';
import { main } from '../../src/main';

describe('registerInvokeCommand', () => {
    it('registers invoke with the shipped flags (--in/--out required, --plugins-root optional)', () => {
        const program = new Command();
        registerInvokeCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'invoke');
        expect(cmd).toBeDefined();
        const longs = cmd?.options.map((o) => o.long) ?? [];
        expect(longs).toEqual(expect.arrayContaining(['--in', '--out', '--plugins-root']));
        for (const required of ['--in', '--out']) {
            expect(cmd?.options.find((o) => o.long === required)?.mandatory).toBe(true);
        }
        expect(cmd?.options.find((o) => o.long === '--plugins-root')?.mandatory).toBe(false);
    });

    it('main returns 1 when the plugin is missing (no process.exit in the module)', async () => {
        const originalError = logger.error;
        logger.error = () => {};
        try {
            const code = await main([
                'node',
                'test',
                'invoke',
                'non-existent',
                '--in',
                'in.json',
                '--out',
                'out.json',
                '--plugins-root',
                '/tmp',
            ]);
            expect(code).toBe(1);
        } finally {
            logger.error = originalError;
        }
    });
});
