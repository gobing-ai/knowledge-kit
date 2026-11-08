#!/usr/bin/env bun
/** Daily AI-news operator entries: supervised generation, bundle-safe posting, and read-only diagnosis. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Bundle, PublishOutcome } from '../apps/cli/src/publish-matrix';

const REPO = resolve(import.meta.dir, '..');
const SUPERVISOR = join(REPO, 'plugins/kk/scripts/daily-scheduled-run.ts');
const PUBLISH_LAUNCHER = join(REPO, 'plugins/kk/scripts/voice3-publish-window.ts');
const SUPPLY_REPORT = join(REPO, 'scripts/ai-news-supply-report.ts');
const EXTRACT_PROFILE = join(REPO, 'plugins/kk/decisions/extract/ai-news.yaml');
const DOGFOOD_TEST = 'apps/cli/tests/voice3-migration.e2e.test.ts';
const WINDOWS = new Set(['after-generate', 'cn-peak', 'overseas-rss']);
const USAGE = `usage:
  bun run daily-news:generate [-- <daily-scheduled-run options>]
  bun run daily-news:publish [-- --run-date <YYYY-MM-DD|YYYYMMDD>] [--window <window>] [--yes] [publisher flags]
  bun run daily-news:validate [-- --run-date <YYYY-MM-DD|YYYYMMDD>] [--skip-dogfood]

publish defaults to today's after-generate window. Missing/incomplete generation asks on a TTY;
--yes explicitly consents to generation. Non-TTY runs never generate implicitly.
validate is read-only against live state; dogfood uses the offline voice3 migration rehearsal.`;

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';
type GenerationStatus = 'complete' | 'missing' | 'incomplete' | 'invalid' | 'no-content' | 'running';

interface GenerationInspection {
    status: GenerationStatus;
    reason: string;
    dayDir: string;
}

interface ValidationCheck {
    name: string;
    status: CheckStatus;
    detail: string;
}

interface CapturedRun {
    status: number;
    stdout: string;
    stderr: string;
}

function expandHome(raw: string): string {
    return raw === '~' || raw.startsWith('~/') ? join(homedir(), raw.slice(1)) : raw;
}

function configPath(): string {
    return process.env.KK_CONFIG || join(homedir(), '.config/kk/config.yaml');
}

function readConfig(path: string): Record<string, unknown> {
    const parsed: unknown = Bun.YAML.parse(readFileSync(path, 'utf-8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('expected a YAML mapping');
    return parsed as Record<string, unknown>;
}

/** Match voice3-publish-window: KK_WORKS_DIR > config works_dir > checkout .works. */
function resolveWorksDir(): string {
    const fromEnv = process.env.KK_WORKS_DIR;
    if (fromEnv) return resolve(expandHome(fromEnv));
    const path = configPath();
    if (existsSync(path)) {
        try {
            const configured = readConfig(path).works_dir;
            if (typeof configured === 'string' && configured !== '') return resolve(expandHome(configured));
        } catch {
            // The files check reports malformed config; path resolution still has a safe default.
        }
    }
    return join(REPO, '.works');
}

function normalizeRunDate(raw: string): string | undefined {
    const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(raw.trim());
    if (match === null) return undefined;
    const iso = `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (
        Number.isNaN(parsed.getTime()) ||
        parsed.getUTCFullYear() !== Number(match[1]) ||
        parsed.getUTCMonth() + 1 !== Number(match[2]) ||
        parsed.getUTCDate() !== Number(match[3])
    ) {
        return undefined;
    }
    return iso;
}

function losAngelesDate(offsetDays = 0): string {
    const instant = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(instant);
}

function readOptional(path: string): string | null {
    try {
        return readFileSync(path, 'utf-8').trim();
    } catch {
        return null;
    }
}

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

async function matrixSchemas() {
    return import('../apps/cli/src/publish-matrix');
}

async function inspectGeneration(dayDir: string, runDate: string): Promise<GenerationInspection> {
    const receiptPath = join(dayDir, 'schedule-receipt.json');
    if (existsSync(receiptPath)) {
        try {
            const receipt = readJson(receiptPath) as { status?: unknown };
            if (receipt.status === 'running')
                return { status: 'running', reason: `scheduled run is still running: ${receiptPath}`, dayDir };
        } catch {
            // A malformed receipt cannot make an otherwise invalid bundle publishable.
        }
    }
    const summary = readOptional(join(dayDir, 'run-report.summary.txt'));
    if (summary?.startsWith('no-content:'))
        return { status: 'no-content', reason: `generation closed with no content: ${summary}`, dayDir };

    const bundlePath = join(dayDir, 'bundle.json');
    if (!existsSync(bundlePath)) return { status: 'missing', reason: `no generation bundle at ${bundlePath}`, dayDir };
    let raw: unknown;
    try {
        raw = readJson(bundlePath);
    } catch {
        return { status: 'invalid', reason: `unreadable generation bundle at ${bundlePath}`, dayDir };
    }
    const { BundleSchema } = await matrixSchemas();
    const parsed = BundleSchema.safeParse(raw);
    if (!parsed.success)
        return {
            status: 'invalid',
            reason: `invalid generation bundle at ${bundlePath}: ${parsed.error.message}`,
            dayDir,
        };
    const bundle: Bundle = parsed.data;
    const bundleDate = normalizeRunDate(bundle.runDate);
    if (bundleDate !== runDate) {
        return {
            status: 'invalid',
            reason: `bundle at ${bundlePath} is dated ${bundleDate ?? 'unknown'}, not the requested ${runDate}`,
            dayDir,
        };
    }

    const variantEntries = Object.entries(bundle.variants);
    if (variantEntries.length === 0) return { status: 'invalid', reason: 'bundle has no publishable variants', dayDir };
    if (bundle.safety === undefined)
        return { status: 'invalid', reason: 'bundle has no final-variant safety evidence', dayDir };

    for (const [key, variant] of variantEntries) {
        const variantPath = resolve(dayDir, variant.path);
        const rel = relative(dayDir, variantPath);
        if (rel.startsWith('..') || isAbsolute(rel))
            return { status: 'invalid', reason: `variant '${key}' escapes the generation directory`, dayDir };
        if (!existsSync(variantPath))
            return { status: 'invalid', reason: `variant '${key}' is missing at ${variantPath}`, dayDir };
        const sha256 = createHash('sha256').update(readFileSync(variantPath)).digest('hex');
        if (sha256 !== variant.sha256)
            return { status: 'invalid', reason: `variant '${key}' sha256 mismatch at ${variantPath}`, dayDir };
        if (bundle.safety.variants[key] !== sha256)
            return { status: 'invalid', reason: `variant '${key}' has a safety digest mismatch`, dayDir };
    }
    return { status: 'complete', reason: `valid frozen bundle at ${bundlePath}`, dayDir };
}

function runInherited(command: string, args: string[], env?: Record<string, string>): number {
    const result = spawnSync(command, args, {
        cwd: REPO,
        env: { ...process.env, ...env },
        stdio: 'inherit',
    });
    if (result.error) console.error(`daily-ai-news: ${command} failed to start: ${result.error.message}`);
    return result.status ?? 1;
}

function runCaptured(command: string, args: string[], timeout = 120_000): CapturedRun {
    const result = spawnSync(command, args, {
        cwd: REPO,
        env: { ...process.env, NODE_ENV: 'test' },
        encoding: 'utf-8',
        timeout,
        maxBuffer: 50 * 1024 * 1024,
    });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.error ? `${result.stderr ?? ''}\n${result.error.message}` : (result.stderr ?? ''),
    };
}

function generate(args: string[]): number {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return 0;
    }
    return runInherited(
        'bun',
        [
            SUPERVISOR,
            '--repo',
            REPO,
            '--works-dir',
            resolveWorksDir(),
            '--workflow',
            'kk-daily-ai-voice3',
            '--generate-only',
            '--window',
            '72h',
            '--agent',
            'codex-sol',
            '--retry-agent',
            'claude',
            ...args,
        ],
        { KK_BROWSER_CHANNEL: process.env.KK_BROWSER_CHANNEL ?? 'chrome' },
    );
}

function valueAfter(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    return value;
}

async function inspectCommand(args: string[]): Promise<number> {
    const workDir = valueAfter(args, '--work-dir');
    if (workDir === undefined) throw new Error('inspect requires --work-dir <dir>');
    const rawDate = valueAfter(args, '--run-date') ?? readOptional(join(workDir, 'run-date.txt')) ?? losAngelesDate();
    const runDate = normalizeRunDate(rawDate);
    if (runDate === undefined) throw new Error(`'${rawDate}' is not a valid calendar day`);
    const inspection = await inspectGeneration(resolve(workDir), runDate);
    console.log(JSON.stringify({ status: inspection.status, reason: inspection.reason, workDir: inspection.dayDir }));
    return inspection.status === 'complete' ? 0 : 1;
}

async function confirmGeneration(runDate: string, reason: string): Promise<boolean> {
    if (process.stdin.isTTY !== true) {
        console.error(
            `daily-ai-news: generation for ${runDate} is incomplete (${reason}).\n` +
                'Run `bun run daily-news:generate` first, or rerun publish on a TTY and accept generation.',
        );
        return false;
    }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await prompt.question(
            `Generation for ${runDate} is incomplete (${reason}). Generate it now? [y/N] `,
        );
        return /^(y|yes)$/i.test(answer.trim());
    } finally {
        prompt.close();
    }
}

async function publish(args: string[]): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return 0;
    }
    const window = valueAfter(args, '--window') ?? 'after-generate';
    if (!WINDOWS.has(window)) throw new Error(`--window must be one of ${[...WINDOWS].join('|')}`);
    const rawDate = valueAfter(args, '--run-date') ?? losAngelesDate(window === 'overseas-rss' ? -1 : 0);
    const runDate = normalizeRunDate(rawDate);
    if (runDate === undefined) throw new Error(`'${rawDate}' is not a valid calendar day`);
    if (args.includes('--work-dir'))
        throw new Error('--work-dir is not supported; use KK_WORKS_DIR so generation and publishing share one root');
    const yes = args.includes('--yes');
    const forwarded = args.filter(
        (arg, index) =>
            arg !== '--yes' &&
            arg !== '--window' &&
            arg !== '--run-date' &&
            args[index - 1] !== '--window' &&
            args[index - 1] !== '--run-date',
    );
    const dayDir = join(resolveWorksDir(), 'kk-daily-ai-voice2', runDate.replaceAll('-', ''));
    let inspection = await inspectGeneration(dayDir, runDate);
    if (inspection.status !== 'complete') {
        if (inspection.status === 'invalid') {
            console.error(
                `daily-ai-news: refusing to regenerate or post an invalid existing bundle: ${inspection.reason}`,
            );
            return 1;
        }
        if (inspection.status === 'running' || inspection.status === 'no-content') {
            console.error(`daily-ai-news: ${inspection.reason}`);
            return 1;
        }
        if (runDate !== losAngelesDate()) {
            console.error(
                `daily-ai-news: ${inspection.reason}.\n` +
                    `Automatic generation is available only for today (${losAngelesDate()}); refusing to substitute another day.`,
            );
            return 1;
        }
        const accepted = yes || (await confirmGeneration(runDate, inspection.reason));
        if (!accepted) {
            if (yes) console.error(`daily-ai-news: generation was not accepted; nothing was posted.`);
            return 1;
        }
        const generated = runInherited('bun', ['run', 'daily-news:generate']);
        if (generated !== 0) {
            console.error(`daily-ai-news: generation exited ${generated}; nothing was posted.`);
            return generated;
        }
        inspection = await inspectGeneration(dayDir, runDate);
        if (inspection.status !== 'complete') {
            console.error(`daily-ai-news: generation is still not publishable: ${inspection.reason}`);
            return 1;
        }
    }
    return runInherited('bun', [PUBLISH_LAUNCHER, '--window', window, '--run-date', runDate, ...forwarded]);
}

function evidenceDirectory(worksDir: string): string {
    const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
    const dir = join(worksDir, 'tmp/test-daily-ai-news', `${stamp}-${process.pid}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

async function validate(args: string[]): Promise<number> {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return 0;
    }
    const rawDate = valueAfter(args, '--run-date') ?? losAngelesDate();
    const runDate = normalizeRunDate(rawDate);
    if (runDate === undefined) throw new Error(`'${rawDate}' is not a valid calendar day`);
    const unknown = args.filter(
        (arg, index) => arg !== '--skip-dogfood' && arg !== '--run-date' && args[index - 1] !== '--run-date',
    );
    if (unknown.length > 0) throw new Error(`unknown validation argument(s): ${unknown.join(', ')}`);
    const skipDogfood = args.includes('--skip-dogfood');
    const worksDir = resolveWorksDir();
    const digits = runDate.replaceAll('-', '');
    const dayDir = join(worksDir, 'kk-daily-ai-voice2', digits);
    const evidence = evidenceDirectory(worksDir);
    const checks: ValidationCheck[] = [];
    const add = (name: string, status: CheckStatus, detail: string) => {
        checks.push({ name, status, detail });
        console.log(`[${status.toUpperCase()}] ${name} — ${detail}`);
    };

    const requiredTools = ['spur', 'kk', 'jq', 'ffmpeg', 'ffprobe', 'python3'];
    const missingTools = requiredTools.filter((tool) => spawnSync('which', [tool], { stdio: 'ignore' }).status !== 0);
    add(
        'tools',
        missingTools.length === 0 ? 'pass' : 'fail',
        missingTools.length === 0
            ? `bun plus ${requiredTools.join(', ')} are on PATH`
            : `missing from PATH: ${missingTools.join(', ')}`,
    );

    const requiredFiles = [
        configPath(),
        join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice3.yaml'),
        join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml'),
        join(REPO, 'plugins/kk/workflows/kk-daily-publish3.yaml'),
        join(REPO, 'plugins/kk/publish-presets/daily-ai-voice.json'),
        EXTRACT_PROFILE,
        SUPERVISOR,
        PUBLISH_LAUNCHER,
        join(REPO, DOGFOOD_TEST),
    ];
    const missingFiles = requiredFiles.filter((path) => !existsSync(path));
    add(
        'required-files',
        missingFiles.length === 0 ? 'pass' : 'fail',
        missingFiles.length === 0
            ? `${requiredFiles.length} workflow/config/launcher files exist`
            : missingFiles.join(', '),
    );

    const preflight = runCaptured('kk', [
        'stage',
        'daily-preflight',
        'plugins/kk/workflows/kk-daily-ai-voice2.yaml',
        'plugins/kk/workflows/kk-daily-safety.yaml',
        'plugins/kk/workflows/kk-daily-publish3.yaml',
    ]);
    writeFileSync(join(evidence, 'stage-preflight.log'), `${preflight.stdout}${preflight.stderr}`);
    add(
        'installed-stage-preflight',
        preflight.status === 0 ? 'pass' : 'fail',
        preflight.status === 0
            ? 'the installed kk runner recognizes every required daily stage'
            : `kk stage daily-preflight exited ${preflight.status}; see stage-preflight.log`,
    );

    try {
        const config = readConfig(configPath());
        const store = (config.store ?? {}) as { db_path?: unknown };
        const configuredDb = typeof store.db_path === 'string' && store.db_path !== '' ? store.db_path : '.works/kk.db';
        const expanded = expandHome(configuredDb);
        const dbPath = isAbsolute(expanded) ? expanded : resolve(REPO, expanded);
        if (!existsSync(dbPath)) {
            add('store-supply', 'fail', `store does not exist: ${dbPath}`);
        } else {
            const supply = runCaptured(process.execPath, [
                SUPPLY_REPORT,
                '--db',
                dbPath,
                '--config',
                configPath(),
                '--profile',
                EXTRACT_PROFILE,
                '--at',
                new Date().toISOString(),
            ]);
            writeFileSync(join(evidence, 'supply-report.log'), `${supply.stdout}${supply.stderr}`);
            if (supply.status !== 0) {
                add('store-supply', 'fail', `read-only supply report exited ${supply.status}; see supply-report.log`);
            } else {
                const report = JSON.parse(supply.stdout) as {
                    windows?: { hours?: number; gates?: { name?: string; stories?: number }[] }[];
                };
                // Production voice3 extracts 72h (design §8); the widest window is not what the run sees.
                const latest = report.windows?.find((window) => window.hours === 72) ?? report.windows?.at(-1);
                const eligible = latest?.gates?.find((gate) => gate.name === 'reservationExclusion')?.stories;
                writeFileSync(join(evidence, 'supply-report.json'), supply.stdout);
                add(
                    'store-supply',
                    'pass',
                    `read-only supply gate report completed; ${latest?.hours ?? '?'}h window has ${eligible ?? '?'} eligible stories`,
                );
            }
        }
    } catch (error) {
        add('store-supply', 'fail', error instanceof Error ? error.message : String(error));
    }

    let schedulerReady = false;
    try {
        const config = readConfig(join(REPO, '.spur/config.yaml'));
        const bootstrap = (config.bootstrap ?? {}) as {
            scheduler?: {
                enabled?: unknown;
                jobs?: { name?: unknown; cron?: unknown; command?: unknown }[];
            };
        };
        const scheduler = bootstrap.scheduler ?? {};
        const jobs = Array.isArray(scheduler.jobs) ? scheduler.jobs : [];
        const daily = jobs.find((job) => job.name === 'kk-daily-ai-voice');
        const publishJob = jobs.find((job) => job.name === 'kk-daily-publish3');
        const dailyCommand = typeof daily?.command === 'string' ? daily.command : '';
        const publishCommand = typeof publishJob?.command === 'string' ? publishJob.command : '';
        const activeWindowLine = (window: string): boolean => {
            const path = join(
                REPO,
                `plugins/kk/schedules/kk-daily-publish3-${window === 'cn-peak' ? 'cn-peak' : 'overseas'}.cron.tmpl`,
            );
            return (readOptional(path) ?? '').split('\n').some((line) => {
                const active = line.trim();
                return (
                    active !== '' &&
                    !active.startsWith('#') &&
                    active.includes('voice3-publish-window.ts') &&
                    active.includes(`--window ${window}`)
                );
            });
        };
        schedulerReady =
            scheduler.enabled === true &&
            daily?.cron === '30 4 * * *' &&
            dailyCommand.includes('daily-scheduled-run.ts') &&
            dailyCommand.includes('--workflow kk-daily-ai-voice3') &&
            dailyCommand.includes('--window 72h') &&
            !dailyCommand.includes('--generate-only') &&
            publishJob?.cron === '0 7 * * *' &&
            publishCommand.includes('voice3-publish-window.ts --window overseas-rss') &&
            activeWindowLine('cn-peak') &&
            activeWindowLine('overseas-rss');
    } catch {
        schedulerReady = false;
    }
    add(
        'scheduler-config',
        schedulerReady ? 'pass' : 'fail',
        schedulerReady
            ? 'enabled voice3 72h daily and overseas jobs plus active cn-peak/overseas templates are wired'
            : 'enabled voice3 72h daily/overseas jobs or an active cn-peak/overseas template is missing',
    );

    const generation = await inspectGeneration(dayDir, runDate);
    add(
        'generation',
        generation.status === 'complete' ? 'pass' : generation.status === 'no-content' ? 'warn' : 'fail',
        generation.reason,
    );
    const receiptPath = join(dayDir, 'schedule-receipt.json');
    if (!existsSync(receiptPath)) {
        add('scheduled-run', 'warn', `no scheduler receipt at ${receiptPath}`);
    } else {
        try {
            const receipt = readJson(receiptPath) as { status?: unknown; exitCode?: unknown };
            const status = typeof receipt.status === 'string' ? receipt.status : 'unknown';
            const receiptDone = status === 'done' && receipt.exitCode === 0;
            add(
                'scheduled-run',
                receiptDone ? 'pass' : status === 'no-content' || status === 'running' ? 'warn' : 'fail',
                `receipt status=${status}, exitCode=${String(receipt.exitCode ?? '?')}: ${receiptPath}`,
            );
        } catch {
            add('scheduled-run', 'fail', `unreadable scheduler receipt at ${receiptPath}`);
        }
    }

    const draftSafetyPath = join(dayDir, `24-script/${digits}_09_safety-verdict.status`);
    const draftSafety = readOptional(draftSafetyPath);
    add(
        'draft-safety',
        draftSafety === 'accept' ? 'pass' : draftSafety === null ? 'warn' : 'fail',
        draftSafety === null ? `no draft safety verdict at ${draftSafetyPath}` : `draft safety verdict=${draftSafety}`,
    );

    const { PublishOutcomeSchema } = await matrixSchemas();
    for (const window of WINDOWS) {
        const outcomePath = join(dayDir, `4-publish/outcome.${window}.json`);
        if (!existsSync(outcomePath)) {
            add(`publish:${window}`, 'warn', `no outcome yet at ${outcomePath}`);
            continue;
        }
        try {
            const parsed = PublishOutcomeSchema.safeParse(readJson(outcomePath));
            if (!parsed.success) {
                add(`publish:${window}`, 'fail', `malformed outcome at ${outcomePath}: ${parsed.error.message}`);
                continue;
            }
            const outcome: PublishOutcome = parsed.data;
            if (outcome.window !== window) {
                add(`publish:${window}`, 'fail', `outcome window is ${outcome.window}, not ${window}`);
            } else if (normalizeRunDate(outcome.runDate) !== runDate) {
                add(`publish:${window}`, 'fail', `outcome is dated ${outcome.runDate}, not ${runDate}`);
            } else {
                add(
                    `publish:${window}`,
                    outcome.status === 'full' || outcome.status === 'dummy' ? 'pass' : 'fail',
                    `status=${outcome.status}, published=${outcome.published}/${outcome.targets}: ${outcomePath}`,
                );
            }
        } catch (error) {
            add(`publish:${window}`, 'fail', error instanceof Error ? error.message : String(error));
        }
    }

    if (skipDogfood) {
        add('dogfood', 'skipped', '--skip-dogfood supplied; no test process started');
    } else {
        const dogfood = runCaptured(
            'bun',
            ['test', '--dots', '--coverage-dir', join(evidence, 'dogfood-coverage'), DOGFOOD_TEST],
            1_200_000,
        );
        writeFileSync(join(evidence, 'dogfood.log'), `${dogfood.stdout}${dogfood.stderr}`);
        const testOutput = `${dogfood.stdout}\n${dogfood.stderr}`;
        const pass = /(\d+) pass/.exec(testOutput)?.[1];
        const fail = /(\d+) fail/.exec(testOutput)?.[1];
        const testsPassed = dogfood.status === 0 && pass !== undefined && Number(pass) > 0 && fail === '0';
        add(
            'dogfood',
            testsPassed ? 'pass' : 'fail',
            testsPassed
                ? `${pass} pass, ${fail} fail; see dogfood.log`
                : `dogfood exited ${dogfood.status} with ${pass ?? '?'} pass / ${fail ?? '?'} fail; see dogfood.log`,
        );
    }

    const status = checks.some((check) => check.status === 'fail')
        ? 'fail'
        : checks.some((check) => check.status === 'warn')
          ? 'warn'
          : 'pass';
    const reportPath = join(evidence, 'validation.json');
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runDate,
        worksDir,
        status,
        checks,
        evidence: {
            directory: evidence,
            offlineRehearsalSummary: join(REPO, '.works/tmp/test-voice3-migration/0335/summary.json'),
        },
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`daily-ai-news validation ${status.toUpperCase()}: ${reportPath}`);
    return status === 'fail' ? 1 : 0;
}

async function main(): Promise<number> {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'generate') return generate(args);
    if (command === 'publish') return publish(args);
    if (command === 'inspect') return inspectCommand(args);
    if (command === 'validate') return validate(args);
    console.log(USAGE);
    return command === undefined || command === '--help' || command === '-h' ? 0 : 1;
}

try {
    process.exitCode = await main();
} catch (error) {
    console.error(`daily-ai-news: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
