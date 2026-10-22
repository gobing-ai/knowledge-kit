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
 *
 * The same applies to proto refusing lefthook: `lefthook` is a `[plugins.tools]` entry, so proto
 * ignores the untrusted `.prototools` of a fresh clone or worktree and the shim exits 1. That is
 * also a local gap — `proto trust .prototools` fixes it — not a broken dependency graph.
 */

if (Bun.which('lefthook') === null) {
    console.warn('lefthook not on PATH — git hooks not installed (run `proto use` or `brew install lefthook`)');
    process.exit(0);
}

const result = Bun.spawnSync({
    cmd: ['lefthook', 'install'],
    stdin: 'inherit',
    // Piped (then re-emitted) so a proto trust refusal is recognisable; it prints to stdout in an
    // agent environment and to stderr otherwise.
    stdout: 'pipe',
    stderr: 'pipe',
});

const output = `${result.stdout.toString()}${result.stderr.toString()}`;
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);

if ((result.exitCode ?? 1) !== 0 && output.includes('proto::tool::untrusted_plugin')) {
    console.warn(
        'proto ignored the untrusted .prototools, so lefthook was not run — git hooks not installed (run `proto trust .prototools`)',
    );
    process.exit(0);
}

process.exit(result.exitCode ?? 1);
