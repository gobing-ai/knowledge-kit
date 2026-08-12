import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { KK_CAPABILITY_COLLECTION, kindForCollection, PLUGIN_COLLECTION_KINDS, type PluginKind } from './kinds';
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
    code: 'malformed' | 'duplicate_name' | 'unreadable' | 'misplaced' | 'kind_mismatch';
    path: string;
    reason: string;
}

/** Output of {@link discoverPlugins}. */
export interface DiscoveryResult {
    plugins: readonly PluginRecord[];
    diagnostics: readonly DiscoveryDiagnostic[];
}

/**
 * Discover plugins under a plugins root (ADR-009).
 *
 * - If `pluginsRoot` is a kind collection (`ingestions` / `generations` / `publishings`),
 *   scan its immediate children for `plugin.json`.
 * - Otherwise treat it as the `plugins/` root: scan each kind collection, skip `kk`,
 *   and emit `misplaced` for a kk-core `plugin.json` sitting at the top level.
 */
export function discoverPlugins(pluginsRoot: string): DiscoveryResult {
    const absRoot = resolve(pluginsRoot);
    const plugins: PluginRecord[] = [];
    const diagnostics: DiscoveryDiagnostic[] = [];
    const seenNames = new Set<string>();

    const entries = listSortedDir(absRoot);
    if (!entries.ok) {
        return { plugins: [], diagnostics: [entries.diagnostic] };
    }

    const rootAsCollection = kindForCollection(basename(absRoot));
    if (rootAsCollection) {
        scanCollection(absRoot, rootAsCollection, plugins, diagnostics, seenNames);
        return { plugins, diagnostics };
    }

    for (const entryName of entries.names) {
        const dirPath = join(absRoot, entryName);
        if (!isDirectory(dirPath)) {
            continue;
        }
        if (entryName === KK_CAPABILITY_COLLECTION) {
            continue;
        }
        const expectedKind = kindForCollection(entryName);
        if (expectedKind) {
            scanCollection(dirPath, expectedKind, plugins, diagnostics, seenNames);
            continue;
        }
        const strayManifest = join(dirPath, 'plugin.json');
        if (existsSync(strayManifest)) {
            diagnostics.push({
                code: 'misplaced',
                path: strayManifest,
                reason:
                    `Plugin must live under a kind collection ` +
                    `(${Object.keys(PLUGIN_COLLECTION_KINDS).join(', ')}), not at the plugins root`,
            });
        }
    }

    return { plugins, diagnostics };
}

function scanCollection(
    collectionDir: string,
    expectedKind: PluginKind,
    plugins: PluginRecord[],
    diagnostics: DiscoveryDiagnostic[],
    seenNames: Set<string>,
): void {
    const entries = listSortedDir(collectionDir);
    if (!entries.ok) {
        diagnostics.push(entries.diagnostic);
        return;
    }

    for (const entryName of entries.names) {
        const dirPath = join(collectionDir, entryName);
        if (!isDirectory(dirPath)) {
            continue;
        }
        consumeManifest(dirPath, expectedKind, plugins, diagnostics, seenNames);
    }
}

function consumeManifest(
    dirPath: string,
    expectedKind: PluginKind,
    plugins: PluginRecord[],
    diagnostics: DiscoveryDiagnostic[],
    seenNames: Set<string>,
): void {
    const manifestPath = join(dirPath, 'plugin.json');
    let content: string;
    try {
        content = readFileSync(manifestPath, 'utf-8');
    } catch {
        // Non-plugin directory without plugin.json -> silent skip
        return;
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
        return;
    }

    const parsed = PluginManifestSchema.safeParse(json);
    if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
        diagnostics.push({
            code: 'malformed',
            path: manifestPath,
            reason: issues,
        });
        return;
    }

    const manifest = parsed.data;
    if (manifest.kind !== expectedKind) {
        diagnostics.push({
            code: 'kind_mismatch',
            path: manifestPath,
            reason: `Plugin kind "${manifest.kind}" does not match collection kind "${expectedKind}"`,
        });
        return;
    }

    if (seenNames.has(manifest.name)) {
        diagnostics.push({
            code: 'duplicate_name',
            path: manifestPath,
            reason: `Plugin name "${manifest.name}" was already registered`,
        });
        return;
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

type ListedDir = { ok: true; names: string[] } | { ok: false; diagnostic: DiscoveryDiagnostic };

function listSortedDir(absDir: string): ListedDir {
    try {
        // Sort for deterministic results: readdir order is filesystem-dependent
        // (APFS is alphabetical, ext4 is hash-ordered), which would make
        // duplicate-name "first-wins" and list ordering platform-dependent.
        return { ok: true, names: readdirSync(absDir).sort() };
    } catch (err: unknown) {
        return {
            ok: false,
            diagnostic: {
                code: 'unreadable',
                path: absDir,
                reason: err instanceof Error ? err.message : String(err),
            },
        };
    }
}

function isDirectory(path: string): boolean {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

/** Filter discovered plugins by lifecycle kind. */
export function listByKind(result: DiscoveryResult, kind: PluginKind): PluginRecord[] {
    return result.plugins.filter((p) => p.kind === kind);
}

/** Find a discovered plugin by name. */
export function getByName(result: DiscoveryResult, name: string): PluginRecord | undefined {
    return result.plugins.find((p) => p.name === name);
}
