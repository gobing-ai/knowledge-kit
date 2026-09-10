/**
 * Stage the marketplace/plugin content into the CLI package tree for the npm
 * tarball. The published `@gobing-ai/knowledge-kit` package (from `apps/cli/`)
 * must ship `plugins/` and `.claude-plugin/` at the package root so an end user
 * can run `superskill install kk --marketplace <package-root>` without cloning
 * this monorepo.
 *
 * npm cannot pack these via bare `files` entries because both trees live at the
 * monorepo root while the package is `apps/cli/` (silent empty pack). So staging
 * is a build-time copy with a prune filter for non-distribution content. The
 * copied destinations are gitignored build artifacts — never hand-edit
 * `apps/cli/{plugins,.claude-plugin}`.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../', import.meta.url).pathname;
const PLUGIN_SOURCE = join(REPO_ROOT, 'plugins');
const PLUGIN_TARGET = join(REPO_ROOT, 'apps/cli/plugins');
const MARKETPLACE_SOURCE = join(REPO_ROOT, '.claude-plugin');
const MARKETPLACE_TARGET = join(REPO_ROOT, 'apps/cli/.claude-plugin');

/**
 * Prune anything that is not distribution content. `cp`'s filter runs per
 * entry: returning false prunes the entry (and, for a directory, its subtree).
 *
 * Excluded from the staged copy only:
 *  - `tests/` directories and any `*.test.ts` file anywhere in the tree (the
 *    kind-collection plugins keep their tests in `tests/` dirs; they must not
 *    ship in the tarball);
 *  - `evals/` (monorepo-only);
 *  - OS junk (`.DS_Store`).
 */
export const EXCLUDE = /(^|\/)(\.DS_Store|\.spur|tests|evals)($|\/)|\.test\.ts$/;

/** Kind collections that hold product plugin directories (ADR-009). */
const KIND_COLLECTIONS = ['ingestions', 'generations', 'publishings'] as const;

/**
 * Bundle one staged plugin entry into `<plugin>/dist/index.js` and point the
 * staged manifest at it (0110 I1). Raw shipped entries import `@gobing-ai/*`
 * workspace packages that the published tarball strips (publish-manifest), so
 * an installed plugin entry cannot resolve them outside the repository. The
 * bundle inlines that closure at build time; assets and the directory layout
 * are untouched, and source manifests keep pointing at `./src/index.ts`.
 */
async function bundleStagedEntry(pluginDir: string): Promise<void> {
    const manifestPath = join(pluginDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        return;
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as { entry?: string; name?: string };
    if (manifest.entry === undefined) {
        throw new Error(`staged manifest has no entry: ${manifestPath}`);
    }
    const entrySrc = join(pluginDir, manifest.entry.replace(/^\.\//, ''));
    if (!existsSync(entrySrc)) {
        throw new Error(`staged entry missing: ${entrySrc}`);
    }
    const result = await Bun.build({
        entrypoints: [entrySrc],
        outdir: join(pluginDir, 'dist'),
        target: 'bun',
    });
    if (!result.success) {
        const logs = result.logs.map((l) => String(l)).join('; ');
        throw new Error(`bundling ${manifest.name ?? pluginDir} failed: ${logs}`);
    }
    manifest.entry = './dist/index.js';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
}

/** Bundle every staged product plugin entry (0110 I1). */
export async function bundleStagedEntries(pluginTarget: string): Promise<number> {
    let count = 0;
    for (const collection of KIND_COLLECTIONS) {
        const collectionDir = join(pluginTarget, collection);
        if (!existsSync(collectionDir)) {
            continue;
        }
        for (const name of (await readdir(collectionDir)).sort()) {
            const pluginDir = join(collectionDir, name);
            if (!existsSync(join(pluginDir, 'plugin.json'))) {
                continue;
            }
            await mkdir(pluginDir, { recursive: true });
            await bundleStagedEntry(pluginDir);
            count += 1;
        }
    }
    return count;
}

/**
 * Copy the repo-root `plugins/` and `.claude-plugin/` trees into `apps/cli/`,
 * pruning non-distribution content, then bundle every staged product entry so
 * the installed package can execute plugins without repository node_modules
 * (0110 I1).
 *
 * @param pluginTarget  - destination for `plugins/` (default `apps/cli/plugins`)
 * @param marketplaceTarget - destination for `.claude-plugin/` (default `apps/cli/.claude-plugin`)
 */
export async function bundlePlugins(
    pluginTarget: string = PLUGIN_TARGET,
    marketplaceTarget: string = MARKETPLACE_TARGET,
): Promise<{ pluginTarget: string; marketplaceTarget: string }> {
    await rm(pluginTarget, { recursive: true, force: true });
    await rm(marketplaceTarget, { recursive: true, force: true });

    await cp(PLUGIN_SOURCE, pluginTarget, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(PLUGIN_SOURCE.length)),
    });
    await cp(MARKETPLACE_SOURCE, marketplaceTarget, { recursive: true });

    const bundled = await bundleStagedEntries(pluginTarget);
    if (bundled === 0) {
        throw new Error(`no product plugins found under ${pluginTarget} — staging is broken`);
    }

    return { pluginTarget, marketplaceTarget };
}

bundlePlugins().catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
