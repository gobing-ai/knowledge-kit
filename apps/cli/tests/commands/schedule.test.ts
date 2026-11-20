/**
 * `kk schedule` command-noun surface (task 0208 R6).
 *
 * Failure-first list (written before the code):
 * 1. an unknown `--platform` (or a missing/empty one) prints nothing on stdout and exits 1
 *    with `kk.schedule.render.failed` naming the expected values — a typo must never
 *    render a partially substituted template;
 * 2. an unknown schedule name exits 1 the same way (only `kk-collect` ships a template);
 * 3. a template that cannot be read (a `--repo` without `plugins/kk/schedules/`, when the
 *    running package's own copy is also absent) exits 1 naming the path — never prints an
 *    empty schedule;
 * 4. the launchd render must carry `StartCalendarInterval` at 04:00/10:00/16:00/22:00 local
 *    (6 h), the exact `spur workflow run plugins/kk/workflows/kk-collect.yaml` ProgramArguments
 *    and both stream paths at `.works/kk-collect/launchd.log`, with `--repo` bound as the working
 *    directory — a schedule that runs in the wrong checkout silently collects nothing;
 * 5. the cron render must carry the six-hourly expression (hours 4,10,16,22) plus the same
 *    program and log path;
 * 6. rendering must never install anything (no launchctl/crontab write): the command's
 *    only side effect is stdout;
 * 7. `kk-serve` (task 0265) is launchd-only: `--platform cron` exits 1 naming the missing
 *    template — cron cannot keep a process alive — while kk-collect's cron render is unchanged;
 * 8. the kk-serve launchd render carries R2's keepalive dict (Label `ai.gobing.spur-serve`, an
 *    absolute `Program`, `spur self serve --cwd {{repo}} --host 127.0.0.1 --port 3003 --no-open`,
 *    `RunAtLoad`/`KeepAlive` true, `ThrottleInterval` 10, both streams at
 *    `.works/spur-serve/serve.log`, PATH + TYPESAFE_API_KEY);
 * 9. an XML-special credential is escaped so the artifact still parses, and an unset key renders
 *    the empty string.
 */

import { describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const REPO = resolve(import.meta.dir, '../../../..');

/** Run `kk …` in-process, returning the exit code plus the captured echo/echoError output. */
async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

/** The `<string>` values of a plist `<array>` block named `key`. */
function plistArrayValues(plist: string, key: string): string[] {
    const block = plist.split(`<key>${key}</key>`)[1]?.split('</array>')[0] ?? '';
    return [...block.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => match[1] ?? '');
}

/** The value of a plist `<key>` whose payload is a single `<string>`. */
function plistStringValue(plist: string, key: string): string {
    return plist.split(`<key>${key}</key>`)[1]?.match(/<string>([\s\S]*?)<\/string>/)?.[1] ?? '';
}

/** The `<integer>` values of a plist `<array>` block named `key`. */
function plistArrayIntegers(plist: string, key: string): number[] {
    const block = plist.split(`<key>${key}</key>`)[1]?.split('</array>')[0] ?? '';
    return [...block.matchAll(/<integer>([\s\S]*?)<\/integer>/g)].map((match) => Number(match[1]));
}

/** The boolean payload following a plist `<key>`, or undefined when it is not `<true/>`/`<false/>`. */
function plistBooleanValue(plist: string, key: string): boolean | undefined {
    const next = plist.split(`<key>${key}</key>`)[1]?.trimStart() ?? '';
    if (next.startsWith('<true')) return true;
    if (next.startsWith('<false')) return false;
    return undefined;
}

/** The `<integer>` payload following a plist `<key>`. */
function plistIntegerValue(plist: string, key: string): number | undefined {
    const raw = plist.split(`<key>${key}</key>`)[1]?.match(/<integer>([\s\S]*?)<\/integer>/)?.[1];
    return raw === undefined ? undefined : Number(raw);
}

/**
 * AC2's "still parses" half. Bun and Node ship no XML parser and the repo has no plist
 * dependency, so assert the two properties an unescaped environment value breaks: every `&`
 * starts an entity, and the tag nesting balances (comments carry prose, so strip them first).
 */
function expectWellFormedPlist(plist: string): void {
    // XML comments are not an entity context, so they are dropped before both checks.
    const xml = plist.replaceAll(/<!--[\s\S]*?-->/g, '');
    expect(xml).not.toMatch(/&(?!(?:amp|lt|gt|quot|apos);)/);
    const open: string[] = [];
    for (const [, close, name, rest] of xml.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)([^>]*)>/g)) {
        if (close === '/') expect(open.pop()).toBe(name);
        else if (!(rest ?? '').endsWith('/')) open.push(name ?? '');
    }
    expect(open).toEqual([]);
}

describe('registerScheduleCommand', () => {
    it('R6 — registers the schedule noun with the render verb and its options', () => {
        const program = createProgram();
        const schedule = program.commands.find((command) => command.name() === 'schedule');
        expect(schedule).toBeDefined();

        expect(schedule?.commands.map((command) => command.name())).toEqual(['render']);

        const render = schedule?.commands.find((command) => command.name() === 'render');
        expect(render?.options.map((option) => option.long)).toEqual([
            '--platform',
            '--repo',
            '--bot',
            '--tz',
            '--cron',
        ]);
        expect(render?.registeredArguments.map((argument) => argument.name())).toEqual(['schedule']);
    });
});

describe('kk schedule render', () => {
    it('R6/AC4 — the launchd render schedules kk-collect 6-hourly at 04/10/16/22 local from the given repo', async () => {
        const result = await run(['schedule', 'render', 'kk-collect', '--platform', 'launchd', '--repo', REPO]);

        expect(result.code).toBe(0);
        expect(result.err).toBe('');
        const plist = result.out;
        expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
        // StartCalendarInterval Hour,Minute pairs — 04:00/10:00/16:00/22:00 local (6 h cadence).
        expect(plistArrayIntegers(plist, 'StartCalendarInterval')).toEqual([4, 0, 10, 0, 16, 0, 22, 0]);
        expect(plistArrayValues(plist, 'ProgramArguments')).toEqual([
            'spur',
            'workflow',
            'run',
            'plugins/kk/workflows/kk-collect.yaml',
        ]);
        expect(plistStringValue(plist, 'WorkingDirectory')).toBe(REPO);
        expect(plistStringValue(plist, 'StandardOutPath')).toBe(`${REPO}/.works/kk-collect/launchd.log`);
        expect(plistStringValue(plist, 'StandardErrorPath')).toBe(`${REPO}/.works/kk-collect/launchd.log`);
        // AC4's runtime half: launchd runs with /usr/bin:/bin:/usr/sbin:/sbin, which carries neither
        // `spur` nor the kk/jq/bun the workflow shells out to. Without this PATH the rendered plist
        // bootstraps fine and then dies on its first tick with `spur: command not found` (127).
        expect(plist).toContain('<key>EnvironmentVariables</key>');
        expect(plist).toContain('/.bun/bin');
        // launchd resolves a RELATIVE ProgramArguments[0] with its fixed _PATH_STDPATH before the job
        // environment exists, so no PATH setting can save a bare `spur` there — the plist must name an
        // absolute `Program` as well. R6's frozen argv array is asserted unchanged just above.
        const program = plistStringValue(plist, 'Program');
        expect(program.startsWith('/')).toBe(true);
        expect(program.endsWith('/spur')).toBe(true);
        // Nothing is installed: no placeholder survived the render.
        expect(plist).not.toContain('{{');
    });

    it('R6/AC4 — the cron render is `0 4,10,16,22 * * *` running the same workflow into the same log', async () => {
        const result = await run(['schedule', 'render', 'kk-collect', '--platform', 'cron', '--repo', REPO]);

        expect(result.code).toBe(0);
        expect(result.err).toBe('');
        const line = result.out.trim().split('\n').at(-1) ?? '';
        expect(line).toStartWith('0 4,10,16,22 * * * ');
        expect(line).toContain('spur workflow run plugins/kk/workflows/kk-collect.yaml');
        expect(line).toContain(`${REPO}/.works/kk-collect/launchd.log`);
        expect(line).toContain(`cd ${REPO}`);
        // cron's PATH is minimal, and its `>>` redirect aborts the tick BEFORE the command runs when
        // the log directory is absent — both are handled in the rendered line itself.
        expect(line).toContain('mkdir -p .works/kk-collect');
        expect(line).toContain('PATH=');
        expect(result.out).not.toContain('{{');
    });

    it('AC1/AC2 — the kk-serve launchd render is the supervised-server keepalive R2 freezes', async () => {
        const result = await run(['schedule', 'render', 'kk-serve', '--platform', 'launchd', '--repo', REPO]);

        expect(result.code).toBe(0);
        expect(result.err).toBe('');
        const plist = result.out;
        expect(plistStringValue(plist, 'Label')).toBe('ai.gobing.spur-serve');
        // Absolute `Program` for launchd's own lookup; ProgramArguments stays the frozen argv.
        expect(plistStringValue(plist, 'Program')).toBe(`${homedir()}/.bun/bin/spur`);
        expect(plistArrayValues(plist, 'ProgramArguments')).toEqual([
            'spur',
            'self',
            'serve',
            '--cwd',
            REPO,
            '--host',
            '127.0.0.1',
            '--port',
            '3003',
            '--no-open',
        ]);
        expect(plistStringValue(plist, 'WorkingDirectory')).toBe(REPO);
        expect(plistStringValue(plist, 'StandardOutPath')).toBe(`${REPO}/.works/spur-serve/serve.log`);
        expect(plistStringValue(plist, 'StandardErrorPath')).toBe(`${REPO}/.works/spur-serve/serve.log`);
        // The supervision contract: up at login, restarted on death, no restart storm.
        expect(plistBooleanValue(plist, 'RunAtLoad')).toBe(true);
        expect(plistBooleanValue(plist, 'KeepAlive')).toBe(true);
        expect(plistIntegerValue(plist, 'ThrottleInterval')).toBe(10);
        // PATH is what the scheduler's `/bin/sh -c` jobs need (bare spur/kk/jq/bun).
        expect(plistStringValue(plist, 'PATH')).toContain(`${homedir()}/.bun/bin`);
        // NODE_PATH is what makes `@gobing-ai/spur` resolvable for the decision catalogs the jobs
        // load (2026-11-19: without it every project catalog failed to load and the collect + safety
        // jobs failed). Derived from the `spur` on PATH, falling back to the bun-global layout the
        // `Program` above already assumes.
        expect(plistStringValue(plist, 'NODE_PATH')).toEndWith('node_modules');
        expect(plistStringValue(plist, 'NODE_PATH')).not.toContain('{{');
        expect(plist).toContain('<key>TYPESAFE_API_KEY</key>');
        // D2: the hand plist's TYPESAFE_BASE_URL is deliberately not part of the shipped template.
        expect(plist).not.toContain('<key>TYPESAFE_BASE_URL</key>');
        expect(plist).not.toContain('api.typesafe.ai');
        expect(plist).not.toContain('{{');
        expectWellFormedPlist(plist);
    });

    it('AC2 — an XML-special credential is escaped, and an unset key renders an empty string', async () => {
        const previous = process.env.TYPESAFE_API_KEY;
        try {
            process.env.TYPESAFE_API_KEY = 'apikey_a&b<c>d';
            const escaped = await run(['schedule', 'render', 'kk-serve', '--platform', 'launchd', '--repo', REPO]);
            expect(escaped.code).toBe(0);
            expect(plistStringValue(escaped.out, 'TYPESAFE_API_KEY')).toBe('apikey_a&amp;b&lt;c&gt;d');
            expect(escaped.out).not.toContain('a&b<c>d');
            expectWellFormedPlist(escaped.out);

            delete process.env.TYPESAFE_API_KEY;
            const unset = await run(['schedule', 'render', 'kk-serve', '--platform', 'launchd', '--repo', REPO]);
            expect(unset.code).toBe(0);
            expect(unset.err).toBe('');
            expect(unset.out).toMatch(/<key>TYPESAFE_API_KEY<\/key>\s*<string><\/string>/);
            expectWellFormedPlist(unset.out);
        } finally {
            if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
            else process.env.TYPESAFE_API_KEY = previous;
        }
    });

    it('AC3 — kk-serve has no cron template (cron cannot keep a process alive) and kk-collect is unchanged', async () => {
        const serve = await run(['schedule', 'render', 'kk-serve', '--platform', 'cron', '--repo', REPO]);

        expect(serve.code).toBe(1);
        expect(serve.out).toBe('');
        expect(serve.err).toContain('kk.schedule.render.failed');
        expect(serve.err).toContain("schedule 'kk-serve' has no cron template (expected launchd)");

        const collect = await run(['schedule', 'render', 'kk-collect', '--platform', 'cron', '--repo', REPO]);
        expect(collect.code).toBe(0);
    });

    it('R6 — an unknown platform exits 1 with kk.schedule.render.failed and no stdout', async () => {
        const result = await run(['schedule', 'render', 'kk-collect', '--platform', 'systemd', '--repo', REPO]);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('kk.schedule.render.failed');
        expect(result.err).toContain('systemd');
    });

    it('R6 — an unknown schedule exits 1 naming it and no stdout is written', async () => {
        const result = await run(['schedule', 'render', 'kk-unknown', '--platform', 'cron', '--repo', REPO]);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('kk.schedule.render.failed');
        expect(result.err).toContain('kk-unknown');
    });
});

describe('kk schedule render — grok-bot cloud routine (task 0343)', () => {
    const GROK_GREET = [
        'schedule',
        'render',
        'kk-collect',
        '--platform',
        'grok-bot',
        '--bot',
        'kk-cloud',
        '--tz',
        'America/Los_Angeles',
    ];

    /** The eight fixed routine headings R2 freezes. */
    const HEADINGS = [
        'Owner Bot',
        'Schedule',
        'Inputs',
        'Steps',
        'Expected result',
        'Approval boundary',
        'Missing / stale',
        'Mac import',
    ];

    it('AC1 — kk-collect renders the complete consent-preserving routine', async () => {
        const result = await run(GROK_GREET);

        expect(result.code).toBe(0);
        expect(result.err).toBe('');
        // Every frozen heading is present, in order (the routine is read top-down in the Bot editor).
        const positions = HEADINGS.map((heading) => result.out.indexOf(heading));
        for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(result.out).toContain('## Owner Bot\n\nkk-cloud');
        expect(result.out).toContain('0 4,10,16,22 * * *');
        expect(result.out).toContain('America/Los_Angeles');
        // The run script is the store-free kk-collect prefix and its push lands on the sync branch.
        expect(result.out).toContain('kk stage collect-prepare');
        expect(result.out).toContain('kk executor fan-in');
        expect(result.out).toContain('sync/kk-collect/$stamp.json');
        expect(result.out).toContain('kk-cloud-sync');
        expect(result.out).toContain('kk store ingest --run cloud-');
        expect(result.out).toContain('no-content');
        // Consent-preserving: kk only prints; creating the routine is an operator action.
        expect(result.out).toContain('routine');
        // No placeholder survived, and no placeholder the launchd/cron render carries is present.
        expect(result.out).not.toContain('{{');
        expect(result.out).not.toContain('{{repo}}');
        expect(result.out).not.toContain('{{home}}');
    });

    it('AC2a — a grok-bot render without --bot fails loud naming the flag', async () => {
        const result = await run([
            'schedule',
            'render',
            'kk-collect',
            '--platform',
            'grok-bot',
            '--tz',
            'America/Los_Angeles',
        ]);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('kk.schedule.render.failed');
        expect(result.err).toContain('--bot');
    });

    it('AC2b — a sub-5-minute --cron expression is rejected', async () => {
        const result = await run([...GROK_GREET, '--cron', '*/2 * * * *']);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('kk.schedule.render.failed');
        expect(result.err).toContain('*/2 * * * *');
        expect(result.err).toContain('5');
    });

    it('AC2c — a 4-field --cron expression is rejected', async () => {
        const result = await run([...GROK_GREET, '--cron', '0 4,10,16,22 *']);

        expect(result.code).toBe(1);
        expect(result.out).toBe('');
        expect(result.err).toContain('kk.schedule.render.failed');
        expect(result.err).toContain('0 4,10,16,22 *');
    });

    it('AC2d — grok-bot-only flags on launchd/cron fail naming all three', async () => {
        for (const platform of ['launchd', 'cron']) {
            const result = await run(['schedule', 'render', 'kk-collect', '--platform', platform, '--bot', 'b']);
            expect(result.code).toBe(1);
            expect(result.out).toBe('');
            expect(result.err).toContain('--bot/--tz/--cron are only valid with --platform grok-bot');

            const tz = await run(['schedule', 'render', 'kk-collect', '--platform', platform, '--tz', 'UTC']);
            expect(tz.code).toBe(1);
            expect(tz.err).toContain('--bot/--tz/--cron are only valid with --platform grok-bot');

            const cron = await run(['schedule', 'render', 'kk-collect', '--platform', platform, '--cron', '0 4 * * *']);
            expect(cron.code).toBe(1);
            expect(cron.err).toContain('--bot/--tz/--cron are only valid with --platform grok-bot');
        }
    });

    it('AC3 — store- or browser-bound schedules are refused on grok-bot with the ADR-044 sentence', async () => {
        const ADR_SENTENCE = 'cloud routines run store-free, browser-free work only (ADR-044)';
        for (const schedule of ['kk-daily-publish3-cn-peak', 'kk-daily-publish3-overseas', 'kk-serve']) {
            const result = await run(['schedule', 'render', schedule, '--platform', 'grok-bot', '--bot', 'b']);
            expect(result.code).toBe(1);
            expect(result.out).toBe('');
            expect(result.err).toContain('kk.schedule.render.failed');
            expect(result.err).toContain(ADR_SENTENCE);
        }
        // The launchd/cron refusals stay byte-identical: kk-serve has no cron template, and the
        // existing render paths are untouched.
        const serveCron = await run(['schedule', 'render', 'kk-serve', '--platform', 'cron', '--repo', REPO]);
        expect(serveCron.code).toBe(1);
        expect(serveCron.err).toContain("schedule 'kk-serve' has no cron template (expected launchd)");
        expect(serveCron.err).not.toContain('store-free');
        const collectCron = await run(['schedule', 'render', 'kk-collect', '--platform', 'cron', '--repo', REPO]);
        expect(collectCron.code).toBe(0);
        const collectLaunchd = await run(['schedule', 'render', 'kk-collect', '--platform', 'launchd', '--repo', REPO]);
        expect(collectLaunchd.code).toBe(0);
    });

    it('AC4 — no credential leaks into the routine text', async () => {
        const previous = process.env.TYPESAFE_API_KEY;
        try {
            process.env.TYPESAFE_API_KEY = 'apikey_test_leak';
            const result = await run(GROK_GREET);
            expect(result.code).toBe(0);
            expect(result.out).not.toContain('apikey_test_leak');
            expect(result.out).not.toContain('{{');
        } finally {
            if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
            else process.env.TYPESAFE_API_KEY = previous;
        }
    });

    it('R3 — the grok-bot cadence default and host zone fill in', async () => {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await run(['schedule', 'render', 'kk-collect', '--platform', 'grok-bot', '--bot', 'kk-cloud']);

        expect(result.code).toBe(0);
        expect(result.out).toContain(zone);
        expect(result.out).toContain('0 4,10,16,22 * * *');
    });
});
