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
import { formatIssues } from './plugin-output';

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
    const out: Record<string, string> = {};
    if (kind === 'publish') {
        for (const sibling of Object.values(collectionNode)) {
            if (!isPlainObject(sibling) || !isPlainObject(sibling.env)) continue;
            const ch = stringifyEnvValue(sibling.env.KK_BROWSER_CHANNEL);
            if (ch !== undefined && ch !== '') {
                out.KK_BROWSER_CHANNEL = ch;
                break;
            }
        }
        if (name === 'surfdash-pub') {
            const podcastNode = collectionNode['podcast-pub'];
            if (isPlainObject(podcastNode) && isPlainObject(podcastNode.env)) {
                for (const key of ['MICROFEED_BASE_URL', 'MICROFEED_API_KEY'] as const) {
                    const inherited = stringifyEnvValue(podcastNode.env[key]);
                    if (inherited !== undefined && inherited !== '') {
                        out[key] = inherited;
                    }
                }
            }
        }
    }
    const pluginNode = collectionNode[name];
    if (!isPlainObject(pluginNode) || !isPlainObject(pluginNode.env)) {
        return out;
    }
    for (const [key, value] of Object.entries(pluginNode.env)) {
        const str = stringifyEnvValue(value);
        if (str === undefined || str === '') {
            continue;
        }
        out[key] = str;
    }
    return out;
}

/** Build the entry command: bun executes `.ts`/`.js` entries; anything else must be directly executable. */
function pluginEntryCmd(opts: PluginEntrySpawnOptions): string[] {
    return opts.entryPath.endsWith('.ts') || opts.entryPath.endsWith('.js')
        ? [process.execPath, opts.entryPath, '--in', opts.inPath, '--out', opts.outPath]
        : [opts.entryPath, '--in', opts.inPath, '--out', opts.outPath];
}

/**
 * Build a plugin's process env — the one precedence owner (0311): operator-config env under
 * `process.env`, scoped `extraEnv` over that, and `KNOWLEDGE_KIT_PROJECT_ROOT` anchored at the
 * kk invocation root. Every plugin spawn and the itc readiness probe resolve env here.
 */
export function pluginProcessEnv(
    kind?: PluginKind,
    name?: string,
    extraEnv?: Record<string, string>,
): Record<string, string | undefined> {
    const fromConfig = kind !== undefined && name !== undefined ? pluginEnvFromConfig(kind, name) : {};
    // Plugins run with cwd = their package dir; hand them the kk invocation root so
    // anything they spawn (e.g. content-gen's `spur agent run` stages) anchors there
    // instead of self-initializing a stray .spur/ inside the plugin dir.
    return {
        ...fromConfig,
        ...process.env,
        // Scoped lease delegation (0276/0277) wins over process.env: the parent holds the
        // live lease object, so its env view is authoritative for the child.
        ...(extraEnv ?? {}),
        KNOWLEDGE_KIT_PROJECT_ROOT: process.env.KNOWLEDGE_KIT_PROJECT_ROOT ?? process.cwd(),
    };
}

/** Build the spawn env for one spawn call — delegates so the precedence exists once. */
function pluginEntryEnv(
    opts: Pick<PluginEntrySpawnOptions, 'pluginKind' | 'pluginName'> & {
        extraEnv?: Record<string, string>;
    },
): Record<string, string | undefined> {
    return pluginProcessEnv(opts.pluginKind, opts.pluginName, opts.extraEnv);
}

/** Options for the ADR-032 readiness-probe / login spawn (`plugin check` + `plugin login`). */
export interface PluginProbeSpawnOptions {
    /** Absolute path to the probe entry (plugin.json `check`, resolved by the registry). */
    entryPath: string;
    /** Working directory for the spawned process (the plugin package dir). */
    cwd: string;
    /** Probe subcommand: `check` (readiness), `login` (interactive) or `open` (bot session, 0277). */
    subcommand: 'check' | 'login' | 'open';
    /** Forward `--headed` to the probe (check only). */
    headed?: boolean;
    /** Forward `--timeout <ms>` to the probe and enforce it on the spawn (check only). */
    timeoutMs?: number;
    /** Explicit profile dir forwarded as `--profile` (bot sessions); an explicit flag beats plugin env tiers. */
    profileDir?: string;
    /** Session URL forwarded as `--url` (bot sessions; login navigation target, mandatory for `open`). */
    url?: string;
    /** Extra child env entries (scoped lease delegation) layered over `process.env` — the parent holds the truth. */
    extraEnv?: Record<string, string>;
    /** When set with `pluginName`, merge `plugins.<collection>.<name>.env` from KK_CONFIG. */
    pluginKind?: PluginKind;
    /** Plugin manifest name used to look up operator-config env. */
    pluginName?: string;
    /** Aborted when the operator interrupts the session: the child is killed and exits nonzero (0423 R5). */
    signal?: AbortSignal;
}

/** Build the probe command: bun executes `.ts`/`.js` probes; anything else must be directly executable. */
function pluginProbeCmd(opts: PluginProbeSpawnOptions): string[] {
    const flags = [
        ...(opts.subcommand === 'check' && opts.headed ? ['--headed'] : []),
        ...(opts.subcommand === 'check' && opts.timeoutMs !== undefined ? ['--timeout', String(opts.timeoutMs)] : []),
        // Legacy `check|login` argv is preserved: without a bot session the flags below stay unset.
        ...(opts.profileDir !== undefined ? ['--profile', opts.profileDir] : []),
        ...(opts.url !== undefined ? ['--url', opts.url] : []),
    ];
    return opts.entryPath.endsWith('.ts') || opts.entryPath.endsWith('.js')
        ? [process.execPath, opts.entryPath, opts.subcommand, ...flags]
        : [opts.entryPath, opts.subcommand, ...flags];
}

/**
 * Spawn a plugin's readiness probe synchronously with captured streams (ADR-032).
 * A timeout kill or an unlaunchable probe surfaces as exit code 2 — the ADR-032
 * `error` verdict — never as `refused` (1).
 */
export function spawnPluginProbe(opts: PluginProbeSpawnOptions): PluginEntrySpawnResult {
    let proc: ReturnType<typeof Bun.spawnSync>;
    try {
        proc = Bun.spawnSync(pluginProbeCmd(opts), {
            cwd: opts.cwd,
            env: pluginEntryEnv(opts),
            stdout: 'pipe',
            stderr: 'pipe',
            timeout: opts.timeoutMs,
        });
    } catch {
        return { exitCode: 2, stdout: '', stderr: 'probe failed to start' };
    }
    return {
        exitCode: proc.exitCode ?? (proc.signalCode !== null ? 2 : 1),
        stdout: (proc.stdout ?? Buffer.alloc(0)).toString().trim(),
        stderr: (proc.stderr ?? Buffer.alloc(0)).toString().trim(),
    };
}

/**
 * Spawn a plugin's interactive `login` probe with inherited stdio (ADR-032) and
 * return its exit code. Streams pass through so the operator can interact.
 */
export function spawnPluginLogin(opts: PluginProbeSpawnOptions): number {
    const proc = Bun.spawnSync(pluginProbeCmd(opts), {
        cwd: opts.cwd,
        env: pluginEntryEnv(opts),
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
    });
    return proc.exitCode ?? 1;
}

/** Outcome of an interactive bot-session spawn: exit code plus the piped stdout (verdict channel). */
export interface PluginSessionSpawnResult {
    exitCode: number;
    stdout: string;
}

/**
 * Spawn a plugin's interactive bot-session command (`login`/`open`, 0277) and await its exit.
 * stdin and stderr are inherited so the operator interacts and sees site diagnostics; stdout is
 * piped because it carries the machine verdict (canonical `defaultUrl` on a successful login),
 * which the parent must parse. Spawn failures surface as exit 2 (usage-shaped), never success.
 */
export async function spawnPluginSession(opts: PluginProbeSpawnOptions): Promise<PluginSessionSpawnResult> {
    const started = (): Bun.Subprocess<'inherit', 'pipe', 'inherit'> | null => {
        try {
            return Bun.spawn(pluginProbeCmd(opts), {
                cwd: opts.cwd,
                env: pluginEntryEnv(opts),
                stdin: 'inherit',
                stdout: 'pipe',
                stderr: 'inherit',
                ...(opts.signal === undefined ? {} : { signal: opts.signal }),
            });
        } catch {
            return null;
        }
    };
    const proc = started();
    if (proc === null) {
        return { exitCode: 2, stdout: '' };
    }
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    return { exitCode: proc.exitCode ?? 1, stdout: stdout.trim() };
}

/** Verdict derived from a probe spawn outcome; raw probe output never survives. */
export interface ProbeVerdict {
    status: 'verified' | 'refused' | 'error';
    profileDir?: string;
    detail?: string;
}

/**
 * How far back a verdict line may sit. A browser probe prints at most a handful of progress lines
 * before its verdict, and a bounded scan keeps stale output from an earlier phase out of the answer.
 */
const VERDICT_SCAN_LINES = 20;

/**
 * Map a probe spawn outcome to its verdict (ADR-032 R3): `verified` (exit 0),
 * `refused` (exit 1) or `error` (exit 2, another code, a crash, a timeout, or a
 * no/malformed final JSON line). Only status/profileDir/detail survive; raw
 * probe stdout/stderr — which can carry page text or tokens — never does.
 */
export function probeVerdict(exitCode: number, stdout: string): ProbeVerdict {
    // The verdict is the last line the probe PRINTED, which is not the last line it WROTE: a browser
    // probe emits progress lines, and a channel's own writer can append a trailing line after the
    // verdict. Reading only the final line therefore reported `malformed probe output` for a probe
    // that had already said `refused — session expired` (0381), which is the one text that tells the
    // operator the fix is a re-login. Scan back over the tail for the last line that PARSES as a
    // verdict; unparsed lines never reach the detail (they can carry page text or tokens).
    const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .slice(-VERDICT_SCAN_LINES);
    let fields: { status?: unknown; profileDir?: unknown; detail?: unknown } | undefined;
    for (const line of [...lines].reverse()) {
        if (!line.startsWith('{')) continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        if (
            typeof parsed === 'object' &&
            parsed !== null &&
            typeof (parsed as { status?: unknown }).status === 'string'
        ) {
            fields = parsed as { status?: unknown; profileDir?: unknown; detail?: unknown };
            break;
        }
    }
    const status = typeof fields?.status === 'string' ? fields.status : undefined;
    if ((status === 'verified' && exitCode === 0) || (status === 'refused' && exitCode === 1)) {
        return {
            status,
            ...(typeof fields?.profileDir === 'string' ? { profileDir: fields.profileDir } : {}),
            ...(typeof fields?.detail === 'string' ? { detail: fields.detail } : {}),
        };
    }
    if (status === undefined) {
        return { status: 'error', detail: `probe exit ${exitCode} (malformed probe output)` };
    }
    // A deliberate `error` verdict's detail is probe-authored (e.g. a missing env var), unlike raw
    // stdout, so it is the one error-path text worth showing the operator.
    const cause = status === 'error' && typeof fields?.detail === 'string' ? `: ${fields.detail}` : '';
    return { status: 'error', detail: `probe exit ${exitCode}${cause}` };
}

/**
 * Spawn a plugin entry synchronously (ADR-006) with the `--in` / `--out` contract.
 *
 * This is the **only** sanctioned direct process spawn in the CLI surface
 * (`no-direct-process-spawn` allowlists `invoke.ts`). Callers such as
 * `fanout` must go through this helper rather than calling `Bun.spawnSync`
 * themselves.
 *
 * Precedence for plugin env: existing `process.env` wins over
 * `plugins.<collection>.<name>.env` in `$KK_CONFIG`; the kk invocation root
 * is handed to the plugin env so nested tooling anchors there (see pluginEntryEnv).
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

/** Settle window between tree-kill sweeps; late spawn registrations need it (see killProcessTree). */
const KILL_TREE_SETTLE_MS = 100;

function listChildren(pid: number): number[] {
    let stdout: string;
    try {
        stdout = Bun.spawnSync(['pgrep', '-P', String(pid)]).stdout.toString();
    } catch {
        stdout = '';
    }
    return stdout
        .trim()
        .split('\n')
        .map(Number)
        .filter((child) => Number.isInteger(child) && child > 0);
}

/** Kill `pid` and everything below it, children first so nothing respawns it. Synchronous sweep unit. */
function killSubtree(pid: number): void {
    for (const child of listChildren(pid)) {
        killSubtree(child);
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Already gone — the end state we want.
    }
}

/**
 * Kill a process and all of its descendants, children first so nothing
 * respawns a parent (0110 I2). Owned-tool termination for the async spawn
 * seam: on timeout the direct child dies via the abort signal, but children
 * it spawned (e.g. a `spur agent run` stage) would survive and keep writing
 * artifacts. Depth-first pgrep walk; SIGKILL throughout.
 *
 * Two sweeps with a settle window: a spawn that was in flight during sweep 1
 * registers under the — still alive — root pid within microseconds; sweep 2
 * reaps it. Killing the root before that window turns late registrations into
 * orphans reparented to launchd, unreachable by any pgrep -P walk (0110 I2b).
 *
 * ponytail: POSIX only (`pgrep -P` walk). A Windows kk executor would use
 * `taskkill /T /F /PID <pid>` — add when one exists.
 */
async function killProcessTree(pid: number): Promise<void> {
    // Group kill first: with the entry spawned detached, every descendant —
    // including a grandchild whose fork completed after the last pgrep
    // snapshot — already carries the entry's pgid, so this reaps the race the
    // pgrep walk below cannot see (observed: snapshot at +152ms, root kill at
    // +168ms, fork landing in between → orphan reparented to launchd).
    if (process.platform !== 'win32') {
        try {
            process.kill(-pid, 'SIGKILL');
        } catch {
            // No such group — entry already gone; the walk below still runs.
        }
    }
    const sweep = () => {
        for (const child of listChildren(pid)) {
            killSubtree(child);
        }
    };
    sweep();
    await Bun.sleep(KILL_TREE_SETTLE_MS);
    sweep();
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
        // Own process group (POSIX) so the timeout kill can take the whole tree
        // group-wide; see killProcessTree (0110 I2b).
        detached: process.platform !== 'win32',
    });

    if (opts.timeoutMs !== undefined) {
        timer = setTimeout(() => {
            timedOut = true;
            // Fire-and-forget: killProcessTree cannot reject (all kill/spawn calls are
            // guarded), and the caller's `await proc.exited` plus pipe drains already
            // bound the observable completion. The root dies last, after the settle
            // sweep, so this keeps running slightly past exit — by design (0110 I2b).
            void killProcessTree(proc.pid);
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

/** True when both paths exist and name the same file (dev+ino; follows symlinks). */
function isSameFile(a: string, b: string): boolean {
    if (!existsSync(b)) return false;
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.dev === sb.dev && sa.ino === sb.ino;
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

    // 0110 I5 + 0157 R1: an aliased --in/--out cannot pass freshness handling — the stale-output
    // clear below would delete the input before the child reads it. Path strings miss aliases
    // (case-insensitive APFS, symlinked dirs, hard links), so compare file identity when both
    // exist. Reject before any mutation or spawn; sidecar semantics stay intact because nothing
    // is renamed.
    if (existsSync(absInPath) && (absInPath === absOutPath || isSameFile(absInPath, absOutPath))) {
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
                echoError(
                    `Input schema violation for the declared doc-list operation of '${record.name}': ${formatIssues(docs.error)}`,
                );
                return 1;
            }
            artifactOutput = op.output === 'markdown';
        } else {
            const parseResult = contract.input.safeParse(json);
            if (!parseResult.success) {
                echoError(`Input schema violation for kind '${record.kind}': ${formatIssues(parseResult.error)}`);
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
        return proc.exitCode;
    }

    // Forward the child's own diagnostics on success too (2026-10-22). A plugin that produces a
    // valid-yet-empty result explains itself only here — horizon-ingest's "no fresh digest …
    // emitting []" was dropped, which is how a dead channel stayed invisible in the collect log.
    if (proc.stderr !== '') {
        echoError(`[plugin:${record.name}] ${proc.stderr}`);
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
        echoError(`Output schema violation for kind '${record.kind}': ${formatIssues(outResult.error)}`);
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
