import { Command } from 'commander';
import { registerAddCommand } from './commands/add';
import { registerFaninCommand } from './commands/fanin';
import { registerFanoutCommand } from './commands/fanout';
import { registerInvokeCommand } from './commands/invoke';
import { registerPluginsCommand } from './commands/plugins';
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

    registerAddCommand(program);
    registerInvokeCommand(program);
    registerFaninCommand(program);
    registerFanoutCommand(program);
    registerPluginsCommand(program);

    return program;
}
