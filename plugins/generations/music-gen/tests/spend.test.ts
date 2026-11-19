import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { AnalysisOutcome } from '../src/adapter/instance';
import { createOfflineInstance } from '../src/adapter/offline';
import type { TakeSidecar } from '../src/artifact';
import { parseMusicBriefYaml } from '../src/brief';
import { DEFAULT_MUSIC_PRICES, type MusicConfig, resolveMusicConfig } from '../src/config';
import { analyzeTake, estimateMusicJob, main, processGeneratorIO } from '../src/plugin';
import { resolveJob } from '../src/presets';
import {
    DEFAULT_TAKES_CAP,
    estimateAnalyze,
    estimateGenerate,
    formatEstimate,
    formatUsd,
    HARD_TAKES_CAP,
    requireConfirmation,
    resolveTakeCount,
    resolveTakesCap,
    SpendRefusal,
    type SpendRequest,
    withConfirmation,
} from '../src/spend';
import { StubInstance } from './stub-instance';

/**
 * AC1–AC5 (task 0400) — the spend guard: a complete free estimate, the
 * confirmation gate, run-scoped dedupe, the takes cap and actionable refusals.
 *
 * Every case runs against an injected adapter or the offline one, and every
 * directory is a throwaway temp root, so no test touches the corpus and no test
 * can open a socket.
 */

const CLIP_BRIEF = `title: Midnight Cable Car
model: clip
format: clip
theme: lofi
language: EN
audio_format: mp3
style: |-
  Dusty lofi hip-hop at 78 BPM in D minor: vinyl crackle, upright bass, brushed kit, Rhodes chords.
lyrics: |-
  Last tram humming through the rain
`;

/** The zero-config shape with the documented price defaults and the default take cap. */
const CONFIG: MusicConfig = {
    baseUrl: 'http://127.0.0.1:3000',
    timeoutMs: 180_000,
    connectTimeoutMs: 5_000,
    prices: DEFAULT_MUSIC_PRICES,
    takesCap: DEFAULT_TAKES_CAP,
    dryRun: true,
};

interface RunOptions {
    /** Reuse a run directory (the dedupe cases need one that already holds a take). */
    dir?: string;
    brief?: string;
    client?: StubInstance | ReturnType<typeof createOfflineInstance>;
    config?: MusicConfig;
    /** The 0400 flags under test; the default is a confirmed generate. */
    spend?: SpendRequest;
}

interface RunOutcome {
    dir: string;
    error: Error | null;
    /** Everything the run left in the directory, `input.json` excluded. */
    files: string[];
    sidecars: TakeSidecar[];
    /** The estimate blocks the entry emitted, in order. */
    estimates: string[];
}

/** Drive `processGeneratorIO` over a throwaway run directory and collect what it did. */
async function runJob(options: RunOptions = {}): Promise<RunOutcome> {
    const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'kk-music-spend-'));
    const inputPath = join(dir, 'input.json');
    writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: options.brief ?? CLIP_BRIEF } satisfies Doc]));
    const estimates: string[] = [];
    const error = await processGeneratorIO(inputPath, join(dir, 'content.json'), {
        client: options.client ?? createOfflineInstance(),
        config: options.config ?? CONFIG,
        spend: options.spend ?? { confirmed: true },
        emit: (block: string) => estimates.push(block),
    })
        .then(() => null)
        .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))));
    const files = readdirSync(dir)
        .filter((name) => name !== 'input.json')
        .sort();
    const sidecars = files
        .filter((name) => name.endsWith('.take.json'))
        .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as TakeSidecar);
    return { dir, error, files, sidecars, estimates };
}

/** A stub instance that counts `analyze` calls, so "no analyze request" is assertable. */
class CountingInstance extends StubInstance {
    analyzeCalls = 0;

    override async analyze(instanceId: string): Promise<AnalysisOutcome> {
        this.analyzeCalls += 1;
        return await super.analyze(instanceId);
    }
}

/** Run `fn` with a throwaway config file; the caller removes nothing. */
async function withConfigFile<T>(yaml: string, fn: (path: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-music-spend-config-'));
    const path = join(dir, 'config.yaml');
    writeFileSync(path, yaml);
    try {
        return await fn(path);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('AC1 — the estimate is complete and free (R1)', () => {
    test('a generate estimate prints prompt, model, takes, unit price and total', () => {
        const job = resolveJob(parseMusicBriefYaml(CLIP_BRIEF));
        const estimate = estimateGenerate({ job, prices: DEFAULT_MUSIC_PRICES, takes: 2 });
        const block = formatEstimate(estimate);

        expect(block).toContain('music spend estimate — generate');
        expect(block).toContain('Dusty lofi hip-hop at 78 BPM in D minor');
        expect(block).toContain('model: clip');
        expect(block).toContain('takes: 2');
        expect(block).toContain('unit price: $0.04');
        expect(block).toContain('total: $0.08');
        expect(estimate).toMatchObject({ unitPrice: 0.04, total: 0.08, unpriced: false });
    });

    test('the default price config is pro 0.08 / clip 0.04, and a pro estimate uses the pro price', () => {
        const proBrief = `${CLIP_BRIEF.replace('model: clip', 'model: pro').replace('format: clip', 'format: song')}duration_target: '0:30'
`;
        const job = resolveJob(parseMusicBriefYaml(proBrief));
        const block = formatEstimate(estimateGenerate({ job, prices: DEFAULT_MUSIC_PRICES, takes: 1 }));
        expect(block).toContain('unit price: $0.08');
        expect(block).toContain('total: $0.08');
    });

    test('an analyze estimate with no configured price prints "unpriced" and still demands confirmation', () => {
        const estimate = estimateAnalyze({ prices: DEFAULT_MUSIC_PRICES, instanceId: 'gen_1', model: 'clip' });
        const block = formatEstimate(estimate);
        expect(block).toContain('unit price: unpriced');
        expect(block).toContain('total: unpriced');
        expect(estimate.unpriced).toBe(true);
        expect(estimate.total).toBeNull();
        // Unpriced is not free: R2 applies to it exactly like a priced call.
        expect(() => requireConfirmation(estimate, undefined)).toThrow(SpendRefusal);
    });

    test('a configured analyze price is used instead of unpriced', () => {
        const estimate = estimateAnalyze({
            prices: { ...DEFAULT_MUSIC_PRICES, analyze: 0.01 },
            instanceId: 'gen_1',
        });
        expect(estimate.unpriced).toBe(false);
        expect(formatEstimate(estimate)).toContain('total: $0.01');
    });

    test('--estimate-only prints the estimate, exits 0 and performs no network request', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-estimate-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
        const buffer = createBufferTarget();
        const rollback = setDefaultOutputTargets({ stdout: buffer });
        // An endpoint nothing listens on: a connection attempt would fail, so a zero exit
        // is proof the path never opened a socket.
        const previousUrl = process.env.KK_MUSIC_INSTANCE_URL;
        const previousConfig = process.env.KK_CONFIG;
        process.env.KK_MUSIC_INSTANCE_URL = 'http://127.0.0.1:1';
        process.env.KK_CONFIG = join(dir, 'no-such-config.yaml');
        try {
            const code = await main(['--in', inputPath, '--out', join(dir, 'content.json'), '--estimate-only']);
            expect(code).toBe(0);
            const output = buffer.text();
            expect(output).toContain('music spend estimate — generate');
            expect(output).toContain('model: clip');
            expect(output).toContain('unit price: $0.04');
            expect(output).toContain('total: $0.04');
            // Only the input remains: no artifact, no sidecar, no contract file.
            expect(readdirSync(dir)).toEqual(['input.json']);
        } finally {
            rollback();
            if (previousUrl === undefined) {
                delete process.env.KK_MUSIC_INSTANCE_URL;
            } else {
                process.env.KK_MUSIC_INSTANCE_URL = previousUrl;
            }
            if (previousConfig === undefined) {
                delete process.env.KK_CONFIG;
            } else {
                process.env.KK_CONFIG = previousConfig;
            }
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('--estimate-only honours --takes inside the cap and refuses a count above it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-estimate-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
        try {
            const estimate = await estimateMusicJob(inputPath, { config: CONFIG, takes: 2 });
            expect(estimate.takes).toBe(2);
            expect(estimate.total).toBe(0.08);

            const overCap = await estimateMusicJob(inputPath, { config: CONFIG, takes: 4 }).catch(
                (err: unknown) => err,
            );
            expect(overCap).toBeInstanceOf(SpendRefusal);
            expect((overCap as SpendRefusal).flag).toBe('--takes');
            expect((overCap as Error).message).toContain('configured cap of 2');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an unparseable --takes is a refusal, not a crash', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-music-estimate-'));
        const inputPath = join(dir, 'input.json');
        writeFileSync(inputPath, JSON.stringify([{ id: 'brief-1', body: CLIP_BRIEF } satisfies Doc]));
        const rollback = setDefaultOutputTargets({ stdout: createBufferTarget(), stderr: createBufferTarget() });
        try {
            expect(
                await main([
                    '--in',
                    inputPath,
                    '--out',
                    join(dir, 'content.json'),
                    '--estimate-only',
                    '--takes',
                    'lots',
                ]),
            ).toBe(1);
            expect(readdirSync(dir)).toEqual(['input.json']);
        } finally {
            rollback();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('AC2 — nothing is spent without confirmation (R2)', () => {
    test('a generate without --yes exits non-zero after printing the estimate and sends nothing', async () => {
        const client = new StubInstance();
        const run = await runJob({ client, spend: {} });
        try {
            expect(run.error).toBeInstanceOf(SpendRefusal);
            expect((run.error as SpendRefusal).flag).toBe('--yes');
            expect(run.error?.message).toContain('--yes');
            expect(client.requests).toHaveLength(0);
            expect(run.files).toEqual([]);
            expect(run.estimates).toHaveLength(1);
            expect(run.estimates[0]).toContain('total: $0.04');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('the same job with --yes spends exactly one request', async () => {
        const client = new StubInstance();
        const run = await runJob({ client });
        try {
            expect(run.error).toBeNull();
            expect(client.requests).toHaveLength(1);
            expect(run.sidecars).toHaveLength(1);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('an analyze without a confirmation flag sends no analyze request', async () => {
        const client = new CountingInstance();
        const emitted: string[] = [];
        const error = await analyzeTake('gen_1', {
            client,
            config: CONFIG,
            emit: (block: string) => emitted.push(block),
        }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(SpendRefusal);
        expect((error as SpendRefusal).flag).toBe('--yes');
        expect(client.analyzeCalls).toBe(0);
        expect(emitted[0]).toContain('music spend estimate — analyze');
        // `music.prices.analyze` has no default: the estimate is unpriced, never free.
        expect(emitted[0]).toContain('unpriced');
    });

    test('a confirmed analyze reaches the adapter exactly once', async () => {
        const client = new CountingInstance();
        const outcome = await analyzeTake('gen_1', {
            client,
            config: CONFIG,
            confirmed: true,
            emit: () => {},
        });
        expect(outcome.instanceId).toBe('gen_1');
        expect(client.analyzeCalls).toBe(1);
    });

    test('withConfirmation never runs the paid call when confirmation is absent', async () => {
        const estimate = estimateGenerate({
            job: resolveJob(parseMusicBriefYaml(CLIP_BRIEF)),
            prices: DEFAULT_MUSIC_PRICES,
            takes: 1,
        });
        let calls = 0;
        const refusal = await withConfirmation(estimate, false, async () => {
            calls += 1;
            return 'paid';
        }).catch((err: unknown) => err);
        expect(refusal).toBeInstanceOf(SpendRefusal);
        expect(calls).toBe(0);
        expect(await withConfirmation(estimate, true, async () => 'paid')).toBe('paid');
    });
});

describe('AC3 — a duplicate is refused within the run, not across runs (R3)', () => {
    test('the same brief into a run directory that already holds the take is refused with path and digest', async () => {
        const first = await runJob();
        expect(first.error).toBeNull();
        const paidTake = first.sidecars[0] as TakeSidecar;
        const second = await runJob({ dir: first.dir });
        try {
            expect(second.error).toBeInstanceOf(SpendRefusal);
            const refusal = second.error as SpendRefusal;
            expect(refusal.flag).toContain('--force');
            expect(refusal.message).toContain(paidTake.digest);
            expect(refusal.message).toContain(paidTake.artifactPath);
            // R5: the refusal names the flags that resolve it.
            expect(refusal.message).toContain('--force');
            expect(refusal.message).toContain('--reason');
            // Nothing new was paid for.
            expect(second.sidecars).toHaveLength(1);
        } finally {
            rmSync(first.dir, { recursive: true, force: true });
        }
    });

    test('the same brief into a different run directory proceeds', async () => {
        const first = await runJob();
        const second = await runJob();
        try {
            expect(first.error).toBeNull();
            expect(second.error).toBeNull();
            expect(second.sidecars).toHaveLength(1);
            expect(second.sidecars[0]?.digest).toBe(first.sidecars[0]?.digest);
        } finally {
            rmSync(first.dir, { recursive: true, force: true });
            rmSync(second.dir, { recursive: true, force: true });
        }
    });

    test('--force --reason "re-roll" proceeds and records forced=true with the reason', async () => {
        const first = await runJob();
        expect(first.error).toBeNull();
        const forced = await runJob({
            dir: first.dir,
            spend: { confirmed: true, force: true, reason: 're-roll' },
        });
        try {
            expect(forced.error).toBeNull();
            expect(forced.sidecars).toHaveLength(1);
            expect(forced.sidecars[0]?.forced).toBe(true);
            expect(forced.sidecars[0]?.reason).toBe('re-roll');
        } finally {
            rmSync(first.dir, { recursive: true, force: true });
        }
    });

    test('--force without --reason is refused, naming --reason', async () => {
        const first = await runJob();
        const forced = await runJob({ dir: first.dir, spend: { confirmed: true, force: true } });
        try {
            expect(forced.error).toBeInstanceOf(SpendRefusal);
            expect((forced.error as SpendRefusal).flag).toBe('--reason');
            expect(forced.error?.message).toContain('--reason');
        } finally {
            rmSync(first.dir, { recursive: true, force: true });
        }
    });
});

describe('AC4 — takes are capped and every take records its spend (R4)', () => {
    test('1 and 2 proceed, 4 and 8 are refused; nothing is trimmed silently', async () => {
        for (const takes of [1, 2]) {
            const run = await runJob({ spend: { confirmed: true, takes } });
            try {
                expect(run.error).toBeNull();
                expect(run.sidecars).toHaveLength(takes);
            } finally {
                rmSync(run.dir, { recursive: true, force: true });
            }
        }
        for (const takes of [4, 8]) {
            const client = new StubInstance();
            const run = await runJob({ client, spend: { confirmed: true, takes } });
            try {
                expect(run.error).toBeInstanceOf(SpendRefusal);
                const refusal = run.error as SpendRefusal;
                expect(refusal.flag).toBe('--takes');
                expect(refusal.message).toContain(`configured cap of ${String(DEFAULT_TAKES_CAP)}`);
                expect(refusal.message).toContain('--takes');
                expect(client.requests).toHaveLength(0);
                expect(run.files).toEqual([]);
            } finally {
                rmSync(run.dir, { recursive: true, force: true });
            }
        }
    });

    test('a config cap of 9 is rejected at load, naming music.takesCap', async () => {
        const error = await withConfigFile(
            'music:\n  takesCap: 9\n',
            async (path) => await resolveMusicConfig({ env: {}, configPath: path }).catch((err: unknown) => err),
        );
        expect(error).toBeInstanceOf(SpendRefusal);
        expect((error as SpendRefusal).flag).toBe('music.takesCap');
        expect((error as Error).message).toContain('music.takesCap');
        expect((error as Error).message).toContain('hard cap of 4');
    });

    test('the cap rule: default 2, a configured 4 is allowed, above 4 or below 1 is refused', () => {
        expect(resolveTakesCap(undefined)).toBe(DEFAULT_TAKES_CAP);
        expect(DEFAULT_TAKES_CAP).toBe(2);
        expect(HARD_TAKES_CAP).toBe(4);
        expect(resolveTakesCap(4)).toBe(4);
        expect(() => resolveTakesCap(5)).toThrow(SpendRefusal);
        expect(() => resolveTakesCap(9)).toThrow(SpendRefusal);
        expect(() => resolveTakesCap(0)).toThrow(SpendRefusal);
        // The guard re-validates an injected cap, so a config object cannot smuggle 9 past it.
        expect(() => resolveTakeCount(1, 9)).toThrow(SpendRefusal);
        expect(resolveTakeCount(2, 2)).toBe(2);
    });

    test('a configured cap of 4 lets 4 takes run, and the sidecars sum to the printed estimate', async () => {
        const config: MusicConfig = { ...CONFIG, takesCap: 4 };
        const run = await runJob({ config, spend: { confirmed: true, takes: 4 } });
        try {
            expect(run.error).toBeNull();
            expect(run.sidecars).toHaveLength(4);
            let sum = 0;
            for (const sidecar of run.sidecars) {
                expect(sidecar.model).toBe('clip');
                expect(sidecar.unitPrice).toBe(0.04);
                expect(sidecar.instanceId).toMatch(/^offline-take-/);
                expect(sidecar.digest).toMatch(/^[0-9a-f]{64}$/);
                sum += sidecar.unitPrice ?? 0;
            }
            const estimate = run.estimates[0] as string;
            expect(estimate).toContain(`total: ${formatUsd(sum)}`);
            expect(sum).toBe(0.16);
            // Four takes of one request are four distinct digests (0397's takeIndex).
            expect(new Set(run.sidecars.map((sidecar) => sidecar.digest)).size).toBe(4);
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });

    test('the sidecar records the workflow run id when the caller knows it', async () => {
        const run = await runJob({ config: { ...CONFIG, runId: 'run-42' } });
        try {
            expect(run.sidecars[0]?.runId).toBe('run-42');
        } finally {
            rmSync(run.dir, { recursive: true, force: true });
        }
    });
});

describe('AC5 — refusals are actionable (R5)', () => {
    test('every refusal message contains the exact flag that resolves it', async () => {
        const job = resolveJob(parseMusicBriefYaml(CLIP_BRIEF));

        const unconfirmed = await runJob({ spend: {} });
        const duplicates = await runJob({ dir: (await runJob()).dir });
        const forced = await runJob({ spend: { confirmed: true, force: true } });
        try {
            // --yes
            expect(unconfirmed.error?.message).toContain('--yes');
            // --force --reason
            expect(duplicates.error?.message).toContain('--force --reason');
            // --reason
            expect(forced.error?.message).toContain('--reason');
            // --takes (and the cap it must fit)
            expect(() => resolveTakeCount(8, DEFAULT_TAKES_CAP)).toThrow(/--takes/);
            // music.takesCap
            expect(() => resolveTakesCap(9)).toThrow(/music\.takesCap/);
            // the estimate is unchanged by a refusal: no model or take-count rewrite
            expect(estimateGenerate({ job, prices: DEFAULT_MUSIC_PRICES, takes: 2 })).toMatchObject({
                model: 'clip',
                takes: 2,
            });
        } finally {
            rmSync(unconfirmed.dir, { recursive: true, force: true });
            rmSync(forced.dir, { recursive: true, force: true });
            for (const run of [duplicates]) {
                rmSync(run.dir, { recursive: true, force: true });
            }
        }
    });
});
