/**
 * The scheduler runs without padding scripts (task 0369 R1/R2, G61, design §7).
 *
 * Reads the three daily job commands straight from `.spur/config.yaml`, runs each one in the launch
 * sandbox (stub `spur` recording every spawn, stub workflows, so nothing is published) and asserts
 * the command is a `kk` verb that starts no entry script: no `scripts/` path in the command or in any
 * recorded argv, and exactly one `spur workflow run` per launch (one generate at most, one publish).
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { project, repoRoot, runCli } from './launch-sandbox';

/**
 * design §7: job name → the exact replacement command.
 *
 * Each command also pins `--agent pi-dsv4.1-flash-cc` (task 0373, 2026-11-15). Cost-first executor
 * resolution on the production host landed on executors that die at dispatch — opencode `-free`
 * answers "Invalid credential", `agy-gemini` needs an expired Google login and `pi-dsv4.1-flash-volc`
 * is 429 until 2026-11-18 — so every 04:30 run failed in the executor probe. Pin what answers here;
 * the assertion this file exists for (a `kk` verb, no `scripts/` entry point, no bare `bun`) is
 * unchanged by the suffix.
 */
const JOBS: Record<string, string> = {
    'kk-daily-ai-voice': 'kk news generate --publish --skip-review --agent pi-dsv4.1-flash-cc',
    'kk-daily-publish3': 'kk news publish --window overseas-rss --unattended --agent pi-dsv4.1-flash-cc',
    'kk-daily-publish3-cn-peak': 'kk news publish --window cn-peak --unattended --agent pi-dsv4.1-flash-cc',
};

/**
 * One scheduler job's state in the checked-in config. A job may be deliberately DISABLED (commented
 * out with a dated reason — `kk-daily-publish3-cn-peak` was, while generation still overran the
 * 17:00 tick), and that is not the silent deletion this file exists to catch: a disabled job must
 * still be present as a commented block carrying its DISABLED reason.
 */
type JobState = { enabled: true; command: string } | { enabled: false; reason: string };

function jobState(name: string): JobState {
    const lines = readFileSync(join(repoRoot, '.spur', 'config.yaml'), 'utf8').split('\n');
    const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
    if (start >= 0) {
        for (const line of lines.slice(start + 1)) {
            const trimmed = line.trim();
            if (trimmed.startsWith('- name:')) break;
            if (trimmed.startsWith('command:'))
                return { enabled: true, command: trimmed.slice('command:'.length).trim() };
        }
        throw new Error(`scheduler job '${name}' has no command`);
    }
    const disabled = lines.findIndex((line) => line.trim() === `# - name: ${name}`);
    if (disabled < 0) throw new Error(`scheduler job '${name}' is neither enabled nor disabled in .spur/config.yaml`);
    const reason = lines
        .slice(0, disabled)
        .filter((line) => line.trim().startsWith('#'))
        .reverse()
        .find((line) => /DISABLED/i.test(line));
    if (reason === undefined) throw new Error(`scheduler job '${name}' is commented out without a DISABLED reason`);
    return { enabled: false, reason: reason.trim() };
}

describe('scheduler job commands start no entry script (0369 R1, R2)', () => {
    it('runs each of the three jobs as kk verbs with one workflow run per launch', async () => {
        const summary: Array<Record<string, unknown>> = [];
        for (const [name, expected] of Object.entries(JOBS)) {
            const state = jobState(name);
            if (!state.enabled) {
                // Disabled on purpose: nothing to exercise, but the reason must survive in the config.
                expect(state.reason).toMatch(/DISABLED/i);
                summary.push({ job: name, enabled: false, reason: state.reason });
                continue;
            }
            const command = state.command;
            expect(command).toBe(expected);
            const argv = command.split(/\s+/);
            expect(argv[0]).toBe('kk');

            const sandbox = project();
            try {
                const result = await runCli(argv.slice(1));
                const spawned = sandbox.log();
                const runs = sandbox.workflowRuns();
                const generates = runs.filter((line) => line.includes('kk-news-generate.yaml'));
                const publishes = runs.filter((line) => line.includes('kk-publish.yaml'));

                expect(result.code).toBe(0);
                // No `bun <path under scripts/>` — neither in the job line nor in anything it spawned.
                expect([command, ...spawned].filter((line) => /(^|[\s/"'=])scripts\//.test(line))).toEqual([]);
                expect(spawned.filter((line) => /(^|\s)bun\s/.test(line))).toEqual([]);
                expect(generates.length).toBeLessThanOrEqual(1);
                expect(publishes).toHaveLength(1);
                expect(runs).toHaveLength(generates.length + publishes.length);
                summary.push({ job: name, command, code: result.code, generates: generates.length, publishes: 1 });
            } finally {
                sandbox.restore();
            }
        }
        const summaryDir = join(repoRoot, '.works', 'tmp', 'test-schedule');
        mkdirSync(summaryDir, { recursive: true });
        writeFileSync(join(summaryDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
        expect(summary).toHaveLength(3);
    }, 60_000);
});
