/**
 * Pure published-manifest rewrite. Repo workspaces keep `catalog:` (ADR-014)
 * and `workspace:*`; npm consumers cannot resolve either protocol.
 */

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

/** Scan roots used when the root manifest declares no `workspaces.packages`. */
const DEFAULT_WORKSPACE_PATTERNS = ['apps/*', 'packages/*'];

/**
 * Workspace globs from the root manifest. Deriving them keeps a private workspace outside
 * apps/–packages/ (the plugin kinds) from looking public: the publish scan missed
 * `@gobing-ai/music-gen` there and the 0.1.21 tarball build refused to publish.
 */
export function workspacePackagePatterns(rootPkg: Record<string, unknown>): string[] {
    const workspaces = rootPkg.workspaces;
    if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces)) {
        return DEFAULT_WORKSPACE_PATTERNS;
    }
    const packages = (workspaces as { packages?: unknown }).packages;
    return Array.isArray(packages) && packages.every((p) => typeof p === 'string' && p.length > 0)
        ? (packages as string[])
        : DEFAULT_WORKSPACE_PATTERNS;
}

/** Names of the `private: true` workspace packages a publish run may strip. */
export async function collectPrivateWorkspaceNames(
    repoRoot: string,
    rootPkg: Record<string, unknown>,
): Promise<Set<string>> {
    const names = new Set<string>();
    for (const pattern of workspacePackagePatterns(rootPkg)) {
        const glob = new Bun.Glob(`${pattern}/package.json`);
        for await (const entry of glob.scan({ cwd: repoRoot, absolute: true })) {
            const pkg = (await Bun.file(entry).json()) as Record<string, unknown>;
            if (typeof pkg.name === 'string' && pkg.private === true) names.add(pkg.name);
        }
    }
    return names;
}

export interface PreparePublishedManifestOptions {
    /** Root `workspaces.catalog` name → version range. */
    catalog: Record<string, string>;
    /** Workspace package names with `"private": true`. */
    privateWorkspaceNames: Set<string>;
}

export interface PreparePublishedManifestResult {
    changed: number;
    strippedWorkspace: number;
    rewrittenCatalog: number;
}

/**
 * Mutate `manifest` so every dependency specifier is valid on the public npm
 * registry. Returns counts of rewrites (does not clone).
 *
 * - `workspace:*` to a private package is stripped (bundled into dist/).
 * - `catalog:` is rewritten to the catalog range so `bun add` can resolve it.
 */
export function preparePublishedManifest(
    manifest: Record<string, unknown>,
    opts: PreparePublishedManifestOptions,
): PreparePublishedManifestResult {
    let strippedWorkspace = 0;
    let rewrittenCatalog = 0;

    for (const field of DEP_FIELDS) {
        const deps = manifest[field] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (range.startsWith('workspace:')) {
                if (opts.privateWorkspaceNames.has(name)) {
                    delete deps[name];
                    strippedWorkspace++;
                } else {
                    throw new Error(`cannot publish: non-private workspace dep "${name}" — resolve its version first`);
                }
                continue;
            }
            if (range.startsWith('catalog:')) {
                const version = opts.catalog[name];
                if (!version) {
                    throw new Error(
                        `cannot publish: catalog: dependency "${name}" is not in the root workspaces.catalog`,
                    );
                }
                deps[name] = version;
                rewrittenCatalog++;
            }
        }
    }

    return {
        changed: strippedWorkspace + rewrittenCatalog,
        strippedWorkspace,
        rewrittenCatalog,
    };
}

/** Read `workspaces.catalog` from the repo-root package.json object. */
export function catalogFromRootPackage(rootPkg: Record<string, unknown>): Record<string, string> {
    const workspaces = rootPkg.workspaces;
    if (!workspaces || typeof workspaces !== 'object' || Array.isArray(workspaces)) {
        return {};
    }
    const catalog = (workspaces as { catalog?: unknown }).catalog;
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(catalog as Record<string, unknown>)) {
        if (typeof range === 'string' && range.length > 0) {
            out[name] = range;
        }
    }
    return out;
}
