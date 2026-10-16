import { type Command, CommanderError } from 'commander';
import { runItcStage } from '../itc-stage';
import { runStage } from '../stage';

/** Root options main() accepts before the `stage` token (the root -v/--verbose pair). */
const ROOT_GLOBALS = new Set(['-v', '--verbose']);

/**
 * Insert the canonical `run` verb into a legacy `kk stage <stage> …` invocation
 * (A22 R2 / ADR-037). The legacy stage name is data, not a command, so the
 * rewrite happens in main() before Commander parses: `stage run` is the only
 * registered verb and every shipped `kk stage <stage>` caller keeps its argv
 * order, `--` separators, unknown options and child exit status.
 *
 * Only root globals may precede `stage`. Any other leading token (an unknown
 * root option, `help`, another noun) is returned untouched so Commander keeps
 * owning its own help and error paths. `kk stage`, `kk stage run …` and
 * `kk stage --help` are already canonical and pass through unchanged.
 */
export function normalizeStageArgs(argv: readonly string[]): string[] {
    let i = 2;
    while (i < argv.length && ROOT_GLOBALS.has(argv[i] as string)) {
        i += 1;
    }
    const next = argv[i + 1];
    if (argv[i] !== 'stage' || next === undefined || next === 'run' || next === '--help' || next === '-h') {
        return [...argv];
    }
    return [...argv.slice(0, i + 1), 'run', ...argv.slice(i + 1)];
}

/**
 * Register the `stage` group and its canonical `run <stage> [args…]` verb.
 *
 * The group carries no default action: `kk stage` alone prints Commander usage
 * without running a stage, and the legacy `kk stage <stage>` spelling reaches
 * this verb through `normalizeStageArgs` in main() (A22 R1).
 */
export function registerStageCommand(program: Command): void {
    program
        .command('stage')
        .description('Run a kk-workflow-stages.ts stage (workflow orchestration steps)')
        .command('run')
        .description('Run one stage by name with positional pass-through')
        .argument('<args...>', 'Stage name followed by its positional arguments')
        .allowUnknownOption(true)
        .action((args: string[]) => {
            if (args[0]?.startsWith('itc-')) {
                return (async () => {
                    const itcCode = await runItcStage(args);
                    const code = itcCode !== undefined ? itcCode : runStage(args);
                    if (code !== 0) {
                        throw new CommanderError(code, 'kk.stage.failed', `stage failed with exit code ${code}`);
                    }
                })();
            }
            const code = runStage(args);
            if (code !== 0) {
                throw new CommanderError(code, 'kk.stage.failed', `stage failed with exit code ${code}`);
            }
        });
}
