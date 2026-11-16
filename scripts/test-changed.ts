/**
 * `test-changed` action override — coverage for the changed scope, without clobbering the corpus.
 *
 * WHY: spur's light gate runs `cd {workspace} && bun test --coverage … {paths}`, which writes
 * `.coverage/` in the workspace (and can land on the repo-wide corpus when the workspace is the
 * root). The light gate's own run then left `.coverage/lcov.info` describing ONE workspace, and the
 * next gate's `rules:post` coverage rule read that partial file and failed every file it did not
 * touch (`apps/cli/src/board/*.ts` at 8%) — a red gate caused by the previous gate's artifact
 * (0383). Isolating the changed-scope coverage into a scratch dir keeps the repo-wide corpus intact
 * and still records what the changed tests cover.
 *
 * Usage (bound from `.spur/config.yaml` → `builder.actions.test-changed`):
 *   bun scripts/test-changed.ts <workspace> [<path>...]
 */
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Where a changed-scope run deposits its coverage, never the repo-wide `.coverage/`. */
export const SCOPED_COVERAGE_DIR = join('.works', 'tmp', 'coverage-changed');

/** The argv one changed-scope test run uses. Exported so the test can assert the isolation. */
export function testArgv(paths: readonly string[], coverageDir: string): string[] {
    return ['bun', 'test', '--coverage', `--coverage-dir=${coverageDir}`, '--coverage-reporter=text', ...paths];
}

/** Run the changed scope from one workspace; the scratch dir is cleared first so numbers never mix. */
export function main(argv: string[], root = process.cwd()): number {
    const workspace = argv[0];
    if (workspace === undefined || workspace.trim() === '') {
        process.stderr.write('usage: bun scripts/test-changed.ts <workspace> [<path>...]\n');
        return 2;
    }
    const coverageDir = resolve(root, SCOPED_COVERAGE_DIR);
    rmSync(coverageDir, { recursive: true, force: true });
    mkdirSync(coverageDir, { recursive: true });
    const result = Bun.spawnSync(testArgv(argv.slice(1), coverageDir), {
        cwd: resolve(root, workspace),
        stdout: 'inherit',
        stderr: 'inherit',
    });
    return result.exitCode ?? 1;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
