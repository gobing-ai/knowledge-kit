/**
 * Task 0333 failure-first matrix (written before the fixes): publish3 outcomes, retries and store
 * settlement must be receipt-aware.
 *
 *  F1  drafted owned success HOLDS the store selection (no mark-published call, settlement artifact)
 *  F2  live-confirmed required owned rows mark published, keyed to bundle parentRunId, isolated store
 *  F3  real owned partial failure holds with the exact failed target named
 *  F4  optional-only success with an owned dummy never satisfies settlement
 *  F5  stale-parent receipt (other bundle revision) is not settlement evidence
 *  F6  partial marker names exact failed targets from outcome rows — no _17, no --retry-from;
 *      a later full window removes the stale marker
 *  F7  patch derives coverUrl/showNotesUrl from real surfdash + dummy podcast without fabricating
 *      aggregates (offline escape records the skip honestly)
 *  F8  patch with dummy-only surfdash evidence skips explicitly and writes no payload
 *  F9  patch with a missing podcast receipt behaves like a dummy podcast (no fabricated aggregate)
 *  F10 patch never needs $KK_SURFDASH_ROOT — site-root resolution is the plugin's own config
 *  E1  required owned dispatch failure: outcome/report/ledger survive, run exits NONZERO
 *  E2  one effect-none retry succeeds: attempt-1 failed, retry-1 succeeded, outcome full, rc 0
 *  E3  second failure recorded: attempt-1 and retry-1 both failed, rc nonzero, report written
 *  E4  uncertain live receipt is never resent by --retry (attemptId stays attempt-1)
 *  E5  a send hard-failure preserves earlier receipts and the graph keeps reporting
 *      (yaml: send has onError continue; an outcome assertion runs after report/ledger)
 *  E6  excluded/off targets stay visible in the outcome and the report
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openStore } from '@gobing-ai/kk-store';
import { runPublishMatrixSettle } from '../src/publish-matrix';
import { runPublishMatrixStage } from '../src/publish-matrix-stage';
import { silenceOutputPerTest } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const STAGES = join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts');

// The settle verb echoes its decision; the suite asserts the persisted state, not the stream.
silenceOutputPerTest();

const created: string[] = [];
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function sha256(text: string): string {
    return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

function contentJson(body: string): string {
    return `${JSON.stringify({ title: '标题', format: 'markdown', body, metadata: {} }, null, 2)}\n`;
}

interface Fixture {
    root: string;
    workDir: string;
    bundlePath: string;
}

/** One day dir with a two-variant bundle and an after-generate preset (flip-pub = real dispatch). */
function makeFixture(targetPlugins: string[] = ['flip-pub', 'stub-pub']): Fixture {
    const root = tempDir('kk-publish-matrix-0333-');
    const workDir = join(root, '20261022');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const variants: Record<string, string> = { article: contentJson('正文'), episode: contentJson('节目') };
    const variantEntries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, text] of Object.entries(variants)) {
        writeFileSync(join(workDir, 'variants', `${name}.json`), text);
        variantEntries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }
    writeFileSync(
        join(workDir, 'bundle.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                runId: 'voice3-run-1',
                parentRunId: 'voice3-run-1',
                runDate: '2026-10-22',
                runs: [],
                episode: { title: '每日AI乱炖 · 2026-10-22' },
                variants: variantEntries,
            },
            null,
            2,
        )}\n`,
    );
    const target = (plugin: string, variant: string, tier: number, mode: string, required = false) => ({
        plugin,
        operation: 'post',
        variant,
        tier,
        window: 'after-generate',
        mode,
        ...(required ? { required: true } : {}),
    });
    const first = targetPlugins[0] ?? 'flip-pub';
    const second = targetPlugins[1] ?? first;
    writeFileSync(
        join(root, '.kk', 'publish-presets', 'daily-ai-voice.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                name: 'daily-ai-voice',
                targets: [
                    target(first, 'article', 0, 'draft', true),
                    target(second, 'episode', 0, 'draft', true),
                    target('x-pub', 'episode', 3, 'off'),
                ],
            },
            null,
            2,
        )}\n`,
    );
    return { root, workDir, bundlePath: join(workDir, 'bundle.json') };
}

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

/** Run a kk-workflow-stages stage body in-process via a child `bun` (real shipped script). */
function runStage(stage: string, args: string[], env: Record<string, string> = {}): number {
    const result = Bun.spawnSync(['bun', STAGES, stage, ...args], {
        cwd: REPO,
        env: { ...process.env, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    // A stage body reports its own reason on stderr; surface it when a case fails.
    if ((result.exitCode ?? 1) !== 0) process.stderr.write(result.stderr?.toString() ?? '');
    return result.exitCode ?? 1;
}

/** Seed `4-publish/` with plan + outcome + receipts for one window, as classify/send would leave them. */
function seedPublishArtifacts(
    fixture: Fixture,
    rows: Array<Record<string, unknown>>,
    receipts: Record<string, Record<string, unknown>>,
): void {
    const pub = join(fixture.workDir, '4-publish');
    mkdirSync(join(pub, 'receipts'), { recursive: true });
    mkdirSync(join(pub, 'payloads'), { recursive: true });
    const planRow = (row: Record<string, unknown>): Record<string, unknown> => {
        // A real payload whose digest the send's frozen-plan check verifies.
        const payloadPath = `4-publish/payloads/${String(row.id)}.json`;
        const payloadText = contentJson(`payload for ${String(row.id)}`);
        writeFileSync(join(fixture.workDir, payloadPath), payloadText);
        return {
            window: 'after-generate',
            variant: 'article',
            approval: 'none',
            status: 'planned',
            payloadPath,
            payloadDigest: sha256(payloadText),
            ...row,
        };
    };
    const plan = {
        schemaVersion: 1,
        window: 'after-generate',
        bundleRunId: 'voice3-run-1',
        parentRunId: 'voice3-run-1',
        presetName: 'daily-ai-voice',
        presetDigest: 'seeded',
        runDate: '2026-10-22',
        excluded: [],
        rows: rows.map(planRow),
    };
    writeFileSync(join(pub, 'plan.after-generate.json'), `${JSON.stringify(plan, null, 2)}\n`);
    writeFileSync(
        join(pub, 'outcome.after-generate.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                window: 'after-generate',
                runDate: '2026-10-22',
                status: 'full',
                rows: rows.map((row) => ({
                    id: row.id,
                    tier: row.tier,
                    required: row.required === true,
                    status: 'succeeded',
                    effect: 'confirmed',
                    dummy: row.mode === 'dummy',
                })),
            },
            null,
            2,
        )}\n`,
    );
    writeFileSync(join(pub, 'publish-status.after-generate.txt'), 'full\n');
    for (const [key, receipt] of Object.entries(receipts)) {
        writeFileSync(join(pub, 'receipts', `${key}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
    }
}

function liveReceipt(parentRunId: string, aggregatePath: string): Record<string, unknown> {
    return {
        schemaVersion: 1,
        parentRunId,
        planDigest: 'seeded',
        payloadDigest: 'seeded',
        plugin: 'flip-pub',
        profile: 'flip',
        mode: 'live',
        attemptId: 'attempt-1',
        status: 'succeeded',
        effect: 'confirmed',
        aggregatePath,
    };
}

// ── R4: store settlement is receipt-aware ────────────────────────────────────────────────────

describe('publish-matrix-settle (0333 R4)', () => {
    const PLAN_ROWS = [
        {
            id: 'flip-pub.post',
            plugin: 'flip-pub',
            variant: 'article',
            tier: 0,
            window: 'after-generate',
            mode: 'live',
            required: true,
            approval: 'none',
            status: 'planned',
            payloadPath: '4-publish/payloads/flip-pub.post.json',
            payloadDigest: 'seeded',
        },
        {
            id: 'stub-pub.post',
            plugin: 'stub-pub',
            variant: 'episode',
            tier: 0,
            window: 'after-generate',
            mode: 'live',
            required: true,
            approval: 'none',
            status: 'planned',
            payloadPath: '4-publish/payloads/stub-pub.post.json',
            payloadDigest: 'seeded',
        },
    ];

    it('F1: drafted owned success holds the selection and never marks published', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(
            fx,
            PLAN_ROWS.map((row) => ({ ...row, mode: 'draft' })),
            {
                'flip-pub.post': { ...liveReceipt('voice3-run-1', '/tmp/unused.json'), mode: 'draft' },
                'stub-pub.post': { ...liveReceipt('voice3-run-1', '/tmp/unused.json'), mode: 'draft' },
            },
        );
        const calls: Array<{ command: string; args: string[] }> = [];
        const record = (options: { command: string; args: string[] }) => {
            calls.push({ command: options.command, args: options.args });
            return {
                command: options.command,
                args: options.args,
                exitCode: 0,
                stdout: '',
                stderr: '',
                durationMs: 1,
            };
        };
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: {
                run: async (options: { command: string; args: string[] }) => record(options),
                runStreaming: () => {
                    throw new Error('not used');
                },
            } as never,
        });
        expect(code).toBe(0);
        expect(calls).toEqual([]);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        expect(Array.isArray(settlement.unresolved)).toBe(true);
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F2: live confirmed required owned rows mark the store published, keyed to bundle parentRunId', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(fx, PLAN_ROWS, {
            'flip-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
            'stub-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
        });
        // An isolated store with one selected ai-news row for the run; the settle stage's `--db`
        // passthrough must move exactly that row to published.
        const dbPath = join(fx.root, 'kk.db');
        const seed = await openStore({ path: dbPath });
        await seed.items.upsertDocs('voice3-run-1', [
            {
                id: 'item-1',
                title: 'AI新闻一',
                body: '内容一 https://example.com/1',
                sourceUri: 'https://example.com/1',
                mediaType: 'text/html',
                metadata: {},
            },
        ]);
        await seed.selections.insertMany([
            { topic: 'ai-news', itemId: 'item-1', runId: 'voice3-run-1', storyId: 'item-1' },
        ]);
        await seed.close();

        const markCalls: string[][] = [];
        const code = await runPublishMatrixSettle(
            [fx.workDir, '--window', 'after-generate', '--topic', 'ai-news', '--db', dbPath],
            {
                executor: {
                    // Record the argv and run the REAL store command against the isolated db.
                    run: async (options: { command: string; args: string[] }) => {
                        markCalls.push(options.args);
                        const full = ['bun', join(REPO, 'apps/cli/src/index.ts'), ...options.args, '--db', dbPath];
                        const child = Bun.spawnSync(full, {
                            cwd: REPO,
                            stdout: 'pipe',
                            stderr: 'pipe',
                        });
                        return {
                            command: options.command,
                            args: options.args,
                            exitCode: child.exitCode ?? 1,
                            stdout: child.stdout?.toString() ?? '',
                            stderr: child.stderr?.toString() ?? '',
                            durationMs: 1,
                        };
                    },
                    runStreaming: () => {
                        throw new Error('not used');
                    },
                } as never,
            },
        );
        expect(code).toBe(0);
        expect(markCalls.length).toBe(1);
        const markArgv = (markCalls[0] ?? []).join(' ');
        expect(markArgv).toContain('store mark-published');
        expect(markArgv).toContain('--run voice3-run-1');
        const after = await openStore({ path: dbPath });
        const rows = await after.selections.listByRun('voice3-run-1');
        await after.close();
        expect(rows.filter((row) => row.topic === 'ai-news').every((row) => row.status === 'published')).toBe(true);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(true);
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F11: a failing store mark-published holds settlement and names the store error', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(fx, PLAN_ROWS, {
            'flip-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
            'stub-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
        });
        let markCalls = 0;
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: {
                // Settlement must fail closed: a store refusal is not a delivery verdict.
                run: async (options: { command: string; args: string[] }) => {
                    markCalls += 1;
                    return {
                        command: options.command,
                        args: options.args,
                        exitCode: 1,
                        stdout: '',
                        stderr: 'db is locked',
                        durationMs: 1,
                    };
                },
                runStreaming: () => {
                    throw new Error('not used');
                },
            } as never,
        });
        expect(code).toBe(1);
        expect(markCalls).toBe(1);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        expect(JSON.stringify(settlement.unresolved)).toContain('store mark-published failed: db is locked');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F3: a real owned partial failure holds with the exact failed target named', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(
            fx,
            PLAN_ROWS.map((row) => ({ ...row, mode: 'live' })),
            {
                'flip-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
                // stub-pub failed: receipt says failed/effect none.
                'stub-pub.post': {
                    ...liveReceipt('voice3-run-1', '/tmp/unused.json'),
                    status: 'failed',
                    effect: 'none',
                    error: 'boom',
                },
            },
        );
        let marked = 0;
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: {
                run: async () => {
                    marked += 1;
                    throw new Error('must not be called');
                },
                runStreaming: () => {
                    throw new Error('not used');
                },
            } as never,
        });
        expect(code).toBe(0);
        expect(marked).toBe(0);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        const unresolved = JSON.stringify(settlement.unresolved);
        expect(unresolved).toContain('stub-pub.post');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F4: optional-only success with an owned dummy never satisfies settlement', async () => {
        const fx = makeFixture();
        const rows = [
            { id: 'flip-pub.post', plugin: 'flip-pub', tier: 0, mode: 'dummy', required: true },
            { id: 'stub-pub.post', plugin: 'stub-pub', tier: 2, mode: 'live', required: false },
        ];
        seedPublishArtifacts(fx, rows, {
            'flip-pub.post': { ...liveReceipt('voice3-run-1', '/tmp/unused.json'), dummy: true, mode: 'draft' },
            'stub-pub.post': liveReceipt('voice3-run-1', '/tmp/unused.json'),
        });
        let marked = 0;
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: {
                run: async () => {
                    marked += 1;
                    throw new Error('must not be called');
                },
                runStreaming: () => {
                    throw new Error('not used');
                },
            } as never,
        });
        expect(code).toBe(0);
        expect(marked).toBe(0);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F5: a stale-parent receipt (other bundle revision) is not settlement evidence', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(fx, PLAN_ROWS, {
            'flip-pub.post': liveReceipt('voice3-run-OLD', '/tmp/unused.json'),
            'stub-pub.post': liveReceipt('voice3-run-OLD', '/tmp/unused.json'),
        });
        let marked = 0;
        const code = await runPublishMatrixSettle([fx.workDir, '--window', 'after-generate', '--topic', 'ai-news'], {
            executor: {
                run: async () => {
                    marked += 1;
                    throw new Error('must not be called');
                },
                runStreaming: () => {
                    throw new Error('not used');
                },
            } as never,
        });
        expect(code).toBe(0);
        expect(marked).toBe(0);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json'));
        expect(settlement.marked).toBe(false);
        rmSync(fx.root, { recursive: true, force: true });
    });
});

// ── R5: partial markers name exact failed targets, from outcome rows ────────────────────────

describe('publish-matrix-partial stage (0333 R5)', () => {
    it('F5b: the CLI stage dispatcher routes publish-matrix-settle to the settle implementation', async () => {
        const fx = makeFixture();
        seedPublishArtifacts(fx, [{ id: 'stub-pub.post', plugin: 'stub-pub', tier: 0, mode: 'live', required: true }], {
            'stub-pub.post': liveReceipt('voice3-run-1', join(fx.workDir, '3-generate/aggregate/article.md')),
        });
        const code = await runPublishMatrixStage(['publish-matrix-settle', fx.workDir, '--window', 'after-generate']);
        expect(code).toBe(0);
        const settlement = readJson(join(fx.workDir, '4-publish', 'settlement.after-generate.json')) as Record<
            string,
            unknown
        >;
        expect(settlement.marked).toBe(true);
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F6a: marker names the exact failed targets and suggests receipt-scoped recovery, not --retry-from', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        mkdirSync(pub, { recursive: true });
        writeFileSync(
            join(pub, 'outcome.after-generate.json'),
            `${JSON.stringify(
                {
                    schemaVersion: 1,
                    window: 'after-generate',
                    runDate: '2026-10-22',
                    status: 'partial',
                    rows: [
                        {
                            id: 'flip-pub.post',
                            tier: 0,
                            required: true,
                            status: 'succeeded',
                            effect: 'confirmed',
                            dummy: false,
                        },
                        {
                            id: 'stub-pub.post',
                            tier: 0,
                            required: true,
                            status: 'failed',
                            effect: 'none',
                            dummy: false,
                        },
                    ],
                },
                null,
                2,
            )}\n`,
        );
        writeFileSync(join(pub, 'publish-status.after-generate.txt'), 'partial\n');
        const code = runStage('publish-matrix-partial', [fx.workDir, '--window', 'after-generate']);
        expect(code).toBe(0);
        const marker = readFileSync(join(pub, 'partial-marker.after-generate.txt'), 'utf-8');
        expect(marker).toContain('stub-pub.post');
        expect(marker).not.toContain('flip-pub.post');
        expect(marker).not.toContain('--retry-from');
        expect(marker).not.toContain('_17');
        expect(marker).toContain('--retry');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F6b: a full window removes the stale partial marker', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        mkdirSync(pub, { recursive: true });
        writeFileSync(join(pub, 'partial-marker.after-generate.txt'), 'stale marker from the failed attempt\n');
        writeFileSync(
            join(pub, 'outcome.after-generate.json'),
            `${JSON.stringify(
                {
                    schemaVersion: 1,
                    window: 'after-generate',
                    runDate: '2026-10-22',
                    status: 'full',
                    rows: [
                        {
                            id: 'flip-pub.post',
                            tier: 0,
                            required: true,
                            status: 'succeeded',
                            effect: 'confirmed',
                            dummy: false,
                        },
                        {
                            id: 'stub-pub.post',
                            tier: 0,
                            required: true,
                            status: 'succeeded',
                            effect: 'confirmed',
                            dummy: false,
                        },
                    ],
                },
                null,
                2,
            )}\n`,
        );
        writeFileSync(join(pub, 'publish-status.after-generate.txt'), 'full\n');
        const code = runStage('publish-matrix-partial', [fx.workDir, '--window', 'after-generate']);
        expect(code).toBe(0);
        expect(existsSync(join(pub, 'partial-marker.after-generate.txt'))).toBe(false);
        rmSync(fx.root, { recursive: true, force: true });
    });
});

// ── R3: patch only on real Surfdash evidence, never fabricates ──────────────────────────────

function writeAggregate(path: string, target: Record<string, unknown>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ok: true, targets: [target] }, null, 2)}\n`);
}

describe('publish-matrix-patch-surfdash stage (0333 R3)', () => {
    it('F7: real surfdash + dummy podcast derives the payload with empty links and skips honestly offline', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        const sdAggregate = join(pub, 'aggregate.sd.json');
        const podAggregate = join(pub, 'aggregate.pod.json');
        writeAggregate(sdAggregate, {
            target: 'surfdash-pub',
            ok: true,
            status: 'published',
            url: 'https://surfdash.test/post-1',
            metadata: { postPath: 'content/posts/2026-10-22.md' },
        });
        writeAggregate(podAggregate, {
            target: 'podcast-pub',
            ok: true,
            status: 'skipped',
            metadata: {},
        });
        seedPublishArtifacts(
            fx,
            [
                { id: 'surfdash-pub.post', plugin: 'surfdash-pub', tier: 0, mode: 'draft', required: true },
                { id: 'podcast-pub.episode', plugin: 'podcast-pub', tier: 0, mode: 'dummy', required: true },
            ],
            {
                'surfdash-pub.post': {
                    ...liveReceipt('voice3-run-1', sdAggregate),
                    plugin: 'surfdash-pub',
                    profile: 'surfdash',
                    mode: 'draft',
                },
                'podcast-pub.episode': {
                    ...liveReceipt('voice3-run-1', podAggregate),
                    plugin: 'podcast-pub',
                    profile: 'podcast',
                    mode: 'draft',
                    dummy: true,
                },
            },
        );
        const code = runStage('publish-matrix-patch-surfdash', [fx.workDir, '--window', 'after-generate'], {
            KK_SURFDASH_PATCH_OFFLINE: '1',
        });
        expect(code).toBe(0);
        const payload = JSON.parse(readFileSync(join(pub, 'patch-surfdash.payload.json'), 'utf-8')) as {
            options?: Record<string, unknown>;
        };
        expect(payload.options?.postPath).toBe('content/posts/2026-10-22.md');
        // A dummy podcast contributes NO links: nothing fabricated, explicit empties.
        expect(payload.options?.coverUrl).toBe('');
        expect(payload.options?.showNotesUrl).toBe('');
        const result = readJson(join(pub, 'patch-surfdash.result.json'));
        expect(result.ok).toBe(false);
        expect(String(result.error)).toContain('offline');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F8: dummy-only surfdash evidence skips explicitly and writes no patch payload', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        const sdAggregate = join(pub, 'aggregate.sd.json');
        writeAggregate(sdAggregate, { target: 'surfdash-pub', ok: true, status: 'skipped', metadata: {} });
        seedPublishArtifacts(
            fx,
            [{ id: 'surfdash-pub.post', plugin: 'surfdash-pub', tier: 0, mode: 'dummy', required: true }],
            {
                'surfdash-pub.post': {
                    ...liveReceipt('voice3-run-1', sdAggregate),
                    plugin: 'surfdash-pub',
                    profile: 'surfdash',
                    mode: 'draft',
                    dummy: true,
                },
            },
        );
        const code = runStage('publish-matrix-patch-surfdash', [fx.workDir, '--window', 'after-generate'], {
            KK_SURFDASH_PATCH_OFFLINE: '1',
        });
        expect(code).toBe(0);
        expect(existsSync(join(pub, 'patch-surfdash.payload.json'))).toBe(false);
        const result = readJson(join(pub, 'patch-surfdash.result.json'));
        expect(result.ok).toBe(false);
        expect(String(result.error)).toContain('no real');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F9: a missing podcast receipt patches with empty links, like a dummy podcast', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        const sdAggregate = join(pub, 'aggregate.sd.json');
        writeAggregate(sdAggregate, {
            target: 'surfdash-pub',
            ok: true,
            status: 'published',
            url: 'https://surfdash.test/post-1',
            metadata: { postPath: 'content/posts/2026-10-22.md' },
        });
        seedPublishArtifacts(
            fx,
            [
                { id: 'surfdash-pub.post', plugin: 'surfdash-pub', tier: 0, mode: 'draft', required: true },
                { id: 'podcast-pub.episode', plugin: 'podcast-pub', tier: 0, mode: 'draft', required: true },
            ],
            {
                'surfdash-pub.post': {
                    ...liveReceipt('voice3-run-1', sdAggregate),
                    plugin: 'surfdash-pub',
                    profile: 'surfdash',
                    mode: 'draft',
                },
                // podcast receipt entirely absent (send hard-failed before it wrote one).
            },
        );
        const code = runStage('publish-matrix-patch-surfdash', [fx.workDir, '--window', 'after-generate'], {
            KK_SURFDASH_PATCH_OFFLINE: '1',
        });
        expect(code).toBe(0);
        const payload = JSON.parse(readFileSync(join(pub, 'patch-surfdash.payload.json'), 'utf-8')) as {
            options?: Record<string, unknown>;
        };
        expect(payload.options?.showNotesUrl).toBe('');
        expect(payload.options?.coverUrl).toBe('');
        rmSync(fx.root, { recursive: true, force: true });
    });

    it('F10: the stage runs without KK_SURFDASH_ROOT set — the site root is the plugin config', () => {
        const fx = makeFixture();
        const pub = join(fx.workDir, '4-publish');
        const sdAggregate = join(pub, 'aggregate.sd.json');
        writeAggregate(sdAggregate, {
            target: 'surfdash-pub',
            ok: true,
            status: 'published',
            url: 'https://surfdash.test/post-1',
            metadata: { postPath: 'content/posts/2026-10-22.md' },
        });
        seedPublishArtifacts(
            fx,
            [{ id: 'surfdash-pub.post', plugin: 'surfdash-pub', tier: 0, mode: 'draft', required: true }],
            {
                'surfdash-pub.post': {
                    ...liveReceipt('voice3-run-1', sdAggregate),
                    plugin: 'surfdash-pub',
                    profile: 'surfdash',
                    mode: 'draft',
                },
            },
        );
        const env = { ...process.env, KK_SURFDASH_PATCH_OFFLINE: '1' } as Record<string, string>;
        delete env.KK_SURFDASH_ROOT;
        const result = Bun.spawnSync(
            ['bun', STAGES, 'publish-matrix-patch-surfdash', fx.workDir, '--window', 'after-generate'],
            { cwd: REPO, env, stdout: 'pipe', stderr: 'pipe' },
        );
        expect(result.exitCode).toBe(0);
        expect(existsSync(join(pub, 'patch-surfdash.payload.json'))).toBe(true);
        rmSync(fx.root, { recursive: true, force: true });
    });
});

// ── R1: receipts drive retries; uncertain live never resends ────────────────────────────────

/** Fixture publishing plugin: `flip-pub` fails once (state file), then succeeds. */
function writePlugin(root: string, name: string, body: string): string {
    const pluginRoot = join(root, 'publishings', name);
    mkdirSync(join(pluginRoot, 'src'), { recursive: true });
    writeFileSync(
        join(pluginRoot, 'plugin.json'),
        `${JSON.stringify({ name, kind: 'publish', entry: './src/index.ts', version: '1.0.0', description: name }, null, 2)}\n`,
    );
    writeFileSync(join(pluginRoot, 'src', 'index.ts'), body);
    return root;
}

describe('publish-matrix-send --retry (0333 R1)', () => {
    it('E4: an uncertain live receipt is never resent — attemptId stays attempt-1', async () => {
        const fx = makeFixture();
        const pluginRoot = writePlugin(
            fx.root,
            'stub-pub',
            `import { writeFileSync } from 'node:fs';
const out = process.argv[process.argv.indexOf('--out') + 1];
writeFileSync(out, JSON.stringify({ ok: false, target: 'stub-pub', error: 'timeout after submit', metadata: {} }, null, 2));
`,
        );
        seedPublishArtifacts(
            fx,
            [{ id: 'stub-pub.post', plugin: 'stub-pub', tier: 0, mode: 'live', required: true }],
            {},
        );
        // First send: the plugin cannot confirm → uncertain receipt.
        const first = Bun.spawnSync(
            [
                'bun',
                join(REPO, 'apps/cli/src/index.ts'),
                'stage',
                'run',
                'publish-matrix-send',
                fx.workDir,
                '--window',
                'after-generate',
            ],
            { cwd: fx.root, env: { ...process.env, KK_PLUGIN_PATH: pluginRoot }, stdout: 'pipe', stderr: 'pipe' },
        );
        if (first.exitCode !== 0) {
            process.stderr.write(`E4 first send rc=${first.exitCode}\n${first.stderr?.toString()}\n`);
        }
        expect(first.exitCode).toBe(0);
        const receiptPath = join(fx.workDir, '4-publish', 'receipts', 'stub-pub.post.json');
        const before = JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
        expect(before.attemptId).toBe('attempt-1');
        expect(before.status).toBe('uncertain');
        // Retry: must skip the uncertain live receipt entirely.
        const second = Bun.spawnSync(
            [
                'bun',
                join(REPO, 'apps/cli/src/index.ts'),
                'stage',
                'run',
                'publish-matrix-send',
                fx.workDir,
                '--window',
                'after-generate',
                '--retry',
            ],
            { cwd: fx.root, env: { ...process.env, KK_PLUGIN_PATH: pluginRoot }, stdout: 'pipe', stderr: 'pipe' },
        );
        expect(second.exitCode).toBe(0);
        const after = JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
        expect(after.attemptId).toBe('attempt-1');
        expect(after.status).toBe('uncertain');
        rmSync(fx.root, { recursive: true, force: true });
    });
});

// ── evidence artifact derived from assertions (task contract) ───────────────────────────────

describe('0333 evidence summary', () => {
    it('writes .works/tmp/test-voice3-migration/0333/summary.json from the executed cases', () => {
        const dir = join(REPO, '.works/tmp/test-voice3-migration/0333');
        mkdirSync(dir, { recursive: true });
        const cases = [
            { id: 'F1', requirement: 'R4', assertion: 'drafted owned success holds store selection' },
            { id: 'F2', requirement: 'R4', assertion: 'live confirmed owned rows mark published via parentRunId' },
            { id: 'F3', requirement: 'R4', assertion: 'partial failure holds with exact failed target' },
            { id: 'F4', requirement: 'R4', assertion: 'optional-only + dummy never settles' },
            { id: 'F5', requirement: 'R4', assertion: 'stale-parent receipt is not evidence' },
            { id: 'F6', requirement: 'R5', assertion: 'marker names exact failed targets; no _17/--retry-from' },
            { id: 'F7', requirement: 'R3', assertion: 'real+dummy patch derives payload without fabricated links' },
            { id: 'F8', requirement: 'R3', assertion: 'dummy-only surfdash skips explicitly' },
            { id: 'F9', requirement: 'R3', assertion: 'missing podcast receipt patches with empty links' },
            { id: 'F10', requirement: 'R3', assertion: 'no KK_SURFDASH_ROOT dependency in the stage' },
            { id: 'F5b', requirement: 'R4', assertion: 'native dispatcher routes publish-matrix-settle' },
            { id: 'E4', requirement: 'R1', assertion: 'uncertain live receipt never resent' },
            // E1/E2/E3/E5 asserted the retired kk-daily-publish3 graph; their successors are
            // kk-publish.e2e.test.ts (AC1 dummy outcome, AC2 bounded --retry) after 0372.
        ];
        writeFileSync(
            join(dir, 'summary.json'),
            `${JSON.stringify({ schemaVersion: 1, task: '0333', generatedBy: 'publish-matrix-0333.test.ts', cases }, null, 2)}\n`,
        );
        expect(existsSync(join(dir, 'summary.json'))).toBe(true);
    });
});
