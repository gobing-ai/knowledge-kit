import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { discoverAllPlugins, getByName, kindContract } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';

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
}

/** Outcome of spawning a plugin entry (exit code + captured streams). */
export interface PluginEntrySpawnResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

/**
 * Spawn a plugin entry with the `--in` / `--out` contract (ADR-006).
 *
 * This is the **only** sanctioned direct process spawn in the CLI surface
 * (`no-direct-process-spawn` allowlists `invoke.ts`). Callers such as
 * `fanout` must go through this helper rather than calling `Bun.spawnSync`
 * themselves.
 */
export function spawnPluginEntry(opts: PluginEntrySpawnOptions): PluginEntrySpawnResult {
    const cmd: string[] =
        opts.entryPath.endsWith('.ts') || opts.entryPath.endsWith('.js')
            ? [process.execPath, opts.entryPath, '--in', opts.inPath, '--out', opts.outPath]
            : [opts.entryPath, '--in', opts.inPath, '--out', opts.outPath];

    const proc = Bun.spawnSync(cmd, {
        cwd: opts.cwd,
        env: process.env,
        stdout: 'pipe',
        stderr: 'pipe',
    });

    return {
        exitCode: proc.exitCode === null ? 1 : proc.exitCode,
        stdout: proc.stdout.toString().trim(),
        stderr: proc.stderr.toString().trim(),
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
        logger.error(`Plugin '${opts.plugin}' not found in the merged plugin registry`);
        if (discovery.diagnostics.length > 0) {
            for (const diag of discovery.diagnostics) {
                logger.error(`  [diagnostic] ${diag.code} at ${diag.path}: ${diag.reason}`);
            }
        }
        return 1;
    }

    const contract = kindContract(record.kind);
    const absInPath = resolve(opts.inPath);
    const absOutPath = resolve(opts.outPath);

    if (contract.input !== null) {
        if (!existsSync(absInPath)) {
            logger.error(`Input file does not exist: ${absInPath}`);
            return 1;
        }
        let inContent: string;
        try {
            inContent = readFileSync(absInPath, 'utf-8');
        } catch (err: unknown) {
            logger.error(`Failed to read input file ${absInPath}: ${err instanceof Error ? err.message : String(err)}`);
            return 1;
        }

        let json: unknown;
        try {
            json = JSON.parse(inContent);
        } catch (err: unknown) {
            logger.error(
                `Input file ${absInPath} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            );
            return 1;
        }

        const parseResult = contract.input.safeParse(json);
        if (!parseResult.success) {
            const issues = parseResult.error.issues
                .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
                .join('; ');
            logger.error(`Input schema violation for kind '${record.kind}': ${issues}`);
            return 1;
        }
    } else {
        if (!existsSync(absInPath)) {
            logger.error(`Source path does not exist: ${absInPath}`);
            return 1;
        }
    }

    const entryPath = isAbsolute(record.entry) ? record.entry : resolve(record.dir, record.entry);
    if (!existsSync(entryPath)) {
        logger.error(`Plugin entry script does not exist: ${entryPath}`);
        return 1;
    }

    const proc = spawnPluginEntry({
        entryPath,
        cwd: record.dir,
        inPath: absInPath,
        outPath: absOutPath,
    });

    if (proc.exitCode !== 0) {
        const errMsg = proc.stderr || proc.stdout || `Plugin entry exited with code ${proc.exitCode}`;
        logger.error(`Plugin entry '${record.name}' failed (exit code ${proc.exitCode}): ${errMsg}`);
        const exitCode = proc.exitCode !== 0 ? proc.exitCode : 1;
        return exitCode;
    }

    if (!existsSync(absOutPath)) {
        logger.error(`Plugin entry succeeded but did not write output file: ${absOutPath}`);
        return 1;
    }

    let outContent: string;
    try {
        outContent = readFileSync(absOutPath, 'utf-8');
    } catch (err: unknown) {
        logger.error(`Failed to read output file ${absOutPath}: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    let outJson: unknown;
    try {
        outJson = JSON.parse(outContent);
    } catch (err: unknown) {
        logger.error(`Output file ${absOutPath} is invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }

    const outResult = contract.output.safeParse(outJson);
    if (!outResult.success) {
        const issues = outResult.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        logger.error(`Output schema violation for kind '${record.kind}': ${issues}`);
        return 1;
    }

    return 0;
}
