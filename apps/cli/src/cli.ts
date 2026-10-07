import { Command } from 'commander';
import { registerExecutorCommand } from './commands/executor';
import { registerLedgerCommand } from './commands/ledger';
import { registerPluginCommand } from './commands/plugin';
import { registerStageCommand } from './commands/stage';
import { registerStoreCommand } from './commands/store';
import { CLI_CONFIG } from './config';

/**
 * Create a Commander CLI program with the shipped kk subcommands registered.
 *
 * Side-effect-free factory: it only builds the command tree (each shipped noun
 * registers from apps/cli/src/commands/<noun>.ts) and never parses argv or
 * runs action bodies — main() owns parsing and the exit seam.
 */
export function createProgram(): Command {
    const program = new Command()
        .name(CLI_CONFIG.binaryName)
        .description('knowledge-kit CLI')
        .version(CLI_CONFIG.binaryVersion)
        .option('-v, --verbose', 'enable verbose diagnostics');

    registerExecutorCommand(program);
    registerLedgerCommand(program);
    registerPluginCommand(program);
    registerStageCommand(program);
    registerStoreCommand(program);

    return program;
}
