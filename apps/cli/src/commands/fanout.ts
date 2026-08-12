import { type Command, CommanderError } from 'commander';
import { runFanout } from '../fanout';

/** Register the `fanout` subcommand (one Content → N publish targets). */
export function registerFanoutCommand(program: Command): void {
    // Collect repeated `--target` values into an array (commander last-wins otherwise).
    const collectTarget = (value: string, acc: string[]): string[] => {
        acc.push(value);
        return acc;
    };

    program
        .command('fanout')
        .description('Publish one Content JSON to N targets, aggregating per-target results')
        .requiredOption('--content <path>', 'Source ContentSchema JSON file path')
        .option('--target <plugin>', 'Target publish plugin name (repeatable)', collectTarget, [])
        .requiredOption('--out <path>', 'Aggregate Result JSON file path')
        .option('--retry-from <path>', 'Prior Result JSON file to retry only previously failed targets')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action(async (options) => {
            // Rebuild the flag slice so runFanout owns the CLI contract.
            const argv: string[] = ['--content', options.content, '--out', options.out];
            for (const target of options.target) {
                argv.push('--target', target);
            }
            if (options.retryFrom) {
                argv.push('--retry-from', options.retryFrom);
            }
            if (options.pluginsRoot) {
                argv.push('--plugins-root', options.pluginsRoot);
            }

            const code = await runFanout(argv);
            if (code !== 0) {
                throw new CommanderError(code, 'kk.fanout.failed', `fanout failed with exit code ${code}`);
            }
        });
}
