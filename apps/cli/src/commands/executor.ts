import { type Command, CommanderError } from 'commander';
import { runFanin } from '../fanin';
import { runFanout } from '../fanout';
import { runInvoke } from '../invoke';

/** Options accepted by the `executor run` verb (and its hidden `invoke` alias). */
interface RunOptions {
    in: string;
    out: string;
    pluginsRoot?: string;
    pluginsPath?: string[];
}

/** Options accepted by the `executor fan-in` verb (and its hidden `fanin` alias). */
interface FaninOptions {
    in: string[];
    out: string;
}

/** Options accepted by the `executor fan-out` verb (and its hidden `fanout` alias). */
interface FanoutOptions {
    content: string;
    target: string[];
    out: string;
    retryFrom?: string;
    pluginsRoot?: string;
    pluginsPath?: string[];
}

/** Collect repeated `--plugins-path` values into an array (commander last-wins otherwise). */
function collectPath(value: string, acc: string[]): string[] {
    acc.push(value);
    return acc;
}

/** Fail-loud paths throw a CommanderError carrying the runner's exit code; main() maps it to the process exit code. */
async function runInvokeAction(plugin: string, options: RunOptions): Promise<void> {
    if (options.pluginsRoot !== undefined && (options.pluginsPath?.length ?? 0) > 0) {
        throw new CommanderError(
            2,
            'kk.executor.run.root-path-conflict',
            '--plugins-root and --plugins-path are mutually exclusive',
        );
    }
    const code = await runInvoke({
        plugin,
        inPath: options.in,
        outPath: options.out,
        pluginsRoot: options.pluginsRoot,
        pluginsPath: options.pluginsPath,
    });
    if (code !== 0) {
        throw new CommanderError(code, 'kk.executor.run.failed', `invoke failed with exit code ${code}`);
    }
}

/** Collect repeated `--in` values into an array (commander last-wins otherwise). */
function collectIn(value: string, acc: string[]): string[] {
    acc.push(value);
    return acc;
}

/** Rebuild the flag slice so runFanin owns the CLI contract. */
async function runFaninAction(options: FaninOptions): Promise<void> {
    const argv: string[] = [];
    for (const inPath of options.in) {
        argv.push('--in', inPath);
    }
    argv.push('--out', options.out);

    const code = await runFanin(argv);
    if (code !== 0) {
        throw new CommanderError(code, 'kk.executor.fanin.failed', `fan-in failed with exit code ${code}`);
    }
}

/** Collect repeated `--target` values into an array (commander last-wins otherwise). */
function collectTarget(value: string, acc: string[]): string[] {
    acc.push(value);
    return acc;
}

/** Rebuild the flag slice so runFanout owns the CLI contract. */
async function runFanoutAction(options: FanoutOptions): Promise<void> {
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
    for (const path of options.pluginsPath ?? []) {
        argv.push('--plugins-path', path);
    }

    const code = await runFanout(argv);
    if (code !== 0) {
        throw new CommanderError(code, 'kk.executor.fanout.failed', `fan-out failed with exit code ${code}`);
    }
}

/**
 * Register the `executor` command group (run + fan-in + fan-out) and the
 * hidden one-release top-level aliases `invoke` / `fanin` / `fanout`
 * (ADR-011 R4). Hyphenated verb names are canonical; aliases reach the same
 * action functions — no second implementation.
 */
export function registerExecutorCommand(program: Command): void {
    const executor = program
        .command('executor')
        .description('Run knowledge-kit plugin steps (invoke, fan-in, fan-out)');

    executor
        .command('run')
        .description('Invoke a plugin with input/output files and contract validation')
        .argument('<plugin>', 'Name of the plugin to invoke')
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(runInvokeAction);

    executor
        .command('fan-in')
        .alias('fanin')
        .description('Merge N Doc[] JSON inputs into one deduplicated Doc[] output')
        .requiredOption('--in <path>', 'Input Doc[] JSON file (repeatable)', collectIn, [])
        .requiredOption('--out <path>', 'Output merged Doc[] JSON file path')
        .action(runFaninAction);

    executor
        .command('fan-out')
        .alias('fanout')
        .description('Publish one Content JSON to N targets, aggregating per-target results')
        .requiredOption('--content <path>', 'Source ContentSchema JSON file path')
        .option('--target <plugin>', 'Target publish plugin name (repeatable)', collectTarget, [])
        .requiredOption('--out <path>', 'Aggregate Result JSON file path')
        .option('--retry-from <path>', 'Prior Result JSON file to retry only previously failed targets')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(runFanoutAction);

    // Hidden one-release aliases (ADR-011 R4): same engines, same flags, not
    // listed in `kk --help`.
    program
        .command('invoke', { hidden: true })
        .description('Alias for `executor run` (deprecated)')
        .argument('<plugin>', 'Name of the plugin to invoke')
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(runInvokeAction);

    program
        .command('fanin', { hidden: true })
        .description('Alias for `executor fan-in` (deprecated)')
        .requiredOption('--in <path>', 'Input Doc[] JSON file (repeatable)', collectIn, [])
        .requiredOption('--out <path>', 'Output merged Doc[] JSON file path')
        .action(runFaninAction);

    program
        .command('fanout', { hidden: true })
        .description('Alias for `executor fan-out` (deprecated)')
        .requiredOption('--content <path>', 'Source ContentSchema JSON file path')
        .option('--target <plugin>', 'Target publish plugin name (repeatable)', collectTarget, [])
        .requiredOption('--out <path>', 'Aggregate Result JSON file path')
        .option('--retry-from <path>', 'Prior Result JSON file to retry only previously failed targets')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(runFanoutAction);
}
