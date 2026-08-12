import { type Command, CommanderError } from 'commander';
import { runInvoke } from '../invoke';

/**
 * Register the `invoke` subcommand.
 *
 * Fail-loud paths throw a CommanderError carrying the runner's exit code;
 * main() maps CommanderError to the returned process exit code (R3) — the
 * module never exits the process directly.
 */
export function registerInvokeCommand(program: Command): void {
    program
        .command('invoke')
        .description('Invoke a plugin with input/output files and contract validation')
        .argument('<plugin>', 'Name of the plugin to invoke')
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action(async (plugin, options) => {
            const code = await runInvoke({
                plugin,
                inPath: options.in,
                outPath: options.out,
                pluginsRoot: options.pluginsRoot,
            });
            if (code !== 0) {
                throw new CommanderError(code, 'kk.invoke.failed', `invoke failed with exit code ${code}`);
            }
        });
}
