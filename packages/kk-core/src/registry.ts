import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KK_CAPABILITY_COLLECTION, kindForCollection, PLUGIN_COLLECTION_KINDS, type PluginKind } from './kinds';
import { PluginManifestSchema } from './manifest';

/** Where a discovered plugin was found (ADR-012 R3). */
export type PluginOrigin = 'builtin' | 'project' | 'user' | 'path';

/** Discovered plugin record. */
export interface PluginRecord {
    name: string;
    kind: PluginKind;
    entry: string;
    dir: string;
    manifestPath: string;
    origin: PluginOrigin;
    version?: string;
    description?: string;
}

/** Diagnostic emitted during discovery when a plugin fails checks or clashes. */
export interface DiscoveryDiagnostic {
    code: 'malformed' | 'duplicate_name' | 'unreadable' | 'misplaced' | 'kind_mismatch' | 'shadowed';
    path: string;
    reason: string;
}

/**
 * Options for {@link discoverAllPlugins} / {@link resolvePluginRoots}. Every
 * root is injectable so unit tests never touch a real `$HOME` (design §6).
 */
export interface DiscoverAllOptions {
    /** Working directory; the `./plugins` project root resolves against it. */
    cwd?: string;
    /** Environment snapshot; `KK_PLUGIN_PATH` (colon-separated) is read from it. */
    env?: { KK_PLUGIN_PATH?: string };
    /** Home directory; `~/.config/kk/plugins` resolves against it. Defaults to `os.homedir()`. */
    homeDir?: string;
    /** Package-shipped built-in tree (ADR-012 D2); injectable for tests. */
    packagePluginsRoot?: string;
    /** Additive extra roots (`--plugins-path`, repeatable). */
    extraPaths?: readonly string[];
    /** Exclusive single-root override (`--plugins-root`); disables the default roots. */
    pluginsRoot?: string;
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
 *
 * `origin` stamps every discovered record; the merged registry
 * ({@link discoverAllPlugins}) passes each root's origin. A bare single-root scan
 * defaults to `path`.
 */
export function discoverPlugins(pluginsRoot: string, origin: PluginOrigin = 'path'): DiscoveryResult {
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
        scanCollection(absRoot, rootAsCollection, origin, plugins, diagnostics, seenNames);
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
            scanCollection(dirPath, expectedKind, origin, plugins, diagnostics, seenNames);
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

/**
 * Resolve the ordered discovery roots (ADR-012 R3), low → high priority — a
 * later root shadows an earlier `name`:
 *
 * 1. package-shipped built-in tree (always, when resolvable)
 * 2. `~/.config/kk/plugins` (when present)
 * 3. CWD `./plugins` (when present and not the built-in tree's realpath)
 * 4. `KK_PLUGIN_PATH` entries, left → right
 * 5. `extraPaths` (`--plugins-path`), left → right
 *
 * `pluginsRoot` (`--plugins-root`) is an exclusive single-root override: it
 * disables the default roots entirely (isolation/tests only, ADR-012 R4).
 */
export function resolvePluginRoots(opts: DiscoverAllOptions = {}): readonly { origin: PluginOrigin; root: string }[] {
    if (opts.pluginsRoot !== undefined) {
        return [{ origin: 'path', root: opts.pluginsRoot }];
    }

    const roots: { origin: PluginOrigin; root: string }[] = [];

    const builtinRoot = resolveBuiltinRoot(opts.packagePluginsRoot);
    if (builtinRoot !== undefined) {
        roots.push({ origin: 'builtin', root: builtinRoot });
    }

    const userRoot = join(opts.homeDir ?? homedir(), '.config', 'kk', 'plugins');
    if (isDirectory(userRoot)) {
        roots.push({ origin: 'user', root: userRoot });
    }

    const projectRoot = join(opts.cwd ?? process.cwd(), 'plugins');
    if (isDirectory(projectRoot) && !(builtinRoot !== undefined && sameRealpath(projectRoot, builtinRoot))) {
        roots.push({ origin: 'project', root: projectRoot });
    }

    const env = opts.env ?? process.env;
    for (const entry of (env.KK_PLUGIN_PATH ?? '').split(':').filter((e) => e !== '')) {
        if (isDirectory(entry)) {
            roots.push({ origin: 'path', root: entry });
        }
    }
    for (const extra of opts.extraPaths ?? []) {
        if (extra !== '' && isDirectory(extra)) {
            roots.push({ origin: 'path', root: extra });
        }
    }

    return roots;
}

/**
 * Discover plugins across the merged multi-root registry (ADR-012).
 *
 * Each resolved root is scanned with {@link discoverPlugins}, so ADR-009
 * per-root layout and diagnostics apply unchanged. Roots that share the same
 * realpath are scanned once (R9 — no spurious `duplicate_name`/`shadowed`
 * noise). A same-name plugin on a later/higher-priority root shadows the
 * earlier one and emits a `shadowed` diagnostic naming both manifests (R5).
 */
export function discoverAllPlugins(opts: DiscoverAllOptions = {}): DiscoveryResult {
    const roots = resolvePluginRoots(opts);
    const diagnostics: DiscoveryDiagnostic[] = [];
    const byName = new Map<string, PluginRecord>();
    const scannedRealpaths = new Set<string>();

    for (const { origin, root } of roots) {
        let real: string;
        try {
            real = realpathSync(root);
        } catch {
            continue;
        }
        if (scannedRealpaths.has(real)) {
            continue;
        }
        scannedRealpaths.add(real);

        // A path root (`--plugins-path` / `KK_PLUGIN_PATH`) may be a single
        // plugin directory whose folder itself contains `plugin.json`; its kind
        // comes from the manifest, with no collection-folder constraint
        // (ADR-012 R6 amendment). Trees/collections go through the per-root
        // scanner with ADR-009 layout checks.
        if (origin === 'path' && existsSync(join(root, 'plugin.json'))) {
            const records: PluginRecord[] = [];
            const rootDiagnostics: DiscoveryDiagnostic[] = [];
            consumeManifest(root, null, origin, records, rootDiagnostics, new Set<string>());
            diagnostics.push(...rootDiagnostics);
            for (const record of records) {
                mergeByName(record, byName, diagnostics);
            }
            continue;
        }

        const scan = discoverPlugins(root, origin);
        diagnostics.push(...scan.diagnostics);
        for (const record of scan.plugins) {
            mergeByName(record, byName, diagnostics);
        }
    }

    return { plugins: [...byName.values()], diagnostics };
}

/** Register a plugin by name; a same-name plugin shadows the earlier one (R5). */
function mergeByName(
    record: PluginRecord,
    byName: Map<string, PluginRecord>,
    diagnostics: DiscoveryDiagnostic[],
): void {
    const existing = byName.get(record.name);
    if (existing !== undefined) {
        diagnostics.push({
            code: 'shadowed',
            path: existing.manifestPath,
            reason: `Plugin name "${record.name}" shadowed by ` + `${record.manifestPath} (origin: ${record.origin})`,
        });
    }
    byName.set(record.name, record);
}

/**
 * Resolve the package-shipped built-in tree (ADR-012 D2): the `plugins/`
 * directory next to the running `kk` package. A bundled CLI lives at
 * `<pkg>/dist/index.js` → `<pkg>/plugins`; monorepo sources resolve up to the
 * repo-root `plugins/` tree. Found by walking up from the executing module;
 * injectable via {@link DiscoverAllOptions.packagePluginsRoot} for tests.
 */
function resolveBuiltinRoot(injected: string | undefined): string | undefined {
    if (injected !== undefined) {
        return injected;
    }
    let dir = dirname(fileURLToPath(import.meta.url));
    for (;;) {
        const candidate = join(dir, 'plugins');
        if (isPluginsTree(candidate)) {
            return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** True when `dir` is a directory containing at least one kind collection (a plugins tree, ADR-009). */
function isPluginsTree(dir: string): boolean {
    if (!isDirectory(dir)) {
        return false;
    }
    for (const collection of Object.keys(PLUGIN_COLLECTION_KINDS)) {
        if (isDirectory(join(dir, collection))) {
            return true;
        }
    }
    return false;
}

/** True when both paths exist and resolve to the same realpath. */
function sameRealpath(a: string, b: string): boolean {
    try {
        return realpathSync(a) === realpathSync(b);
    } catch {
        return false;
    }
}

function scanCollection(
    collectionDir: string,
    expectedKind: PluginKind,
    origin: PluginOrigin,
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
        consumeManifest(dirPath, expectedKind, origin, plugins, diagnostics, seenNames);
    }
}

function consumeManifest(
    dirPath: string,
    expectedKind: PluginKind | null,
    origin: PluginOrigin,
    plugins: PluginRecord[],
    diagnostics: DiscoveryDiagnostic[],
    seenNames: Set<string>,
): void {
    const manifestPath = join(dirPath, 'plugin.json');
    let content: string;
    try {
        content = readFileSync(manifestPath, 'utf-8');
    } catch (err: unknown) {
        // No manifest -> not a plugin directory; silent skip (ADR-009).
        // A manifest that exists but cannot be read -> skip-and-report (P3-2):
        // a vanished plugin must not be indistinguishable from an absent one.
        if ((err as { code?: string } | null)?.code === 'ENOENT') {
            return;
        }
        diagnostics.push({
            code: 'unreadable',
            path: manifestPath,
            reason: err instanceof Error ? err.message : String(err),
        });
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
    // `expectedKind === null` is the single-plugin-directory case (ADR-012 R6):
    // the kind comes from the manifest, no collection-folder constraint.
    if (expectedKind !== null && manifest.kind !== expectedKind) {
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
        origin,
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
