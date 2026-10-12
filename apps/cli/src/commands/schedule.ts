import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { consoleOutput } from '../output';

/** Scheduling platforms kk ships a template for. */
type SchedulePlatform = 'launchd' | 'cron';

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
 */
const SCHEDULE_TEMPLATES: Record<string, Record<SchedulePlatform, string>> = {
    'kk-collect': { launchd: 'launchd.plist.tmpl', cron: 'cron.tmpl' },
};

/** Options accepted by `kk schedule render`. */
interface RenderOptions {
    platform: string;
    repo: string;
}

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
 * `kk schedule render <schedule> --platform launchd|cron [--repo <dir>]` — print the schedule
 * artifact for the named workflow, with the checkout it runs from bound as `{{repo}}`.
 *
 * The rendered text is the whole contract: `spur` has no scheduler, so the operator installs
 * it (README §Schedule). An unknown schedule or platform fails loud — a typo must never render
 * a partial schedule, and nothing is ever written or installed.
 */
async function renderAction(schedule: string, options: RenderOptions): Promise<void> {
    try {
        const templates = SCHEDULE_TEMPLATES[schedule];
        if (templates === undefined) {
            throw new Error(`unknown schedule '${schedule}' (expected ${Object.keys(SCHEDULE_TEMPLATES).join('|')})`);
        }
        if (options.platform !== 'launchd' && options.platform !== 'cron') {
            throw new Error(`unknown platform '${options.platform}' (expected launchd|cron)`);
        }
        const repo = resolve(options.repo);
        const template = await readTemplate(createNodeFileSystem(), repo, templates[options.platform]);
        consoleOutput.write(
            template
                .replaceAll(REPO_PLACEHOLDER, repo)
                .replaceAll(HOME_PLACEHOLDER, homedir())
                .replaceAll(TYPESAFE_API_KEY_PLACEHOLDER, xmlEscape(process.env.TYPESAFE_API_KEY ?? '')),
        );
    } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        const message = `kk.schedule.render.failed: ${cause}`;
        consoleOutput.error(message);
        throw new CommanderError(1, 'kk.schedule.render.failed', message);
    }
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
        .requiredOption('--platform <platform>', 'Scheduling platform (launchd|cron)')
        .option('--repo <dir>', 'Checkout the schedule runs from (absolute path in the artifact)', process.cwd())
        .action(renderAction);
}
