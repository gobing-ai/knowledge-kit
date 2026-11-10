/**
 * Task 0344 — failure-first public-surface checks for daily AI-news operator entries.
 *
 * Failure matrix enumerated before implementation:
 *  1. Generate-only accidentally enables auto_publish or calls a publisher.
 *  2. A green generation DAG without a bundle is reported as ready.
 *  3. No-content is mistaken for a publishable bundle or regenerated in a loop.
 *  4. Missing generation publishes anyway, or non-TTY posting generates without consent.
 *  5. Wrong-day, malformed, hash-mismatched, or unsafe bundles reach the publisher.
 *  6. Accepted generation does not finish before after-generate posting starts.
 *  7. Validation hides a live run failure behind green offline dogfood.
 *  8. Nonzero dogfood is accepted because its summary has passes and zero failures.
 *  9. Read-only diagnosis mutates the config, store, schedule, or installed runtime.
 */

import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../..');
const SCRIPT = join(REPO, 'scripts/daily-ai-news.ts');
const SUPERVISOR = join(REPO, 'plugins/kk/scripts/daily-scheduled-run.ts');
function laDate(offsetDays = 0): string {
    const instant = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(instant);
}

const RUN_DATE_ISO = laDate();
const RUN_DATE = RUN_DATE_ISO.replaceAll('-', '');
const PRIOR_DATE = laDate(-1).replaceAll('-', '');

function supervisorRunDate(): string {
    return new Date().toISOString().slice(0, 10).replaceAll('-', '');
}

interface Fixture {
    root: string;
    works: string;
    bin: string;
    config: string;
    dayDir: string;
    actions: string;
}

interface BundleOptions {
    runDate?: string;
    badHash?: boolean;
    safety?: boolean;
    malformed?: boolean;
    emptyVariants?: boolean;
}

function fixture(name: string): Fixture {
    const root = join(tmpdir(), `daily-ai-news-${process.pid}-${name}`);
    rmSync(root, { recursive: true, force: true });
    const works = join(root, 'works root');
    const bin = join(root, 'bin');
    const dayDir = join(works, 'kk-daily-ai-voice2', RUN_DATE);
    mkdirSync(bin, { recursive: true });
    mkdirSync(dayDir, { recursive: true });
    const config = join(root, 'config.yaml');
    writeFileSync(
        config,
        `works_dir: ${JSON.stringify(works)}\nstore:\n  db_path: ${JSON.stringify(join(root, 'kk.db'))}\n  labels:\n    priority: ['*', heuristic]\n    min_confidence: 0.8\n    decisions:\n      kk-item-china-politics:\n        priority: [keyword, '*', heuristic]\n`,
    );
    return { root, works, bin, config, dayDir, actions: join(root, 'actions.jsonl') };
}

function executable(dir: string, name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!${process.execPath}\n${body}`);
    chmodSync(path, 0o755);
    return path;
}

function recordBody(extra = ''): string {
    return `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.ACTIONS, JSON.stringify(process.argv.slice(2)) + '\\n');\n${extra}`;
}

function actions(fx: Fixture): string[][] {
    if (!existsSync(fx.actions)) return [];
    return readFileSync(fx.actions, 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
}

function writeBundle(fx: Fixture, options: BundleOptions = {}, dayDir = fx.dayDir): string {
    mkdirSync(dayDir, { recursive: true });
    const variantPath = join(dayDir, 'article.json');
    const variantBytes = `${JSON.stringify({ title: 'Daily AI', body: 'Body', format: 'markdown' })}\n`;
    writeFileSync(variantPath, variantBytes);
    const actualHash = createHash('sha256').update(variantBytes).digest('hex');
    const bundle = {
        schemaVersion: 1,
        runId: 'fixture-run',
        parentRunId: 'fixture-parent',
        runDate: options.runDate ?? RUN_DATE,
        runs: ['fixture-run'],
        episode: { title: 'Daily AI' },
        variants:
            options.emptyVariants === true
                ? {}
                : {
                      article: {
                          path: 'article.json',
                          sha256: options.badHash === true ? '0'.repeat(64) : actualHash,
                      },
                  },
        ...(options.safety === false
            ? {}
            : {
                  safety: {
                      status: 'pass',
                      digest: 'a'.repeat(64),
                      excludedPlatforms: [],
                      variants: { article: actualHash },
                  },
              }),
    };
    const bundlePath = join(dayDir, 'bundle.json');
    writeFileSync(bundlePath, options.malformed === true ? '{not-json' : `${JSON.stringify(bundle, null, 2)}\n`);
    return bundlePath;
}

function runCli(fx: Fixture, args: string[], extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: REPO,
        env: {
            ...process.env,
            KK_WORKS_DIR: fx.works,
            KK_CONFIG: fx.config,
            ACTIONS: fx.actions,
            ...extraEnv,
        },
        encoding: 'utf-8',
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
    });
}

function fakeGenerateAndPublish(fx: Fixture): void {
    const ready = join(fx.dayDir, 'bundle.ready.json');
    renameSync(join(fx.dayDir, 'bundle.json'), ready);
    executable(
        fx.bin,
        'bun',
        recordBody(`import { copyFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1] === 'daily-news:generate') {
    copyFileSync(process.env.READY_BUNDLE, process.env.LIVE_BUNDLE);
}
`),
    );
}

function validationTools(fx: Fixture, dogfoodExit: number | null = null): void {
    for (const tool of ['spur', 'kk', 'jq', 'ffmpeg', 'ffprobe', 'python3']) {
        executable(fx.bin, tool, 'process.exit(0);\n');
    }
    if (dogfoodExit !== null) {
        executable(
            fx.bin,
            'bun',
            recordBody(`console.log('17 pass');\nconsole.error('0 fail');\nprocess.exit(${dogfoodExit});\n`),
        );
    }
}

async function createStore(fx: Fixture): Promise<void> {
    const { openStore } = await import(Bun.resolveSync('@gobing-ai/kk-store', join(REPO, 'packages/kk-store')));
    const store = await openStore({ path: join(fx.root, 'kk.db') });
    await store.close();
}

function sha256(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function latestValidationReport(fx: Fixture): {
    path: string;
    report: { status: string; mode?: string; checks: { name: string; status: string; detail: string }[] };
} {
    const root = join(fx.works, 'tmp/test-daily-ai-news');
    const dirs = readdirSync(root).sort();
    const path = join(root, dirs.at(-1) ?? '', 'validation.json');
    return { path, report: JSON.parse(readFileSync(path, 'utf-8')) };
}

describe('0344 package entries and supervised generation', () => {
    it('declares exactly the three operator entries with generation separated from posting', () => {
        const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8')) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts['daily-news:generate']).toBe('bun scripts/daily-ai-news.ts generate');
        expect(pkg.scripts['daily-news:publish']).toBe('bun scripts/daily-ai-news.ts publish');
        expect(pkg.scripts['daily-news:validate']).toBe('bun scripts/daily-ai-news.ts validate');
    });

    it('generate entry forwards the current voice3 defaults through the supervisor', () => {
        const fx = fixture('generate-entry');
        const supervisorDate = supervisorRunDate();
        const supervisorDir = join(fx.works, 'kk-daily-ai-voice2', supervisorDate);
        renameSync(
            writeBundle(fx, { runDate: supervisorDate }, supervisorDir),
            join(supervisorDir, 'bundle.ready.json'),
        );
        executable(
            fx.bin,
            'spur',
            recordBody(`import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('run')) {
    const vars = JSON.parse(args[args.indexOf('--vars') + 1]);
    copyFileSync(process.env.READY_BUNDLE, join(vars.work_dir, 'bundle.json'));
}
`),
        );
        executable(fx.bin, 'kk', recordBody());
        const result = runCli(fx, ['generate', '--skip-probe', '--allow-dirty'], {
            TZ: 'UTC',
            PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
            READY_BUNDLE: join(supervisorDir, 'bundle.ready.json'),
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        const launch = actions(fx).find((args) => args.includes('run'));
        expect(launch?.some((arg) => arg.includes('kk-daily-ai-voice3.yaml'))).toBe(true);
        const vars = JSON.parse(launch?.[(launch?.indexOf('--vars') ?? -1) + 1] ?? '{}') as Record<string, string>;
        expect(vars).toMatchObject({
            auto_publish: 'false',
            window: '72h',
            agent: 'planner',
            agent_retry: 'planner',
            skip_review: 'true',
        });
        expect(vars.work_dir).toContain(fx.works);
    });

    it('prints generate help without launching a workflow', () => {
        const fx = fixture('generate-help');
        const result = runCli(fx, ['generate', '--help']);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('daily-news:generate');
        expect(actions(fx)).toEqual([]);
    });

    it('generate-only sets auto_publish=false and distinguishes done, malformed, incomplete, and no-content', async () => {
        for (const scenario of ['done', 'malformed', 'incomplete', 'no-content'] as const) {
            const fx = fixture(`generate-${scenario}`);
            const supervisorDate = supervisorRunDate();
            const supervisorDir = join(fx.works, 'kk-daily-ai-voice2', supervisorDate);
            if (scenario === 'done') {
                renameSync(
                    writeBundle(fx, { runDate: supervisorDate }, supervisorDir),
                    join(supervisorDir, 'bundle.ready.json'),
                );
            }
            if (scenario === 'malformed') {
                mkdirSync(supervisorDir, { recursive: true });
                writeFileSync(join(supervisorDir, 'bundle.json'), '{not-json');
            }
            executable(
                fx.bin,
                'spur',
                recordBody(`import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
if (args.includes('run')) {
    const vars = JSON.parse(args[args.indexOf('--vars') + 1]);
    if (process.env.SCENARIO === 'done') copyFileSync(process.env.READY_BUNDLE, join(vars.work_dir, 'bundle.json'));
    if (process.env.SCENARIO === 'no-content') writeFileSync(join(vars.work_dir, 'run-report.summary.txt'), 'no-content: fixture');
}
if (args.includes('trace')) console.log('{}');
`),
            );
            executable(fx.bin, 'kk', recordBody());
            const receipt = join(fx.root, 'receipt.json');
            const proc = Bun.spawn(
                [
                    process.execPath,
                    SUPERVISOR,
                    '--repo',
                    REPO,
                    '--works-dir',
                    fx.works,
                    '--receipt',
                    receipt,
                    '--run-id',
                    `generate-only-${scenario}`,
                    '--workflow',
                    'kk-daily-ai-voice3',
                    '--generate-only',
                    '--window',
                    '72h',
                    '--skip-probe',
                    '--allow-dirty',
                ],
                {
                    env: {
                        ...process.env,
                        TZ: 'UTC',
                        PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
                        ACTIONS: fx.actions,
                        SCENARIO: scenario,
                        READY_BUNDLE: join(supervisorDir, 'bundle.ready.json'),
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            );
            const [exitCode, stdout, stderr] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            expect({ scenario, exitCode, stdout, stderr }).toMatchObject({
                exitCode: scenario === 'done' ? 0 : 4,
            });
            const row = JSON.parse(readFileSync(receipt, 'utf-8')) as {
                status: string;
                primaryPublishStatus: string | null;
            };
            expect(row.status).toBe(scenario === 'malformed' ? 'incomplete' : scenario);
            expect(row.primaryPublishStatus).toBeNull();
            const launch = actions(fx).find((args) => args.includes('run'));
            const vars = JSON.parse(launch?.[(launch?.indexOf('--vars') ?? -1) + 1] ?? '{}') as Record<string, string>;
            expect(vars.auto_publish).toBe('false');
            expect(vars.window).toBe('72h');
            expect(vars.skip_review).toBe('true');
            expect(actions(fx).some((args) => args.some((arg) => arg.includes('kk-daily-publish3')))).toBe(false);
        }
    }, 30_000);
});

describe('0344 publish dependency and bundle admission', () => {
    it('posts a valid current bundle through the real window launcher without generating', () => {
        const fx = fixture('valid-publish');
        writeBundle(fx);
        const spur = executable(fx.bin, 'spur', recordBody());
        const result = runCli(fx, ['publish', '--run-date', RUN_DATE_ISO], {
            PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
            KK_SPUR_BIN: spur,
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        const launch = actions(fx).find((args) => args.some((arg) => arg.includes('kk-daily-publish3.yaml')));
        expect(launch).toBeDefined();
        const vars = JSON.parse(launch?.[(launch?.indexOf('--vars') ?? -1) + 1] ?? '{}') as Record<string, string>;
        expect(vars).toMatchObject({ window: 'after-generate', run_date: RUN_DATE, work_dir: fx.dayDir });
        expect(actions(fx).some((args) => args.includes('daily-news:generate'))).toBe(false);
    });

    it('refuses non-interactive implicit generation and prints the exact generate command', () => {
        const fx = fixture('non-tty-refusal');
        const result = runCli(fx, ['publish', '--run-date', RUN_DATE]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('bun run daily-news:generate');
        expect(actions(fx)).toEqual([]);
    });

    it('generates with explicit consent and only then starts after-generate posting', () => {
        const fx = fixture('accepted-generation');
        writeBundle(fx);
        fakeGenerateAndPublish(fx);
        const result = runCli(fx, ['publish', '--run-date', RUN_DATE, '--yes'], {
            PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
            READY_BUNDLE: join(fx.dayDir, 'bundle.ready.json'),
            LIVE_BUNDLE: join(fx.dayDir, 'bundle.json'),
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        const calls = actions(fx);
        expect(calls[0]?.slice(0, 2)).toEqual(['run', 'daily-news:generate']);
        expect(calls[1]?.[0]).toContain('voice3-publish-window.ts');
        expect(calls[1]).toContain('after-generate');
    });

    it('accepts generation through a real PTY prompt before posting', () => {
        const fx = fixture('tty-accepted-generation');
        writeBundle(fx);
        fakeGenerateAndPublish(fx);
        const result = spawnSync(
            'python3',
            [
                '-c',
                'import pty,sys; sys.exit(pty.spawn(sys.argv[1:]))',
                process.execPath,
                SCRIPT,
                'publish',
                '--run-date',
                RUN_DATE,
            ],
            {
                cwd: REPO,
                env: {
                    ...process.env,
                    PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
                    KK_WORKS_DIR: fx.works,
                    KK_CONFIG: fx.config,
                    ACTIONS: fx.actions,
                    READY_BUNDLE: join(fx.dayDir, 'bundle.ready.json'),
                    LIVE_BUNDLE: join(fx.dayDir, 'bundle.json'),
                },
                input: 'y\n',
                encoding: 'utf-8',
                timeout: 120_000,
            },
        );
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        expect(result.stdout).toContain('Generate it now?');
        const calls = actions(fx);
        expect(calls[0]?.slice(0, 2)).toEqual(['run', 'daily-news:generate']);
        expect(calls[1]?.[0]).toContain('voice3-publish-window.ts');
    });

    it('rejects wrong-day, malformed, hash-mismatched, and unsafe bundles before any spawn', () => {
        for (const testCase of [
            { name: 'wrong-day', options: { runDate: '20000101' }, expected: 'dated' },
            { name: 'malformed', options: { malformed: true }, expected: 'unreadable' },
            { name: 'bad-hash', options: { badHash: true }, expected: 'sha256' },
            { name: 'unsafe', options: { safety: false }, expected: 'safety' },
            { name: 'empty-variants', options: { emptyVariants: true }, expected: 'variants' },
            { name: 'unsafe-dummy', options: { safety: false }, expected: 'safety', extraArgs: ['--dummy'] },
        ] as { name: string; options: BundleOptions; expected: string; extraArgs?: string[] }[]) {
            const fx = fixture(testCase.name);
            writeBundle(fx, testCase.options);
            const result = runCli(fx, ['publish', '--run-date', RUN_DATE, '--yes', ...(testCase.extraArgs ?? [])], {
                PATH: `${fx.bin}:${process.env.PATH ?? ''}`,
            });
            expect({ name: testCase.name, status: result.status, stderr: result.stderr }).toMatchObject({ status: 1 });
            expect(result.stderr.toLowerCase()).toContain(testCase.expected);
            expect(actions(fx)).toEqual([]);
        }
    });

    it('does not regenerate no-content, running, or historical missing runs', () => {
        for (const scenario of ['no-content', 'running', 'historical'] as const) {
            const fx = fixture(scenario);
            if (scenario === 'no-content')
                writeFileSync(join(fx.dayDir, 'run-report.summary.txt'), 'no-content: thin pool');
            if (scenario === 'running')
                writeFileSync(join(fx.dayDir, 'schedule-receipt.json'), JSON.stringify({ status: 'running' }));
            const runDate = scenario === 'historical' ? PRIOR_DATE : RUN_DATE;
            const result = runCli(fx, ['publish', '--run-date', runDate, '--yes']);
            expect({ scenario, status: result.status, stderr: result.stderr }).toMatchObject({ status: 1 });
            expect(actions(fx)).toEqual([]);
        }
    });
});

describe('0344 validation evidence and dogfood', () => {
    it('defaults to quick file-readiness checks without quality validation or subprocesses', () => {
        const fx = fixture('validation-quick-default');
        // Quick mode proves presence only: hash/safety/schema quality belongs to explicit full mode.
        writeBundle(fx, { badHash: true, safety: false });
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        const { report } = latestValidationReport(fx);
        expect(report.mode).toBe('quick');
        expect(report.checks.map((check) => check.name)).toEqual(['required-files', 'generation-files']);
        expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
        expect(actions(fx)).toEqual([]);
    });

    it('fails quick mode when a declared generation file is absent', () => {
        const fx = fixture('validation-quick-missing-variant');
        writeBundle(fx);
        rmSync(join(fx.dayDir, 'article.json'));
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect(result.status).toBe(1);
        const { report } = latestValidationReport(fx);
        expect(report.mode).toBe('quick');
        expect(report.checks.map((check) => check.name)).toEqual(['required-files', 'generation-files']);
        expect(report.checks.find((check) => check.name === 'generation-files')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'generation-files')?.detail).toContain('article.json');
        expect(actions(fx)).toEqual([]);
    });

    it('reports a live generation failure independently of skipped dogfood and preserves live inputs', async () => {
        const fx = fixture('validation-live-failure');
        validationTools(fx);
        await createStore(fx);
        writeFileSync(join(fx.dayDir, 'schedule-receipt.json'), JSON.stringify({ status: 'done', exitCode: 1 }));
        mkdirSync(join(fx.dayDir, '4-publish'), { recursive: true });
        writeFileSync(
            join(fx.dayDir, '4-publish/outcome.after-generate.json'),
            JSON.stringify({
                schemaVersion: 1,
                window: 'cn-peak',
                runDate: RUN_DATE,
                status: 'full',
                published: 2,
                targets: 2,
                excluded: [],
                rows: [],
            }),
        );
        const configHash = sha256(fx.config);
        const storeHash = sha256(join(fx.root, 'kk.db'));
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE, '--mode', 'full', '--skip-dogfood'], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 1 });
        const { path, report } = latestValidationReport(fx);
        expect(existsSync(path)).toBe(true);
        expect(report.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'generation')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'scheduled-run')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'publish:after-generate')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'dogfood')?.status).toBe('skipped');
        expect(report.checks.find((check) => check.name === 'store-supply')?.status).toBe('pass');
        expect(sha256(fx.config)).toBe(configHash);
        expect(sha256(join(fx.root, 'kk.db'))).toBe(storeHash);
    }, 120_000);

    it('accepts dogfood only with a zero exit and observed passes and zero failures', async () => {
        const fx = fixture('validation-dogfood');
        validationTools(fx, 0);
        await createStore(fx);
        writeBundle(fx);
        mkdirSync(join(fx.dayDir, '4-publish'), { recursive: true });
        mkdirSync(join(fx.dayDir, '24-script'), { recursive: true });
        writeFileSync(join(fx.dayDir, 'schedule-receipt.json'), JSON.stringify({ status: 'done', exitCode: 0 }));
        writeFileSync(join(fx.dayDir, `24-script/${RUN_DATE}_09_safety-verdict.status`), 'accept\n');
        for (const window of ['after-generate', 'cn-peak', 'overseas-rss']) {
            writeFileSync(
                join(fx.dayDir, `4-publish/outcome.${window}.json`),
                JSON.stringify({
                    schemaVersion: 1,
                    window,
                    runDate: RUN_DATE,
                    status: 'full',
                    published: 2,
                    targets: 2,
                    excluded: [],
                    rows: [],
                }),
            );
        }
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE, '--mode', 'full'], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toMatchObject({ status: 0 });
        const { report } = latestValidationReport(fx);
        expect(report.status).toBe('pass');
        expect(report.checks.find((check) => check.name === 'generation')?.status).toBe('pass');
        expect(report.checks.find((check) => check.name === 'dogfood')?.status).toBe('pass');
        expect(report.checks.find((check) => check.name === 'dogfood')?.detail).toContain('17 pass');
        const dogfoodLaunch = actions(fx).find((args) => args.includes('test'));
        expect(dogfoodLaunch).toContain('--coverage-dir');
        expect(dogfoodLaunch?.[(dogfoodLaunch?.indexOf('--coverage-dir') ?? -1) + 1]).toContain('dogfood-coverage');
        expect(actions(fx).some((args) => args.includes('daily-news:generate'))).toBe(false);
        expect(actions(fx).some((args) => args.includes('daily-news:publish'))).toBe(false);
    }, 120_000);

    it('keeps a live generation failure visible when the offline dogfood passes', async () => {
        const fx = fixture('validation-live-fail-dogfood-pass');
        validationTools(fx, 0);
        await createStore(fx);
        writeFileSync(join(fx.dayDir, 'schedule-receipt.json'), JSON.stringify({ status: 'failed', exitCode: 1 }));
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE, '--mode', 'full'], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect(result.status).toBe(1);
        const { report } = latestValidationReport(fx);
        expect(report.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'generation')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'scheduled-run')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'dogfood')?.status).toBe('pass');
    }, 120_000);

    it('keeps live failure and nonzero dogfood failure independent even with green-looking counts', async () => {
        const fx = fixture('validation-two-failures');
        validationTools(fx, 1);
        await createStore(fx);
        writeFileSync(join(fx.dayDir, 'schedule-receipt.json'), JSON.stringify({ status: 'failed', exitCode: 1 }));
        const result = runCli(fx, ['validate', '--run-date', RUN_DATE, '--mode', 'full'], {
            PATH: `${fx.bin}:/usr/bin:/bin`,
        });
        expect(result.status).toBe(1);
        const { report } = latestValidationReport(fx);
        expect(report.checks.find((check) => check.name === 'generation')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'dogfood')?.status).toBe('fail');
        expect(report.checks.find((check) => check.name === 'dogfood')?.detail).toContain('exited 1');
    }, 120_000);
});
