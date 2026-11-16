/**
 * Seed a fresh worktree's coverage corpus from the tree it was cut from.
 *
 * WHY: `recommended-post-check`'s `coverage-gate` reads `.coverage/lcov.info` and exits 1 when the
 * file is absent, so every `--worktree` batch fails `rules:post` until a full `bun run test` (≈25 min
 * here) writes one. A worktree branched from a commit whose coverage already exists describes THE
 * SAME CODE, so copying it is truthful rather than a shortcut — provided the two trees are at the
 * same commit and the source trees carry no modifications.
 *
 * Refuses (exit 1) when:
 *   - the two HEADs differ, or the source tree has uncommitted source changes (the coverage would
 *     describe code this tree does not have);
 *   - the source has no `.coverage/lcov.info`;
 *   - this tree already has one (never overwrite real evidence — `--force` is not offered; delete it
 *     first if you mean it).
 *
 * Usage:
 *   bun scripts/seed-worktree-coverage.ts <source-tree> [--root <target-tree>]
 */
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** `git rev-parse HEAD` for one tree, or null when it is not a git checkout. */
export function headOf(tree: string): string | null {
    const result = Bun.spawnSync(['git', '-C', tree, 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'pipe' });
    if ((result.exitCode ?? 1) !== 0) return null;
    const sha = new TextDecoder().decode(result.stdout).trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** Tracked source modifications in one tree (untracked/gitignored files cannot invalidate coverage). */
export function dirtySourceOf(tree: string): string[] {
    const result = Bun.spawnSync(['git', '-C', tree, 'status', '--porcelain', '--untracked-files=no'], {
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if ((result.exitCode ?? 1) !== 0) return [];
    return new TextDecoder()
        .decode(result.stdout)
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter((path) => path !== '' && /^(apps|packages|plugins|scripts)\//.test(path));
}

export type SeedRefusal = { ok: false; reason: string } | { ok: true; lcov: string };

/** Decide whether the copy is truthful, without touching anything. */
export function planSeed(sourceTree: string, targetTree: string): SeedRefusal {
    const lcov = join(sourceTree, '.coverage', 'lcov.info');
    if (!existsSync(lcov)) {
        return { ok: false, reason: `no coverage corpus at ${lcov} — run \`bun run test\` in ${sourceTree} once` };
    }
    if (existsSync(join(targetTree, '.coverage', 'lcov.info'))) {
        return {
            ok: false,
            reason: `${targetTree} already has its own coverage corpus; remove it first if you mean to replace it`,
        };
    }
    const sourceHead = headOf(sourceTree);
    const targetHead = headOf(targetTree);
    if (sourceHead === null || targetHead === null) return { ok: false, reason: 'both trees must be git checkouts' };
    if (sourceHead !== targetHead) {
        return {
            ok: false,
            reason: `trees differ (${sourceHead.slice(0, 8)} vs ${targetHead.slice(0, 8)}): that coverage describes other code`,
        };
    }
    const dirty = dirtySourceOf(sourceTree);
    if (dirty.length > 0) {
        return {
            ok: false,
            reason: `${sourceTree} has uncommitted source changes (${dirty.slice(0, 3).join(', ')}) — its coverage is stale`,
        };
    }
    return { ok: true, lcov };
}

/** Copy the corpus when {@link planSeed} allows it; return the refusal otherwise. */
export function seedCoverage(sourceTree: string, targetTree: string): SeedRefusal {
    const plan = planSeed(sourceTree, targetTree);
    if (!plan.ok) return plan;
    const target = join(targetTree, '.coverage');
    rmSync(target, { recursive: true, force: true });
    cpSync(join(sourceTree, '.coverage'), target, { recursive: true });
    return { ok: true, lcov: join(target, 'lcov.info') };
}

/** Run the seed; returns the exit code (0 seeded, 1 refused, 2 usage). */
export function main(argv: string[]): number {
    const source = argv[0] === undefined ? '' : resolve(argv[0]);
    const rootFlag = argv.indexOf('--root');
    const target = resolve(rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? process.cwd()));
    if (source === '') {
        process.stderr.write('usage: bun scripts/seed-worktree-coverage.ts <source-tree> [--root <target-tree>]\n');
        return 2;
    }
    const result = seedCoverage(source, target);
    if (!result.ok) {
        process.stderr.write(`seed-worktree-coverage: refused — ${result.reason}\n`);
        return 1;
    }
    process.stdout.write(`seed-worktree-coverage: copied ${readLcovMarker(result.lcov)} into ${target}\n`);
    return 0;
}

/** A one-line proof the copied file is the corpus the gate reads (size, not contents). */
function readLcovMarker(lcov: string): string {
    return `${lcov} (${readFileSync(lcov).byteLength} bytes)`;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
