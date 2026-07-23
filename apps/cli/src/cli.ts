import { add, logger } from '@gobing-ai/utils';
import { Command } from 'commander';

/** Create a Commander CLI program with an add subcommand. */
export function createProgram(): Command {
    const program = new Command().name('knowledge-kit').description('knowledge-kit CLI').version('0.0.0');

    const parseIntArg = (v: string): number => Number.parseInt(v, 10);

    program
        .command('add')
        .description('Add two numbers')
        .argument('<a>', 'first number', parseIntArg)
        .argument('<b>', 'second number', parseIntArg)
        .action((a, b) => {
            logger.out(`${add(a, b)}\n`);
        });

    return program;
}
