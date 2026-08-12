import { type Command, CommanderError } from 'commander';
import { runFanin } from '../fanin';

/** Register the `fanin` subcommand (N Doc[] inputs → one deduplicated Doc[]). */
export function registerFaninCommand(program: Command): void {
    // Collect repeated `--in` values into an array (commander last-wins otherwise).
    const collectIn = (value: string, acc: string[]): string[] => {
        acc.push(value);
        return acc;
    };

    program
        .command('fanin')
        .description('Merge N Doc[] JSON inputs into one deduplicated Doc[] output')
        .requiredOption('--in <path>', 'Input Doc[] JSON file (repeatable)', collectIn, [])
        .requiredOption('--out <path>', 'Output merged Doc[] JSON file path')
        .action(async (options) => {
            // Rebuild the flag slice so runFanin owns the CLI contract.
            const argv: string[] = [];
            for (const inPath of options.in) {
                argv.push('--in', inPath);
            }
            argv.push('--out', options.out);

            const code = await runFanin(argv);
            if (code !== 0) {
                throw new CommanderError(code, 'kk.fanin.failed', `fanin failed with exit code ${code}`);
            }
        });
}
