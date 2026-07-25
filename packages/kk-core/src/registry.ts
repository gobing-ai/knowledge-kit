import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PluginKind } from './kinds';
import { PluginManifestSchema } from './manifest';

/** Discovered plugin record. */
export interface PluginRecord {
    name: string;
    kind: PluginKind;
    entry: string;
    dir: string;
    manifestPath: string;
    version?: string;
    description?: string;
}

/** Diagnostic emitted during discovery when a plugin fails checks or clashes. */
export interface DiscoveryDiagnostic {
    code: 'malformed' | 'duplicate_name' | 'unreadable';
    path: string;
    reason: string;
}

/** Output of {@link discoverPlugins}. */
export interface DiscoveryResult {
    plugins: readonly PluginRecord[];
    diagnostics: readonly DiscoveryDiagnostic[];
}

/**
 * Discover plugins under a plugins root directory (scans one level: plugins subdirectories).
 */
export function discoverPlugins(pluginsRoot: string): DiscoveryResult {
    const absRoot = resolve(pluginsRoot);
    const plugins: PluginRecord[] = [];
    const diagnostics: DiscoveryDiagnostic[] = [];
    const seenNames = new Set<string>();

    let entries: string[];
    try {
        entries = readdirSync(absRoot);
    } catch (err: unknown) {
        return {
            plugins: [],
            diagnostics: [
                {
                    code: 'unreadable',
                    path: absRoot,
                    reason: err instanceof Error ? err.message : String(err),
                },
            ],
        };
    }

    for (const entryName of entries) {
        const dirPath = join(absRoot, entryName);
        try {
            const stat = statSync(dirPath);
            if (!stat.isDirectory()) {
                continue;
            }
        } catch {
            continue;
        }

        const manifestPath = join(dirPath, 'plugin.json');
        let content: string;
        try {
            content = readFileSync(manifestPath, 'utf-8');
        } catch {
            // Non-plugin directory without plugin.json -> silent skip
            continue;
        }

        let json: unknown;
        try {
            json = JSON.parse(content);
        } catch (err: unknown) {
            diagnostics.push({
                code: 'malformed',
                path: manifestPath,
                reason: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            });
            continue;
        }

        const parsed = PluginManifestSchema.safeParse(json);
        if (!parsed.success) {
            const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
            diagnostics.push({
                code: 'malformed',
                path: manifestPath,
                reason: issues,
            });
            continue;
        }

        const manifest = parsed.data;
        if (seenNames.has(manifest.name)) {
            diagnostics.push({
                code: 'duplicate_name',
                path: manifestPath,
                reason: `Plugin name "${manifest.name}" was already registered`,
            });
            continue;
        }

        seenNames.add(manifest.name);
        plugins.push({
            name: manifest.name,
            kind: manifest.kind,
            entry: manifest.entry,
            dir: dirPath,
            manifestPath,
            version: manifest.version,
            description: manifest.description,
        });
    }

    return { plugins, diagnostics };
}

/** Filter discovered plugins by lifecycle kind. */
export function listByKind(result: DiscoveryResult, kind: PluginKind): PluginRecord[] {
    return result.plugins.filter((p) => p.kind === kind);
}

/** Find a discovered plugin by name. */
export function getByName(result: DiscoveryResult, name: string): PluginRecord | undefined {
    return result.plugins.find((p) => p.name === name);
}
