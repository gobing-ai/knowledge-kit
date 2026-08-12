import { describe, expect, it } from 'bun:test';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerAddCommand } from '../../src/commands/add';

describe('registerAddCommand', () => {
    it('registers the add subcommand with two numeric arguments', () => {
        const program = new Command();
        registerAddCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'add');
        expect(cmd).toBeDefined();
        expect(cmd?.description()).toContain('Add');
    });

    it('prints the sum to stdout when run through the program', async () => {
        const program = new Command();
        registerAddCommand(program);
        program.exitOverride();

        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };
        try {
            await program.parseAsync(['node', 'test', 'add', '20', '22']);
            expect(outText).toBe('42\n');
        } finally {
            logger.out = originalOut;
        }
    });
});
