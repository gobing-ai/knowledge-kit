import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { collectionForKind, discoverAllPlugins, getByName, kindContract, type PluginKind } from '@gobing-ai/kk-core';
import { echoError } from '@gobing-ai/ts-utils';

/** Options for running a plugin invocation. */
export interface InvokeOptions {
    plugin: string;
    inPath: string;
    outPath: string;
    /** Exclusive single-root override (`--plugins-root`); disables default roots. */
    pluginsRoot?: string;
    /** Additive extra roots (`--plugins-path`, repeatable); union with defaults. */
    pluginsPath?: string[];
}

/** Options for the sole sanctioned plugin-entry spawn (ADR-006). */
export interface PluginEntrySpawnOptions {
    /** Absolute path to the plugin entry script. */
    entryPath: string;
    /** Working directory for the spawned process (the plugin package dir). */
    cwd: string;
    /** Absolute path passed as `--in`. */
    inPath: string;
    /** Absolute path passed as `--out`. */
    outPath: string;
    /** When set with `pluginName`, merge `plugins.<collection>.<name>.env` from KK_CONFIG. */
    pluginKind?: PluginKind;
    /** Plugin manifest name used to look up operator-config env. */
    pluginName?: string;
}

/** Outcome of spawning a plugin entry (exit code + captured streams). */
export interface PluginEntrySpawnResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    /** Async spawns only: the child was cut short by `timeoutMs` (abort signal fired). */
    timedOut?: boolean;
}

/** Operator config path: `KK_CONFIG` or `~/.config/kk/config.yaml`. */
export function resolveKkConfigPath(): string {
    return process.env.KK_CONFIG || join(homedir(), '.config/kk/config.yaml');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyEnvValue(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return undefined;
}

/**
 * Read `plugins.<collection>.<name>.env` from the operator config.
 * Missing, unreadable, or unparseable files yield an empty map — executor still runs.
 * Empty-string values are skipped so placeholders do not mask compiled defaults.
 */
export function pluginEnvFromConfig(
    kind: PluginKind,
    name: string,
    configFile = resolveKkConfigPath(),
): Record<string, string> {
    if (!existsSync(configFile)) {
        return {};
    }
    let raw: string;
    try {
        raw = readFileSync(configFile, 'utf-8');
    } catch {
        return {};
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(raw);
    } catch {
        return {};
    }
    if (!isPlainObject(parsed)) {
        return {};
    }
    const collectionNode = isPlainObject(parsed.plugins) ? parsed.plugins[collectionForKind(kind)] : undefined;
    if (!isPlainObject(collectionNode)) {
        return {};
    }
    const pluginNode = collectionNode[name];
    if (!isPlainObject(pluginNode) || !isPlainObject(pluginNode.env)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(pluginNode.env)) {
        const str = stringifyEnvValue(value);
        if (str === undefined || str === '') {
            continue;
        }
        out[key] = str;
    }
    return out;
}

/**
 * Spawn a plugin entry with the `--in` / `--out` contract (ADR-006).
 *
 * This is the **only** sanctioned direct process spawn in the CLI surface
 * (`no-direct-process-spawn` allowlists `invoke.ts`). Callers such as
 * `fanout` must go through this helper rather than calling `Bun.spawnSync`
 * themselves.
 *
 * Precedence for plugin env: existing `process.env` wins over
 * `plugins.<collection>.<name>.env` in `$KK_CONFIG`.
 */
/** Build the entry command: bun executes `.ts`/`.js` entries; anything else must be directly executable. */
function pluginEntryCmd(opts: PluginEntrySpawnOptions): string[] {
    return opts.entryPath.endsWith('.ts') || opts.entryPath.endsWith('.js')
        ? [process.execPath, opts.entryPath, '--in', opts.inPath, '--out', opts.outPath]
        : [opts.entryPath, '--in', opts.inPath, '--out', opts.outPath];
}

/** Build the spawn env: operator-config env under `process.env`, anchored at the kk invocation root. */
function pluginEntryEnv(opts: PluginEntrySpawnOptions): Record<string, string | undefined> {
    const fromConfig =
        opts.pluginKind !== undefined && opts.pluginName !== undefined
            ? pluginEnvFromConfig(opts.pluginKind, opts.pluginName)
            : {};
    // Plugins run with cwd = their package dir; hand them the kk invocation root so
    // anything they spawn (e.g. content-gen's `spur agent run` stages) anchors there
    // instead of self-initializing a stray .spur/ inside the plugin dir.
    return {
        ...fromConfig,
        ...process.env,
        KNOWLEDGE_KIT_PROJECT_ROOT: process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd(),
    };
}

/**
 * Spawn a plugin entry synchronously (ADR-006): plugin IO contract via stdin/stdout
 * around Bun.spawnSync, with the kk invocation root handed to the plugin env so
 * nested tooling anchors at the invocation root (see pluginEntryEnv).
 */
export function spawnPluginEntry(opts: PluginEntrySpawnOptions): PluginEntrySpawnResult {
    const proc = Bun.spawnSync(pluginEntryCmd(opts), {
        cwd: opts.cwd,
        env: pluginEntryEnv(opts),
        stdout: 'pipe',
        stderr: 'pipe',
    });

    return {
        exitCode: proc.exitCode === null ? 1 : proc.exitCode,
        stdout: proc.stdout.toString().trim(),
        stderr: proc.stderr.toString().trim(),
    };
}

/** Options for the async plugin-entry spawn — the timeout-aware sibling of {@link PluginEntrySpawnOptions}. */
export interface PluginEntryAsyncSpawnOptions extends PluginEntrySpawnOptions {
    /** Abort the entry after this many ms; omit for no timeout. */
    timeoutMs?: number;
}

/**
 * Async sibling of {@link spawnPluginEntry} for concurrent source runs (ADR-019).
 * Same cmd/env construction as the sync path; only the spawn call differs —
 * `Bun.spawn` plus an optional `AbortSignal.timeout(timeoutMs)` so one slow
 * source cannot pin a whole fan-in. A timeout kill surfaces as exit code 1
 * with `timedOut: true`.
 */
export async function spawnPluginEntryAsync(opts: PluginEntryAsyncSpawnOptions): Promise<PluginEntrySpawnResult> {
    const signal = opts.timeoutMs === undefined ? undefined : AbortSignal.timeout(opts.timeoutMs);
    let timedOut = false;
    signal?.addEventListener('abort', () => {
        timedOut = true;
    });

    const proc = Bun.spawn(pluginEntryCmd(opts), {
        cwd: opts.cwd,
        env: pluginEntryEnv(opts),
        stdout: 'pipe',
        stderr: 'pipe',
        signal,
    });

    // Drain both pipes before awaiting exit so a chatty child cannot wedge on a full buffer.
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;

    return {
        exitCode: proc.exitCode === null ? 1 : proc.exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ...(timedOut ? { timedOut: true } : {}),
    };
}

/**
 * Execute a discovered plugin with file IO and contract validation.
 * @returns exit code (0 on success, non-zero on error)
 */
export async function runInvoke(opts: InvokeOptions): Promise<number> {
    // Exclusive `--plugins-root` and additive `--plugins-path` share one merged
    // entry point; resolvePluginRoots ignores extraPaths under an exclusive root
    // (P3-4: a single-plugin-dir root behaves the same on every command).
    const discovery = discoverAllPlugins({ pluginsRoot: opts.pluginsRoot, extraPaths: opts.pluginsPath });

    const record = getByName(discovery, opts.plugin);
    if (!record) {
        echoError(`Plugin '${opts.plugin}' not found in the merged plugin registry`);
        if (discovery.diagnostics.length > 0) {
            for (const diag of discovery.diagnostics) {
                echoError(`  [diagnostic] ${diag.code} at ${diag.path}: ${diag.reason}`);
            }
        }
        return 1;
    }

    const contract = kindContract(record.kind);
    const absInPath = resolve(opts.inPath);
    const absOutPath = resolve(opts.outPath);

    // 0101: set by the input stage — true exactly when the invocation input is the
    // bare Doc[] array show-notes form (publish's two-form union, 0100), whose --out
    // is the raw markdown artifact rather than a Result JSON.
    let showNotesArrayInput = false;

    if (contract.input !== null) {
        if (!existsSync(absInPath)) {
            echoError(`Input file does not exist: ${absInPath}`);
            return 1;
        }
        let inContent: string;
        try {
            inContent = readFileSync(absInPath, 'utf-8');
        } catch (err: unknown) {
            echoError(`Failed to read input file ${absInPath}: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }

        let json: unknown;
        try {
            json = JSON.parse(inContent);
        } catch (err: unknown) {
            echoError(`Input file ${absInPath} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }

        const parseResult = contract.input.safeParse(json);
        if (!parseResult.success) {
            const issues = parseResult.error.issues
                .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
                .join('; ');
            echoError(`Input schema violation for kind '${record.kind}': ${issues}`);
            return 1;
        }

        // 0101: the array leg of publish's two-form input union (0100) is the show-notes
        // dispatch (0095). Scoped to publish — a generator's Doc[] input is the ordinary
        // form, so its --out stays a validated Content JSON.
        showNotesArrayInput = record.kind === 'publish' && Array.isArray(json);
    } else {
        if (!existsSync(absInPath)) {
            echoError(`Source path does not exist: ${absInPath}`);
            return 1;
        }
    }

    const entryPath = isAbsolute(record.entry) ? record.entry : resolve(record.dir, record.entry);
    if (!existsSync(entryPath)) {
        echoError(`Plugin entry script does not exist: ${entryPath}`);
        return 1;
    }

    const proc = spawnPluginEntry({
        entryPath,
        cwd: record.dir,
        inPath: absInPath,
        outPath: absOutPath,
        pluginKind: record.kind,
        pluginName: record.name,
    });

    if (proc.exitCode !== 0) {
        const errMsg = proc.stderr || proc.stdout || `Plugin entry exited with code ${proc.exitCode}`;
        echoError(`Plugin entry '${record.name}' failed (exit code ${proc.exitCode}): ${errMsg}`);
        const exitCode = proc.exitCode !== 0 ? proc.exitCode : 1;
        return exitCode;
    }

    if (!existsSync(absOutPath)) {
        echoError(`Plugin entry succeeded but did not write output file: ${absOutPath}`);
        return 1;
    }

    // 0101: show-notes markdown exemption. Publish's array input leg (0100) dispatches
    // podcast-pub's show-notes op (0095), which writes the raw markdown artifact itself
    // to --out (plugins/publishings/podcast-pub/src/index.ts:472-481) — the documented
    // deliverable, consumed as-is by the workflow. JSON.parse + ResultSchema validation
    // kills exactly that invocation with `Output file ... is invalid JSON` (0100's P3
    // residual), so for this form --out is an opaque artifact: existence + non-emptiness
    // only. Content-object invocations keep the exact JSON/Result validation and error
    // messages below (an empty --out still fails there as invalid JSON, byte-identical);
    // generator/ingestion kinds are untouched.
    if (showNotesArrayInput) {
        if (statSync(absOutPath).size === 0) {
            echoError(`Plugin entry succeeded but wrote an empty output file: ${absOutPath}`);
            return 1;
        }
        return 0;
    }

    let outContent: string;
    try {
        outContent = readFileSync(absOutPath, 'utf-8');
    } catch (err: unknown) {
        echoError(`Failed to read output file ${absOutPath}: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    let outJson: unknown;
    try {
        outJson = JSON.parse(outContent);
    } catch (err: unknown) {
        echoError(`Output file ${absOutPath} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    const outResult = contract.output.safeParse(outJson);
    if (!outResult.success) {
        const issues = outResult.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        echoError(`Output schema violation for kind '${record.kind}': ${issues}`);
        return 1;
    }

    return 0;
}
