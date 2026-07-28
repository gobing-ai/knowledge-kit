import { add, logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { runInvoke } from './invoke';

/** Create a Commander CLI program with add and invoke subcommands. */
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

    program
        .command('invoke')
        .description('Invoke a plugin with input/output files and contract validation')
        .argument('<plugin>', 'Name of the plugin to invoke')
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action(async (plugin, options) => {
            // Propagate non-zero so the binary fails loud (R4); runInvoke alone only returns a code.
            const code = await runInvoke({
                plugin,
                inPath: options.in,
                outPath: options.out,
                pluginsRoot: options.pluginsRoot,
            });
            if (code !== 0) {
                process.exit(code);
            }
        });

    return program;
}
