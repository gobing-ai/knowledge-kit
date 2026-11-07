/**
 * Task 0334 — voice3 migration schedules, the checkout launcher and the migration preset
 * (R1-R7, audit findings F08/F09/F10).
 *
 * Failure-first list (written before the code):
 * 1. R2/F09 — every rendered migration cron entry parses under cron's command grammar: no
 *    unescaped percent sign anywhere in an entry line (cron ends the command at the first
 *    unescaped % and feeds the rest to stdin, quotes included). Covers the two publish3
 *    windows and the new generation entry.
 * 2. R1/F08 — the launcher resolves the generation bundle from the effective works root
 *    (KK_WORKS_DIR first, spaces survive JSON.stringify) under the generation namespace,
 *    never the publish3 output directory, and forwards work_dir/run_date/window/preset/
 *    live_channels to the real `spur workflow run` through a recording double.
 * 3. R1 — the launch date derives from the window without a flag: cn-peak/after-generate
 *    take today in America/Los_Angeles, overseas-rss takes yesterday (episodes land after
 *    the 07:00 tick).
 * 4. R1 — a missing bundle refuses BEFORE spur is spawned, naming the expected path.
 * 5. R1 — a bundle whose runDate differs from the requested run date refuses before spawn.
 * 6. R3/F10 — live tokens outside the window (the old baked CN list: wechatmp-pub, xhs-pub)
 *    refuse before spawn; the in-window subset forwards verbatim; `--dummy` combined with
 *    live tokens refuses.
 * 7. R3 — the rendered CN schedule discloses the send-confirm pause and bakes only tokens
 *    that match a cn-peak row of the preset it pins.
 * 8. R4 — daily-ai-voice-migration parses against the shared schema, carries an explicit
 *    stable id on every row, covers the shipped daily-ai-voice inventory and only names
 *    plugins that exist under plugins/publishings/; modes stay draft/dummy/off (live is
 *    unencodable by schema).
 * 9. R7 — the voice3 workflow declares `publish_live_channels: ""` and forwards it
 *    verbatim to the nested publish3 `live_channels`.
 * 10. R1/R6 — the generation entry renders as a cron target (launchd refused) with the safe
 *     shadow defaults (`auto_publish` false), and rendering never installs anything beyond
 *     stdout (the artifact is data the operator merges by hand).
 */

import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PublishPresetSchema } from '../src/itc-plan';

const REPO = resolve(import.meta.dir, '../../..');
const ARTIFACTS = join(REPO, '.works/tmp/test-voice3-migration/0334');

/** One `kk schedule render` through the checkout CLI, exactly like the operator runs it. */
function render(schedule: string, platform: 'cron' | 'launchd'): { code: number; out: string; err: string } {
    const proc = Bun.spawnSync(
        [
            'bun',
            join(REPO, 'apps/cli/src/index.ts'),
            'schedule',
            'render',
            schedule,
            '--platform',
            platform,
            '--repo',
            REPO,
        ],
        { cwd: REPO },
    );
    return {
        code: proc.exitCode,
        out: proc.stdout.toString(),
        err: proc.stderr.toString(),
    };
}

/** Cron entries in a rendered artifact: the lines a crontab would treat as commands. */
function cronEntries(text: string): string[] {
    return text.split('\n').filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));
}

/** A temp dir holding a recording `spur` double (records argv, exits 0). */
function makeSpurShim(): { shim: string; record: string } {
    const shim = mkdtempSync(join(tmpdir(), 'voice3-shim-'));
    const record = join(shim, 'spur-argv.log');
    writeFileSync(join(shim, 'spur'), `#!/bin/bash\nprintf '%s\\n' "$@" >> '${record}'\n`);
    chmodSync(join(shim, 'spur'), 0o755);
    return { shim, record };
}

interface LauncherRun {
    code: number;
    out: string;
    err: string;
    argv: string[];
}

/** Run the checkout launcher with the recording double (KK_SPUR_BIN pins it); parse the argv. */
function runLauncher(args: string[], env: Record<string, string>): LauncherRun {
    const { shim, record } = makeSpurShim();
    try {
        const proc = Bun.spawnSync(['bun', join(REPO, 'plugins/kk/scripts/voice3-publish-window.ts'), ...args], {
            cwd: REPO,
            env: { ...process.env, KK_SPUR_BIN: join(shim, 'spur'), SPUR_RECORD: record, ...env },
        });
        const argv = existsSync(record)
            ? readFileSync(record, 'utf-8')
                  .split('\n')
                  .filter((line) => line !== '')
            : [];
        return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString(), argv };
    } finally {
        rmSync(shim, { recursive: true, force: true });
    }
}

/** A minimal valid frozen bundle at `<worksRoot>/<namespace>/<digits>/bundle.json`. */
function seedBundle(worksRoot: string, digits: string, bundleRunDate: string): string {
    const genDir = join(worksRoot, 'kk-daily-ai-voice2', digits);
    mkdirSync(genDir, { recursive: true });
    writeFileSync(
        join(genDir, 'bundle.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                runId: 'gen-run-0334',
                runDate: bundleRunDate,
                runs: [],
                episode: { title: `每日AI乱炖 · ${bundleRunDate}` },
                variants: { 'episode:zh': { path: '30-variants/episode.content.json', sha256: '0'.repeat(64) } },
                safety: { status: 'pass', digest: '0'.repeat(64), excludedPlatforms: [], variants: {} },
            },
            null,
            2,
        )}\n`,
    );
    return genDir;
}

/** `--vars` JSON payload from a recorded spur argv (the value after `--vars`). */
function varsFromArgv(argv: string[]): Record<string, string> {
    const i = argv.indexOf('--vars');
    if (i < 0) throw new Error(`recording has no --vars: ${JSON.stringify(argv)}`);
    return JSON.parse(argv[i + 1] ?? '{}');
}

/** Today/yesterday in America/Los_Angeles as seen by the same date binary the cron uses. */
function laDate(offsetDays: number): string {
    const cmd = offsetDays === 0 ? 'date +%F' : 'date -v-1d +%F 2>/dev/null || date -d yesterday +%F';
    // export, not an env prefix: `TZ=x a || b` binds TZ to `a` only, so on Linux (no -v) the
    // fallback silently computed UTC-based yesterday and disagreed with the launcher (GHA 42347626295).
    const proc = Bun.spawnSync(['bash', '-c', `export TZ=America/Los_Angeles; ${cmd}`]);
    return proc.stdout.toString().trim();
}

const CN_TOKENS = ['wechatmp-pub', 'xhs-pub', 'weibo-pub', 'x-pub'];

describe('0334 rendered migration schedules (R2/F09, R3, R6)', () => {
    it('keeps every cron entry free of unescaped percent signs', () => {
        for (const schedule of ['kk-daily-publish3-cn-peak', 'kk-daily-publish3-overseas', 'kk-daily-ai-voice3']) {
            const rendered = render(schedule, 'cron');
            expect(rendered.code).toBe(0);
            for (const line of cronEntries(rendered.out)) {
                expect(line.replace(/\\%/g, '')).not.toContain('%');
            }
        }
    }, 60_000);

    it('discloses the send-confirm pause and bakes only in-window CN live tokens', () => {
        const rendered = render('kk-daily-publish3-cn-peak', 'cron');
        expect(rendered.code).toBe(0);
        // R3: the artifact must say the live launch stops for manual resume.
        expect(rendered.out).toContain('send-confirm');
        // The consent comment keeps the ADR-022 live_channels naming the 0323 render contract pinned.
        expect(rendered.out).toContain('live_channels');
        const entry = cronEntries(rendered.out).find((line) => line.includes('live-channels'));
        expect(entry).toBeDefined();
        const tokens = (entry?.match(/--live-channels ([A-Za-z0-9,._-]+)/) ?? [])[1]?.split(',') ?? [];
        expect(tokens.length).toBeGreaterThan(0);
        const preset = PublishPresetSchema.parse(
            JSON.parse(readFileSync(join(REPO, 'plugins/kk/publish-presets/daily-ai-voice.json'), 'utf-8')),
        );
        const cnRows = preset.targets.filter((target) => (target.window ?? 'after-generate') === 'cn-peak');
        for (const token of tokens) {
            expect(cnRows.some((target) => target.plugin === token || target.id === token)).toBe(true);
        }
    }, 60_000);

    it('renders the generation entry as a cron target with safe shadow defaults', () => {
        const rendered = render('kk-daily-ai-voice3', 'cron');
        expect(rendered.code).toBe(0);
        const entry = cronEntries(rendered.out).join('\n');
        expect(entry).toContain('kk-daily-ai-voice3.yaml');
        expect(entry).toContain('auto_publish');
        expect(entry).toContain('false');
        const launchd = render('kk-daily-ai-voice3', 'launchd');
        expect(launchd.code).toBe(1);
    }, 60_000);
});

describe('0334 voice3-publish-window launcher (R1/F08)', () => {
    it('resolves the generation bundle from the effective works root and forwards publish vars', () => {
        const root = join(mkdtempSync(join(tmpdir(), 'voice3-works-')), 'my works root');
        mkdirSync(root, { recursive: true });
        const genDir = seedBundle(root, '20261103', '2026-11-03');
        const run = runLauncher(
            [
                '--window',
                'cn-peak',
                '--run-date',
                '2026-11-03',
                '--preset',
                'daily-ai-voice',
                '--live-channels',
                'weibo-pub',
            ],
            { KK_WORKS_DIR: root },
        );
        expect(run.code).toBe(0);
        expect(run.argv).toContain('plugins/kk/workflows/kk-daily-publish3.yaml');
        const vars = varsFromArgv(run.argv);
        // F08: the bundle lives in the generation namespace, never the publish3 output dir.
        expect(vars.work_dir).toBe(genDir);
        expect(vars.work_dir).not.toContain('kk-daily-publish3');
        expect(vars.run_date).toBe('20261103');
        expect(vars.window).toBe('cn-peak');
        expect(vars.preset).toBe('daily-ai-voice');
        expect(vars.live_channels).toBe('weibo-pub');
        rmSync(root, { recursive: true, force: true });
    });

    it('derives the launch date from the window: today for cn-peak, yesterday for overseas', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        const today = laDate(0);
        const yesterday = laDate(-1);
        mkdirSync(join(root, 'kk-daily-ai-voice2', today.replaceAll('-', '')), { recursive: true });
        seedBundle(root, today.replaceAll('-', ''), today);
        mkdirSync(join(root, 'kk-daily-ai-voice2', yesterday.replaceAll('-', '')), { recursive: true });
        seedBundle(root, yesterday.replaceAll('-', ''), yesterday);
        const cn = runLauncher(['--window', 'cn-peak', '--preset', 'daily-ai-voice'], {
            KK_WORKS_DIR: root,
            TZ: 'America/Los_Angeles',
        });
        expect(cn.code).toBe(0);
        expect(varsFromArgv(cn.argv).run_date).toBe(today.replaceAll('-', ''));
        const overseas = runLauncher(['--window', 'overseas-rss', '--preset', 'daily-ai-voice'], {
            KK_WORKS_DIR: root,
            TZ: 'America/Los_Angeles',
        });
        expect(overseas.code).toBe(0);
        expect(varsFromArgv(overseas.argv).run_date).toBe(yesterday.replaceAll('-', ''));
        rmSync(root, { recursive: true, force: true });
    });

    it('refuses a missing bundle before spawning spur', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        const run = runLauncher(['--window', 'cn-peak', '--run-date', '2026-11-03'], { KK_WORKS_DIR: root });
        expect(run.code).toBe(1);
        expect(run.argv).toHaveLength(0);
        expect(run.err).toContain(join(root, 'kk-daily-ai-voice2', '20261103', 'bundle.json'));
        rmSync(root, { recursive: true, force: true });
    });

    it('refuses a bundle dated differently than the requested run date', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        seedBundle(root, '20261103', '2026-10-22');
        const run = runLauncher(['--window', 'cn-peak', '--run-date', '2026-11-03'], { KK_WORKS_DIR: root });
        expect(run.code).toBe(1);
        expect(run.argv).toHaveLength(0);
        rmSync(root, { recursive: true, force: true });
    });
});

describe('0334 live token admission (R3/F10)', () => {
    it('refuses the old baked CN token list — out-of-window tokens never reach spur', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        seedBundle(root, '20261103', '2026-11-03');
        const run = runLauncher(
            [
                '--window',
                'cn-peak',
                '--run-date',
                '2026-11-03',
                '--preset',
                'daily-ai-voice',
                '--live-channels',
                CN_TOKENS.join(','),
            ],
            { KK_WORKS_DIR: root },
        );
        expect(run.code).toBe(1);
        expect(run.argv).toHaveLength(0);
        expect(run.err).toContain('wechatmp-pub');
        rmSync(root, { recursive: true, force: true });
    });

    it('refuses dummy rehearsal combined with live tokens', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        seedBundle(root, '20261103', '2026-11-03');
        const run = runLauncher(
            [
                '--window',
                'cn-peak',
                '--run-date',
                '2026-11-03',
                '--preset',
                'daily-ai-voice',
                '--live-channels',
                'weibo-pub',
                '--dummy',
            ],
            { KK_WORKS_DIR: root },
        );
        expect(run.code).toBe(1);
        expect(run.argv).toHaveLength(0);
        rmSync(root, { recursive: true, force: true });
    });

    it('forwards an in-window live subset verbatim', () => {
        const root = mkdtempSync(join(tmpdir(), 'voice3-works-'));
        seedBundle(root, '20261103', '2026-11-03');
        const run = runLauncher(
            [
                '--window',
                'cn-peak',
                '--run-date',
                '2026-11-03',
                '--preset',
                'daily-ai-voice',
                '--live-channels',
                'weibo-pub',
            ],
            { KK_WORKS_DIR: root },
        );
        expect(run.code).toBe(0);
        expect(varsFromArgv(run.argv).live_channels).toBe('weibo-pub');
        rmSync(root, { recursive: true, force: true });
    });
});

describe('0334 daily-ai-voice-migration preset (R4)', () => {
    it('parses, carries stable ids, covers the shipped inventory and names only real plugins', () => {
        const migration = PublishPresetSchema.parse(
            JSON.parse(readFileSync(join(REPO, 'plugins/kk/publish-presets/daily-ai-voice-migration.json'), 'utf-8')),
        );
        for (const target of migration.targets) {
            expect(target.id).toBeDefined();
            expect(['draft', 'dummy', 'off']).toContain(target.mode ?? 'draft');
            expect(existsSync(join(REPO, 'plugins/publishings', target.plugin))).toBe(true);
        }
        const shipped = PublishPresetSchema.parse(
            JSON.parse(readFileSync(join(REPO, 'plugins/kk/publish-presets/daily-ai-voice.json'), 'utf-8')),
        );
        const key = (target: { plugin: string; operation?: string; variant?: string; window?: string }) =>
            `${target.plugin}|${target.operation ?? ''}|${target.variant ?? ''}|${target.window ?? 'after-generate'}`;
        const migrationKeys = new Set(migration.targets.map(key));
        for (const target of shipped.targets) {
            expect(migrationKeys.has(key(target))).toBe(true);
        }
    });
});

describe('0334 voice3 launch var forwarding (R7)', () => {
    it('declares publish_live_channels empty and forwards it to the nested publish window', () => {
        const text = readFileSync(join(REPO, 'plugins/kk/workflows/kk-daily-ai-voice3.yaml'), 'utf-8');
        expect(text).toContain('publish_live_channels: ""');
        const yaml = Bun.YAML.parse(text) as { vars: Record<string, string> };
        expect(yaml.vars.publish_live_channels).toBe('');
        // `${vars.name}` assembled at runtime so lint's noTemplateCurlyInString stays quiet
        const q = '\\"';
        const dollar = '${';
        expect(text).toContain(`${q}live_channels${q}:${q}${dollar}vars.publish_live_channels}${q}`);
    });
});

it('keeps a repeatable artifact of the migration rehearsal surface', () => {
    mkdirSync(ARTIFACTS, { recursive: true });
    const renders = ['kk-daily-publish3-cn-peak', 'kk-daily-publish3-overseas', 'kk-daily-ai-voice3'].map((name) => {
        const rendered = render(name, 'cron');
        return {
            name,
            exitCode: rendered.code,
            entries: cronEntries(rendered.out).length,
            percentFree: cronEntries(rendered.out).every((line) => !line.replace(/\\%/g, '').includes('%')),
        };
    });
    writeFileSync(
        join(ARTIFACTS, 'summary.json'),
        `${JSON.stringify(
            {
                task: '0334',
                surface: {
                    launcher: 'plugins/kk/scripts/voice3-publish-window.ts',
                    migrationPreset: 'plugins/kk/publish-presets/daily-ai-voice-migration.json',
                    generationSchedule: 'kk-daily-ai-voice3',
                },
                renders,
                're-run': 'bun test apps/cli/tests/voice3-migration-0334.test.ts',
            },
            null,
            2,
        )}\n`,
    );
    expect(existsSync(join(ARTIFACTS, 'summary.json'))).toBe(true);
}, 60_000);
