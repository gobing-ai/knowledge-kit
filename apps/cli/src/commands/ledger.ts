import { resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem, NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import {
    appendLedgerSection,
    cutoverCheck,
    LedgerError,
    ledgerHasRun,
    type ParsedLedger,
    parseLedger,
    parseTraceJson,
    parseTraceListJson,
    renderLedgerSection,
    selectMissingRuns,
    type TraceJson,
    type TraceListEntry,
    traceNodes,
} from '../ledger';
import { consoleOutput } from '../output';

/** Default ledger root: `<cwd>/.works/<workflow>/ledger.md`. */
const DEFAULT_WORKS_DIR = '.works';

/** Options accepted by `kk ledger cutover-check`. */
interface CutoverCheckOptions {
    candidate: string;
    baseline: string;
    runs: string;
    worksDir: string;
}

/** Options accepted by `kk ledger append`. */
interface LedgerAppendOptions {
    workflow: string;
    run: string;
    worksDir: string;
    /** The workflow's `work_dir` variable, when the workflow passes it — source of `<node>.summary.txt`. */
    workDir?: string;
}

/** Options accepted by `kk ledger sync` (also the `kk daily prepare --ledger-sync` seam). */
export interface LedgerSyncOptions {
    workflow: string;
    worksDir: string;
    workDir?: string;
}

/** Outcome of one `spur workflow trace` spawn. */
interface SpurTraceResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Spawn `spur workflow trace … --json` through the ts-runtime sync executor seam.
 *
 * `KK_SPUR_BIN` overrides the binary so tests and non-PATH installs can point at a
 * stub; the default is the `spur` on PATH.
 */
function runSpurTrace(args: string[]): SpurTraceResult {
    const command = process.env.KK_SPUR_BIN ?? 'spur';
    const result = new NodeSyncProcessExecutor().runSync({ command, args });
    return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
}

/** Last non-empty stderr line, or the exit code, for the failure message. */
function failureDetail(result: SpurTraceResult): string {
    const lines = result.stderr
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    return lines.at(-1) ?? `exit ${result.exitCode}`;
}

/** Read one run's trace; a running run, an unknown id or a malformed payload is a LedgerError (R7). */
function readTrace(runId: string): TraceJson {
    const result = runSpurTrace(['workflow', 'trace', runId, '--json']);
    if (result.exitCode !== 0) {
        const detail = failureDetail(result);
        throw new LedgerError(
            /not found/i.test(detail) ? 'trace.not-found' : 'trace.spawn-failed',
            `spur workflow trace ${runId}: ${detail}`,
        );
    }
    const trace = parseTraceJson(result.stdout);
    if (trace.run.status === 'running') {
        throw new LedgerError('run.running', `run ${runId} is still running; nothing was written`);
    }
    return trace;
}

/** List finished runs of `workflow` (`.entries[]`, oldest-first ordering left to the caller). */
function listTraces(workflow: string): TraceListEntry[] {
    const result = runSpurTrace(['workflow', 'trace', '--workflow', workflow, '--json']);
    if (result.exitCode !== 0) {
        throw new LedgerError(
            'trace.spawn-failed',
            `spur workflow trace --workflow ${workflow}: ${failureDetail(result)}`,
        );
    }
    return parseTraceListJson(result.stdout);
}

/** `<node>.summary.txt` first lines for the trace's step nodes; a missing file is simply absent (R5). */
async function readSummaries(
    fs: FileSystem,
    workDir: string | undefined,
    trace: TraceJson,
): Promise<ReadonlyMap<string, string>> {
    const summaries = new Map<string, string>();
    if (workDir === undefined) {
        return summaries;
    }
    for (const node of traceNodes(trace)) {
        const summaryPath = resolve(workDir, `${node}.summary.txt`);
        if (!(await fs.exists(summaryPath))) {
            continue;
        }
        summaries.set(node, await fs.readFile(summaryPath));
    }
    return summaries;
}

/**
 * `<works-dir>/<workflow>/ledger.md`, absolute. The workflow name becomes a path segment, so it
 * must be a flat file stem: `..`, a separator or an absolute path would write outside the works dir.
 */
function ledgerFilePath(worksDir: string, workflow: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(workflow)) {
        throw new LedgerError('workflow.invalid', `'${workflow}' is not a workflow name (letters, digits, . _ -)`);
    }
    return resolve(worksDir, workflow, 'ledger.md');
}

/** Existing ledger content, or null when the file does not exist yet (R1 heading creation). */
async function readLedger(fs: FileSystem, ledgerPath: string): Promise<string | null> {
    return (await fs.exists(ledgerPath)) ? await fs.readFile(ledgerPath) : null;
}

/** Write the ledger, reporting filesystem failures as `kk.ledger.write.failed`. */
async function writeLedger(fs: FileSystem, ledgerPath: string, content: string): Promise<void> {
    try {
        await fs.writeFile(ledgerPath, content);
    } catch (error) {
        throw new LedgerError(
            'write.failed',
            `${ledgerPath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/**
 * `kk ledger append --workflow <name> --run <run-id> [--works-dir .works]` — render the
 * run's trace into one section of `<works-dir>/<workflow>/ledger.md` (R1/R2).
 *
 * Idempotent by run id: a run whose `<!-- run:<id> -->` marker is already present writes
 * nothing, and `appended` reports `[]`. Any failure exits 1 with `kk.ledger.<reason>`
 * and leaves the file untouched (R7).
 */
async function appendAction(options: LedgerAppendOptions): Promise<void> {
    const fs = createNodeFileSystem();
    try {
        const ledgerPath = ledgerFilePath(options.worksDir, options.workflow);
        const trace = readTrace(options.run);
        const existing = await readLedger(fs, ledgerPath);
        if (ledgerHasRun(existing ?? '', options.run)) {
            report(options.workflow, ledgerPath, []);
            return;
        }
        const summaries = await readSummaries(fs, options.workDir, trace);
        const section = renderLedgerSection(trace, { summaries });
        await writeLedger(fs, ledgerPath, appendLedgerSection(existing, options.workflow, section));
        report(options.workflow, ledgerPath, [options.run]);
    } catch (error) {
        failLoud(error);
    }
}

/**
 * `kk ledger sync --workflow <name>` — append a section for every finished run of the
 * workflow that the ledger does not record yet, oldest first (R6). One write for the
 * whole batch, so a trace read that fails leaves the ledger untouched.
 */
export async function syncLedger(options: LedgerSyncOptions): Promise<void> {
    const fs = createNodeFileSystem();
    try {
        const ledgerPath = ledgerFilePath(options.worksDir, options.workflow);
        const existing = await readLedger(fs, ledgerPath);
        const missing = selectMissingRuns(listTraces(options.workflow), existing ?? '');
        let content = existing;
        for (const [index, runId] of missing.entries()) {
            const trace = readTrace(runId);
            // The trace carries no per-run work dir, and one `--work-dir` holds what its latest attempt
            // wrote — so only the newest missing run reads it; older backfills fall back (R5).
            const workDir = index === missing.length - 1 ? options.workDir : undefined;
            const summaries = await readSummaries(fs, workDir, trace);
            content = appendLedgerSection(content, options.workflow, renderLedgerSection(trace, { summaries }));
        }
        if (missing.length > 0) {
            await writeLedger(fs, ledgerPath, content ?? '');
        }
        report(options.workflow, ledgerPath, missing);
    } catch (error) {
        failLoud(error);
    }
}

/** Success line: the ledger path plus the run ids this invocation appended. */
function report(workflow: string, ledgerPath: string, appended: string[]): void {
    consoleOutput.write(JSON.stringify({ workflow, ledger: ledgerPath, appended }));
}

/**
 * Fail loud: print the `kk.ledger.<reason>` contract line and throw a `CommanderError`
 * that `main()` maps to exit code 1 (command modules never terminate the process directly).
 */
function failLoud(error: unknown): never {
    const known = error instanceof LedgerError;
    const message = error instanceof Error ? error.message : String(error);
    consoleOutput.error(message);
    throw new CommanderError(1, known ? error.code : 'kk.ledger.failed', message);
}

/**
 * `kk ledger cutover-check --candidate <name> --baseline <name> --runs <n>` (task 0212 R1) —
 * read-only readiness probe for retiring the legacy workflow: exits 0 always and prints
 * `{ ready, streak, required, reasons }`; only the workflow-name guard still exits 1.
 */
async function cutoverCheckAction(options: CutoverCheckOptions): Promise<void> {
    const fs = createNodeFileSystem();
    let candidatePath: string;
    let baselinePath: string;
    try {
        candidatePath = ledgerFilePath(options.worksDir, options.candidate);
        baselinePath = ledgerFilePath(options.worksDir, options.baseline);
    } catch (error) {
        failLoud(error);
    }
    const fileReasons: string[] = [];
    const parsed: ParsedLedger[] = [];
    for (const [label, path] of [
        ['candidate', candidatePath],
        ['baseline', baselinePath],
    ] as const) {
        try {
            if (!(await fs.exists(path))) {
                fileReasons.push(`${label}: no ledger at ${path}`);
                parsed.push({ runs: [], malformed: [] });
                continue;
            }
            const ledger = parseLedger(await fs.readFile(path));
            for (const bad of ledger.malformed) {
                fileReasons.push(`${label} ledger: malformed section (${bad})`);
            }
            parsed.push(ledger);
        } catch (error) {
            fileReasons.push(`${label}: unreadable (${error instanceof Error ? error.message : String(error)})`);
            parsed.push({ runs: [], malformed: [] });
        }
    }
    const candidateRuns = parsed[0]?.runs ?? [];
    const baselineRuns = parsed[1]?.runs ?? [];
    const verdict =
        fileReasons.length > 0
            ? { ready: false, streak: 0, required: Number(options.runs), reasons: fileReasons }
            : cutoverCheck(candidateRuns, baselineRuns, Number(options.runs));
    consoleOutput.write(JSON.stringify(verdict));
}

/**
 * Register the `ledger` command group — the per-workflow run ledger surface.
 *
 * `sync` runs at a workflow's first node and records every finished run; a final-node
 * `append` sees its own run still `running` and exits 1 (docs/design design §7, task 0207).
 */
export function registerLedgerCommand(program: Command): void {
    const ledger = program.command('ledger').description('Maintain per-workflow run ledgers');

    ledger
        .command('append')
        .description('Append one workflow run section to its ledger (idempotent by run id)')
        .requiredOption('--workflow <name>', 'Workflow name (ledger file <works-dir>/<name>/ledger.md)')
        .requiredOption('--run <run-id>', 'spur workflow run id to render')
        .option('--works-dir <dir>', 'Ledger root directory', DEFAULT_WORKS_DIR)
        .option('--work-dir <dir>', 'Workflow work_dir, for <node>.summary.txt result cells')
        .action(appendAction);

    ledger
        .command('sync')
        .description('Append every finished run missing from the ledger, oldest first')
        .requiredOption('--workflow <name>', 'Workflow name (ledger file <works-dir>/<name>/ledger.md)')
        .option('--works-dir <dir>', 'Ledger root directory', DEFAULT_WORKS_DIR)
        .option('--work-dir <dir>', 'Workflow work_dir, for <node>.summary.txt result cells (newest missing run only)')
        .action(syncLedger);

    ledger
        .command('cutover-check')
        .description(
            'Read-only cutover readiness probe: newest N candidate runs all done and each matches the same-day baseline target set (exit 0 always, ready is the signal)',
        )
        .requiredOption('--candidate <name>', 'Candidate workflow name (the one to cut over to)')
        .requiredOption('--baseline <name>', 'Baseline workflow name (the legacy one to retire)')
        .requiredOption('--runs <n>', 'How many newest candidate runs must qualify')
        .option('--works-dir <dir>', 'Ledger root directory', DEFAULT_WORKS_DIR)
        .action(cutoverCheckAction);
}
