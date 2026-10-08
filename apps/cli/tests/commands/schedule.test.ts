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
 *    only side effect is stdout.
 */

import { describe, expect, it } from 'bun:test';
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

describe('registerScheduleCommand', () => {
    it('R6 — registers the schedule noun with the render verb and its options', () => {
        const program = createProgram();
        const schedule = program.commands.find((command) => command.name() === 'schedule');
        expect(schedule).toBeDefined();

        expect(schedule?.commands.map((command) => command.name())).toEqual(['render']);

        const render = schedule?.commands.find((command) => command.name() === 'render');
        expect(render?.options.map((option) => option.long)).toEqual(['--platform', '--repo']);
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
