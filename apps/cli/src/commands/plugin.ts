import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    type DiscoveryDiagnostic,
    discoverAllPlugins,
    isPluginKind,
    type PluginKind,
    type PluginRecord,
} from '@gobing-ai/kk-core';
import { echoError } from '@gobing-ai/ts-utils';
import { type Command, CommanderError } from 'commander';
import { type ProbeVerdict, probeVerdict, spawnPluginLogin, spawnPluginProbe } from '../invoke';
import { consoleOutput } from '../output';

/**
 * Diagnostic carried by the unified health report. Plugin-level diagnostics
 * add `missing_entry`, which is not part of the discovery diagnostic codes,
 * so the shape is structural (same `{ code, path, reason }` contract).
 */
interface StatusDiagnostic {
    code: string;
    path: string;
    reason: string;
}

/** Unified health report emitted by `plugin status --json` (ADR-011 R3). */
interface PluginStatusJson {
    healthy: boolean;
    plugins: Array<PluginRecord & { healthy: boolean; diagnostics: StatusDiagnostic[] }>;
    diagnostics: DiscoveryDiagnostic[];
}

/** Options accepted by the `plugin status` verb (and its hidden `list` / `doctor` aliases). */
interface StatusOptions {
    kind?: string;
    json?: boolean;
    pluginsRoot?: string;
    pluginsPath?: string[];
}

/** Collect repeated `--plugins-path` values into an array (commander last-wins otherwise). */
function collectPath(value: string, acc: string[]): string[] {
    acc.push(value);
    return acc;
}

/**
 * Build the unified health report over the merged multi-root registry.
 *
 * Tree-level discovery diagnostics (`misplaced`, `kind_mismatch`, `malformed`,
 * `duplicate_name`, `shadowed`, `unreadable`) stay in the top-level
 * `diagnostics` array — they are never dropped just because they are not
 * attached to a PluginRecord. `missing_entry` attaches to the owning plugin's
 * `diagnostics` and counts toward that plugin's `healthy: false`.
 */
function buildStatusReport(opts: { pluginsRoot?: string; pluginsPath?: string[] }): PluginStatusJson {
    const discovery = discoverAllPlugins({ pluginsRoot: opts.pluginsRoot, extraPaths: opts.pluginsPath });

    const plugins = discovery.plugins.map((record) => {
        const diagnostics: StatusDiagnostic[] = [];
        const entryPath = resolve(record.dir, record.entry);
        if (!existsSync(entryPath)) {
            diagnostics.push({
                code: 'missing_entry',
                path: entryPath,
                reason: `Plugin "${record.name}" entry file does not exist: ${record.entry}`,
            });
        }
        return { ...record, healthy: diagnostics.length === 0, diagnostics };
    });

    return {
        healthy: discovery.diagnostics.length === 0 && plugins.every((p) => p.healthy),
        plugins,
        diagnostics: [...discovery.diagnostics],
    };
}

/** Print every diagnostic (tree-level + per-plugin) to stderr. */
function printDiagnostics(report: PluginStatusJson): void {
    const all: StatusDiagnostic[] = [...report.diagnostics];
    for (const p of report.plugins) {
        all.push(...p.diagnostics);
    }
    echoError(`Found ${all.length} diagnostic issue(s):`);
    for (const d of all) {
        echoError(`  [${d.code}] ${d.path}: ${d.reason}`);
    }
}

/**
 * Shared `plugin status` action — also backs the hidden `plugins list` /
 * `plugins doctor` aliases, so both old paths reach the same engine and the
 * same unified JSON contract.
 *
 * Fail-loud paths throw a CommanderError with exit code 1; main() maps it to
 * the returned process exit code — the module never exits the process.
 */
function statusAction(options: StatusOptions): void {
    if (options.pluginsRoot !== undefined && (options.pluginsPath?.length ?? 0) > 0) {
        echoError('--plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)');
        throw new CommanderError(
            2,
            'kk.plugin.root-path-conflict',
            '--plugins-root and --plugins-path are mutually exclusive',
        );
    }
    const report = buildStatusReport({ pluginsRoot: options.pluginsRoot, pluginsPath: options.pluginsPath });

    let records = report.plugins;
    if (options.kind) {
        if (!isPluginKind(options.kind)) {
            echoError(`Invalid plugin kind: ${options.kind}`);
            throw new CommanderError(1, 'kk.plugin.invalid-kind', `invalid plugin kind: ${options.kind}`);
        }
        records = report.plugins.filter((p) => p.kind === options.kind);
    }

    if (options.json) {
        consoleOutput.write(`${JSON.stringify({ ...report, plugins: records }, null, 2)}\n`);
        if (!report.healthy) {
            throw new CommanderError(1, 'kk.plugin.unhealthy', 'plugin diagnostics found');
        }
        return;
    }

    if (records.length === 0) {
        consoleOutput.write('No plugins found.\n');
        if (!report.healthy) {
            printDiagnostics(report);
            throw new CommanderError(1, 'kk.plugin.unhealthy', 'plugin diagnostics found');
        }
        return;
    }

    const kinds: PluginKind[] = options.kind ? [options.kind as PluginKind] : ['ingestion', 'generator', 'publish'];

    for (const k of kinds) {
        const group = records.filter((p) => p.kind === k);
        if (group.length === 0) continue;

        consoleOutput.write(`\n--- ${k.toUpperCase()} PLUGINS ---\n`);
        for (const p of group) {
            const ver = p.version ? ` (v${p.version})` : '';
            const desc = p.description ? ` - ${p.description}` : '';
            const health = p.healthy ? 'healthy' : 'unhealthy';
            const check = p.check !== undefined ? ` check: ${p.check}` : '';
            consoleOutput.write(`  • ${p.name}${ver}: ${p.entry}${desc} [${health}]${check}\n`);
        }
    }

    if (!report.healthy) {
        printDiagnostics(report);
        throw new CommanderError(1, 'kk.plugin.unhealthy', 'plugin diagnostics found');
    }
}

/** One per-plugin row of the `plugin check` report (ADR-032 R4). */
interface CheckRow {
    name: string;
    kind: PluginKind;
    status: 'verified' | 'refused' | 'error' | 'unsupported';
    profileDir?: string;
    detail?: string;
}

/** Options accepted by the `plugin check` verb. */
interface CheckOptions {
    kind?: string;
    json?: boolean;
    headed?: boolean;
    timeout?: string;
    pluginsRoot?: string;
    pluginsPath?: string[];
}

/** Options accepted by the `plugin login` verb. */
interface LoginOptions {
    pluginsRoot?: string;
    pluginsPath?: string[];
}

/** Reject `--plugins-root` + `--plugins-path` combinations (ADR-012 R6), shared by check/login. */
function assertExclusiveRoots(pluginsRoot: string | undefined, pluginsPath: string[] | undefined): void {
    if (pluginsRoot !== undefined && (pluginsPath?.length ?? 0) > 0) {
        echoError('--plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)');
        throw new CommanderError(
            2,
            'kk.plugin.root-path-conflict',
            '--plugins-root and --plugins-path are mutually exclusive',
        );
    }
}

/** Run the readiness probe for one plugin (or report why there is no verdict). */
function checkOne(record: PluginRecord, options: CheckOptions): CheckRow {
    if (record.check === undefined) {
        return { name: record.name, kind: record.kind, status: 'unsupported' };
    }
    if (!existsSync(record.check)) {
        return { name: record.name, kind: record.kind, status: 'error', detail: 'probe entry missing' };
    }
    // Documented default (docs/04_DESIGN.md): a hung browser probe must never wedge the run.
    const timeoutMs = options.timeout !== undefined ? Number(options.timeout) : 30_000;
    const result = spawnPluginProbe({
        entryPath: record.check,
        cwd: record.dir,
        subcommand: 'check',
        headed: options.headed,
        timeoutMs,
        pluginKind: record.kind,
        pluginName: record.name,
    });
    const verdict: ProbeVerdict = probeVerdict(result.exitCode, result.stdout);
    return {
        name: record.name,
        kind: record.kind,
        status: verdict.status,
        ...(verdict.profileDir !== undefined ? { profileDir: verdict.profileDir } : {}),
        ...(verdict.detail !== undefined ? { detail: verdict.detail } : {}),
    };
}

/**
 * `plugin check` action — spawn `<check> check` per selected plugin sequentially
 * (ADR-032: browser profiles are single-writer and the engine is sequential).
 * Exits 0 only when no plugin is refused or errored; unsupported never fails.
 */
function checkAction(names: string[], options: CheckOptions): void {
    assertExclusiveRoots(options.pluginsRoot, options.pluginsPath);
    if (options.kind !== undefined && !isPluginKind(options.kind)) {
        echoError(`Invalid plugin kind: ${options.kind}`);
        throw new CommanderError(1, 'kk.plugin.invalid-kind', `invalid plugin kind: ${options.kind}`);
    }
    let timeoutMs: number | undefined;
    if (options.timeout !== undefined) {
        timeoutMs = Number(options.timeout);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new CommanderError(2, 'kk.plugin.invalid-timeout', `invalid --timeout: ${options.timeout}`);
        }
    }

    const discovery = discoverAllPlugins({ pluginsRoot: options.pluginsRoot, extraPaths: options.pluginsPath });
    const records =
        options.kind !== undefined ? discovery.plugins.filter((p) => p.kind === options.kind) : discovery.plugins;
    if (names.length > 0) {
        const known = new Set(records.map((r) => r.name));
        const unknown = names.filter((n) => !known.has(n));
        if (unknown.length > 0) {
            echoError(`unknown plugin: ${unknown.join(', ')}`);
            throw new CommanderError(2, 'kk.plugin.unknown-name', `unknown plugin: ${unknown.join(', ')}`);
        }
    }
    const selected = names.length > 0 ? records.filter((r) => names.includes(r.name)) : records;

    const rows: CheckRow[] = [];
    for (const record of selected) {
        rows.push(checkOne(record, options));
    }

    const failed = rows.some((r) => r.status === 'refused' || r.status === 'error');
    if (options.json) {
        consoleOutput.write(`${JSON.stringify({ ok: !failed, plugins: rows }, null, 2)}\n`);
    } else {
        for (const r of rows) {
            const detail = r.detail !== undefined ? ` — ${r.detail}` : '';
            const profileDir = r.profileDir !== undefined ? ` (${r.profileDir})` : '';
            consoleOutput.write(`  • ${r.name} [${r.kind}]: ${r.status}${detail}${profileDir}\n`);
        }
    }
    if (failed) {
        throw new CommanderError(1, 'kk.plugin.check-failed', 'plugin check found refused or errored plugins');
    }
}

/**
 * `plugin login` action — run the plugin's interactive login probe with
 * inherited stdio and exit with its code. Unknown plugin or missing `check`
 * is a usage error naming the missing field (ADR-032 R5).
 */
function loginAction(name: string, options: LoginOptions): void {
    assertExclusiveRoots(options.pluginsRoot, options.pluginsPath);
    const discovery = discoverAllPlugins({ pluginsRoot: options.pluginsRoot, extraPaths: options.pluginsPath });
    const record = discovery.plugins.find((p) => p.name === name);
    if (record === undefined) {
        echoError(`unknown plugin: ${name}`);
        throw new CommanderError(2, 'kk.plugin.login-usage', `unknown plugin: ${name}`);
    }
    if (record.check === undefined) {
        echoError(`plugin "${name}" declares no check entry (plugin.json: check)`);
        throw new CommanderError(
            2,
            'kk.plugin.login-usage',
            `plugin "${name}" declares no check entry (plugin.json: check)`,
        );
    }
    // Mirror checkOne: a manifest pointing at a deleted entry is an environment
    // error (exit 1), not an unhandled spawn throw.
    if (!existsSync(record.check)) {
        echoError(`probe entry missing: ${record.check}`);
        throw new CommanderError(1, 'kk.plugin.login-failed', `probe entry missing: ${record.check}`);
    }
    const code = spawnPluginLogin({
        entryPath: record.check,
        cwd: record.dir,
        subcommand: 'login',
        pluginKind: record.kind,
        pluginName: record.name,
    });
    if (code !== 0) {
        throw new CommanderError(code, 'kk.plugin.login-failed', `login probe exited with code ${code}`);
    }
}

/**
 * Register a `plugin status`-equivalent verb (`status`, or a deprecated alias
 * `list` / `doctor`) on a parent command. All verbs share the same options and
 * the same `statusAction` — no second implementation.
 */
function registerStatusVerb(parent: Command, name: string, description: string, hidden: boolean): void {
    parent
        .command(name, { hidden })
        .description(description)
        .option('--kind <kind>', 'Filter plugins by kind (ingestion, generator, publish)')
        .option('--json', 'Output machine-readable unified health report')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(statusAction);
}

/**
 * Register the `plugin` command group (status) and hidden one-release aliases
 * (ADR-011 R4). The deprecated `plugins` path is a hidden top-level delegation
 * command: a group `.alias('plugins')` would render `plugin|plugins` in
 * `kk --help` (Commander 15 shows group aliases), breaking the two-noun
 * surface. Hidden commands never render; every alias reaches the same action.
 */
export function registerPluginCommand(program: Command): void {
    const plugin = program.command('plugin').description('Inspect and validate knowledge-kit plugins');

    registerStatusVerb(
        plugin,
        'status',
        'List discovered plugins grouped by kind with a per-plugin health mark',
        false,
    );

    // Readiness probes (ADR-032): opt-in verbs that may launch browsers. status
    // stays side-effect-free; check/login own the spawn path.
    plugin
        .command('check [names...]')
        .description('Run each selected plugin’s readiness probe; exits nonzero on refused or errored plugins')
        .option('--kind <kind>', 'Filter plugins by kind (ingestion, generator, publish)')
        .option('--json', 'Output machine-readable verdict rows')
        .option('--headed', 'Run probes with a visible browser window')
        .option('--timeout <ms>', 'Per-plugin probe timeout in milliseconds')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(checkAction);
    plugin
        .command('login <name>')
        .description('Run the plugin’s interactive login probe with inherited stdio')
        .option('--plugins-root <dir>', 'Exclusive root containing plugins (isolation/tests only)')
        .option('--plugins-path <dir>', 'Extra plugin root to union with defaults (repeatable)', collectPath, [])
        .action(loginAction);
    // Hidden one-release aliases (ADR-011 R4): same engine, same JSON contract,
    // not listed in `kk --help` or `kk plugin --help`.
    registerStatusVerb(plugin, 'list', '[deprecated] Alias for `plugin status`', true);
    registerStatusVerb(plugin, 'doctor', '[deprecated] Alias for `plugin status`', true);

    // Hidden one-release top-level alias (ADR-011 R4): `kk plugins` and its
    // `status` / `list` / `doctor` subcommands reach the same status engine but
    // never render as visible first-layer commands.
    const plugins = program.command('plugins', { hidden: true }).description('[deprecated] Alias for `plugin status`');
    registerStatusVerb(plugins, 'status', '[deprecated] Alias for `plugin status`', true);
    registerStatusVerb(plugins, 'list', '[deprecated] Alias for `plugin status`', true);
    registerStatusVerb(plugins, 'doctor', '[deprecated] Alias for `plugin status`', true);
}
