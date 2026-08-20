import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
    type Content,
    ContentSchema,
    type DiscoveryResult,
    discoverAllPlugins,
    getByName,
    type Result,
    ResultSchema,
} from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { spawnPluginEntry } from './invoke';

/** A publish target: the name of a publish-kind plugin (spec §1.3). */
export type Target = string;

/** Single-target publish outcome returned by a dispatch (kk-core Result). */
export type ResultEntry = Result;

/** Per-target outcome in the aggregate result (spec §3.1). */
export interface TargetOutcome {
    target: string;
    ok: boolean;
    status: 'published' | 'failed' | 'skipped';
    url?: string;
    id?: string;
    error?: string;
    durationMs?: number;
}

/** Aggregate partial-success result written to `--out` (spec §3.1). */
export interface AggregateResult {
    ok: boolean;
    summary: {
        total: number;
        succeeded: number;
        failed: number;
        skipped: number;
    };
    targets: TargetOutcome[];
    metadata?: Record<string, unknown>;
}

/** Parsed `kk fanout` CLI arguments. */
export interface FanoutOptions {
    contentPath: string;
    targets: string[];
    outPath: string;
    retryFromPath?: string;
    pluginsRoot?: string;
    pluginsPath?: string[];
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
 * Dispatch `content` to every target sequentially (spec §3), aggregating one
 * per-target outcome each. A dispatch that rejects is recorded as failed.
 * Every target appears in the result exactly once per run.
 */
export async function fanout(
    content: Content,
    targets: Target[],
    dispatch: (target: Target) => Promise<ResultEntry>,
): Promise<AggregateResult> {
    // Content flows to transports through the dispatch closure; the parameter keeps the
    // publish payload part of this function's contract (spec §3).
    void content;
    const entries: TargetOutcome[] = [];

    for (const target of targets) {
        const started = Date.now();
        let entry: TargetOutcome;
        try {
            const result = await dispatch(target);
            const durationMs = Date.now() - started;
            entry = result.ok
                ? {
                      target,
                      ok: true,
                      status: 'published',
                      ...(result.url !== undefined ? { url: result.url } : {}),
                      ...(result.id !== undefined ? { id: result.id } : {}),
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
            entry = {
                target,
                ok: false,
                status: 'failed',
                error: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - started,
            };
        }
        entries.push(entry);
    }

    return aggregate(entries);
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
        const issues = result.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        echoError(`Content file ${path} violates the Content schema: ${issues}`);
        return null;
    }

    return result.data;
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

    if (typeof json !== 'object' || json === null) {
        echoError(`Result file ${path} is not an aggregate result object`);
        return null;
    }
    const obj = json as Record<string, unknown>;
    const summary = obj.summary;
    if (typeof obj.ok !== 'boolean' || typeof summary !== 'object' || summary === null || !Array.isArray(obj.targets)) {
        echoError(`Result file ${path} violates the aggregate result schema (ok/summary/targets)`);
        return null;
    }
    const sum = summary as Record<string, unknown>;
    for (const key of ['total', 'succeeded', 'failed', 'skipped']) {
        if (typeof sum[key] !== 'number') {
            echoError(`Result file ${path} violates the aggregate result schema (summary.${key})`);
            return null;
        }
    }

    const targets: TargetOutcome[] = [];
    for (const entry of obj.targets) {
        if (typeof entry !== 'object' || entry === null) {
            echoError(`Result file ${path} violates the aggregate result schema (target entry)`);
            return null;
        }
        const t = entry as Record<string, unknown>;
        if (
            typeof t.target !== 'string' ||
            typeof t.ok !== 'boolean' ||
            (t.status !== 'published' && t.status !== 'failed' && t.status !== 'skipped')
        ) {
            echoError(`Result file ${path} violates the aggregate result schema (target ${String(t.target)})`);
            return null;
        }
        targets.push({
            target: t.target,
            ok: t.ok,
            status: t.status,
            ...(typeof t.url === 'string' ? { url: t.url } : {}),
            ...(typeof t.id === 'string' ? { id: t.id } : {}),
            ...(typeof t.error === 'string' ? { error: t.error } : {}),
            ...(typeof t.durationMs === 'number' ? { durationMs: t.durationMs } : {}),
        });
    }

    return {
        ok: obj.ok,
        summary: {
            total: sum.total as number,
            succeeded: sum.succeeded as number,
            failed: sum.failed as number,
            skipped: sum.skipped as number,
        },
        targets,
    };
}

/** Parse `--content <file> [--target <plugin> ...] --out <file> [--retry-from <file>] [--plugins-root <dir>] [--plugins-path <dir> ...]` from an argv slice. */
function parseArgs(argv: string[]): FanoutOptions {
    const targets: string[] = [];
    const pluginsPath: string[] = [];
    let contentPath: string | undefined;
    let outPath: string | undefined;
    let retryFromPath: string | undefined;
    let pluginsRoot: string | undefined;

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
    };
}

/**
 * Default dispatch: run the publish plugin named by the target through its
 * entry script (same `--in`/`--out` contract as `kk invoke`) and return the
 * `Result` it wrote. Throws on any failure so the target is recorded as failed.
 *
 * Process spawn goes through `spawnPluginEntry` in `invoke.ts` — the only
 * sanctioned `Bun.spawnSync` site under `no-direct-process-spawn`.
 */
async function pluginDispatch(target: string, contentPath: string, discovery: DiscoveryResult): Promise<ResultEntry> {
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
        const proc = spawnPluginEntry({
            entryPath,
            cwd: record.dir,
            inPath: resolve(contentPath),
            outPath: outTmp,
            pluginKind: record.kind,
            pluginName: record.name,
        });
        if (proc.exitCode !== 0) {
            throw new Error(`Plugin '${target}' exited ${proc.exitCode}: ${proc.stderr || proc.stdout || 'no output'}`);
        }

        if (!(await fs.exists(outTmp))) {
            throw new Error(`Plugin '${target}' succeeded but did not write a result file`);
        }
        const parsed = ResultSchema.safeParse(JSON.parse(await fs.readFile(outTmp)));
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
            throw new Error(`Plugin '${target}' wrote an invalid Result: ${issues}`);
        }
        return parsed.data;
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
    let targets = opts.targets;
    if (opts.retryFromPath !== undefined) {
        const parsed = await readAggregateResult(fs, opts.retryFromPath);
        if (parsed === null) {
            return EXIT_INPUT;
        }
        prior = parsed;
        // Published/skipped targets are carried over as skipped with their prior url/id (spec §5.1).
        skipped = prior.targets
            .filter((t) => t.status !== 'failed')
            .map((t) => ({
                target: t.target,
                ok: true,
                status: 'skipped' as const,
                ...(t.url !== undefined ? { url: t.url } : {}),
                ...(t.id !== undefined ? { id: t.id } : {}),
            }));
        // Retry exactly the prior failures; explicit --target narrows to the still-unpublished subset.
        const carried = new Set(skipped.map((t) => t.target));
        targets = opts.targets.length > 0 ? opts.targets.filter((t) => !carried.has(t)) : selectRetryTargets(prior);
    }

    const dispatch = deps.dispatch ?? ((t: Target) => pluginDispatch(t, opts.contentPath, discovery));
    if (deps.dispatch === undefined && !validateTargets(targets, discovery)) {
        return EXIT_INPUT;
    }

    const fresh = await fanout(content, targets, dispatch);
    const result = prior !== undefined ? aggregate([...skipped, ...fresh.targets]) : fresh;

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
