/**
 * Install the repo's git hooks from the root `prepare` lifecycle script.
 *
 * lefthook is pinned in `.prototools` and provisioned by `proto use`, so a checkout without proto
 * has no `lefthook` binary. Running it unguarded made `bun install` itself die with exit 127, which
 * every caller that shells an install then misreports — `spur builder bump-ver` blamed
 * "bun.lock is inconsistent" after a version bump while the lockfile was fine.
 *
 * A missing hook binary is a local-environment gap, not a reason to fail dependency installation.
 * A lefthook that IS present still propagates its own failure, so a broken `lefthook.yml` stays loud.
 */

if (Bun.which('lefthook') === null) {
    console.warn('lefthook not on PATH — git hooks not installed (run `proto use` or `brew install lefthook`)');
    process.exit(0);
}

const result = Bun.spawnSync({
    cmd: ['lefthook', 'install'],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
});

process.exit(result.exitCode ?? 1);
