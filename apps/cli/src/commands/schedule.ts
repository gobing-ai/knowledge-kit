import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { consoleOutput } from '../output';

/** Scheduling platforms kk ships a template for; one array drives validation, help text and errors. */
const SCHEDULE_PLATFORMS = ['launchd', 'cron', 'grok-bot'] as const;
type SchedulePlatform = (typeof SCHEDULE_PLATFORMS)[number];

/** Checkout/package-relative location of the schedule templates. */
const SCHEDULES_REL = 'plugins/kk/schedules';

/**
 * Package/checkout root: this module sits at `<root>/apps/cli/src/commands/`, so the root is FOUR
 * levels up. (Three landed on `<root>/apps`, which made the package fallback in `readTemplate`
 * resolve to a path that never exists.)
 */
const CHECKOUT_ROOT = resolve(import.meta.dir, '../../../..');

/**
 * Shipped schedules: name → the template file each platform renders.
 *
 * A schedule is a rendered artifact the operator installs (`launchctl bootstrap` / `crontab`);
 * kk never installs one itself, so the only side effect of `render` is the text it prints.
 * The platform map is `Partial` because not every schedule has every platform: `kk-serve` is
 * launchd-only — cron has no keepalive semantics, so a cron render is refused by name rather
 * than rendered into a line that cannot do the job.
 */
const SCHEDULE_TEMPLATES: Record<string, Partial<Record<SchedulePlatform, string>>> = {
    'kk-collect': { launchd: 'launchd.plist.tmpl', cron: 'cron.tmpl', 'grok-bot': 'kk-collect.grok-bot.md.tmpl' },
    'kk-serve': { launchd: 'kk-serve.launchd.plist.tmpl' },
    // The two publish3 windows (task 0323 R5). Cron-only by design: the overseas window is a plain
    // daily tick, and cn-peak's `wait-until` node absorbs the hosted-zone offset, so neither needs
    // launchd's keepalive or calendar-interval semantics.
    'kk-daily-publish3-cn-peak': { cron: 'kk-daily-publish3-cn-peak.cron.tmpl' },
    'kk-daily-publish3-overseas': { cron: 'kk-daily-publish3-overseas.cron.tmpl' },
    // The voice3 shadow generation run (task 0334 R1/R6): cron-only like the publish windows —
    // a plain daily tick whose auto_publish=false default keeps it publish-inert.
    'kk-daily-ai-voice3': { cron: 'kk-daily-ai-voice3.cron.tmpl' },
};

/** Options accepted by `kk schedule render`. */
interface RenderOptions {
    platform: string;
    repo: string;
    bot?: string;
    tz?: string;
    cron?: string;
}

/**
 * A Grok Bot routine's smallest schedule: routines accept intervals of >=5 minutes only
 * (https://docs.x.ai/grok-bot/skills-routines-and-automations), so a cron expression whose minute
 * field can fire twice within five minutes must be refused instead of rendering a routine the
 * Bot silently cannot create.
 */
const GROK_MIN_INTERVAL_MINUTES = 5;

/** kk-collect's cadence — the platform's frozen default for grok-bot renders. */
const DEFAULT_GROK_CRON = '0 4,10,16,22 * * *';

/** The `{{repo}}` template placeholder bound to the `--repo` checkout. */
const REPO_PLACEHOLDER = '{{repo}}';

/**
 * The `{{home}}` template placeholder bound to the operator's home directory.
 *
 * The launchd and cron artifacts need it for `PATH`: launchd's `/usr/bin:/bin:/usr/sbin:/sbin` and
 * cron's minimal PATH carry neither `spur` nor the `kk`/`jq`/`bun` the workflow shells out to, so a
 * rendered artifact without one dies with `spur: command not found` (127) on its first tick.
 */
const HOME_PLACEHOLDER = '{{home}}';

/**
 * The `{{typesafe_api_key}}` template placeholder bound to the decision-maker credential in the
 * rendering shell's environment.
 *
 * spur keeps that credential env-only (`spur decision status` reports `missing-key` without it), and
 * an OS-scheduled job inherits none of the operator's shell. Without the key `kk store label`
 * answers every `typesafe`-routed decision with its fail-closed default — `kk-item-china-politics`
 * = 3, `kk-item-sensitivity` = 1 — and the `ai-news` extract profile gates china-politics at
 * `lte: 1`, so the pool comes back empty and the daily run closes as no-content (2026-10-12: the
 * launchd collect ticks 04:00/10:00 labelled all 22 fresh items `no-backend`). Carrying the value
 * from the environment is the same trade the `PATH` binding below already makes: the rendered
 * artifact is a local operator file (a `LaunchAgents` plist or a crontab line), never committed, and
 * a render without the key in the environment still produces a valid artifact — spur reads an empty
 * value as "not set".
 */
const TYPESAFE_API_KEY_PLACEHOLDER = '{{typesafe_api_key}}';

/**
 * The `{{spur_modules}}` template placeholder bound to the module root that carries
 * `@gobing-ai/spur` — the directory the rendered `NODE_PATH` names.
 *
 * Project decision catalogs declare `$schema: "@gobing-ai/spur/schemas/…"`, and Spur/kk resolve it
 * through `Bun.resolveSync` from the catalog's own directory (`.spur/config.yaml`
 * `decisions.paths` → `plugins/kk/decisions`). Bun's resolver does NOT search the global install,
 * so a scheduler-launched job — which inherits only what this plist binds — cannot see the package
 * unless `NODE_PATH` carries its module root. On 2026-11-19 the checkout's only other resolver (a
 * `/Users/robin/node_modules` shadow, pruned by a stray `bun install` in the home directory) vanished
 * and both consumers failed: `kk store label` exited at catalog load (empty label artifact → the
 * collect tick failed) and spur's `decide` action silently loaded zero project catalogs, so the
 * `kk-safety-verdict` row was absent and the daily safety gate refused the drafts. Bind it here so a
 * re-rendered plist cannot lose it again.
 *
 * `scripts/with-spur-env.ts` solves the same problem for `bun run` and derives the path from the
 * `spur` binary; this is the same derivation for a bundled, shippable CLI, so it cannot import the
 * repo script.
 */
const SPUR_MODULES_PLACEHOLDER = '{{spur_modules}}';

/**
 * The module root carrying `@gobing-ai/spur`, derived from the `spur` on PATH.
 *
 * Falls back to the bun-global layout the template's `Program` already assumes (`{{home}}/.bun/bin/spur`)
 * when `spur` is absent or PATH carries something unexpected — `render` must stay a pure text
 * operation that always produces a complete artifact, and that layout is the one the baked-in
 * `Program` path requires anyway.
 */
function spurModulesDir(): string {
    const conventional = resolve(homedir(), '.bun/install/global/node_modules');
    const binary = Bun.which('spur');
    if (binary === null) return conventional;
    let dir: string;
    try {
        dir = dirname(realpathSync(binary));
    } catch {
        return conventional;
    }
    for (;;) {
        const modules = join(dir, 'node_modules');
        if (existsSync(join(modules, '@gobing-ai/spur/package.json'))) return modules;
        const parent = dirname(dir);
        if (parent === dir) return conventional;
        dir = parent;
    }
}

/**
 * The minimum circular gap (minutes) between two firings of a cron expression's MINUTE field.
 *
 * Local to the grok-bot platform's >=5-minute floor: hour/field-only expressions (no explicit
 * minute list) fire hourly or rarer and are trivially safe, and every sub-hour risk lives in the
 * minute field — so only that field is expanded: wildcard, step lists (n per step), ranges (a-b),
 * stepped ranges, and comma lists over 0-59.
 * A single minute fires once an hour (gap 60); a value under 5 here — a wildcard, a sub-minute
 * step like n=2, or a tight pair like 0,2 — rejects the expression. Legal-but-odd parts of the OTHER fields are not validated; a conservative
 * minute-field floor is deliberately stricter than a full cron parser.
 */
function minuteGap(cronExpr: string): number | undefined {
    const minutes = new Set<number>();
    for (const part of (cronExpr.trim().split(/\s+/)[0] ?? '').split(',')) {
        const [range, stepRaw] = part.split('/');
        if (range === undefined) return undefined; // empty minute field
        const step = stepRaw === undefined ? 1 : Number(stepRaw);
        if (!Number.isInteger(step) || step < 1) return undefined; // unparsable minute field
        let lo = 0;
        let hi = 59;
        if (range !== '*') {
            const [a, b] = range.split('-');
            lo = Number(a);
            hi = b === undefined ? lo : Number(b);
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || hi > 59) return undefined;
        }
        for (let m = lo; m <= hi; m += step) minutes.add(m);
    }
    if (minutes.size === 0) return undefined;
    if (minutes.size === 1) return 60; // one minute per hour — trivially above the floor
    const sorted = [...minutes].sort((x, y) => x - y);
    // Wrap around the hour for the last entry: `58,4` fires every 6 minutes, not every 46+58.
    const gaps = sorted.map((m, i) => {
        if (i + 1 < sorted.length) return (sorted[i + 1] ?? 0) - m;
        return 60 - m + (sorted[0] ?? 0);
    });
    return Math.min(...gaps);
}

/**
 * Escape one value interpolated into a rendered plist. A plist is XML, so an unescaped `&` (or a
 * stray `<`) in an environment value makes the whole artifact unparsable and `launchctl bootstrap`
 * refuses it — silently, from the operator's point of view, since the render itself succeeded.
 */
function xmlEscape(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/**
 * Read the schedule template, preferring the scheduled checkout's own copy (the operator
 * schedules the checkout they are in) and falling back to the running package's shipped copy —
 * so `--repo` can name a checkout that does not carry `plugins/kk/schedules/`.
 */
async function readTemplate(fs: FileSystem, repo: string, file: string): Promise<string> {
    const candidates = [resolve(repo, SCHEDULES_REL, file), resolve(CHECKOUT_ROOT, SCHEDULES_REL, file)];
    for (const path of candidates) {
        if (await fs.exists(path)) {
            return await fs.readFile(path);
        }
    }
    throw new Error(`schedule template not found: ${candidates.join(' or ')}`);
}

/**
 * `kk schedule render <schedule> --platform launchd|cron|grok-bot [--repo <dir>]` — print the
 * schedule artifact for the named workflow, with the checkout it runs from bound as `{{repo}}`.
 *
 * The rendered text is the whole contract: kk never installs it, the operator does (README
 * §Schedule). For `grok-bot` the artifact is a Grok Bot routine definition the operator pastes
 * into the Bot's routine editor — the same print-only contract, bound by ADR-044: only schedules
 * that carry a grok-bot template (store-free, browser-free cloud work) render at all, and a
 * schedule without one names the ADR in the refusal. An unknown schedule or platform fails loud —
 * a typo must never render a partial schedule. Nothing is ever written or installed.
 */
async function renderAction(schedule: string, options: RenderOptions): Promise<void> {
    try {
        const templates = SCHEDULE_TEMPLATES[schedule];
        if (templates === undefined) {
            throw new Error(`unknown schedule '${schedule}' (expected ${Object.keys(SCHEDULE_TEMPLATES).join('|')})`);
        }
        const isGrok = options.platform === 'grok-bot';
        const isKnown = (SCHEDULE_PLATFORMS as readonly string[]).includes(options.platform);
        if (!isKnown) {
            throw new Error(`unknown platform '${options.platform}' (expected ${SCHEDULE_PLATFORMS.join('|')})`);
        }
        if (!isGrok && (options.bot !== undefined || options.tz !== undefined || options.cron !== undefined)) {
            throw new Error('--bot/--tz/--cron are only valid with --platform grok-bot');
        }
        const template = templates[options.platform as SchedulePlatform];
        if (template === undefined) {
            if (isGrok) {
                throw new Error(
                    `schedule '${schedule}' has no grok-bot template — cloud routines run store-free, browser-free work only (ADR-044)`,
                );
            }
            throw new Error(
                `schedule '${schedule}' has no ${options.platform} template (expected ${Object.keys(templates).join('|')})`,
            );
        }
        const repo = resolve(options.repo);
        const rendered = isGrok
            ? await renderGrokBody(options, template)
            : await readTemplate(createNodeFileSystem(), repo, template);
        const substitution = isGrok
            ? rendered
                  .replaceAll('{{bot}}', options.bot ?? '')
                  .replaceAll('{{cron}}', options.cron ?? DEFAULT_GROK_CRON)
                  .replaceAll('{{tz}}', options.tz || Intl.DateTimeFormat().resolvedOptions().timeZone)
            : rendered
                  .replaceAll(REPO_PLACEHOLDER, repo)
                  .replaceAll(HOME_PLACEHOLDER, homedir())
                  .replaceAll(TYPESAFE_API_KEY_PLACEHOLDER, xmlEscape(process.env.TYPESAFE_API_KEY ?? ''))
                  .replaceAll(SPUR_MODULES_PLACEHOLDER, xmlEscape(spurModulesDir()));
        if (isGrok && substitution.includes('{{')) {
            throw new Error(
                'grok-bot routine left an unsubstituted placeholder — grok-bot templates may carry only {{bot}}, {{cron}}, {{tz}}',
            );
        }
        consoleOutput.write(substitution);
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        const message = `kk.schedule.render.failed: ${cause}`;
        consoleOutput.error(message);
        throw new CommanderError(1, 'kk.schedule.render.failed', message);
    }
}

/**
 * Render the grok-bot body: `--bot` is required, and `--cron` must be 5 fields whose minute field
 * never fires twice within 5 minutes (Grok Bot's routine interval floor).
 */
async function renderGrokBody(options: RenderOptions, template: string): Promise<string> {
    if (!options.bot) {
        throw new Error('--bot <name> is required for --platform grok-bot');
    }
    if (options.cron !== undefined) {
        const fields = options.cron.trim().split(/\s+/);
        const malformed = fields.length !== 5 || fields.some((field) => !/^[\d*,/-]+$/.test(field));
        if (malformed) {
            throw new Error(`--cron '${options.cron}' must be a 5-field cron expression`);
        }
        const gap = minuteGap(options.cron);
        if (gap === undefined || gap < GROK_MIN_INTERVAL_MINUTES) {
            throw new Error(
                `--cron '${options.cron}' fires under ${GROK_MIN_INTERVAL_MINUTES} minutes apart — Grok Bot routines need a ${GROK_MIN_INTERVAL_MINUTES}-minute minimum gap`,
            );
        }
    }
    return await readTemplate(createNodeFileSystem(), resolve(options.repo), template);
}

/**
 * Register the `schedule` command group — the operator-installed schedule surface.
 *
 * `render` prints a launchd plist or a crontab line for a shipped workflow; installing it
 * (`launchctl bootstrap` / `crontab`) is an operator action, deliberately outside kk.
 */
export function registerScheduleCommand(program: Command): void {
    const schedule = program.command('schedule').description('Render the operator-installed schedules');

    schedule
        .command('render')
        .description('Print the schedule artifact for a workflow (installing it is an operator action)')
        .argument('<schedule>', `Schedule name (${Object.keys(SCHEDULE_TEMPLATES).join('|')})`)
        .requiredOption('--platform <platform>', `Scheduling platform (${SCHEDULE_PLATFORMS.join('|')})`)
        .option('--repo <dir>', 'Checkout the schedule runs from (absolute path in the artifact)', process.cwd())
        .option('--bot <name>', 'Grok-bot only: the owning Bot (required for grok-bot)')
        .option('--tz <iana>', 'Grok-bot only: the routine timezone (default: the rendering host zone)')
        .option('--cron <expr>', `Grok-bot only: the routine cron expression (default '${DEFAULT_GROK_CRON}')`)
        .action(renderAction);
}
