import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const runner = join(import.meta.dir, '../scripts/kk-workflow-stages.ts');

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-daily-surfdash-recovery-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function setupFixture(dir: string, runDate = '20261102'): { prep: string; result: string; intent: string } {
    const publish = join(dir, '31-publish');
    mkdirSync(publish, { recursive: true });
    const prep = join(publish, `${runDate}_13_publish-prep_content.json`);
    const result = join(publish, `${runDate}_14_publish-surfdash_result.json`);
    const intent = join(publish, `${runDate}_14_publish-surfdash_intent.json`);
    writeFileSync(prep, JSON.stringify({ title: '每日 AI 新闻', body: '今天的内容。', metadata: { runDate } }));
    return { prep, result, intent };
}

function fakeKk(dir: string): Record<string, string> {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const path = join(bin, 'kk');
    writeFileSync(
        path,
        [
            '#!/usr/bin/env bun',
            "import { appendFileSync, writeFileSync } from 'node:fs';",
            'const args = process.argv.slice(2);',
            'const calls = process.env.KK_SURFDASH_CALLS;',
            'if (calls) appendFileSync(calls, JSON.stringify(args) + "\\n");',
            "const out = args[args.indexOf('--out') + 1];",
            "const mode = process.env.KK_SURFDASH_MODE ?? 'missing';",
            "if (mode === 'missing') process.exit(0);",
            "if (mode === 'failed') { writeFileSync(out, JSON.stringify({ ok: false, targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', error: 'postsurfing validation failed before dispatch', metadata: { deliveryState: 'not-sent' } }] })); process.exit(1); }",
            "if (mode === 'transport-failed') { writeFileSync(out, JSON.stringify({ ok: false, targets: [{ target: 'surfdash-pub', ok: false, status: 'failed', error: 'Postsurfing transport error: remote CMS accepted the request before the connection reset' }] })); process.exit(1); }",
            "writeFileSync(out, JSON.stringify({ ok: true, targets: [{ target: 'surfdash-pub', ok: true, status: 'published', url: 'https://surf.example/daily' }] }));",
            'process.exit(0);',
        ].join('\n'),
    );
    chmodSync(path, 0o755);
    return {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        KK_SURFDASH_CALLS: join(dir, 'kk-calls.jsonl'),
    };
}

function runStage(workDir: string, runDate: string, env: Record<string, string>): ReturnType<typeof spawnSync> {
    return spawnSync(process.execPath, [runner, 'daily-publish-surfdash', workDir, runDate, ''], {
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });
}

function readJson(path: string): Record<string, unknown> {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function targetOf(result: Record<string, unknown>): Record<string, unknown> {
    const targets = result.targets;
    if (!Array.isArray(targets) || targets.length !== 1 || targets[0] === null || typeof targets[0] !== 'object') {
        throw new Error('expected one target outcome');
    }
    return targets[0] as Record<string, unknown>;
}

describe('daily-publish-surfdash ambiguous-send recovery', () => {
    it('journals the payload before dispatch and makes a missing result sticky', () => {
        withTempDir((dir) => {
            const runDate = '20261102';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);

            const first = runStage(fixture.prep.replace(/\/31-publish\/.*$/, ''), runDate, {
                ...env,
                KK_SURFDASH_MODE: 'missing',
            });
            expect(first.status).toBe(0);
            expect(existsSync(fixture.intent)).toBe(true);
            const intent = readJson(fixture.intent);
            expect(intent.runDate).toBe(runDate);
            expect(intent.payloadSha256).toMatch(/^[0-9a-f]{64}$/);

            const firstResult = targetOf(readJson(fixture.result));
            expect(readJson(fixture.result).summary).toEqual({ total: 1, succeeded: 0, failed: 1, skipped: 0 });
            expect(firstResult.ok).toBe(false);
            expect(firstResult.status).toBe('failed');
            expect((firstResult.metadata as Record<string, unknown>).deliveryState).toBe('uncertain');
            expect(firstResult.error).toContain('no publish result');

            // Even a malformed success-looking receipt cannot clear an uncertainty journal.
            writeFileSync(
                fixture.result,
                JSON.stringify({
                    ok: true,
                    targets: [
                        {
                            target: 'surfdash-pub',
                            ok: true,
                            status: 'published',
                            metadata: { deliveryState: 'uncertain' },
                        },
                    ],
                }),
            );
            const second = runStage(fixture.prep.replace(/\/31-publish\/.*$/, ''), runDate, {
                ...env,
                KK_SURFDASH_MODE: 'success',
            });
            expect(second.status).toBe(0);
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(1);
            expect((targetOf(readJson(fixture.result)).metadata as Record<string, unknown>).deliveryState).toBe(
                'uncertain',
            );
        });
    });

    it('refuses changed content after an interrupted send instead of reusing the dated post identity', () => {
        withTempDir((dir) => {
            const runDate = '20261103';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);
            const root = fixture.prep.replace(/\/31-publish\/.*$/, '');

            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'missing' }).status).toBe(0);
            rmSync(fixture.result);
            writeFileSync(
                fixture.prep,
                JSON.stringify({ title: '改写后的新闻', body: '不同内容。', metadata: { runDate } }),
            );

            const retry = runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'success' });
            expect(retry.status).toBe(0);
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(1);
            const target = targetOf(readJson(fixture.result));
            const metadata = target.metadata as Record<string, unknown>;
            expect(metadata.deliveryState).toBe('uncertain');
            expect(metadata.payloadSha256).not.toBe(metadata.currentPayloadSha256);
            expect(target.error).toContain('prepared payload changed after the send intent');
        });
    });

    it('refuses a send intent from a different run date before dispatch', () => {
        withTempDir((dir) => {
            const runDate = '20261105';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);
            const root = fixture.prep.replace(/\/31-publish\/.*$/, '');

            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'missing' }).status).toBe(0);
            rmSync(fixture.result);
            writeFileSync(fixture.intent, JSON.stringify({ ...readJson(fixture.intent), runDate: '20261106' }));

            const retry = runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'success' });
            expect(retry.status).toBe(0);
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(1);
            const target = targetOf(readJson(fixture.result));
            expect((target.metadata as Record<string, unknown>).deliveryState).toBe('uncertain');
            expect(target.error).toContain('send intent run date');
        });
    });

    it('fails closed when only the send intent survived an unavailable child process', () => {
        withTempDir((dir) => {
            const runDate = '20261105';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);
            const root = fixture.prep.replace(/\/31-publish\/.*$/, '');

            expect(runStage(root, runDate, { ...env, PATH: join(dir, 'no-kk') }).status).toBe(127);
            expect(existsSync(fixture.intent)).toBe(true);
            expect(existsSync(fixture.result)).toBe(false);

            const retry = runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'success' });
            expect(retry.status).toBe(0);
            expect(existsSync(env.KK_SURFDASH_CALLS)).toBe(false);
            const target = targetOf(readJson(fixture.result));
            expect((target.metadata as Record<string, unknown>).deliveryState).toBe('uncertain');
            expect(target.error).toContain('no publish result was recorded after the prior send intent');
        });
    });

    it('retries a confirmed explicit failure and caches a named success', () => {
        withTempDir((dir) => {
            const runDate = '20261104';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);
            const root = fixture.prep.replace(/\/31-publish\/.*$/, '');

            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'failed' }).status).toBe(0);
            expect(targetOf(readJson(fixture.result)).status).toBe('failed');
            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'success' }).status).toBe(0);
            expect(targetOf(readJson(fixture.result)).status).toBe('published');
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(2);

            // A completed named success is the first cache branch and does not invoke kk again.
            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'missing' }).status).toBe(0);
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(2);
        });
    });

    it('turns a generic transport failure into a sticky uncertainty instead of replaying a possibly remote send', () => {
        withTempDir((dir) => {
            const runDate = '20261106';
            const fixture = setupFixture(dir, runDate);
            const env = fakeKk(dir);
            const root = fixture.prep.replace(/\/31-publish\/.*$/, '');

            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'transport-failed' }).status).toBe(0);
            const first = readJson(fixture.result);
            expect(first.summary).toEqual({ total: 1, succeeded: 0, failed: 1, skipped: 0 });
            const firstTarget = targetOf(first);
            expect((firstTarget.metadata as Record<string, unknown>).deliveryState).toBe('uncertain');

            expect(runStage(root, runDate, { ...env, KK_SURFDASH_MODE: 'success' }).status).toBe(0);
            expect(readFileSync(env.KK_SURFDASH_CALLS, 'utf-8').trim().split('\n')).toHaveLength(1);
            expect((targetOf(readJson(fixture.result)).metadata as Record<string, unknown>).deliveryState).toBe(
                'uncertain',
            );
        });
    });
});
