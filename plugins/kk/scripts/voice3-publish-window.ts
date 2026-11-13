#!/usr/bin/env bun
/**
 * voice3-publish-window — cron-safe launcher for the voice3 shadow publish window (task 0334).
 *
 * WHY a launcher (audit F08/F09/F10, docs/design/kk-daily-ai-voice3.md):
 * - cron ends a command at the first UNESCAPED % and feeds the rest to stdin, so any inline
 *   `$(date +%Y%m%d)` shell in a crontab entry silently truncates the command. Date math and
 *   flag assembly live here, in plain TypeScript, behind zero percent signs.
 * - the publish window must read the GENERATION bundle (`<works>/kk-daily-ai-voice2/<date>/
 *   bundle.json` — voice3 prepares under the voice2 namespace until the operator's cutover
 *   changes it), never the publish3 output directory that earlier entries pointed at.
 * - the CN consent token list is validated against the pinned preset's WINDOW rows before any
 *   spur process starts; the old baked `wechatmp-pub,xhs-pub,…` list (tokens that have no
 *   cn-peak row) is refused up front.
 *
 * Contract: everything before `spur workflow run plugins/kk/workflows/kk-daily-publish3.yaml`
 * is preparation and refusal; the only side effects are refusal messages and, on success, the
 * single spur exec. `KK_SPUR_BIN` pins the spur binary (same convention as board/capture.ts and
 * decision-hub.ts); `--dry-run` prints the forwarded vars and stops (rehearsal aid).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE =
    'usage: voice3-publish-window.ts --window <after-generate|cn-peak|overseas-rss> [--run-date <YYYY-MM-DD|YYYYMMDD>] ' +
    '[--preset <slug>] [--live-channels a,b] [--live-confirm true] [--work-dir <dir>] [--dummy] [--dry-run]';

const WINDOWS = new Set(['after-generate', 'cn-peak', 'overseas-rss']);

function failWith(code: number, message: string): never {
    console.error(message);
    process.exit(code);
}

function expandHome(raw: string): string {
    return raw === '~' || raw.startsWith('~/') ? join(homedir(), raw.slice(1)) : raw;
}

/** KK_WORKS_DIR env > config works_dir > <cwd>/.works — the kk-workflow-stages precedence. */
function resolveWorksDir(): string {
    const fromEnv = process.env.KK_WORKS_DIR;
    if (fromEnv) return expandHome(fromEnv);
    const configPath = process.env.KK_CONFIG || join(homedir(), '.config/kk/config.yaml');
    if (existsSync(configPath)) {
        try {
            const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown> | null;
            const worksDir = parsed !== null && typeof parsed === 'object' ? parsed.works_dir : undefined;
            if (typeof worksDir === 'string' && worksDir !== '') return expandHome(worksDir);
        } catch {
            // fall through to the compiled default
        }
    }
    return resolve(process.cwd(), '.works');
}

/** A real calendar day as `YYYY-MM-DD`, or undefined (mirrors publish-matrix normalizeRunDate). */
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

/** Today (offset 0) or yesterday (offset -1) in America/Los_Angeles — the episodes' own day. */
function losAngelesDate(offsetDays: number): string {
    const instant = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    // en-CA renders YYYY-MM-DD; Intl does the zone math cron cannot do inline.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(instant);
}

/** `--flag value`, or undefined. */
function flagValue(args: string[], flag: string): string | undefined {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        console.log(USAGE);
        process.exit(0);
    }
    const window = flagValue(args, '--window');
    if (window === undefined || !WINDOWS.has(window))
        failWith(1, `${USAGE}\nvoice3-publish-window: --window must be one of ${[...WINDOWS].join('|')}`);
    const dummy = args.includes('--dummy');
    // ADR-022 amendment 2026-11-12: the preset's own rows carry live consent, so the send-confirm
    // pause is opt-in. `--live-confirm true` restores it for a supervised one-off window.
    const liveConfirm = (flagValue(args, '--live-confirm') ?? 'false').trim() === 'true';
    const dryRun = args.includes('--dry-run');
    const preset = flagValue(args, '--preset');
    const liveChannelsRaw = flagValue(args, '--live-channels');
    const workDirOverride = flagValue(args, '--work-dir');

    // R1: run date = explicit flag, else window-derived LA day (overseas reads the episode that
    // landed after the 07:00 tick, i.e. yesterday).
    const runDateRaw = flagValue(args, '--run-date');
    let runDate: string | undefined;
    if (runDateRaw !== undefined && runDateRaw.trim() !== '') {
        runDate = normalizeRunDate(runDateRaw);
        if (runDate === undefined)
            failWith(1, `voice3-publish-window: '${runDateRaw}' is not a valid calendar day (YYYY-MM-DD or YYYYMMDD)`);
    } else {
        runDate = losAngelesDate(window === 'overseas-rss' ? -1 : 0);
    }
    const digits = runDate.replaceAll('-', '');

    if (dummy && liveChannelsRaw !== undefined) {
        failWith(1, 'voice3-publish-window: --dummy and --live-channels are mutually exclusive');
    }

    // R3/F10: live tokens validate against the pinned preset's WINDOW rows before any spawn.
    const liveChannels =
        liveChannelsRaw !== undefined && liveChannelsRaw.trim() !== ''
            ? liveChannelsRaw
                  .split(',')
                  .map((token) => token.trim())
                  .filter((token) => token !== '')
            : [];
    if (liveChannels.length > 0 && preset === undefined) {
        failWith(1, 'voice3-publish-window: --live-channels requires an explicit --preset to validate the window');
    }
    if (liveChannels.length > 0) {
        const scriptDir = dirname(fileURLToPath(import.meta.url));
        const presetPath = join(dirname(scriptDir), 'publish-presets', `${preset}.json`);
        if (!existsSync(presetPath))
            failWith(1, `voice3-publish-window: preset '${preset}' not found at ${presetPath}`);
        const parsed = JSON.parse(readFileSync(presetPath, 'utf-8')) as {
            targets?: Array<{ plugin: string; id?: string; mode?: string; window?: string }>;
        };
        const targets = parsed.targets ?? [];
        const inWindow = targets.filter((target) => (target.window ?? 'after-generate') === window);
        const refused = liveChannels.filter((token) => {
            const row = inWindow.find((target) => target.plugin === token || target.id === token);
            return row === undefined || (row.mode ?? 'draft') === 'off';
        });
        if (refused.length > 0) {
            failWith(
                1,
                `voice3-publish-window: live token(s) ${refused.join(', ')} have no active row in window '${window}' of preset '${preset}'` +
                    ` (send-confirm resumes are consent-scoped per window; see docs/design/kk-daily-ai-voice3.md)`,
            );
        }
    }

    // R1/F08: the bundle is the GENERATION artifact under the voice2 namespace, never a publish3
    // output dir. Mismatched/missing bundles refuse before spur starts.
    const genDir =
        workDirOverride !== undefined && workDirOverride.trim() !== ''
            ? resolve(workDirOverride)
            : join(resolveWorksDir(), 'kk-daily-ai-voice2', digits);
    const bundlePath = join(genDir, 'bundle.json');
    if (!existsSync(bundlePath)) failWith(1, `voice3-publish-window: no generation bundle at ${bundlePath}`);
    let bundleRunDate: string | undefined;
    try {
        const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8')) as { runDate?: string };
        bundleRunDate = typeof bundle.runDate === 'string' ? normalizeRunDate(bundle.runDate) : undefined;
    } catch {
        failWith(1, `voice3-publish-window: unreadable generation bundle at ${bundlePath}`);
    }
    if (bundleRunDate !== runDate) {
        failWith(
            1,
            `voice3-publish-window: bundle at ${bundlePath} is dated ${bundleRunDate ?? 'unknown'}, not the requested ${runDate}`,
        );
    }

    const vars: Record<string, string> = {
        work_dir: genDir,
        run_date: digits,
        window,
    };
    if (preset !== undefined && preset.trim() !== '') vars.preset = preset;
    if (liveChannels.length > 0) vars.live_channels = liveChannels.join(',');
    if (dummy) vars.dummy = 'true';
    if (liveConfirm) vars.live_confirm = 'true';

    if (dryRun) {
        console.log(JSON.stringify(vars, null, 2));
        process.exit(0);
    }

    const proc = spawnSync(
        process.env.KK_SPUR_BIN || 'spur',
        ['workflow', 'run', 'plugins/kk/workflows/kk-daily-publish3.yaml', '--vars', JSON.stringify(vars)],
        {
            stdio: 'inherit',
        },
    );
    // node spawnSync surfaces the child's code as `status` (exitCode is the async-API field).
    process.exit(proc.status ?? 1);
}

main();
