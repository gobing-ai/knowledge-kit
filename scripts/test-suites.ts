/**
 * Single-source-of-truth test-suite split between the fast unit tier (`bun run test`) and the
 * heavy browser/Playwright/e2e/subprocess-workflow tier (`bun run test:heavy`, task 0429).
 *
 * WHY: Running all ~369 test files serially in one `bun run test` pass took >30 min because
 * real-Chromium DOM fixtures, subprocess workflow e2e tests, and multi-spawn integration suites
 * dominate wall time while contributing zero in-process coverage. Splitting them through one
 * exported classification guarantees `fast ∩ heavy = ∅` and `fast ∪ heavy = all workspace
 * *.test.ts`, while keeping `bun run test` strictly at the 90% per-file line and function
 * coverage floor and keeping `bun run test:heavy` from clobbering `.coverage/lcov.info`.
 *
 * Usage:
 *   bun scripts/test-suites.ts fast [-- <extra bun test args>]
 *   bun scripts/test-suites.ts heavy [-- <extra bun test args>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Glob } from 'bun';

/** Workspace top-level roots scanned for `*.test.ts` files. */
export const WORKSPACE_TEST_ROOTS = ['apps', 'packages', 'plugins', 'scripts'] as const;

/** Generated Bun config used by `heavy` runs to disable coverage without touching `bunfig.toml`. */
export const HEAVY_BUNFIG_PATH = join('.works', 'tmp', 'heavy-bunfig.toml');

/**
 * Repo-relative glob patterns and explicit paths routed to `bun run test:heavy`.
 *
 * Criteria: real-Chromium / Playwright DOM runners, installed-bundle / dogfood suites, and
 * subprocess-only workflow e2e tests whose removal from `fast` preserves >= 90% per-file line
 * and function coverage across all production `src/` files.
 */
export const HEAVY_TEST_PATTERNS: readonly string[] = [
    '**/*-dom.test.ts',
    '**/*-dogfood.test.ts',
    '**/*-installed.test.ts',
    '**/installed-*.test.ts',
    'plugins/generations/image-gen/tests/compose-e2e.test.ts',
    'apps/cli/tests/kk-publish.e2e.test.ts',
    'apps/cli/tests/kk-news-generate.e2e.test.ts',
    'apps/cli/tests/kk-article.e2e.test.ts',
    'apps/cli/tests/daily-script-ordering-e2e.test.ts',
    'apps/cli/tests/schedule-no-scripts.e2e.test.ts',
    'apps/cli/tests/voice2-dag.test.ts',
    'apps/cli/tests/kk-collect.test.ts',
    'apps/cli/tests/kk-workflow-stages.test.ts',
    'apps/cli/tests/kk-daily-ai-voice-workflow.test.ts',
    'apps/cli/tests/kk-daily-ai-voice-content-quality.test.ts',
    'apps/cli/tests/daily-cache-recovery.test.ts',
    'apps/cli/tests/daily-generate-sections.test.ts',
    'plugins/kk/tests/daily-triage.test.ts',
    'plugins/kk/tests/daily-extract-ladder.test.ts',
    'plugins/kk/tests/daily-publish-path-0329.test.ts',
    'plugins/kk/tests/daily-surfdash-recovery.test.ts',
    'plugins/kk/tests/daily-floor-gate.test.ts',
    'plugins/kk/tests/kk-music-workflow.test.ts',
    'plugins/kk/tests/kk-workflow-stages.test.ts',
    'plugins/kk/tests/safety-retry-preserves-artifacts.test.ts',
    'plugins/kk/tests/news-localize-bundle.test.ts',
    'plugins/kk/tests/daily-script-retry-regression.test.ts',
];

export type TestSuiteMode = 'fast' | 'heavy';

const COMPILED_HEAVY_GLOBS = HEAVY_TEST_PATTERNS.map((pattern) => new Glob(pattern));

/** True when a repo-relative POSIX test path belongs to the `heavy` tier. */
export function isHeavyTest(repoRelPath: string): boolean {
    const normalized = repoRelPath.replaceAll('\\', '/').replace(/^\.\//, '');
    return COMPILED_HEAVY_GLOBS.some((glob) => glob.match(normalized));
}

/** Partition a list of repo-relative test paths into disjoint `fast` and `heavy` arrays. */
export function classifyTestFiles(files: readonly string[]): { fast: string[]; heavy: string[] } {
    const fast: string[] = [];
    const heavy: string[] = [];
    for (const file of files) {
        if (isHeavyTest(file)) heavy.push(file);
        else fast.push(file);
    }
    return { fast, heavy };
}

/** Discover all workspace `*.test.ts` files under {@link WORKSPACE_TEST_ROOTS}, sorted deterministically. */
export async function discoverWorkspaceTests(root: string = process.cwd()): Promise<string[]> {
    const found: string[] = [];
    const pattern = `{${WORKSPACE_TEST_ROOTS.join(',')}}/**/*.test.ts`;
    const glob = new Glob(pattern);
    for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
        const normalized = rel.replaceAll('\\', '/');
        if (normalized.includes('/node_modules/') || normalized.startsWith('vendors/')) continue;
        found.push(normalized);
    }
    return found.sort();
}

/** Write the minimal Bun test config that disables coverage for `heavy` runs while keeping the preload. */
export function ensureHeavyBunfig(root: string = process.cwd()): string {
    const configPath = resolve(root, HEAVY_BUNFIG_PATH);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(
        configPath,
        ['[test]', 'preload = ["./scripts/test-silence-output.ts"]', 'coverage = false', ''].join('\n'),
    );
    return configPath;
}

/** Build the `bun test` argv for the selected tier. */
export function buildTestArgv(
    mode: TestSuiteMode,
    files: readonly string[],
    extraArgs: readonly string[] = [],
    heavyConfigPath: string = HEAVY_BUNFIG_PATH,
): string[] {
    if (mode === 'fast') {
        return [
            'bun',
            'test',
            '--parallel=8',
            '--dots',
            '--coverage',
            '--coverage-dir=.coverage',
            '--coverage-reporter=lcov',
            '--coverage-reporter=text',
            '--timeout',
            '20000',
            ...extraArgs,
            ...files,
        ];
    }
    return ['bun', `--config=${heavyConfigPath}`, 'test', '--dots', '--timeout', '120000', ...extraArgs, ...files];
}

/** CLI entrypoint: discover, partition, and execute the requested suite tier. */
export async function main(
    argv: string[],
    root: string = process.cwd(),
    spawn: typeof Bun.spawnSync = Bun.spawnSync,
): Promise<number> {
    const mode = argv[0];
    if (mode !== 'fast' && mode !== 'heavy') {
        process.stderr.write('usage: bun scripts/test-suites.ts <fast|heavy> [extra bun test args...]\n');
        return 2;
    }
    const extraArgs = argv[1] === '--' ? argv.slice(2) : argv.slice(1);
    const allFiles = await discoverWorkspaceTests(root);
    const { fast, heavy } = classifyTestFiles(allFiles);
    const selected = mode === 'fast' ? fast : heavy;
    if (selected.length === 0) {
        process.stderr.write(`test-suites: no ${mode} test files found under ${root}\n`);
        return 1;
    }
    const heavyConfig = mode === 'heavy' ? ensureHeavyBunfig(root) : HEAVY_BUNFIG_PATH;
    const result = spawn(buildTestArgv(mode, selected, extraArgs, heavyConfig), {
        cwd: root,
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, NODE_ENV: 'test' },
    });
    return result.exitCode ?? 1;
}

if (import.meta.main) {
    process.exit(await main(Bun.argv.slice(2)));
}
