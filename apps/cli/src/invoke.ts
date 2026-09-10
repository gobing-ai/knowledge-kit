import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import {
    collectionForKind,
    DocListSchema,
    discoverAllPlugins,
    getByName,
    kindContract,
    type PluginKind,
} from '@gobing-ai/kk-core';
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
    /** Async spawns only: the child was cut short by `timeoutMs` (self-managed timer). */
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
 * Kill a process and all of its descendants, children first so nothing
 * respawns a parent (0110 I2). Owned-tool termination for the async spawn
 * seam: on timeout the direct child dies via the abort signal, but children
 * it spawned (e.g. a `spur agent run` stage) would survive and keep writing
 * artifacts. Depth-first pgrep walk; SIGKILL throughout.
 *
 * ponytail: POSIX only (`pgrep -P` walk). A Windows kk executor would use
 * `taskkill /T /F /PID <pid>` — add when one exists.
 */
function killProcessTree(pid: number): void {
    let stdout: string;
    try {
        stdout = Bun.spawnSync(['pgrep', '-P', String(pid)]).stdout.toString();
    } catch {
        stdout = '';
    }
    for (const line of stdout.trim().split('\n')) {
        const child = Number(line);
        if (Number.isInteger(child) && child > 0) {
            killProcessTree(child);
        }
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Already gone — the end state we want.
    }
}

/**
 * Async sibling of {@link spawnPluginEntry} for concurrent source runs (ADR-019).
 * Same cmd/env construction as the sync path; only the spawn call differs —
 * `Bun.spawn` plus an optional self-managed `timeoutMs` timer so one slow
 * source cannot pin a whole fan-in. A timeout kill surfaces as exit code 1
 * with `timedOut: true`, and the child's whole process tree is reaped (0110 I2):
 * descendants die even if the direct child already spawned them, so a
 * timed-out source leaves no owned tool running or writing artifacts.
 */
export async function spawnPluginEntryAsync(opts: PluginEntryAsyncSpawnOptions): Promise<PluginEntrySpawnResult> {
    let timedOut = false;

    // The timeout is driven by our own timer, not `AbortSignal.timeout` on the spawn:
    // Bun's abort-kill beats any late listener to the direct child, so a tree walk
    // running after abort sees an already-dead pid (grandchildren reparented and
    // invisible). Firing killProcessTree first, while the child is still alive, is the
    // only order that reaps the whole tree (0110 I2).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const proc = Bun.spawn(pluginEntryCmd(opts), {
        cwd: opts.cwd,
        env: pluginEntryEnv(opts),
        stdout: 'pipe',
        stderr: 'pipe',
    });

    if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
            timedOut = true;
            killProcessTree(proc.pid);
        }, opts.timeoutMs);
    }

    // Drain both pipes before awaiting exit so a chatty child cannot wedge on a full buffer.
    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    await proc.exited;
    if (timer !== undefined) {
        clearTimeout(timer);
    }

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

    // 0110 I5: an aliased --in/--out cannot pass freshness handling — the stale-output
    // clear below would delete the input before the child reads it. Reject before any
    // mutation or spawn; sidecar semantics stay intact because nothing is renamed.
    if (existsSync(absInPath) && absInPath === absOutPath) {
        echoError(`--in and --out alias the same path (${absInPath}); refusing to overwrite the input`);
        return 1;
    }

    // 0110 I3: a publish array input is allowed only when the manifest declares a
    // doc-list operation (e.g. podcast-pub show-notes). Undeclared arrays are rejected
    // before the child runs — no kind- or name-based exceptions, and the output-side
    // validation bypass dies with the old shape-sniffing (AC5).
    let artifactOutput = false;

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

        if (record.kind === 'publish' && Array.isArray(json)) {
            const op = Object.values(record.operations ?? {}).find((o) => o.input === 'doc-list');
            if (!op) {
                echoError(
                    `Publish plugin '${record.name}' received a Doc[] array but declares no doc-list operation; a Content object is required`,
                );
                return 1;
            }
            const docs = DocListSchema.safeParse(json);
            if (!docs.success) {
                const issues = docs.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
                echoError(`Input schema violation for the declared doc-list operation of '${record.name}': ${issues}`);
                return 1;
            }
            artifactOutput = op.output === 'markdown';
        } else {
            const parseResult = contract.input.safeParse(json);
            if (!parseResult.success) {
                const issues = parseResult.error.issues
                    .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
                    .join('; ');
                echoError(`Input schema violation for kind '${record.kind}': ${issues}`);
                return 1;
            }
        }
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

    // 0110 I5: fresh-output ownership. Any pre-existing --out is removed before the
    // spawn, so existence after the child exits proves the output was produced by this
    // invocation — a zero-exit child that writes nothing fails even over a previously
    // valid file. Only the exact --out path is removed: output-relative sidecars keep
    // their locations, and a failed rerun leaves no --out at all (the old artifact was
    // cleared up front, so stale output can never read as fresh success).
    if (existsSync(absOutPath)) {
        try {
            unlinkSync(absOutPath);
        } catch (err: unknown) {
            echoError(
                `Failed to clear stale output ${absOutPath}: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }
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

    // 0110 I3: declared-operation artifact output (e.g. show-notes markdown). The op's
    // output form is part of the manifest declaration, so --out stays an opaque artifact
    // only for invocations the plugin actually declared: existence + non-emptiness, no
    // JSON/Result validation. Content invocations keep exact Result validation below.
    if (artifactOutput) {
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

    // 0110 I6: a valid Result with ok:false is a publish failure, not success — the
    // executor must exit nonzero even when the child exited 0 (fan-out parity: the
    // dispatch result's ok flag already marks such targets failed). The failure
    // artifact stays on disk for inspection; the child's own nonzero exit remains
    // authoritative and unchanged. KindContract.output is an unparameterized ZodType,
    // so safeParse().data is unknown; the shape cast keeps the ok-check honest without
    // re-declaring the Result schema here.
    const parsed = outResult.data as { ok?: boolean; error?: string; message?: string };
    if (record.kind === 'publish' && parsed.ok === false) {
        const reason = parsed.error ?? parsed.message ?? 'publish failed';
        echoError(`Plugin '${record.name}' reported failure: ${reason}`);
        return 1;
    }

    return 0;
}
