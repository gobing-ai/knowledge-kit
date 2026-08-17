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
    echoError(`Found ${all.length} diagnostic issue(s):\n`);
    for (const d of all) {
        echoError(`  [${d.code}] ${d.path}: ${d.reason}\n`);
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
        echoError('--plugins-root and --plugins-path are mutually exclusive (ADR-012 R6)\n');
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
            echoError(`Invalid plugin kind: ${options.kind}\n`);
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
            consoleOutput.write(`  • ${p.name}${ver}: ${p.entry}${desc} [${health}]\n`);
        }
    }

    if (!report.healthy) {
        printDiagnostics(report);
        throw new CommanderError(1, 'kk.plugin.unhealthy', 'plugin diagnostics found');
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
    // Hidden one-release aliases (ADR-011 R4): same engine, same JSON contract,
    // not listed in `kk --help` or `kk plugin --help`.
    registerStatusVerb(plugin, 'list', 'Alias for `plugin status` (deprecated)', true);
    registerStatusVerb(plugin, 'doctor', 'Alias for `plugin status` (deprecated)', true);

    // Hidden one-release top-level alias (ADR-011 R4): `kk plugins` and its
    // `status` / `list` / `doctor` subcommands reach the same status engine but
    // never render as visible first-layer commands.
    const plugins = program.command('plugins', { hidden: true }).description('Alias for `plugin status` (deprecated)');
    registerStatusVerb(plugins, 'status', 'Alias for `plugin status` (deprecated)', true);
    registerStatusVerb(plugins, 'list', 'Alias for `plugin status` (deprecated)', true);
    registerStatusVerb(plugins, 'doctor', 'Alias for `plugin status` (deprecated)', true);
}
