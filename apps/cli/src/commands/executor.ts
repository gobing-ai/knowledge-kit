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
    source?: string[];
    sourceTimeout?: string;
    sourceTimeoutOverride?: string[];
    pluginsRoot?: string;
    pluginsPath?: string[];
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

/** Accumulate a repeatable option into an array (commander keeps only the last value otherwise). */
function collectRepeatable(value: string, acc: string[]): string[] {
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

/** Rebuild the flag slice so runFanin owns the CLI contract. */
async function runFaninAction(options: FaninOptions): Promise<void> {
    const argv: string[] = [];
    for (const inPath of options.in) {
        argv.push('--in', inPath);
    }
    for (const source of options.source ?? []) {
        argv.push('--source', source);
    }
    if (options.sourceTimeout !== undefined) {
        argv.push('--source-timeout', options.sourceTimeout);
    }
    for (const override of options.sourceTimeoutOverride ?? []) {
        argv.push('--source-timeout-override', override);
    }
    argv.push('--out', options.out);
    if (options.pluginsRoot !== undefined) {
        argv.push('--plugins-root', options.pluginsRoot);
    }
    for (const path of options.pluginsPath ?? []) {
        argv.push('--plugins-path', path);
    }

    const code = await runFanin(argv);
    if (code !== 0) {
        throw new CommanderError(code, 'kk.executor.fanin.failed', `fan-in failed with exit code ${code}`);
    }
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

/** Declare the `run` flag contract once for `executor run` and the hidden `invoke` alias. */
function withRunOptions(cmd: Command): Command {
    return cmd
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectRepeatable, []);
}

/** Declare the `fan-in` flag contract once for `executor fan-in` and the hidden `fanin` alias. */
function withFaninOptions(cmd: Command): Command {
    return cmd
        .option('--in <path>', 'Input Doc[] JSON file (repeatable)', collectRepeatable, [])
        .option(
            '--source <plugin>:<file>',
            'Ingestion source to spawn concurrently: plugin name and its input file (repeatable)',
            collectRepeatable,
            [],
        )
        .option('--source-timeout <ms>', 'Per-source timeout in milliseconds (default 1800000)')
        .option(
            '--source-timeout-override <plugin>:<ms>',
            'Per-source timeout override for one named --source plugin, e.g. horizon-ingest:2700000 (repeatable; wins over --source-timeout/default)',
            collectRepeatable,
            [],
        )
        .requiredOption('--out <path>', 'Output merged Doc[] JSON file path')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectRepeatable, []);
}

/** Declare the `fan-out` flag contract once for `executor fan-out` and the hidden `fanout` alias. */
function withFanoutOptions(cmd: Command): Command {
    return cmd
        .requiredOption('--content <path>', 'Source ContentSchema JSON file path')
        .option('--target <plugin>', 'Target publish plugin name (repeatable)', collectRepeatable, [])
        .requiredOption('--out <path>', 'Aggregate Result JSON file path')
        .option('--retry-from <path>', 'Prior Result JSON file to retry only previously failed targets')
        .option('--serial', 'Dispatch the parallel batch one target at a time (pre-2026-10-03 behaviour)')
        .option('--jobs <n>', 'Concurrent-start bound for the parallel batch (default: every target at once)')
        .option(
            '--serial-target <plugin>',
            'Target kept out of the parallel batch and run alone afterwards, e.g. a headed browser channel or a shared checkout (repeatable)',
            collectRepeatable,
            [],
        )
        .option(
            '--target-timeout <ms>',
            'Per-target wall-clock budget; an overrun is recorded failed and siblings continue',
        )
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectRepeatable, []);
}

/**
 * Register the `executor` command group (run + fan-in + fan-out) and the
 * hidden one-release top-level aliases `invoke` / `fanin` / `fanout`
 * (ADR-011 R4). Hyphenated verb names are canonical; aliases reach the same
 * action functions — no second implementation. Each verb declares its flags
 * once in a registrar, so a verb and its alias cannot drift apart.
 */
export function registerExecutorCommand(program: Command): void {
    const executor = program
        .command('executor')
        .description('Run knowledge-kit plugin steps (invoke, fan-in, fan-out)');

    withRunOptions(
        executor
            .command('run')
            .description('Invoke a plugin with input/output files and contract validation')
            .argument('<plugin>', 'Name of the plugin to invoke'),
    ).action(runInvokeAction);

    withFaninOptions(
        executor
            .command('fan-in')
            .alias('fanin')
            .description('Merge N Doc[] JSON inputs into one deduplicated Doc[] output'),
    ).action(runFaninAction);

    withFanoutOptions(
        executor
            .command('fan-out')
            .alias('fanout')
            .description('Publish one Content JSON to N targets, aggregating per-target results'),
    ).action(runFanoutAction);

    // Hidden one-release aliases (ADR-011 R4): same engines, same flags, not
    // listed in `kk --help`.
    withRunOptions(
        program
            .command('invoke', { hidden: true })
            .description('Alias for `executor run` (deprecated)')
            .argument('<plugin>', 'Name of the plugin to invoke'),
    ).action(runInvokeAction);

    withFaninOptions(
        program.command('fanin', { hidden: true }).description('Alias for `executor fan-in` (deprecated)'),
    ).action(runFaninAction);

    withFanoutOptions(
        program.command('fanout', { hidden: true }).description('Alias for `executor fan-out` (deprecated)'),
    ).action(runFanoutAction);
}
