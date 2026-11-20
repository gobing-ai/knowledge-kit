/**
 * CI publish helper for npm Trusted Publishing (OIDC) — ported from spur-new.
 *
 * Prepares the published manifest, then builds the package BEFORE
 * `npm publish --access public` so bin files exist when npm validates them
 * (npm >= 11 checks bin existence pre-lifecycle-scripts).
 *
 * Workspace protocol ranges are not resolvable on npm:
 *   - `workspace:*` to a **private** package is stripped (bundled into dist/).
 *   - `catalog:` is rewritten to the concrete range from the root
 *     `workspaces.catalog` (ADR-014). `bun add -g @gobing-ai/knowledge-kit`
 *     otherwise fails with `@gobing-ai/ts-*@catalog: failed to resolve`.
 * Repo manifests keep `catalog:` / `workspace:*`; only the tarball is rewritten.
 */

import { catalogFromRootPackage, collectPrivateWorkspaceNames, preparePublishedManifest } from './publish-manifest';

const repoRoot = new URL('../', import.meta.url).pathname;

async function loadJson(path: string): Promise<Record<string, unknown>> {
    return await Bun.file(path).json();
}

/** Strip/rewrite workspace protocol deps, then `npm publish` the package. */
async function publish(target: string | undefined): Promise<void> {
    if (!target) {
        throw new Error('Usage: bun scripts/publish.ts <package-dir>');
    }
    const dir = target.startsWith('/') ? target : `${process.cwd()}/${target}`.replace(/\/+$/, '');
    const manifestPath = `${dir}/package.json`;
    const original = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(original) as Record<string, unknown>;

    const rootPkg = await loadJson(`${repoRoot}package.json`);
    const result = preparePublishedManifest(manifest, {
        catalog: catalogFromRootPackage(rootPkg),
        privateWorkspaceNames: await collectPrivateWorkspaceNames(repoRoot, rootPkg),
    });

    if (result.changed > 0) {
        await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        const parts: string[] = [];
        if (result.strippedWorkspace > 0) {
            parts.push(`stripped ${result.strippedWorkspace} private workspace dep(s)`);
        }
        if (result.rewrittenCatalog > 0) {
            parts.push(`rewrote ${result.rewrittenCatalog} catalog: dep(s)`);
        }
        console.log(parts.join('; '));
    }

    // Build (bundle + stage plugins/marketplace) before npm publish so bin
    // files exist when npm validates them. npm >= 11 checks bin file existence
    // BEFORE running lifecycle scripts, so relying on prepack alone causes npm
    // to strip the bin entry.
    const build = Bun.spawnSync(['bun', 'run', 'build:bundle'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    if (build.exitCode !== 0) {
        if (result.changed > 0) await Bun.write(manifestPath, original);
        console.error(build.stderr.toString().trim());
        throw new Error(`build failed (exit ${build.exitCode})`);
    }

    const published = Bun.spawnSync(['npm', 'publish', '--access', 'public'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [published.stdout.toString(), published.stderr.toString()].filter(Boolean).join('\n').trim();
    console.log(output);

    // Restore the original manifest in all cases — catalog: / workspace: refs
    // are correct for the repo; only the published tarball needs npm ranges.
    if (result.changed > 0) {
        await Bun.write(manifestPath, original);
    }

    if (published.exitCode !== 0) throw new Error(`npm publish failed (exit ${published.exitCode})`);
}

publish(process.argv[2]).catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
