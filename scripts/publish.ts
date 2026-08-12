/**
 * CI publish helper for npm Trusted Publishing (OIDC) — ported from spur-new.
 *
 * Strips `workspace:*` deps to private packages (they are compiled into the
 * bundle at build time and are not resolvable from npm), then builds the
 * package BEFORE `npm publish --access public` so bin files exist when npm
 * validates them (npm >= 11 checks bin existence pre-lifecycle-scripts).
 */

const repoRoot = new URL('../', import.meta.url).pathname;

async function loadJson(path: string): Promise<Record<string, unknown>> {
    return await Bun.file(path).json();
}

/** Strip `workspace:*` deps to private packages, then `npm publish` it. */
async function publish(target: string | undefined): Promise<void> {
    if (!target) {
        throw new Error('Usage: bun scripts/publish.ts <package-dir>');
    }
    const dir = target.startsWith('/') ? target : `${process.cwd()}/${target}`.replace(/\/+$/, '');
    const manifestPath = `${dir}/package.json`;
    const original = await Bun.file(manifestPath).text();
    const manifest = JSON.parse(original) as Record<string, unknown>;

    // Build name->private map from workspace packages. Private packages are
    // bundled into the artifact at build time, so their `workspace:*` refs must
    // be STRIPPED from the published manifest (npm cannot resolve unpublished
    // names) rather than version-resolved.
    const wsPrivate = new Set<string>();
    for (const wsDir of ['apps', 'packages']) {
        const glob = new Bun.Glob(`${wsDir}/*/package.json`);
        for await (const entry of glob.scan({ cwd: repoRoot, absolute: true })) {
            const pkg = await loadJson(entry);
            if (pkg.name && pkg.private === true) wsPrivate.add(pkg.name as string);
        }
    }

    let changed = 0;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
        const deps = manifest[field] as Record<string, string> | undefined;
        if (!deps) continue;
        for (const [name, range] of Object.entries(deps)) {
            if (range.startsWith('workspace:')) {
                if (wsPrivate.has(name)) {
                    delete deps[name];
                    changed++;
                } else {
                    throw new Error(`cannot publish: non-private workspace dep "${name}" — resolve its version first`);
                }
            }
        }
    }

    if (changed > 0) {
        await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
        console.log(`Stripped ${changed} private workspace dep(s) from the manifest`);
    }

    // Build (bundle + stage plugins/marketplace) before npm publish so bin
    // files exist when npm validates them. npm >= 11 checks bin file existence
    // BEFORE running lifecycle scripts, so relying on prepack alone causes npm
    // to strip the bin entry.
    const build = Bun.spawnSync(['bun', 'run', 'build:bundle'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    if (build.exitCode !== 0) {
        if (changed > 0) await Bun.write(manifestPath, original);
        console.error(build.stderr.toString().trim());
        throw new Error(`build failed (exit ${build.exitCode})`);
    }

    const result = Bun.spawnSync(['npm', 'publish', '--access', 'public'], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = [result.stdout.toString(), result.stderr.toString()].filter(Boolean).join('\n').trim();
    console.log(output);

    // Restore the original manifest in all cases — the workspace: refs are
    // correct for the repo; only the published tarball needs them stripped.
    if (changed > 0) {
        await Bun.write(manifestPath, original);
    }

    if (result.exitCode !== 0) throw new Error(`npm publish failed (exit ${result.exitCode})`);
}

publish(process.argv[2]).catch((error) => {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
