import { type Command, CommanderError } from 'commander';
import { runStage } from '../stage';

/**
 * Register the `stage` verb: run a kk-workflow-stages.ts stage by name with
 * positional pass-through. Workflow shell steps call `kk stage <stage> ...`
 * instead of re-resolving the stages script path themselves.
 */
export function registerStageCommand(program: Command): void {
    program
        .command('stage')
        .description('Run a kk-workflow-stages.ts stage (workflow orchestration steps)')
        .argument('<args...>', 'Stage name followed by its positional arguments')
        .allowUnknownOption(true)
        .action((args: string[]) => {
            const code = runStage(args);
            if (code !== 0) {
                throw new CommanderError(code, 'kk.stage.failed', `stage failed with exit code ${code}`);
            }
        });
}
