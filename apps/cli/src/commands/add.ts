import { add, logger } from '@gobing-ai/utils';
import type { Command } from 'commander';

/** Register the `add` subcommand (arithmetic sanity verb). */
export function registerAddCommand(program: Command): void {
    const parseIntArg = (v: string): number => Number.parseInt(v, 10);

    program
        .command('add')
        .description('Add two numbers')
        .argument('<a>', 'first number', parseIntArg)
        .argument('<b>', 'second number', parseIntArg)
        .action((a, b) => {
            logger.out(`${add(a, b)}\n`);
        });
}
