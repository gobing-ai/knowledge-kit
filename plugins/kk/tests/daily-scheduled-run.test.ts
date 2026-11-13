import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dir, '../../..');
const runner = join(repo, 'plugins/kk/scripts/daily-scheduled-run.ts');
const evidence = join(repo, '.works/tmp/test-daily-recovery/scheduler');

describe('scheduled daily run supervision (0338)', () => {
    it('defaults wechat_live to false and forwards an explicit --wechat-live flag to the child workflow', async () => {
        for (const policy of [
            { name: 'default', args: [], expected: 'false' },
            { name: 'live', args: ['--wechat-live'], expected: 'true' },
        ]) {
            const dir = join(evidence, String(process.pid), 'wechat-live-policy', policy.name);
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(join(dir, 'bin'), { recursive: true });
            const fake = join(dir, 'bin/spur');
            writeFileSync(
                fake,
                `#!${process.execPath}
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('acquire')) console.log(JSON.stringify({ acquired: true }));
if (args.includes('run')) {
    writeFileSync(process.env.PROBE_VARS, args[args.indexOf('--vars') + 1]);
}
process.exit(0);
`,
            );
            chmodSync(fake, 0o755);
            const kk = join(dir, 'bin/kk');
            writeFileSync(kk, readFileSync(fake));
            chmodSync(kk, 0o755);
            const receipt = join(dir, 'receipt.json');
            const proc = Bun.spawn(
                [
                    process.execPath,
                    runner,
                    '--repo',
                    repo,
                    '--works-dir',
                    join(dir, 'works'),
                    '--run-id',
                    `wechat-live-policy-${policy.name}`,
                    '--timeout-ms',
                    '5000',
                    '--skip-probe',
                    '--allow-dirty',
                    '--receipt',
                    receipt,
                    ...policy.args,
                ],
                {
                    env: {
                        ...process.env,
                        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
                        PROBE_VARS: join(dir, 'vars.json'),
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
            expect({ policy: policy.name, exitCode, stdout, stderr }).toMatchObject({ exitCode: 4 });
            const vars = JSON.parse(readFileSync(join(dir, 'vars.json'), 'utf-8')) as Record<string, unknown>;
            expect(vars.wechat_live).toBe(policy.expected);
        }
    }, 20000);

    it('records success, closes failures, and reaps a timed-out workflow before finalizing its ledger', async () => {
        const results: Record<string, unknown>[] = [];
        for (const scenario of [
            'success',
            'no-content',
            'no-content-after-send',
            'partial',
            'missing-result',
            'channel-failure',
            'missing-completeness',
            'failure',
            'failure-after-send',
            'failure-classify',
            'failure-stale-trace',
            'failure-inflight-trace',
            'timeout',
            'timeout-ignore-term',
            'timeout-detached',
        ]) {
            const dir = join(evidence, String(process.pid), scenario);
            rmSync(dir, { recursive: true, force: true });
            mkdirSync(join(dir, 'bin'), { recursive: true });
            const fake = join(dir, 'bin/spur');
            writeFileSync(
                fake,
                `#!${process.execPath}
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_ACTIONS, JSON.stringify(args) + '\\n');
if (args.includes('acquire')) console.log(JSON.stringify({ acquired: true }));
if (args.includes('trace')) {
    const startedAt = new Date(Number(readFileSync(process.env.PROBE_STARTTIME, 'utf8')) - (process.env.PROBE_SCENARIO === 'failure-stale-trace' ? 86400000 : 0)).toISOString();
    const status = process.env.PROBE_SCENARIO === 'failure-inflight-trace' ? 'running' : process.env.PROBE_SCENARIO.startsWith('no-content') ? 'done' : 'failed';
    const sendNode = ['failure-after-send','no-content-after-send'].includes(process.env.PROBE_SCENARIO) ? 'publish-surfdash' : process.env.PROBE_SCENARIO === 'failure-classify' ? 'publish-classify' : 'safety';
    console.log(JSON.stringify({run:{runId:args[args.indexOf('trace')+1],workflowName:'kk-daily-ai-voice2',startedAt,status},events:[{kind:'action',node:sendNode,status:'failed'}]}));
}
if (args.includes('release')) console.log(JSON.stringify({released:3}));
if (args.includes('run')) {
    writeFileSync(process.env.PROBE_STARTED, String(process.pid));
    writeFileSync(process.env.PROBE_STARTTIME, String(Date.now()));
    const vars = JSON.parse(args[args.indexOf('--vars') + 1]);
    mkdirSync(join(vars.work_dir, '31-publish'), { recursive: true });
    if (['success', 'partial', 'channel-failure', 'missing-completeness'].includes(process.env.PROBE_SCENARIO)) {
        writeFileSync(join(vars.work_dir, '31-publish', vars.run_date + '_17_publish_publish-status.txt'), process.env.PROBE_SCENARIO === 'partial' ? 'partial' : 'full');
    }
    if (process.env.PROBE_SCENARIO !== 'missing-completeness') {
        writeFileSync(join(vars.work_dir, '31-publish', vars.run_date + '_17_publish_completeness.json'), JSON.stringify({rows:[{channel:'wechat',state:process.env.PROBE_SCENARIO==='channel-failure'?'failed':'done'},{channel:'locales',state:'done'},{channel:'cms-resync',state:'done'},{channel:'xhs',state:'not-run'}]}));
    }
    if (process.env.PROBE_SCENARIO.startsWith('no-content')) writeFileSync(join(vars.work_dir, 'run-report.summary.txt'), 'no-content: insufficient source material');
    if (process.env.PROBE_SCENARIO.startsWith('timeout')) {
        if (process.env.PROBE_SCENARIO === 'timeout-ignore-term') process.on('SIGTERM', () => {});
        const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1000)'], {detached:process.env.PROBE_SCENARIO==='timeout-detached'});
        writeFileSync(process.env.PROBE_CHILD, String(child.pid));
        setInterval(() => {}, 1000);
    } else process.exit(process.env.PROBE_SCENARIO.startsWith('failure') ? 7 : 0);
}
`,
            );
            chmodSync(fake, 0o755);
            writeFileSync(join(dir, 'bin/kk'), readFileSync(fake));
            chmodSync(join(dir, 'bin/kk'), 0o755);
            const actionsFile = join(dir, 'actions.jsonl');
            const receipt = join(dir, 'receipt.json');
            const proc = Bun.spawn(
                [
                    process.execPath,
                    runner,
                    '--repo',
                    repo,
                    '--works-dir',
                    join(dir, 'works'),
                    '--run-id',
                    `recovery-test-${scenario}`,
                    '--timeout-ms',
                    scenario.startsWith('timeout') ? '400' : '5000',
                    '--skip-probe',
                    '--allow-dirty',
                    '--receipt',
                    receipt,
                    '--agent',
                    'fixture',
                ],
                {
                    env: {
                        ...process.env,
                        PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
                        PROBE_ACTIONS: actionsFile,
                        PROBE_SCENARIO: scenario,
                        PROBE_STARTED: join(dir, 'started'),
                        PROBE_STARTTIME: join(dir, 'start-time'),
                        PROBE_CHILD: join(dir, 'child'),
                    },
                    stdout: 'pipe',
                    stderr: 'pipe',
                },
            );
            let watchdogForced = false;
            const watchdog = setTimeout(() => {
                watchdogForced = true;
                try {
                    process.kill(-Number(readFileSync(join(dir, 'started'), 'utf-8')), 'SIGKILL');
                } catch {}
                try {
                    process.kill(Number(readFileSync(join(dir, 'child'), 'utf-8')), 'SIGKILL');
                } catch {}
            }, 2500);
            const [exitCode, stdout, stderr] = await Promise.all([
                proc.exited,
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
            ]);
            clearTimeout(watchdog);
            expect(watchdogForced).toBe(false);
            expect({ scenario, exitCode, stdout, stderr }).toMatchObject({
                exitCode:
                    scenario === 'success'
                        ? 0
                        : scenario.startsWith('failure')
                          ? 7
                          : scenario.startsWith('timeout')
                            ? 124
                            : 4,
            });
            const row = JSON.parse(readFileSync(receipt, 'utf-8')) as Record<string, unknown>;
            expect(row.runId).toBe(`recovery-test-${scenario}`);
            expect(row.status).toBe(
                scenario === 'success'
                    ? 'done'
                    : scenario.startsWith('failure')
                      ? 'failed'
                      : scenario.startsWith('timeout')
                        ? 'timed-out'
                        : scenario.startsWith('no-content')
                          ? 'no-content'
                          : 'incomplete',
            );
            const actions = readFileSync(actionsFile, 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as string[]);
            const launch = actions.find((args) => args.includes('run'));
            expect(launch).toBeDefined();
            const vars = JSON.parse(launch?.[(launch?.indexOf('--vars') ?? -1) + 1] ?? '{}');
            expect(vars).toMatchObject({
                publish_enabled: 'true',
                skip_review: 'true',
                agent: 'fixture',
            });
            expect(vars.agent_retry).toBeUndefined();
            // 0360 R8: every receipt names the checkout that ran and the executor it used.
            expect(row.executor).toBe('fixture');
            expect(typeof row.checkoutCommit).toBe('string');
            // 0360 R7: the single-flight lock is taken before the run and released on every exit.
            const lockCalls = actions.filter((args) => args[0] === 'lock');
            expect(lockCalls.at(0)?.[1]).toBe('acquire');
            expect(String(lockCalls.at(0)?.[lockCalls.at(0)?.indexOf('--name') + 1])).toMatch(
                /^kk-daily-ai-voice2-\d{8}$/,
            );
            expect(lockCalls.at(-1)?.[1]).toBe('release');
            expect(actions.some((args) => args.includes('sync'))).toBe(true);
            const cancelled = actions.filter((args) => args.includes('cancel'));
            expect(cancelled.length).toBe(scenario.startsWith('failure') || scenario.startsWith('timeout') ? 2 : 0);
            expect(actions.some((args) => args.includes('store') && args.includes('release'))).toBe(
                scenario === 'failure' || scenario.startsWith('timeout') || scenario === 'no-content',
            );
            if (scenario.startsWith('timeout')) {
                for (const path of ['started', 'child']) {
                    const pid = Number(readFileSync(join(dir, path), 'utf-8'));
                    let running = true;
                    try {
                        process.kill(pid, 0);
                    } catch {
                        running = false;
                    }
                    if (running) {
                        try {
                            process.kill(pid, 'SIGKILL');
                        } catch {}
                    }
                    expect({ path, pid, running }).toMatchObject({ running: false });
                }
            }
            results.push({ scenario, exitCode, receipt: row, actions });
        }
        writeFileSync(
            join(evidence, 'summary.json'),
            JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
        );
    }, 20000);

    it('launches voice3 vars, judges the after-generate outcome, and syncs the voice3 ledger (0432)', async () => {
        const dir = join(evidence, String(process.pid), 'voice3');
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, 'bin'), { recursive: true });
        const fake = join(dir, 'bin/spur');
        writeFileSync(
            fake,
            `#!${process.execPath}
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_ACTIONS, JSON.stringify(args) + '\\n');
if (args.includes('acquire')) console.log(JSON.stringify({ acquired: true }));
if (args.includes('trace')) {
    const startedAt = new Date(Number(readFileSync(process.env.PROBE_STARTTIME, 'utf8'))).toISOString();
    console.log(JSON.stringify({run:{runId:args[args.indexOf('trace')+1],workflowName:'kk-daily-ai-voice3',startedAt,status:'failed'},events:[{kind:'action',node:'publish',status:'failed'}]}));
}
if (args.includes('run')) {
    writeFileSync(process.env.PROBE_STARTED, String(process.pid));
    writeFileSync(process.env.PROBE_STARTTIME, String(Date.now()));
    const vars = JSON.parse(args[args.indexOf('--vars') + 1]);
    mkdirSync(join(vars.work_dir, '4-publish'), { recursive: true });
    writeFileSync(join(vars.work_dir, '4-publish', 'publish-status.after-generate.txt'), 'full\\n');
    writeFileSync(join(vars.work_dir, '4-publish', 'outcome.after-generate.json'), JSON.stringify({rows:[
        {id:'surfdash-pub-post', required:true, status:'succeeded', dummy:false},
        {id:'xhs-pub-longform', required:false, status:'failed', dummy:true},
    ]}));
    process.exit(0);
}
`,
        );
        chmodSync(fake, 0o755);
        writeFileSync(join(dir, 'bin/kk'), readFileSync(fake));
        chmodSync(join(dir, 'bin/kk'), 0o755);
        const actionsFile = join(dir, 'actions.jsonl');
        const receipt = join(dir, 'receipt.json');
        const proc = Bun.spawn(
            [
                process.execPath,
                runner,
                '--repo',
                repo,
                '--works-dir',
                join(dir, 'works'),
                '--run-id',
                'voice3-test',
                '--timeout-ms',
                '5000',
                '--skip-probe',
                '--allow-dirty',
                '--receipt',
                receipt,
                '--workflow',
                'kk-daily-ai-voice3',
                '--window',
                '72h',
                '--agent',
                'fixture',
            ],
            {
                env: {
                    ...process.env,
                    PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
                    PROBE_ACTIONS: actionsFile,
                    PROBE_STARTED: join(dir, 'started'),
                    PROBE_STARTTIME: join(dir, 'start-time'),
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
        expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
        const row = JSON.parse(readFileSync(receipt, 'utf-8')) as Record<string, unknown>;
        expect(row.status).toBe('done');
        expect(row.primaryPublishStatus).toBe('full');
        expect(row.missingRequiredChannels).toEqual([]);
        const actions = readFileSync(actionsFile, 'utf-8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as string[]);
        const launch = actions.find((args) => args.includes('run'));
        const yaml = launch?.[launch.indexOf('run') + 1] ?? '';
        expect(yaml).toContain('kk-daily-ai-voice3.yaml');
        const vars = JSON.parse(launch?.[(launch.indexOf('--vars') ?? -1) + 1] ?? '{}');
        expect(vars).toMatchObject({
            auto_publish: 'true',
            window: '72h',
            skip_review: 'true',
            agent: 'fixture',
        });
        expect(vars.agent_retry).toBeUndefined();
        expect(row.executor).toBe('fixture');
        expect(vars.wechat_live).toBeUndefined();
        expect(vars.publish_enabled).toBeUndefined();
        expect(actions.some((args) => args.includes('store') && args.includes('release'))).toBe(false);
        const sync = actions.find((args) => args.includes('sync'));
        expect(sync).toContain('--workflow');
        expect(sync?.[sync.indexOf('--workflow') + 1]).toBe('kk-daily-ai-voice3');
    }, 20000);

    it('probes the default inline executor through its role before any run row exists (0360 AC2)', async () => {
        const dir = join(evidence, String(process.pid), 'probe-default-inline');
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, 'bin'), { recursive: true });
        const stub = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_ACTIONS, JSON.stringify(args) + '\\n');
if (args.includes('acquire')) console.log(JSON.stringify({ acquired: true }));
if (args.includes('agent')) process.exit(1);
process.exit(0);
`;
        for (const name of ['spur', 'kk']) {
            const path = join(dir, 'bin', name);
            writeFileSync(path, stub);
            chmodSync(path, 0o755);
        }
        const actionsFile = join(dir, 'actions.jsonl');
        const receipt = join(dir, 'receipt.json');
        const proc = Bun.spawn(
            [
                process.execPath,
                runner,
                '--repo',
                repo,
                '--works-dir',
                join(dir, 'works'),
                '--run-id',
                'probe-default-inline',
                '--workflow',
                'kk-daily-ai-voice3',
                '--generate-only',
                '--timeout-ms',
                '5000',
                '--allow-dirty',
                '--receipt',
                receipt,
            ],
            {
                env: {
                    ...process.env,
                    PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
                    PROBE_ACTIONS: actionsFile,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        const [exitCode, , stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect({ exitCode, stderr }).toMatchObject({ exitCode: 5 });
        const row = JSON.parse(readFileSync(receipt, 'utf-8')) as {
            status: string;
            preflight?: { reasons?: string[] };
        };
        expect(row.status).toBe('preflight-refused');
        expect(row.preflight?.reasons?.some((reason) => reason.includes('scribe'))).toBe(true);
        const actions = readFileSync(actionsFile, 'utf-8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as string[]);
        // The default inline executor is probed through its role, and no workflow run is started.
        const probe = actions.find((args) => args.includes('agent'));
        expect(probe?.[probe.indexOf('--agent') + 1]).toBe('scribe');
        expect(actions.some((args) => args.includes('run') && args.includes('workflow'))).toBe(false);
        expect(actions.some((args) => args[0] === 'lock' && args[1] === 'release')).toBe(true);
    }, 20000);

    it('refuses a second launch for the same workflow and day without touching the receipt (0360 AC3)', async () => {
        const dir = join(evidence, String(process.pid), 'lock-held');
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(join(dir, 'bin'), { recursive: true });
        const stub = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
appendFileSync(process.env.PROBE_ACTIONS, JSON.stringify(args) + '\\n');
if (args.includes('acquire')) console.log(JSON.stringify({ skipped: 'locked', holder: 'A' }));
process.exit(0);
`;
        for (const name of ['spur', 'kk']) {
            const path = join(dir, 'bin', name);
            writeFileSync(path, stub);
            chmodSync(path, 0o755);
        }
        const receipt = join(dir, 'schedule-receipt.json');
        const firstOwner = `${JSON.stringify({ runId: 'A', status: 'running' }, null, 2)}\n`;
        writeFileSync(receipt, firstOwner);
        const actionsFile = join(dir, 'actions.jsonl');
        const proc = Bun.spawn(
            [
                process.execPath,
                runner,
                '--repo',
                repo,
                '--works-dir',
                join(dir, 'works'),
                '--run-id',
                'lock-held-second-launch',
                '--workflow',
                'kk-daily-ai-voice3',
                '--timeout-ms',
                '5000',
                '--skip-probe',
                '--allow-dirty',
                '--receipt',
                receipt,
            ],
            {
                env: {
                    ...process.env,
                    PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`,
                    PROBE_ACTIONS: actionsFile,
                },
                stdout: 'pipe',
                stderr: 'pipe',
            },
        );
        const [exitCode, , stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect({ exitCode }).toMatchObject({ exitCode: 6 });
        expect(stderr).toContain('already running');
        expect(stderr).toContain('A');
        // The held lock leaves the incumbent's receipt byte-identical, and nothing is launched.
        expect(readFileSync(receipt, 'utf-8')).toBe(firstOwner);
        const actions = readFileSync(actionsFile, 'utf-8')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line) as string[]);
        expect(actions.some((args) => args.includes('workflow'))).toBe(false);
        expect(actions.some((args) => args[0] === 'lock' && args[1] === 'release')).toBe(false);
    }, 20000);
});
