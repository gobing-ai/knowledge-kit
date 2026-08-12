import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { discoverPlugins, isPluginKind, listByKind, type PluginKind } from '@gobing-ai/kk-core';
import { add, logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { runFanin } from './fanin';
import { runFanout } from './fanout';
import { runInvoke } from './invoke';

/** Create a Commander CLI program with add and invoke subcommands. */
export function createProgram(): Command {
    const program = new Command().name('knowledge-kit').description('knowledge-kit CLI').version('0.0.0');

    const parseIntArg = (v: string): number => Number.parseInt(v, 10);

    program
        .command('add')
        .description('Add two numbers')
        .argument('<a>', 'first number', parseIntArg)
        .argument('<b>', 'second number', parseIntArg)
        .action((a, b) => {
            logger.out(`${add(a, b)}\n`);
        });

    program
        .command('invoke')
        .description('Invoke a plugin with input/output files and contract validation')
        .argument('<plugin>', 'Name of the plugin to invoke')
        .requiredOption('--in <path>', 'Input file path (or source path for ingestion)')
        .requiredOption('--out <path>', 'Output file path')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action(async (plugin, options) => {
            // Propagate non-zero so the binary fails loud (R4); runInvoke alone only returns a code.
            const code = await runInvoke({
                plugin,
                inPath: options.in,
                outPath: options.out,
                pluginsRoot: options.pluginsRoot,
            });
            if (code !== 0) {
                process.exit(code);
            }
        });

    // Collect repeated `--in` values into an array (commander last-wins otherwise).
    const collectIn = (value: string, acc: string[]): string[] => {
        acc.push(value);
        return acc;
    };

    program
        .command('fanin')
        .description('Merge N Doc[] JSON inputs into one deduplicated Doc[] output')
        .requiredOption('--in <path>', 'Input Doc[] JSON file (repeatable)', collectIn, [])
        .requiredOption('--out <path>', 'Output merged Doc[] JSON file path')
        .action(async (options) => {
            // Rebuild the flag slice so runFanin owns the CLI contract.
            const argv: string[] = [];
            for (const inPath of options.in) {
                argv.push('--in', inPath);
            }
            argv.push('--out', options.out);

            // Propagate non-zero so the binary fails loud (R4); runFanin alone only returns a code.
            const code = await runFanin(argv);
            if (code !== 0) {
                process.exit(code);
            }
        });

    // Collect repeated `--target` values into an array (commander last-wins otherwise).
    const collectTarget = (value: string, acc: string[]): string[] => {
        acc.push(value);
        return acc;
    };

    program
        .command('fanout')
        .description('Publish one Content JSON to N targets, aggregating per-target results')
        .requiredOption('--content <path>', 'Source ContentSchema JSON file path')
        .option('--target <plugin>', 'Target publish plugin name (repeatable)', collectTarget, [])
        .requiredOption('--out <path>', 'Aggregate Result JSON file path')
        .option('--retry-from <path>', 'Prior Result JSON file to retry only previously failed targets')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action(async (options) => {
            // Rebuild the flag slice so runFanout owns the CLI contract.
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

            // Propagate non-zero so the binary fails loud (spec §4); runFanout alone only returns a code.
            const code = await runFanout(argv);
            if (code !== 0) {
                process.exit(code);
            }
        });

    const pluginsCmd = program.command('plugins').description('Manage and inspect knowledge-kit plugins');

    pluginsCmd
        .command('list')
        .description('List discovered plugins grouped by kind')
        .option('--kind <kind>', 'Filter plugins by kind (ingestion, generator, publish)')
        .option('--json', 'Output machine-readable JSON array')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action((options) => {
            const root = options.pluginsRoot ?? './plugins';
            const discovery = discoverPlugins(root);

            let records = discovery.plugins;
            if (options.kind) {
                if (!isPluginKind(options.kind)) {
                    logger.error(`Invalid plugin kind: ${options.kind}\n`);
                    process.exit(1);
                }
                records = listByKind(discovery, options.kind as PluginKind);
            }

            if (options.json) {
                logger.out(`${JSON.stringify(records, null, 2)}\n`);
                return;
            }

            if (records.length === 0) {
                logger.out('No plugins found.\n');
                return;
            }

            const kinds: PluginKind[] = options.kind
                ? [options.kind as PluginKind]
                : ['ingestion', 'generator', 'publish'];

            for (const k of kinds) {
                const group = records.filter((p) => p.kind === k);
                if (group.length === 0) continue;

                logger.out(`\n--- ${k.toUpperCase()} PLUGINS ---\n`);
                for (const p of group) {
                    const ver = p.version ? ` (v${p.version})` : '';
                    const desc = p.description ? ` - ${p.description}` : '';
                    logger.out(`  • ${p.name}${ver}: ${p.entry}${desc}\n`);
                }
            }
        });

    pluginsCmd
        .command('doctor')
        .description('Validate plugin manifests and entries under plugins root')
        .option('--json', 'Output machine-readable JSON object')
        .option('--plugins-root <dir>', 'Root directory containing plugins')
        .action((options) => {
            const root = options.pluginsRoot ?? './plugins';
            const discovery = discoverPlugins(root);
            const diagnostics: Array<{ code: string; path: string; reason: string }> = [...discovery.diagnostics];

            for (const p of discovery.plugins) {
                const entryPath = resolve(p.dir, p.entry);
                if (!existsSync(entryPath)) {
                    diagnostics.push({
                        code: 'missing_entry',
                        path: entryPath,
                        reason: `Plugin "${p.name}" entry file does not exist: ${p.entry}`,
                    });
                }
            }

            const healthy = diagnostics.length === 0;

            if (options.json) {
                logger.out(`${JSON.stringify({ healthy, diagnostics }, null, 2)}\n`);
                if (!healthy) {
                    process.exit(1);
                }
                return;
            }

            if (healthy) {
                logger.out('All plugin manifests and entries are healthy.\n');
                return;
            }

            logger.error(`Found ${diagnostics.length} diagnostic issue(s):\n`);
            for (const d of diagnostics) {
                logger.error(`  [${d.code}] ${d.path}: ${d.reason}\n`);
            }
            process.exit(1);
        });

    return program;
}
