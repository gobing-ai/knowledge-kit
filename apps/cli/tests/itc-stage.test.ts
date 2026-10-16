import { describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runItcStage } from '../src/itc-stage';

/**
 * 0303 — the ITC stage dispatcher boundary.
 *
 * It owns ONE decision: which stage names the native handler claims. Every non-ITC name must fall
 * through with `undefined` so the legacy `runStage` subprocess path still serves it, and every
 * claimed name must reach its handler and report an actionable failure instead of throwing.
 */

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-itc-stage-'));
    try {
        await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('runItcStage dispatch boundary', () => {
    it('returns undefined for every non-ITC stage so the legacy runner takes over', async () => {
        expect(await runItcStage([])).toBeUndefined();
        expect(await runItcStage(['daily-publish-partial', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['prepare-itc', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['itc-materialize', '/tmp/w'])).toBeUndefined();
        expect(await runItcStage(['itc-outline-pick', '/tmp/w'])).toBeUndefined();
    });

    it('claims every native ITC stage and reports a missing request file instead of throwing', async () => {
        for (const stage of [
            'itc-publish-plan',
            'itc-topic-extract',
            'itc-topic-validate',
            'itc-topic-select',
            'itc-selection-settle',
            'itc-decision',
            'itc-author-complete',
            'itc-author-verdict',
            'itc-materialize-plan',
            'itc-check-targets',
            'itc-send-targets',
            'itc-reconcile-receipts',
            'itc-export-seo',
            'itc-report-summary',
            'itc-prepare',
        ]) {
            const result = await runItcStage([stage, '/tmp/definitely-absent-workspace']);
            expect(result, stage).not.toBeUndefined();
        }
    });

    it('fails loud on a non-JSON request body rather than crashing', async () => {
        await withTempDir(async (dir) => {
            const request = join(dir, 'launch.json');
            writeFileSync(request, 'not json at all');
            const result = await runItcStage(['itc-prepare', '--request', request]);
            expect(result).toBe(1);
        });
    });

    it('a valid launch resolves and writes ONLY under the pinned HOME', async () => {
        await withTempDir(async (dir) => {
            const home = join(dir, 'home');
            const request = join(dir, 'launch.json');
            writeFileSync(request, JSON.stringify({ topic: 'reliable-workflows', parentRunId: 'run-x' }));

            // The stage reads the ambient env, so pin HOME for the duration — never the operator's.
            const priorHome = process.env.HOME;
            const priorConfig = process.env.KK_CONFIG;
            const priorWorks = process.env.KK_WORKS_DIR;
            process.env.HOME = home;
            delete process.env.KK_CONFIG;
            delete process.env.KK_WORKS_DIR;
            let result: number | undefined;
            try {
                result = await runItcStage(['itc-prepare', '--request', request]);
            } finally {
                if (priorHome === undefined) delete process.env.HOME;
                else process.env.HOME = priorHome;
                if (priorConfig !== undefined) process.env.KK_CONFIG = priorConfig;
                if (priorWorks !== undefined) process.env.KK_WORKS_DIR = priorWorks;
            }
            expect(result).toBe(0);
            expect(existsSync(join(home, '.config/kk/works/kk-itc/reliable-workflows/itc-options.json'))).toBe(true);
        });
    });
});

/** Pin env keys for one call so a stage reading the ambient env never touches the operator's. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const prior = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(prior)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

describe('itc-prepare --chosen (0299 R2 / 0303 R1)', () => {
    function seedIntake(dir: string, parentRunId: string): string {
        const intake = join(dir, 'intake');
        mkdirSync(intake, { recursive: true });
        writeFileSync(
            join(intake, 'chosen-source.json'),
            JSON.stringify({
                parentRunId,
                topicName: 'async-rust',
                displayTitle: 'Async Rust in Practice',
                topicProfile: 'rust-weekly',
            }),
        );
        writeFileSync(join(intake, 'selected-docs.json'), '[{"id":"d1"}]');
        writeFileSync(join(intake, 'topic-pool-manifest.json'), '{"items":[]}');
        return intake;
    }
    const prepare = (dir: string, launch: Record<string, unknown>, intake: string): Promise<number | undefined> => {
        const request = join(dir, 'launch.json');
        writeFileSync(request, JSON.stringify(launch));
        return withEnv({ HOME: join(dir, 'home'), KK_CONFIG: undefined, KK_WORKS_DIR: undefined }, () =>
            runItcStage(['itc-prepare', '--request', request, '--chosen', intake]),
        );
    };

    it('finalizes the intake snapshot into a prepared workspace that owns its selection evidence', async () => {
        await withTempDir(async (dir) => {
            const intake = seedIntake(dir, 'run-c');
            const workDir = join(dir, 'ws');
            expect(await prepare(dir, { fromCollect: 'rust-weekly', parentRunId: 'run-c', dir: workDir }, intake)).toBe(
                0,
            );
            const options = JSON.parse(readFileSync(join(workDir, 'itc-options.json'), 'utf-8'));
            expect(options).toMatchObject({
                status: 'prepared',
                sourceKind: 'from_collect',
                parentRunId: 'run-c',
                workDir,
                topicName: 'async-rust',
                displayTitle: 'Async Rust in Practice',
                topicProfile: 'rust-weekly',
            });
            expect(readFileSync(join(workDir, 'docs.json'), 'utf-8')).toBe('[{"id":"d1"}]');
            expect(existsSync(join(workDir, 'chosen-source.json'))).toBe(true);
            expect(existsSync(join(workDir, 'topic-pool-manifest.json'))).toBe(true);
        });
    });

    it("refuses another run's chosen source and writes no workspace", async () => {
        await withTempDir(async (dir) => {
            const intake = seedIntake(dir, 'run-other');
            const workDir = join(dir, 'ws');
            expect(await prepare(dir, { fromCollect: 'rust-weekly', parentRunId: 'run-c', dir: workDir }, intake)).toBe(
                1,
            );
            expect(existsSync(workDir)).toBe(false);
        });
    });

    it('rejects --chosen on a non-collected launch and a missing chosen source', async () => {
        await withTempDir(async (dir) => {
            const intake = seedIntake(dir, 'run-c');
            expect(await prepare(dir, { topic: 'plain-topic', parentRunId: 'run-c' }, intake)).toBe(1);
            expect(await prepare(dir, { fromCollect: 'rust-weekly', parentRunId: 'run-c' }, join(dir, 'nope'))).toBe(1);
        });
    });
});

describe('itc-decision slot forms (0301 R1)', () => {
    // A stub `spur decision run` that answers with whatever value the test names.
    function stubSpur(dir: string, value: string): string {
        const bin = join(dir, 'spur-stub');
        writeFileSync(bin, `#!/bin/sh\nprintf '{"value":"${value}","reason":"stub","maker":"stub"}'\n`);
        chmodSync(bin, 0o755);
        return bin;
    }
    function seedOutlines(workDir: string): void {
        mkdirSync(join(workDir, '2-outline'), { recursive: true });
        for (const id of ['a', 'b'])
            writeFileSync(join(workDir, `2-outline/outline-option-${id}.md`), `# Option ${id}\n`);
        writeFileSync(join(workDir, '2-outline/outline-recommendation.json'), '{"pick":"b"}');
    }

    it('binds a valid outline pick into .auto-pick and records the decision', async () => {
        await withTempDir(async (dir) => {
            seedOutlines(dir);
            const code = await withEnv({ SPUR_BIN: stubSpur(dir, 'b') }, () =>
                runItcStage(['itc-decision', '--outline', dir, 'run-o']),
            );
            expect(code).toBe(0);
            expect(readFileSync(join(dir, '2-outline/.auto-pick'), 'utf-8')).toBe('b');
            const decision = JSON.parse(readFileSync(join(dir, '2-outline/outline-decision.json'), 'utf-8'));
            expect(decision).toMatchObject({ decisionId: 'kk-itc-outline-choice', value: 'b', parentRunId: 'run-o' });
        });
    });

    it('an out-of-set pick defers: .auto-pick stays empty so the child pauses, never guesses', async () => {
        await withTempDir(async (dir) => {
            seedOutlines(dir);
            const code = await withEnv({ SPUR_BIN: stubSpur(dir, 'c') }, () =>
                runItcStage(['itc-decision', '--outline', dir, 'run-o']),
            );
            expect(code).toBe(0);
            expect(readFileSync(join(dir, '2-outline/.auto-pick'), 'utf-8')).toBe('');
        });
    });

    it('fails without outline options or without the run id', async () => {
        await withTempDir(async (dir) => {
            expect(await runItcStage(['itc-decision', '--outline', dir, 'run-o'])).toBe(1);
            expect(await runItcStage(['itc-decision', '--outline', dir])).toBe(1);
        });
    });

    it('chooses a topic from the validated candidates', async () => {
        await withTempDir(async (dir) => {
            writeFileSync(
                join(dir, 'topic-candidates.json'),
                JSON.stringify({ candidates: [{ id: 't1', title: 'Async Rust', reason: 'fresh' }] }),
            );
            const code = await withEnv({ SPUR_BIN: stubSpur(dir, 't1') }, () =>
                runItcStage(['itc-decision', '--topic', dir, 'run-t']),
            );
            expect(code).toBe(0);
            expect(JSON.parse(readFileSync(join(dir, 'topic-decision.json'), 'utf-8')).value).toBe('t1');
        });
    });
});
