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
 *  - `node_modules/` (workspace symlinks into the checkout — 0110 I1 / 0111);
 *  - `.git/` (must not leak VCS metadata into the tarball);
 *  - OS junk (`.DS_Store`).
 */
export const EXCLUDE = /(^|\/)(\.DS_Store|\.spur|tests|evals|node_modules|\.git)($|\/)|\.test\.ts$/;

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
async function bundleStagedEntry(pluginDir: string, sourceDir: string): Promise<void> {
    const manifestPath = join(pluginDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        return;
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as { entry?: string; name?: string };
    if (manifest.entry === undefined) {
        throw new Error(`staged manifest has no entry: ${manifestPath}`);
    }
    // Resolve the entry from the source plugin so Bun.build can follow workspace
    // packages. The staged copy has no node_modules (0111) — bundling the staged
    // src would fail with "Bundle failed" / missing @gobing-ai/*.
    const entrySrc = join(sourceDir, manifest.entry.replace(/^\.\//, ''));
    if (!existsSync(entrySrc)) {
        throw new Error(`source entry missing: ${entrySrc}`);
    }
    // Bun ≥1.3 throws AggregateError on build failure instead of resolving with
    // success:false (verified empirically in 0111) — catch and format uniformly.
    try {
        await Bun.build({
            entrypoints: [entrySrc],
            outdir: join(pluginDir, 'dist'),
            target: 'bun',
            // Optional peer of `@gobing-ai/publish-harness` (E7 launchPersistentBrowser).
            // File-cli plugins import the harness barrel; Bun would otherwise try
            // to inline playwright-core (chromium-bidi / electron) and fail.
            external: ['playwright'],
        });
    } catch (error) {
        throw new Error(
            `bundling ${manifest.name ?? pluginDir} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    manifest.entry = './dist/index.js';
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
}

/** Bundle every staged product plugin entry (0110 I1). */
export async function bundleStagedEntries(pluginTarget: string, pluginSource: string = PLUGIN_SOURCE): Promise<number> {
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
            await bundleStagedEntry(pluginDir, join(pluginSource, collection, name));
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
 * @param pluginSource - source `plugins/` root (default repo-root `plugins/`; tests
 * inject a fixture tree so the staging flow runs in-process without `Bun.build`
 * touching the plugins' workspace symlinks)
 * @param marketplaceSource - source `.claude-plugin/` root (default repo root)
 */
export async function bundlePlugins(
    pluginTarget: string = PLUGIN_TARGET,
    marketplaceTarget: string = MARKETPLACE_TARGET,
    pluginSource: string = PLUGIN_SOURCE,
    marketplaceSource: string = MARKETPLACE_SOURCE,
): Promise<{ pluginTarget: string; marketplaceTarget: string }> {
    await rm(pluginTarget, { recursive: true, force: true });
    await rm(marketplaceTarget, { recursive: true, force: true });

    await cp(pluginSource, pluginTarget, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(pluginSource.length)),
    });
    await cp(marketplaceSource, marketplaceTarget, { recursive: true });

    const bundled = await bundleStagedEntries(pluginTarget, pluginSource);
    if (bundled === 0) {
        throw new Error(`no product plugins found under ${pluginTarget} — staging is broken`);
    }

    return { pluginTarget, marketplaceTarget };
}

if (import.meta.main) {
    // `bun scripts/bundle-plugins.ts [<plugin-target> <marketplace-target>]`:
    // with no args it restages `apps/cli/` (prepack). Overrides let tests stage
    // a scratch tree in a subprocess — bun test cannot run Bun.build in-process
    // for the plugins' workspace symlinks (0111).
    const [pluginTarget, marketplaceTarget] = process.argv.slice(2);
    try {
        await bundlePlugins(pluginTarget, marketplaceTarget);
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
