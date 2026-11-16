/**
 * `lint-changed` action override — formats nothing, fails only on a real finding.
 *
 * WHY: spur's light gate runs `bunx biome check {files}` over the changed paths. Biome does not
 * process files whose language it does not handle (Markdown), and `ignoreUnknown: true` makes it
 * skip them silently — so a docs-only change set leaves biome with zero files to check and it exits
 * 1 with "No files were processed in the specified paths". The gate reads that as a task failure,
 * which makes every docs-only task ungateable (task 0383).
 *
 * The rule the gate actually wants is "the changed files carry no lint or format finding". That is
 * true when every path is one Biome ignores. This wrapper filters the arguments to the languages
 * Biome handles AND passes `--no-errors-on-unmatched`, so a path that Biome's own config ignores
 * (`.works/**`, `dist/**`) is a pass rather than "no files were processed".
 *
 * Usage (bound from `.spur/config.yaml` → `builder.actions.lint-changed`):
 *   bun scripts/lint-changed.ts <path> [<path>...]
 */
import { existsSync } from 'node:fs';

/** Extensions Biome's formatter/linter handles in this repo. Everything else is skipped. */
const BIOME_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc'];

/** The paths Biome can actually check; everything else is ignored rather than passed on. */
export function checkable(paths: readonly string[]): string[] {
    return paths.filter((path) => BIOME_EXTENSIONS.some((extension) => path.endsWith(extension)));
}

/** Paths that do not exist any more (a deletion in the change set) are never passed to Biome. */
export function existing(paths: readonly string[]): string[] {
    return paths.filter((path) => existsSync(path));
}

/** The real check: Biome over the given paths, its exit code passed through unchanged. */
export function runBiome(targets: string[]): number {
    const result = Bun.spawnSync(['bunx', 'biome', 'check', '--no-errors-on-unmatched', ...targets], {
        stdout: 'inherit',
        stderr: 'inherit',
    });
    return result.exitCode ?? 1;
}

/**
 * Run the check over what Biome can process; an empty set passes with an explicit note. `run` is the
 * seam the tests inject, so "a real finding is not swallowed" is asserted without standing up Biome.
 */
export function main(argv: string[], run: (targets: string[]) => number = runBiome): number {
    const targets = existing(checkable(argv));
    if (targets.length === 0) {
        process.stdout.write(`lint-changed: nothing Biome can check in ${argv.length} changed path(s) — pass\n`);
        return 0;
    }
    return run(targets);
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
