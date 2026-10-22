import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { type DiscoveryResult, type Doc, DocListSchema, discoverAllPlugins, getByName } from '@gobing-ai/kk-core';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { spawnPluginEntryAsync } from './invoke';
import { formatIssues, readPluginJson } from './plugin-output';

/** One provenance entry per originating source file (spec §2.2). */
export interface SourceEntry {
    file: string;
    sourceUri?: string;
}

/**
 * One `--source <plugin>:<inputFile>` entry: an ingestion plugin to spawn
 * concurrently in source-runner mode (L1, ADR-019).
 */
export interface FaninSource {
    plugin: string;
    inputFile: string;
}

/** One degraded source in the merged output's `metadata.sourceErrors[]` (R3). */
export interface FaninSourceError {
    plugin: string;
    error: string;
    durationMs: number;
}

/** Parsed `kk fanin` CLI arguments. */
export interface FaninOptions {
    inPaths: string[];
    outPath: string;
    /** `--source` entries; present only in source-runner mode. */
    sources?: FaninSource[];
    /** `--source-timeout`; present only when explicitly given (default below applies otherwise). */
    sourceTimeoutMs?: number;
    /** `--source-timeout-override` entries, keyed by plugin; wins over `--source-timeout` and the default for that source. */
    sourceTimeoutOverrides?: Record<string, number>;
    /** `--plugins-root`; exclusive single-root override for source discovery. */
    pluginsRoot?: string;
    /** `--plugins-path` entries; unioned with the default roots for source discovery. */
    pluginsPath?: string[];
}

/**
 * Default per-source timeout: 30m (L1 — horizon alone took 20m40s in dogfood).
 * Horizon ingest latency kept growing (0098 r7: 28m39s solo), straddling this
 * default — long-lead sources get a `--source-timeout-override` (e.g. the daily
 * workflow pins horizon-ingest to 45m) instead of inflating the leash for everyone.
 */
const DEFAULT_SOURCE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Cap for the error string embedded in `metadata.sourceErrors[]` (P3b): the array
 * is copied onto every merged doc, so a chatty child's full stderr must not ride
 * along unchecked.
 */
const SOURCE_ERROR_MAX_CHARS = 2048;

/**
 * Cap a degraded-source error string. The head is kept (usually the informative
 * side of a failure log) and the truncation is stated explicitly, never silent.
 */
function capSourceError(error: string): string {
    if (error.length <= SOURCE_ERROR_MAX_CHARS) {
        return error;
    }
    return `${error.slice(0, SOURCE_ERROR_MAX_CHARS)}... [truncated; ${error.length} chars total]`;
}

/** Exit code for CLI usage errors (missing/unknown flags). */
const EXIT_USAGE = 2;
/** Exit code for input/output file errors (missing, unreadable, invalid) and all-sources-failed. */
const EXIT_INPUT = 1;

/**
 * Merge N Doc lists into one deduplicated Doc list (spec §2).
 *
 * Dedupe identity is the Doc `id`; the first-seen document wins and later
 * duplicates contribute only their provenance source. `metadata.sources` is
 * built in input order, and documents keep first-appearance order. Inputs
 * are never mutated; each merged doc is a fresh copy.
 */
export function mergeDocLists(inputs: Doc[][], sources: string[]): Doc[] {
    const merged: Doc[] = [];
    const byId = new Map<string, Doc>();

    for (const [i, docList] of inputs.entries()) {
        const file = sources[i] ?? `input[${i}]`;
        for (const doc of docList) {
            const entry: SourceEntry = { file };
            if (doc.sourceUri !== undefined) {
                entry.sourceUri = doc.sourceUri;
            }

            const existing = byId.get(doc.id);
            if (existing) {
                const list = existing.metadata?.sources;
                if (Array.isArray(list)) {
                    list.push(entry);
                }
                continue;
            }

            const mergedDoc: Doc = {
                ...doc,
                metadata: { ...(doc.metadata ?? {}), sources: [entry] },
            };
            byId.set(doc.id, mergedDoc);
            merged.push(mergedDoc);
        }
    }

    return merged;
}

/**
 * Read one `--in` file as a `Doc[]`.
 * @returns the parsed doc list, or null (with a file-naming error logged) on failure
 */
async function readDocList(fs: FileSystem, path: string): Promise<Doc[] | null> {
    if (!(await fs.exists(path))) {
        echoError(`Input file does not exist: ${path}`);
        return null;
    }

    let content: string;
    try {
        content = await fs.readFile(path);
    } catch (err: unknown) {
        echoError(`Failed to read input file ${path}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    let json: unknown;
    try {
        json = JSON.parse(content);
    } catch (err: unknown) {
        echoError(`Input file ${path} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }

    const result = DocListSchema.safeParse(json);
    if (!result.success) {
        echoError(`Input file ${path} violates the Doc list schema: ${formatIssues(result.error)}`);
        return null;
    }

    return result.data;
}

/**
 * Parse `--in <path>` (repeatable), `--source <plugin>:<inputFile>` (repeatable),
 * `--source-timeout <ms>`, and `--out <path>` from an argv slice.
 */
function parseArgs(argv: string[]): FaninOptions {
    const inPaths: string[] = [];
    const sources: FaninSource[] = [];
    let outPath: string | undefined;
    let sourceTimeoutMs: number | undefined;
    const sourceTimeoutOverrides: Record<string, number> = {};
    let pluginsRoot: string | undefined;
    const pluginsPath: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--in') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--in requires a file path');
            }
            inPaths.push(value);
        } else if (arg === '--source') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--source requires <plugin>:<inputFile>');
            }
            const sep = value.indexOf(':');
            if (sep <= 0 || sep === value.length - 1) {
                throw new Error(`--source requires <plugin>:<inputFile>, got '${value}'`);
            }
            sources.push({ plugin: value.slice(0, sep), inputFile: value.slice(sep + 1) });
        } else if (arg === '--source-timeout') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--source-timeout requires a millisecond value');
            }
            if (sourceTimeoutMs !== undefined) {
                throw new Error('--source-timeout may be specified only once');
            }
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(`--source-timeout must be a positive integer (ms), got '${value}'`);
            }
            sourceTimeoutMs = parsed;
        } else if (arg === '--source-timeout-override') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--source-timeout-override requires <plugin>:<ms>');
            }
            const sep = value.indexOf(':');
            if (sep <= 0 || sep === value.length - 1) {
                throw new Error(`--source-timeout-override requires <plugin>:<ms>, got '${value}'`);
            }
            const plugin = value.slice(0, sep);
            if (plugin in sourceTimeoutOverrides) {
                throw new Error(`--source-timeout-override: plugin '${plugin}' may be specified only once`);
            }
            const parsed = Number(value.slice(sep + 1));
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(
                    `--source-timeout-override ms must be a positive integer, got '${value.slice(sep + 1)}'`,
                );
            }
            sourceTimeoutOverrides[plugin] = parsed;
        } else if (arg === '--out') {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error('--out requires a file path');
            }
            if (outPath !== undefined) {
                throw new Error('--out may be specified only once');
            }
            outPath = value;
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

    if (inPaths.length === 0 && sources.length === 0) {
        throw new Error('at least one --in file or --source is required');
    }
    if (sourceTimeoutMs !== undefined && sources.length === 0) {
        throw new Error('--source-timeout requires at least one --source');
    }
    if (Object.keys(sourceTimeoutOverrides).length > 0 && sources.length === 0) {
        throw new Error('--source-timeout-override requires at least one --source');
    }
    for (const plugin of Object.keys(sourceTimeoutOverrides)) {
        if (!sources.some((candidate) => candidate.plugin === plugin)) {
            throw new Error(
                `--source-timeout-override names plugin '${plugin}' which is not among the --source plugins`,
            );
        }
    }
    if (outPath === undefined) {
        throw new Error('--out file is required');
    }

    return {
        inPaths,
        outPath,
        ...(sources.length > 0 ? { sources } : {}),
        ...(sourceTimeoutMs !== undefined ? { sourceTimeoutMs } : {}),
        ...(Object.keys(sourceTimeoutOverrides).length > 0 ? { sourceTimeoutOverrides } : {}),
        ...(pluginsRoot !== undefined ? { pluginsRoot } : {}),
        ...(pluginsPath.length > 0 ? { pluginsPath } : {}),
    };
}

/**
 * Resolve one `--source` entry against the merged plugin registry, spawn its
 * ingestion plugin through the sanctioned async seam (`invoke.ts`), and read
 * its `Doc[]` output. Any failure throws; the caller degrades that source
 * without touching siblings (R3).
 */
async function collectSourceDocs(discovery: DiscoveryResult, source: FaninSource, timeoutMs: number): Promise<Doc[]> {
    const record = getByName(discovery, source.plugin);
    if (!record) {
        throw new Error(`Plugin '${source.plugin}' not found in the merged plugin registry`);
    }
    if (record.kind !== 'ingestion') {
        throw new Error(`Plugin '${source.plugin}' is kind '${record.kind}', not 'ingestion'`);
    }

    const fs = createNodeFileSystem();
    const absInPath = resolve(source.inputFile);
    if (!(await fs.exists(absInPath))) {
        throw new Error(`Input file does not exist: ${absInPath}`);
    }

    const entryPath = isAbsolute(record.entry) ? record.entry : resolve(record.dir, record.entry);
    if (!(await fs.exists(entryPath))) {
        throw new Error(`Plugin entry script does not exist: ${entryPath}`);
    }

    const outTmp = join(
        tmpdir(),
        `kk-fanin-${source.plugin}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    try {
        const proc = await spawnPluginEntryAsync({
            entryPath,
            cwd: record.dir,
            inPath: absInPath,
            outPath: outTmp,
            pluginKind: record.kind,
            pluginName: record.name,
            timeoutMs,
        });
        if (proc.exitCode !== 0) {
            const why = proc.timedOut === true ? `timed out after ${timeoutMs}ms` : `exited with code ${proc.exitCode}`;
            throw new Error(`Plugin '${source.plugin}' ${why}: ${proc.stderr || proc.stdout || 'no output'}`);
        }
        // A source can succeed while contributing nothing, and its own stderr is then the only
        // explanation. Horizon-ingest's "no fresh digest … emitting []" never reached the collect
        // log, so a channel that had been empty for two days (2026-10-22) looked healthy.
        if (proc.stderr !== '') {
            echoError(`[source:${source.plugin}] ${proc.stderr.trim()}`);
        }
        if (!(await fs.exists(outTmp))) {
            throw new Error(`Plugin '${source.plugin}' succeeded but did not write an output file`);
        }

        // 0157 R10: shared reader — same invalid-JSON and Doc-list-schema wording as before.
        return readPluginJson(
            fs,
            outTmp,
            DocListSchema,
            `Plugin '${source.plugin}'`,
            'output violates the Doc list schema',
        );
    } finally {
        await fs.deleteFile(outTmp);
    }
}

/**
 * Run the `kk fanin` CLI handler.
 * @param argv `--in <path> [--in <path> ...] [--source <plugin>:<inputFile> ...] [--source-timeout <ms>] [--source-timeout-override <plugin>:<ms> ...] --out <path> [--plugins-root <dir> | --plugins-path <dir> ...]` (no subcommand name)
 * @returns exit code: 0 success (≥1 source succeeded), 1 file error / all sources failed, 2 usage error
 */
export async function runFanin(argv: string[]): Promise<number> {
    let opts: FaninOptions;
    try {
        opts = parseArgs(argv);
    } catch (err: unknown) {
        echoError(`fanin: ${err instanceof Error ? err.message : String(err)}`);
        return EXIT_USAGE;
    }

    if (opts.pluginsRoot !== undefined && (opts.pluginsPath?.length ?? 0) > 0) {
        echoError('fanin: --plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)');
        return EXIT_USAGE;
    }

    const fs = createNodeFileSystem();
    const inputs: Doc[][] = [];
    const sources: string[] = [];
    const sourceErrors: FaninSourceError[] = [];

    for (const inPath of opts.inPaths) {
        const docList = await readDocList(fs, inPath);
        if (docList === null) {
            return EXIT_INPUT;
        }
        inputs.push(docList);
        sources.push(inPath);
    }

    if (opts.sources !== undefined && opts.sources.length > 0) {
        // Same discovery entry point as runInvoke: the merged multi-root registry,
        // honouring --plugins-root / --plugins-path (ADR-012 R6).
        const discovery = discoverAllPlugins({ pluginsRoot: opts.pluginsRoot, extraPaths: opts.pluginsPath });

        // One concurrent run per --source; declaration order is preserved by
        // allSettled so the merge output stays deterministic. A failed or
        // timed-out source degrades to an error entry and never aborts siblings (R3).
        const settled = await Promise.allSettled(
            opts.sources.map(async (source) => {
                const started = Date.now();
                try {
                    const timeoutMs =
                        opts.sourceTimeoutOverrides?.[source.plugin] ??
                        opts.sourceTimeoutMs ??
                        DEFAULT_SOURCE_TIMEOUT_MS;
                    return { ok: true as const, docs: await collectSourceDocs(discovery, source, timeoutMs) };
                } catch (err: unknown) {
                    return {
                        ok: false as const,
                        error: err instanceof Error ? err.message : String(err),
                        durationMs: Date.now() - started,
                    };
                }
            }),
        );

        for (const [i, outcome] of settled.entries()) {
            const source = opts.sources[i];
            if (source === undefined) {
                continue;
            }
            const result =
                outcome.status === 'fulfilled'
                    ? outcome.value
                    : { ok: false as const, error: String(outcome.reason), durationMs: 0 };
            if (result.ok) {
                inputs.push(result.docs);
                sources.push(source.plugin);
            } else {
                // P3b: cap the embedded error so full child stderr never lands in the metadata.
                sourceErrors.push({
                    plugin: source.plugin,
                    error: capSourceError(result.error),
                    durationMs: result.durationMs,
                });
            }
        }

        // Per-source failures are never swallowed: every degradation echoes to the run output (R3).
        for (const err of sourceErrors) {
            echoError(`fanin: source '${err.plugin}' failed after ${err.durationMs}ms: ${err.error}`);
        }

        // Exit contract: 0 when ≥1 source succeeded, 1 only when every source failed.
        if (sourceErrors.length === opts.sources.length) {
            echoError(`fanin: all ${opts.sources.length} source(s) failed; no output written`);
            return EXIT_INPUT;
        }
    }

    const merged = mergeDocLists(inputs, sources);
    if (sourceErrors.length > 0) {
        // The output is a plain Doc[], so degraded-source warnings ride on every
        // merged doc's metadata for downstream states (workflow collect, L1 R1).
        for (const doc of merged) {
            doc.metadata = { ...(doc.metadata ?? {}), sourceErrors };
        }
    }

    try {
        await fs.writeFile(resolve(opts.outPath), `${JSON.stringify(merged, null, 2)}\n`);
    } catch (err: unknown) {
        echoError(
            `Failed to write output file ${resolve(opts.outPath)}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return EXIT_INPUT;
    }

    return 0;
}
