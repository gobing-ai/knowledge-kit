import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
    type AggregateResult,
    AggregateResultSchema,
    type Content,
    ContentSchema,
    type DiscoveryResult,
    discoverAllPlugins,
    getByName,
    type Result,
    ResultSchema,
    type TargetOutcome,
} from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { spawnPluginEntryAsync } from './invoke';
import { formatIssues, readPluginJson } from './plugin-output';

/** A publish target: the name of a publish-kind plugin (spec §1.3). */
export type Target = string;

/** Single-target publish outcome returned by a dispatch (kk-core Result). */
export type ResultEntry = Result;

/** Per-target outcome and aggregate result contracts live in kk-core (`TargetOutcomeSchema` / `AggregateResultSchema`); re-exported for existing consumers. */
export type { AggregateResult, TargetOutcome };

/** Parsed `kk fanout` CLI arguments. */
export interface FanoutOptions {
    contentPath: string;
    targets: string[];
    outPath: string;
    retryFromPath?: string;
    pluginsRoot?: string;
    pluginsPath?: string[];
    /** Run the parallel batch one target at a time (pre-2026-10-03 behaviour). */
    serial?: boolean;
    /** Concurrent-start bound for the parallel batch. */
    jobs?: number;
    /** Targets kept out of the parallel batch (headed browser channels, shared checkouts). */
    serialTargets?: string[];
    /** Per-target wall-clock budget in milliseconds. */
    targetTimeoutMs?: number;
}

/** Runner dependencies; tests inject a fake dispatch so no real publishers run. */
export interface FanoutDeps {
    dispatch?: (target: Target) => Promise<ResultEntry>;
    pluginsRoot?: string;
}

/** Exit code for target failures — partial or total (spec §4). */
const EXIT_FAILURE = 1;
/** Exit code for CLI / input errors: malformed flags, invalid content, unresolvable plugin (spec §4). */
const EXIT_INPUT = 2;

/** Collapse per-target outcomes into the aggregate shape (spec §3.1). */
function aggregate(entries: TargetOutcome[]): AggregateResult {
    const summary = { total: entries.length, succeeded: 0, failed: 0, skipped: 0 };
    for (const entry of entries) {
        if (entry.status === 'published') {
            summary.succeeded += 1;
        } else if (entry.status === 'failed') {
            summary.failed += 1;
        } else {
            summary.skipped += 1;
        }
    }
    return { ok: summary.failed === 0, summary, targets: entries };
}

/**
 * Interior concurrency for one fan-out run (ADR-007 R4 amendment 2026-10-03).
 *
 * The workflow engine executes one node at a time, so the publisher fan-out is where N independent
 * targets actually get to overlap — the same split ADR-019 chose for `fan-in`. Defaults keep the
 * caller's shape: every non-serial target starts together, results are aggregated in `--target`
 * order, and a failing or hanging target never aborts its siblings (spec §3.1, §5.1).
 */
export interface FanoutRunOptions {
    /** `'concurrent'` (default) overlaps the parallel batch; `'serial'` restores the pre-2026-10-03 loop. */
    mode?: 'concurrent' | 'serial';
    /** Concurrent-start bound for the parallel batch (default: every target at once). */
    jobs?: number;
    /** Targets that must run alone, after the parallel batch (headed browser channels sharing a profile). */
    serialTargets?: readonly string[];
    /** Per-target wall-clock budget; an overrun is recorded failed and its siblings continue. */
    timeoutMs?: number;
}

/** One dispatch, reduced to a per-target outcome. A rejection or timeout is recorded, never rethrown. */
async function dispatchOne(
    target: Target,
    dispatch: (target: Target) => Promise<ResultEntry>,
    timeoutMs: number | undefined,
): Promise<TargetOutcome> {
    const started = Date.now();
    try {
        const result =
            timeoutMs === undefined ? await dispatch(target) : await withTimeout(dispatch(target), timeoutMs, target);
        const durationMs = Date.now() - started;
        return result.ok
            ? {
                  target,
                  ok: true,
                  status: 'published',
                  ...(result.url !== undefined ? { url: result.url } : {}),
                  ...(result.id !== undefined ? { id: result.id } : {}),
                  ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
                  durationMs,
              }
            : {
                  target,
                  ok: false,
                  status: 'failed',
                  error: result.error ?? result.message ?? 'publish failed',
                  durationMs,
              };
    } catch (err: unknown) {
        return {
            target,
            ok: false,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - started,
        };
    }
}

/**
 * Bound one target's wall clock. The transport keeps its own timeout; this is the fan-out's own
 * isolation guarantee (a wedged target must not hold the aggregate open past its budget).
 */
function withTimeout(promise: Promise<ResultEntry>, timeoutMs: number, target: Target): Promise<ResultEntry> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<ResultEntry>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`target '${target}' exceeded its ${timeoutMs}ms budget`)), timeoutMs);
    });
    return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

/**
 * Dispatch `content` to every target, aggregating one per-target outcome each (spec §3). Targets run
 * concurrently unless `mode: 'serial'`; `serialTargets` opt individual publishers out of the batch
 * and run them one at a time afterwards. A dispatch that rejects (or overruns `timeoutMs`) is
 * recorded as failed without aborting siblings. Every target appears in the result exactly once per
 * run, in the caller's target order — completion order never reorders the ledger.
 */
export async function fanout(
    content: Content,
    targets: Target[],
    dispatch: (target: Target) => Promise<ResultEntry>,
    options: FanoutRunOptions = {},
): Promise<AggregateResult> {
    // Content flows to transports through the dispatch closure; the parameter keeps the
    // publish payload part of this function's contract (spec §3).
    void content;
    const outcomes = new Map<Target, TargetOutcome>();
    const runOne = async (target: Target): Promise<void> => {
        outcomes.set(target, await dispatchOne(target, dispatch, options.timeoutMs));
    };

    if (options.mode === 'serial') {
        // Pre-2026-10-03 behaviour, kept for callers whose transports share a resource (one headed
        // browser profile, one checkout) and for reproducing older traces.
        for (const target of targets) await runOne(target);
    } else {
        const serial = new Set(options.serialTargets ?? []);
        const parallel = targets.filter((target) => !serial.has(target));
        const solo = targets.filter((target) => serial.has(target));
        const jobs = options.jobs !== undefined && options.jobs > 0 ? options.jobs : parallel.length;
        // Worker pool: start order follows `targets`, the pool only bounds how many are in flight.
        let cursor = 0;
        const worker = async (): Promise<void> => {
            while (cursor < parallel.length) {
                const target = parallel[cursor++];
                if (target === undefined) return;
                await runOne(target);
            }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, parallel.length)) }, worker));
        for (const target of solo) await runOne(target);
    }

    // Ordered aggregation: the ledger follows the caller's target order regardless of who finished first.
    return aggregate(
        targets.map((target) => outcomes.get(target)).filter((entry): entry is TargetOutcome => entry !== undefined),
    );
}

/**
 * Select the targets to retry from a prior aggregate result (spec §5):
 * exactly the targets that previously failed.
 */
export function selectRetryTargets(prior: AggregateResult): Target[] {
    return prior.targets.filter((t) => t.status === 'failed').map((t) => t.target);
}

/** Read one `--content` file as a `Content`. @returns the parsed content, or null (with an error logged) on failure */
async function readContent(fs: FileSystem, path: string): Promise<Content | null> {
    if (!(await fs.exists(path))) {
        echoError(`Content file does not exist: ${path}`);
        return null;
    }

    let content: string;
    try {
        content = await fs.readFile(path);
    } catch (err: unknown) {
        echoError(`Failed to read content file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch (err: unknown) {
        echoError(`Content file ${path} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    const result = ContentSchema.safeParse(json);
    if (!result.success) {
        echoError(`Content file ${path} violates the Content schema: ${formatIssues(result.error)}`);
        return null;
    }

    return result.data;
}

/** Map the first aggregate-schema issue back to the message tail the hand parser used (kept byte-identical for existing assertions). */
function describeAggregateIssue(json: unknown, issue: { path: PropertyKey[] } | undefined): string {
    if (issue === undefined) return ' (ok/summary/targets)';
    const path = issue.path.map(String);
    const targets = (json as { targets?: unknown }).targets;
    const targetName = (index: number): string => {
        const entry = Array.isArray(targets) ? targets[index] : undefined;
        if (typeof entry !== 'object' || entry === null) return 'undefined';
        return String((entry as Record<string, unknown>).target);
    };
    if (path[0] === 'targets' && path.length >= 2) {
        const index = Number(path[1]);
        if (path.length === 2) return ' (target entry)';
        if (path[2] === 'metadata') return `: target '${targetName(index)}' metadata must be an object`;
        return ` (target ${targetName(index)})`;
    }
    if (path[0] === 'summary' && path.length >= 2) return ` (summary.${path[1]})`;
    return ' (ok/summary/targets)';
}

/** Read and validate one prior aggregate result (spec §3.1). @returns the parsed result, or null (with an error logged) on failure */
async function readAggregateResult(fs: FileSystem, path: string): Promise<AggregateResult | null> {
    if (!(await fs.exists(path))) {
        echoError(`Result file does not exist: ${path}`);
        return null;
    }

    let content: string;
    try {
        content = await fs.readFile(path);
    } catch (err: unknown) {
        echoError(`Failed to read result file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch (err: unknown) {
        echoError(`Result file ${path} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
        echoError(`Result file ${path} is not an aggregate result object`);
        return null;
    }
    const parsed = AggregateResultSchema.safeParse(json);
    if (!parsed.success) {
        echoError(
            `Result file ${path} violates the aggregate result schema${describeAggregateIssue(json, parsed.error.issues[0])}`,
        );
        return null;
    }
    return parsed.data;
}

/** Parse `--content <file> [--target <plugin> ...] --out <file> [--retry-from <file>] [--plugins-root <dir>] [--plugins-path <dir> ...]` from an argv slice. */
function parseArgs(argv: string[]): FanoutOptions {
    const targets: string[] = [];
    const pluginsPath: string[] = [];
    const serialTargets: string[] = [];
    let contentPath: string | undefined;
    let outPath: string | undefined;
    let retryFromPath: string | undefined;
    let pluginsRoot: string | undefined;
    let serial = false;
    let jobs: number | undefined;
    let targetTimeoutMs: number | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--content') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--content requires a file path');
            }
            if (contentPath !== undefined) {
                throw new Error('--content may be specified only once');
            }
            contentPath = value;
        } else if (arg === '--target') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--target requires a plugin name');
            }
            targets.push(value);
        } else if (arg === '--out') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--out requires a file path');
            }
            if (outPath !== undefined) {
                throw new Error('--out may be specified only once');
            }
            outPath = value;
        } else if (arg === '--retry-from') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--retry-from requires a file path');
            }
            if (retryFromPath !== undefined) {
                throw new Error('--retry-from may be specified only once');
            }
            retryFromPath = value;
        } else if (arg === '--plugins-root') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--plugins-root requires a directory path');
            }
            if (pluginsRoot !== undefined) {
                throw new Error('--plugins-root may be specified only once');
            }
            pluginsRoot = value;
        } else if (arg === '--plugins-path') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--plugins-path requires a directory path');
            }
            pluginsPath.push(value);
        } else if (arg === '--serial') {
            serial = true;
        } else if (arg === '--jobs') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--jobs requires a positive integer');
            }
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error(`--jobs requires a positive integer, got '${value}'`);
            }
            jobs = parsed;
        } else if (arg === '--serial-target') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--serial-target requires a plugin name');
            }
            serialTargets.push(value);
        } else if (arg === '--target-timeout') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--target-timeout requires milliseconds');
            }
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error(`--target-timeout requires a positive integer in milliseconds, got '${value}'`);
            }
            targetTimeoutMs = parsed;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (contentPath === undefined) {
        throw new Error('--content file is required');
    }
    if (outPath === undefined) {
        throw new Error('--out file is required');
    }
    if (targets.length === 0 && retryFromPath === undefined) {
        throw new Error('at least one --target is required (unless --retry-from is given)');
    }

    return {
        contentPath,
        targets,
        outPath,
        ...(retryFromPath !== undefined ? { retryFromPath } : {}),
        ...(pluginsRoot !== undefined ? { pluginsRoot } : {}),
        ...(pluginsPath.length > 0 ? { pluginsPath } : {}),
        ...(serial ? { serial } : {}),
        ...(jobs !== undefined ? { jobs } : {}),
        ...(serialTargets.length > 0 ? { serialTargets } : {}),
        ...(targetTimeoutMs !== undefined ? { targetTimeoutMs } : {}),
    };
}

/**
 * Default dispatch: run the publish plugin named by the target through its
 * entry script asynchronously (same `--in`/`--out` contract as `kk invoke`)
 * and return the `Result` it wrote. Throws on any failure so the target is
 * recorded as failed.
 *
 * Process spawn goes through `spawnPluginEntryAsync` in `invoke.ts` — the
 * sanctioned spawn seam under `no-direct-process-spawn`, and the one that lets
 * independent publishers overlap (ADR-007 R4 amendment 2026-10-03).
 * `targetTimeoutMs` is that spawn's own budget: it is enforced there, tree and
 * all, before this function reads or deletes the temporary output — the
 * fan-out must never race an owned subprocess (R2).
 */
async function pluginDispatch(
    target: string,
    contentPath: string,
    discovery: DiscoveryResult,
    targetTimeoutMs: number | undefined,
): Promise<ResultEntry> {
    const record = getByName(discovery, target);
    if (record?.kind !== 'publish') {
        throw new Error(`Publish plugin '${target}' not found in the merged plugin registry`);
    }

    const fs = createNodeFileSystem();
    const entryPath = isAbsolute(record.entry) ? record.entry : resolve(record.dir, record.entry);
    if (!(await fs.exists(entryPath))) {
        throw new Error(`Plugin entry script does not exist: ${entryPath}`);
    }

    const outTmp = join(tmpdir(), `kk-fanout-${target}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    try {
        const proc = await spawnPluginEntryAsync({
            entryPath,
            cwd: record.dir,
            inPath: resolve(contentPath),
            outPath: outTmp,
            pluginKind: record.kind,
            pluginName: record.name,
            ...(targetTimeoutMs !== undefined ? { timeoutMs: targetTimeoutMs } : {}),
        });
        if (proc.timedOut === true) {
            // `timedOut` is only ever set by a spawn given a budget; name it (R2).
            throw new Error(`target '${target}' exceeded its ${targetTimeoutMs}ms budget`);
        }
        if (proc.exitCode !== 0) {
            throw new Error(`Plugin '${target}' exited ${proc.exitCode}: ${proc.stderr || proc.stdout || 'no output'}`);
        }

        if (!(await fs.exists(outTmp))) {
            throw new Error(`Plugin '${target}' succeeded but did not write a result file`);
        }
        // 0157 R5/R10: shared reader names the target on malformed JSON (a bare SyntaxError
        // used to leak through with no plugin name) and keeps the Result-schema wording.
        return readPluginJson(fs, outTmp, ResultSchema, `Plugin '${target}'`, 'wrote an invalid Result');
    } finally {
        await fs.deleteFile(outTmp);
    }
}

/** Check every target resolves to a publish plugin; log and return false otherwise (spec §4 input error). */
function validateTargets(targets: Target[], discovery: DiscoveryResult): boolean {
    const missing: string[] = [];
    for (const target of targets) {
        const record = getByName(discovery, target);
        if (record?.kind !== 'publish') {
            missing.push(target);
        }
    }
    if (missing.length > 0) {
        echoError(`Unknown publish target(s): ${missing.join(', ')}`);
        for (const diag of discovery.diagnostics) {
            echoError(`  [diagnostic] ${diag.code} at ${diag.path}: ${diag.reason}`);
        }
        return false;
    }
    return true;
}

/**
 * Run the `kk fanout` CLI handler.
 * @param argv `--content <file> [--target <plugin> ...] --out <file> [--retry-from <file>] [--plugins-root <dir>] [--plugins-path <dir> ...]` (no subcommand name)
 * @param deps optional injected dispatch / pluginsRoot (tests) — default dispatch runs publish plugin entries
 * @returns exit code per spec §4: 0 all succeeded, 1 partial/total failure, 2 CLI/input error
 */
export async function runFanout(argv: string[], deps: FanoutDeps = {}): Promise<number> {
    let opts: FanoutOptions;
    try {
        opts = parseArgs(argv);
    } catch (err: unknown) {
        echoError(`fanout: ${err instanceof Error ? err.message : String(err)}`);
        return EXIT_INPUT;
    }

    const fs = createNodeFileSystem();
    const content = await readContent(fs, opts.contentPath);
    if (content === null) {
        return EXIT_INPUT;
    }

    if (opts.pluginsRoot !== undefined && (opts.pluginsPath?.length ?? 0) > 0) {
        echoError('--plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)');
        return EXIT_INPUT;
    }
    // One discovery per run: `--plugins-root` stays an exclusive single-root
    // override; otherwise union the default roots with `--plugins-path`
    // (ADR-012). Both route through the merged entry point so a single-plugin
    // dir root behaves identically on every command (P3-4).
    const pluginsRoot = deps.pluginsRoot ?? opts.pluginsRoot;
    const discovery = discoverAllPlugins({ pluginsRoot, extraPaths: opts.pluginsPath });

    let prior: AggregateResult | undefined;
    let skipped: TargetOutcome[] = [];
    // 0157 R2: each target is attempted at most once per run (fanout() contract; spec §5.1
    // dedupe) — a templated duplicate must not publish twice. First-seen order is kept.
    let targets = [...new Set(opts.targets)];
    // 0110 I7: prior failures not selected for attempt stay in the ledger as failed.
    let retainedFailed: TargetOutcome[] = [];
    if (opts.retryFromPath !== undefined) {
        const parsed = await readAggregateResult(fs, opts.retryFromPath);
        if (parsed === null) {
            return EXIT_INPUT;
        }
        prior = parsed;
        // Published/skipped targets are carried over as skipped with their prior url/id
        // and metadata (spec §5.1, 0110 I4).
        skipped = prior.targets
            .filter((t) => t.status !== 'failed')
            .map((t) => ({
                target: t.target,
                ok: true,
                status: 'skipped' as const,
                ...(t.url !== undefined ? { url: t.url } : {}),
                ...(t.id !== undefined ? { id: t.id } : {}),
                ...(t.metadata !== undefined ? { metadata: t.metadata } : {}),
            }));
        const carried = new Set(skipped.map((t) => t.target));
        const priorFailed = prior.targets.filter((t) => t.status === 'failed');
        if (opts.targets.length > 0) {
            // Explicit selection (spec §5): names already published/skipped stay skipped,
            // previously unattempted names are eligible, and each attempt happens at most
            // once (dedupe). Prior failures excluded from the selection remain failed in
            // the aggregate (0110 R7) so counters, exit code, and later retry rounds see
            // the full outstanding ledger.
            const attempt = [...new Set(opts.targets.filter((t) => !carried.has(t)))];
            const attemptSet = new Set(attempt);
            targets = attempt;
            retainedFailed = priorFailed.filter((t) => !attemptSet.has(t.target));
        } else {
            // No explicit targets: retry exactly the prior failures (spec §5).
            targets = priorFailed.map((t) => t.target);
        }
    }

    const productionDispatch = deps.dispatch === undefined;
    const dispatch =
        deps.dispatch ?? ((t: Target) => pluginDispatch(t, opts.contentPath, discovery, opts.targetTimeoutMs));
    if (productionDispatch && !validateTargets(targets, discovery)) {
        return EXIT_INPUT;
    }

    // R2: the production dispatch owns its own budget — the spawn terminates and reaps its process
    // tree before it resolves, so the fan-out's generic race would settle cleanup while the process
    // is still running. Keep that race for an injected dispatch only (it owns no subprocess).
    const raceTimeoutMs = productionDispatch ? undefined : opts.targetTimeoutMs;
    const fresh = await fanout(content, targets, dispatch, {
        ...(opts.serial === true ? { mode: 'serial' as const } : {}),
        ...(opts.jobs !== undefined ? { jobs: opts.jobs } : {}),
        ...(opts.serialTargets !== undefined ? { serialTargets: opts.serialTargets } : {}),
        ...(raceTimeoutMs !== undefined ? { timeoutMs: raceTimeoutMs } : {}),
    });
    const result = prior !== undefined ? aggregate([...skipped, ...retainedFailed, ...fresh.targets]) : fresh;

    try {
        await fs.writeFile(resolve(opts.outPath), `${JSON.stringify(result, null, 2)}\n`);
    } catch (err: unknown) {
        echoError(
            `Failed to write output file ${resolve(opts.outPath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EXIT_INPUT;
    }

    return result.ok ? 0 : EXIT_FAILURE;
}
