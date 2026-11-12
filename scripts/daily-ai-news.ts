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
// Production posture of the two scheduled jobs in .spur/config.yaml (2026-11-12
// consolidation): `generate --full` IS the 04:30 kk-daily-ai-voice job and
// `publish --window overseas-rss --unattended` IS the 07:00 kk-daily-publish3 job, so
// cron and a local run of the same command share one flag definition.
// --window 72h (2026-11-05): the 24h pool produced a 8.4-min script and the 15-min
// floor refused before TTS (duration-refusal); pinned until ingest bodies or label
// quality widen the fresh pool.
// Executor pair: retry stays a DIFFERENT binary family (2026-11-04 — spur's readiness
// gate SIGTERMs a stalled `<agent> --version` after 5s, so a same-binary retry re-hits
// the same stall); 2026-11-08 primary was pi-dsv4.1-flash-volc; 2026-11-10 volc's quota
// died mid-run (AccountQuotaExceeded) with the claude retry weekly-limit-dead, so
// primary repointed to pi-deepseek (kin to the validated volc executor) and retry to
// agy-gemini (different binary family, probe-passed). The 0347 F1 preflight probes both
// before spending the window; re-evaluate when volc resets.
const PRODUCTION = {
    agent: 'pi-deepseek',
    retryAgent: 'agy-gemini',
    workflow: 'kk-daily-ai-voice3',
    window: '72h',
} as const;
const USAGE = `usage:
  bun run daily-news:generate [--full] [--agent <role|executor>] [--retry-agent <role|executor>] [-- <daily-scheduled-run options>]
  bun run daily-news:publish [-- --run-date <YYYY-MM-DD|YYYYMMDD>] [--window <window>] [--unattended] [--yes] [publisher flags]
  bun run daily-news:validate [-- --run-date <YYYY-MM-DD|YYYYMMDD>] [--mode quick|full] [--skip-dogfood]

generate defaults to the supervised shadow posture: generate-only (auto_publish=false) over the
72h pool; --agent/--retry-agent default to the 'planner' role (capable-2, tier-resolved at
dispatch — no pinned model) and accept a role or a named executor to override. Explicit executor
names are resolved with a one-time transition warning (0542 R2). --full is the 04:30 scheduled
posture: the whole voice3 workflow with auto_publish=true and the production pair
(pi-deepseek + agy-gemini); per-dispatch overrides still win (last flag wins).
publish defaults to today's after-generate window. Missing/incomplete generation asks on a TTY;
--yes explicitly consents to generation. Non-TTY runs never generate implicitly. --unattended is
the 07:00 scheduled posture (kk-daily-publish3): today's voice3 receipt gates a full production
regeneration (done/no-content/incomplete/running skip; missing/hard-failed re-run), then the
window launcher runs without any prompt — bundle admission stays with the launcher.
validate defaults to quick file-readiness checks and prints a per-part generation breakdown (run,
plan, article, cover, script, safety, audio, bundle, publish windows, channels — each done, failed,
partial, not-started, running, or no-content). --mode full runs live read-only diagnosis;
dogfood uses the offline voice3 migration rehearsal.`;

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

type PartState = 'done' | 'failed' | 'partial' | 'not-started' | 'running' | 'no-content';

interface GenerationPart {
    part: string;
    state: PartState;
    detail: string;
}

interface ReceiptForParts {
    status?: unknown;
    exitCode?: unknown;
    channelCompleteness?: unknown;
    triage?: { failedNode?: { id?: unknown; stderrTail?: unknown } };
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

function buildGenerateArgv(full: boolean, overrides: string[]): string[] {
    return [
        SUPERVISOR,
        '--repo',
        REPO,
        '--works-dir',
        resolveWorksDir(),
        '--workflow',
        PRODUCTION.workflow,
        '--window',
        PRODUCTION.window,
        // Shadow posture (default): roles, not executor names (ADR-078 / 0542 R2) —
        // planner = capable-2 authoring grade, tier-resolved at dispatch, so a quota-dead
        // model never pins a supervised run. The full posture pins the production pair
        // and drops --generate-only (auto_publish=true); forwarded args below still
        // override per dispatch (parseArgs is last-wins).
        ...(full ? [] : ['--generate-only']),
        '--agent',
        full ? PRODUCTION.agent : 'planner',
        '--retry-agent',
        full ? PRODUCTION.retryAgent : 'planner',
        ...overrides,
    ];
}

function browserEnv(): Record<string, string> {
    return { KK_BROWSER_CHANNEL: process.env.KK_BROWSER_CHANNEL ?? 'chrome' };
}

function generate(args: string[]): number {
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        return 0;
    }
    // --full runs the whole voice3 workflow (auto_publish=true) in the production
    // posture; without it the run stays generate-only (auto_publish=false).
    const full = args.includes('--full');
    const forwarded = args.filter((arg) => arg !== '--full');
    return runInherited('bun', buildGenerateArgv(full, forwarded), browserEnv());
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
    const unattended = args.includes('--unattended');
    const forwarded = args.filter(
        (arg, index) =>
            arg !== '--yes' &&
            arg !== '--unattended' &&
            args[index - 1] !== '--window' &&
            args[index - 1] !== '--run-date',
    );
    if (unattended) {
        // The 07:00 scheduled posture (kk-daily-publish3): the receipt, not the bundle,
        // gates regeneration — done|no-content|incomplete|running skip (a 'running' 04:30
        // job may legally still be executing and owns the store lock), anything else
        // (missing/hard-failed/garbage) re-runs the full voice3 workflow with the same
        // production flags as the 04:30 job (one definition: buildGenerateArgv(true)).
        // Bundle admission stays with the window launcher, exactly as in the shell this
        // replaced.
        const stamp = losAngelesDate().replaceAll('-', '');
        const receiptPath = join(resolveWorksDir(), 'kk-daily-ai-voice2', stamp, 'schedule-receipt.json');
        let status = 'missing';
        try {
            const parsed = JSON.parse(readFileSync(receiptPath, 'utf-8')) as { status?: unknown };
            if (typeof parsed.status === 'string') status = parsed.status;
        } catch {
            // A missing or unreadable receipt regenerates, like the former jq fallback.
        }
        const regen = !['done', 'no-content', 'incomplete', 'running'].includes(status);
        console.log(
            `daily-ai-news: voice3 receipt status=${status}${regen ? '; re-running generation with the 04:30 production flags' : ''}`,
        );
        if (regen) {
            const generated = runInherited('bun', buildGenerateArgv(true, []), browserEnv());
            if (generated !== 0) {
                console.error(`daily-ai-news: generation re-run exited ${generated}; skipping the ${window} window.`);
                return generated;
            }
        }
        return runInherited('bun', [PUBLISH_LAUNCHER, '--window', window, '--run-date', runDate, ...forwarded]);
    }
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

function generationFilesMissing(dayDir: string): string[] {
    const bundlePath = join(dayDir, 'bundle.json');
    if (!existsSync(bundlePath)) return [bundlePath];
    try {
        const raw = readJson(bundlePath);
        const variants =
            raw !== null && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as { variants?: unknown }).variants
                : undefined;
        if (variants === null || typeof variants !== 'object' || Array.isArray(variants)) {
            return [`${bundlePath}: no declared variant file map`];
        }
        const entries = Object.entries(variants as Record<string, unknown>);
        if (entries.length === 0) return [`${bundlePath}: no declared variant files`];
        const missing: string[] = [];
        for (const [key, value] of entries) {
            const path =
                value !== null && typeof value === 'object' && !Array.isArray(value)
                    ? (value as { path?: unknown }).path
                    : undefined;
            if (typeof path !== 'string' || path === '') {
                missing.push(`${bundlePath}: variant '${key}' has no file path`);
                continue;
            }
            const variantPath = resolve(dayDir, path);
            const rel = relative(dayDir, variantPath);
            if (rel.startsWith('..') || isAbsolute(rel)) {
                missing.push(`${bundlePath}: variant '${key}' escapes the generation directory`);
            } else if (!existsSync(variantPath)) {
                missing.push(variantPath);
            }
        }
        return missing;
    } catch {
        return [`${bundlePath}: unreadable JSON`];
    }
}

function startedSteps(dayDir: string): Set<string> {
    const steps = new Set<string>();
    try {
        for (const line of readFileSync(join(dayDir, 'step-timing.json'), 'utf-8').split('\n')) {
            if (line.trim() === '') continue;
            const parsed = JSON.parse(line) as { step?: unknown };
            if (typeof parsed.step === 'string') steps.add(parsed.step);
        }
    } catch {
        // No timing file: artifact presence alone decides the part state.
    }
    return steps;
}

// The voice3 user-visible products, in pipeline order. The `_NN_` node prefixes are the
// workflow's stable stage numbers (the same convention validate already uses for the
// safety verdict and 31-publish receipts).
const PART_ARTIFACTS = [
    {
        part: 'plan',
        path: (stamp: string) => `21-plan/${stamp}_04_quality-control-content_candidates.json`,
        step: 'plan',
    },
    { part: 'article', path: (stamp: string) => `22-article/${stamp}_06_article_article.md`, step: 'article' },
    { part: 'cover', path: (stamp: string) => `23-cover/${stamp}_07_cover_cover.png`, step: 'cover' },
    { part: 'script', path: (stamp: string) => `24-script/${stamp}_08_script_content.json`, step: 'script' },
];

/** Per-part generation state: done / failed / partial / not-started / running / no-content. */
async function inspectParts(dayDir: string, runDate: string, mode: 'quick' | 'full'): Promise<GenerationPart[]> {
    const digits = runDate.replaceAll('-', '');
    const parts: GenerationPart[] = [];
    const steps = startedSteps(dayDir);

    let receipt: ReceiptForParts | undefined;
    if (existsSync(join(dayDir, 'schedule-receipt.json'))) {
        try {
            receipt = readJson(join(dayDir, 'schedule-receipt.json')) as ReceiptForParts;
        } catch {
            parts.push({
                part: 'run',
                state: 'failed',
                detail: 'unreadable scheduler receipt at schedule-receipt.json',
            });
        }
    }
    if (receipt === undefined && !parts.some((part) => part.part === 'run')) {
        parts.push({
            part: 'run',
            state: 'not-started',
            detail: 'no scheduler receipt; no scheduled generation has run today',
        });
    } else if (receipt !== undefined) {
        const status = typeof receipt.status === 'string' ? receipt.status : 'unknown';
        const failedNode = receipt.triage?.failedNode;
        const tail =
            typeof failedNode?.stderrTail === 'string'
                ? failedNode.stderrTail.replaceAll('\n', ' ').trim().slice(0, 140)
                : '';
        const hint =
            typeof failedNode?.id === 'string'
                ? `; failed node ${failedNode.id}${tail === '' ? '' : ` — ${tail}`}`
                : '';
        const state: PartState =
            status === 'done'
                ? 'done'
                : status === 'no-content'
                  ? 'no-content'
                  : status === 'running'
                    ? 'running'
                    : status === 'incomplete'
                      ? 'partial'
                      : 'failed';
        parts.push({
            part: 'run',
            state,
            detail: `receipt status=${status}, exitCode=${String(receipt.exitCode ?? '?')}${state === 'failed' ? hint : ''}`,
        });
    }

    for (const { part, path, step } of PART_ARTIFACTS) {
        const rel = path(digits);
        if (existsSync(join(dayDir, rel))) parts.push({ part, state: 'done', detail: rel });
        else if (steps.has(step))
            parts.push({ part, state: 'failed', detail: `${step} ran but left no artifact at ${rel}` });
        else parts.push({ part, state: 'not-started', detail: `no ${step} step, no artifact at ${rel}` });
    }

    const verdictRel = `24-script/${digits}_09_safety-verdict.status`;
    const verdict = readOptional(join(dayDir, verdictRel))?.trim();
    if (verdict === 'accept') parts.push({ part: 'safety', state: 'done', detail: `verdict=accept (${verdictRel})` });
    else if (verdict) parts.push({ part: 'safety', state: 'failed', detail: `verdict=${verdict} (${verdictRel})` });
    else if (steps.has('safety-review') || steps.has('safety-verdict-check'))
        parts.push({ part: 'safety', state: 'failed', detail: `safety ran but left no verdict at ${verdictRel}` });
    else parts.push({ part: 'safety', state: 'not-started', detail: `no safety step, no verdict at ${verdictRel}` });

    const audioRel = `30-audio/${digits}_11_generate_content.mp3`;
    if (existsSync(join(dayDir, audioRel))) {
        let detail = audioRel;
        try {
            const measured = (
                readJson(join(dayDir, `30-audio/${digits}_11_generate_content_duration.json`)) as {
                    measuredMinutes?: unknown;
                }
            ).measuredMinutes;
            if (typeof measured === 'number') detail += ` (~${measured} min)`;
        } catch {
            // Duration probe is optional garnish on a done part.
        }
        parts.push({ part: 'audio', state: 'done', detail });
    } else if (steps.has('generate') || steps.has('intro-music'))
        parts.push({ part: 'audio', state: 'failed', detail: `TTS ran but left no episode at ${audioRel}` });
    else parts.push({ part: 'audio', state: 'not-started', detail: `no TTS step, no episode at ${audioRel}` });

    if (mode === 'quick') {
        // Quick stays presence-only for quality (hash/safety/schema belongs to explicit full mode);
        // the no-content marker and artifact presence are still honest there.
        const summary = readOptional(join(dayDir, 'run-report.summary.txt')) ?? '';
        const noContent = summary.startsWith('no-content:');
        const bundleStarted = steps.has('bundle-variants') || steps.has('safety-manifest');
        const hasBundle = existsSync(join(dayDir, 'bundle.json'));
        parts.push({
            part: 'bundle',
            state: noContent ? 'no-content' : hasBundle ? 'done' : bundleStarted ? 'failed' : 'not-started',
            detail: noContent
                ? summary.trim()
                : hasBundle
                  ? 'bundle.json present (hash/safety/schema verified in --mode full)'
                  : bundleStarted
                    ? 'bundling ran but left no bundle.json'
                    : 'no generation bundle (bundle.json absent)',
        });
    } else {
        const inspection = await inspectGeneration(dayDir, runDate);
        if (inspection.status === 'complete') parts.push({ part: 'bundle', state: 'done', detail: inspection.reason });
        else if (inspection.status === 'missing')
            parts.push({
                part: 'bundle',
                state: steps.has('bundle-variants') || steps.has('safety-manifest') ? 'failed' : 'not-started',
                detail: inspection.reason,
            });
        else if (inspection.status === 'running')
            parts.push({ part: 'bundle', state: 'running', detail: inspection.reason });
        else if (inspection.status === 'no-content')
            parts.push({ part: 'bundle', state: 'no-content', detail: inspection.reason });
        else parts.push({ part: 'bundle', state: 'failed', detail: inspection.reason });
    }

    const { PublishOutcomeSchema } = await matrixSchemas();
    for (const window of WINDOWS) {
        const rel = `4-publish/outcome.${window}.json`;
        if (!existsSync(join(dayDir, rel))) {
            parts.push({ part: `publish:${window}`, state: 'not-started', detail: `no outcome yet at ${rel}` });
            continue;
        }
        try {
            const parsed = PublishOutcomeSchema.safeParse(readJson(join(dayDir, rel)));
            if (!parsed.success) {
                parts.push({ part: `publish:${window}`, state: 'failed', detail: `malformed outcome at ${rel}` });
                continue;
            }
            const outcome: PublishOutcome = parsed.data;
            const state: PartState =
                outcome.status === 'full' || outcome.status === 'dummy'
                    ? 'done'
                    : outcome.status === 'partial'
                      ? 'partial'
                      : 'failed';
            parts.push({
                part: `publish:${window}`,
                state,
                detail: `status=${outcome.status}, published=${outcome.published}/${outcome.targets} (${rel})`,
            });
        } catch {
            parts.push({ part: `publish:${window}`, state: 'failed', detail: `unreadable outcome at ${rel}` });
        }
    }

    const rows = Array.isArray(receipt?.channelCompleteness)
        ? (receipt.channelCompleteness as { channel?: unknown; state?: unknown; required?: unknown; dummy?: unknown }[])
        : [];
    const required = rows.filter(
        (row) => row.required === true && row.dummy !== true && typeof row.channel === 'string',
    );
    if (receipt === undefined) parts.push({ part: 'channels', state: 'not-started', detail: 'no scheduler receipt' });
    else if (required.length === 0)
        parts.push({ part: 'channels', state: 'not-started', detail: 'no required channel rows in the receipt' });
    else {
        const notDone = required.filter((row) => row.state !== 'done');
        parts.push({
            part: 'channels',
            state: notDone.length === 0 ? 'done' : 'partial',
            detail:
                notDone.length === 0
                    ? `${required.length} required channels delivered`
                    : `not delivered: ${notDone.map((row) => `${row.channel}=${String(row.state)}`).join(', ')}`,
        });
    }

    return parts;
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
    const mode = valueAfter(args, '--mode') ?? 'quick';
    if (mode !== 'quick' && mode !== 'full') throw new Error(`--mode must be quick or full, got '${mode}'`);
    const unknown = args.filter(
        (arg, index) =>
            arg !== '--skip-dogfood' &&
            arg !== '--run-date' &&
            arg !== '--mode' &&
            args[index - 1] !== '--run-date' &&
            args[index - 1] !== '--mode',
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
    const parts = await inspectParts(dayDir, runDate, mode);
    console.log(`generation parts for ${runDate} in ${dayDir}:`);
    for (const part of parts) console.log(`  [${part.state.toUpperCase()}] ${part.part} — ${part.detail}`);
    const failedParts = parts.filter((part) => part.state === 'failed');
    add(
        'generation-parts',
        failedParts.length > 0
            ? 'fail'
            : parts.some((part) => part.state === 'partial' || part.state === 'no-content')
              ? 'warn'
              : 'pass',
        `${
            ['done', 'failed', 'partial', 'no-content', 'running', 'not-started']
                .map((state) => [state, parts.filter((part) => part.state === state).length] as const)
                .filter(([, count]) => count > 0)
                .map(([state, count]) => `${count} ${state}`)
                .join(', ') || 'no parts'
        }${failedParts.length > 0 ? `; failed: ${failedParts.map((part) => part.part).join(', ')}` : ''}`,
    );
    const finish = (): number => {
        const status = checks.some((check) => check.status === 'fail')
            ? 'fail'
            : checks.some((check) => check.status === 'warn')
              ? 'warn'
              : 'pass';
        const reportPath = join(evidence, 'validation.json');
        const report = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            mode,
            runDate,
            worksDir,
            status,
            checks,
            parts,
            evidence: {
                directory: evidence,
                ...(mode === 'full'
                    ? { offlineRehearsalSummary: join(REPO, '.works/tmp/test-voice3-migration/0335/summary.json') }
                    : {}),
            },
        };
        writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
        console.log(
            `daily-ai-news ${mode === 'quick' ? 'quick check' : 'validation'} ${status.toUpperCase()}: ${reportPath}`,
        );
        return status === 'fail' ? 1 : 0;
    };

    const requiredFiles = [
        configPath(),
        join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice3.yaml'),
        join(REPO, 'plugins/kk/workflows/kk-daily-safety.yaml'),
        join(REPO, 'plugins/kk/workflows/kk-daily-publish3.yaml'),
        join(REPO, 'plugins/kk/publish-presets/daily-ai-voice.json'),
        EXTRACT_PROFILE,
        SUPERVISOR,
        PUBLISH_LAUNCHER,
    ];
    if (mode === 'quick') {
        const missingFiles = requiredFiles.filter((path) => !existsSync(path));
        add(
            'required-files',
            missingFiles.length === 0 ? 'pass' : 'fail',
            missingFiles.length === 0
                ? `${requiredFiles.length} workflow/config/launcher files exist`
                : missingFiles.join(', '),
        );
        const missingGeneration = generationFilesMissing(dayDir);
        add(
            'generation-files',
            missingGeneration.length === 0 ? 'pass' : 'fail',
            missingGeneration.length === 0
                ? `bundle and declared variant files are ready at ${dayDir}`
                : missingGeneration.join(', '),
        );
        return finish();
    }
    requiredFiles.push(join(REPO, DOGFOOD_TEST));

    const requiredTools = ['spur', 'kk', 'jq', 'ffmpeg', 'ffprobe', 'python3'];
    const missingTools = requiredTools.filter((tool) => spawnSync('which', [tool], { stdio: 'ignore' }).status !== 0);
    add(
        'tools',
        missingTools.length === 0 ? 'pass' : 'fail',
        missingTools.length === 0
            ? `bun plus ${requiredTools.join(', ')} are on PATH`
            : `missing from PATH: ${missingTools.join(', ')}`,
    );

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
            dailyCommand.includes('bun scripts/daily-ai-news.ts generate --full') &&
            publishJob?.cron === '0 7 * * *' &&
            publishCommand.includes('bun scripts/daily-ai-news.ts publish --window overseas-rss --unattended') &&
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

    return finish();
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
