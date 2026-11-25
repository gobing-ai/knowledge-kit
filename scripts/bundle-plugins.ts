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

import { existsSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { treeDiffs } from './check-tool-freshness';

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
 *  - `.venv/` (a plugin's local Python env — machine-specific, never distribution content);
 *  - OS junk (`.DS_Store`).
 */
export const EXCLUDE = /(^|\/)(\.DS_Store|\.spur|\.venv|tests|evals|node_modules|\.git)($|\/)|\.test\.ts$/;

/** Kind collections that hold product plugin directories (ADR-009). */
const KIND_COLLECTIONS = ['ingestions', 'generations', 'publishings'] as const;

/**
 * Declared paths Bun can bundle; anything else (shell, python) ships as a copied asset.
 * Every TypeScript/JavaScript module extension the runtime can load is listed -- `.mts`/`.cts`
 * included -- and the match is case-insensitive, so a `./src/check.mts` or `./src/check.MJS`
 * declaration is bundled instead of silently shipping a raw source that dies on
 * `Cannot find module` for `@gobing-ai/*` outside the checkout (0249 R1, review P3-2).
 */
export const BUNDLEABLE = /\.(mts|cts|tsx|ts|mjs|cjs|jsx|js)$/i;

/**
 * Render a Bun.build failure into an actionable one-line reason.
 *
 * Bun >=1.3 throws an `AggregateError` on build failure (verified empirically in 0111) whose own
 * `message` is only the bare "Bundle failed"; the cause — an unresolvable `@gobing-ai/*` (a checkout
 * that was never `bun install`ed), a syntax error, a missing file — lives in `errors[]`. Reporting
 * only `message` is what made a stale `node_modules` look like a broken plugin.
 */
export function describeBuildFailure(error: unknown): string {
    const parts: string[] =
        error instanceof AggregateError
            ? error.errors.map((inner) => {
                  const text = inner instanceof Error ? inner.message : String(inner);
                  const position = (inner as { position?: { file?: string; line?: number } }).position;
                  if (position?.file === undefined) return text;
                  return `${text} (${position.file}${position.line === undefined ? '' : `:${position.line}`})`;
              })
            : [];
    if (parts.length === 0) {
        return error instanceof Error ? error.message : String(error);
    }
    // Deduplicate: one unresolvable package reports the same reason per importing module.
    return [...new Set(parts)].join('; ');
}

/**
 * Bundle one declared manifest path — entry or check — from the source plugin into
 * `<plugin>/dist`, and return the path the staged manifest must declare. Raw
 * shipped sources import `@gobing-ai/*` workspace packages that the published
 * tarball strips (publish-manifest), so an installed plugin cannot resolve them
 * outside the repository; the bundle inlines that closure at build time (0110 I1
 * entry, 0249 R1 check). Non-JS declared paths are copied assets and are never fed
 * to Bun.build. A missing source or a failed build fails staging with plugin and
 * path context — shipping a probe that cannot run is the defect 0249 closes.
 */
async function bundleDeclared(
    pluginDir: string,
    sourceDir: string,
    pluginName: string,
    kind: 'entry' | 'check',
    declared: string,
): Promise<string> {
    // A declared probe gets its own artifact, distinct from the entry's index.js.
    const output =
        kind === 'check'
            ? { naming: 'profile-check.js', staged: './dist/profile-check.js' }
            : { staged: './dist/index.js' };
    // Resolve from the source plugin so Bun.build can follow workspace packages.
    // The staged copy has no node_modules (0111) — bundling the staged src would
    // fail with "Bundle failed" / missing @gobing-ai/*.
    const source = join(sourceDir, declared.replace(/^\.\//, ''));
    if (!existsSync(source)) {
        throw new Error(`bundling ${pluginName} failed: source ${kind} missing: ${source}`);
    }
    if (!BUNDLEABLE.test(declared)) {
        // Source existence is not enough: the staged copy is what ships, and a declared path
        // under an EXCLUDE-pruned directory (tests/, evals/, .venv/, ...) is never copied --
        // the manifest would point at a dangling probe that only fails at install time
        // (`probe entry missing`), the exact defect class 0249 closes (review P3-1).
        const staged = join(pluginDir, declared.replace(/^\.\//, ''));
        if (!existsSync(staged)) {
            throw new Error(
                `bundling ${pluginName} failed: ${kind} ${declared} was not staged at ${staged} -- the declared path did not survive the copied tree`,
            );
        }
        return declared;
    }
    // Bun >=1.3 throws AggregateError on build failure instead of resolving with
    // success:false (verified empirically in 0111) — catch and format uniformly.
    try {
        await Bun.build({
            entrypoints: [source],
            outdir: join(pluginDir, 'dist'),
            target: 'bun',
            // Optional peer of `@gobing-ai/ts-browser-automation` (0177 XHS launcher) and the
            // publish-harness barrel. Bun would otherwise try to inline playwright-core
            // (chromium-bidi / electron) and fail.
            external: ['playwright'],
            ...(output.naming === undefined ? {} : { naming: output.naming }),
        });
    } catch (error) {
        throw new Error(`bundling ${pluginName} failed: ${kind} ${declared}: ${describeBuildFailure(error)}`);
    }
    return output.staged;
}

/** Bundle a staged plugin's declared entry and check; rewrite only the staged manifest. */
async function bundleStagedEntry(pluginDir: string, sourceDir: string): Promise<void> {
    const manifestPath = join(pluginDir, 'plugin.json');
    if (!existsSync(manifestPath)) {
        return;
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf-8')) as {
        entry?: string;
        check?: string;
        name?: string;
    };
    if (manifest.entry === undefined) {
        throw new Error(`staged manifest has no entry: ${manifestPath}`);
    }
    const pluginName = manifest.name ?? pluginDir;
    manifest.entry = await bundleDeclared(pluginDir, sourceDir, pluginName, 'entry', manifest.entry);
    // A plugin that declares no check keeps its manifest contract untouched.
    if (manifest.check !== undefined) {
        manifest.check = await bundleDeclared(pluginDir, sourceDir, pluginName, 'check', manifest.check);
    }
    // Only the staged copy is rewritten; source manifests keep their source paths.
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
}

/** Bundle every staged product plugin entry and declared check (0110 I1, 0249 R1). */
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

/** Subtrees the launch preflight compares between checkout and staged `apps/cli/plugins` (0430 R2). */
const STALE_CHECK_TREES = ['kk/workflows', 'kk/scripts'] as const;

/**
 * True when `pluginTarget` (default `apps/cli/plugins`) is absent, its `kk/{workflows,scripts}`
 * trees diverge in bytes from `pluginSource`, or a product manifest was added, removed or updated.
 */
export function isStagedPluginsStale(
    pluginTarget: string = PLUGIN_TARGET,
    pluginSource: string = PLUGIN_SOURCE,
): boolean {
    if (!existsSync(pluginTarget)) return true;
    for (const subtree of STALE_CHECK_TREES) {
        if (treeDiffs(join(pluginSource, subtree), join(pluginTarget, subtree)).length > 0) return true;
    }
    for (const collection of KIND_COLLECTIONS) {
        const srcCol = join(pluginSource, collection);
        const dstCol = join(pluginTarget, collection);
        const names = new Set([
            ...(existsSync(srcCol) ? readdirSync(srcCol) : []),
            ...(existsSync(dstCol) ? readdirSync(dstCol) : []),
        ]);
        for (const name of names) {
            const srcManifest = join(srcCol, name, 'plugin.json');
            const dstManifest = join(dstCol, name, 'plugin.json');
            const sourceExists = existsSync(srcManifest);
            if (sourceExists !== existsSync(dstManifest)) return true;
            if (sourceExists && statSync(srcManifest).mtimeMs > statSync(dstManifest).mtimeMs) return true;
        }
    }
    return false;
}

if (import.meta.main) {
    // `bun scripts/bundle-plugins.ts [--if-stale] [<plugin-target> <marketplace-target>]`:
    // with no args it restages `apps/cli/` (prepack). `--if-stale` skips rebuilding when
    // `apps/cli/plugins/` is already in sync with `plugins/kk/{scripts,workflows}` and product
    // manifests (0430 R2). Overrides let tests stage a scratch tree in a subprocess — bun test
    // cannot run Bun.build in-process for the plugins' workspace symlinks (0111).
    const args = process.argv.slice(2);
    const ifStale = args.includes('--if-stale');
    const positional = args.filter((arg) => arg !== '--if-stale');
    const [pluginTarget, marketplaceTarget] = positional;
    try {
        if (ifStale && !isStagedPluginsStale(pluginTarget)) {
            process.exit(0);
        }
        await bundlePlugins(pluginTarget, marketplaceTarget);
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
