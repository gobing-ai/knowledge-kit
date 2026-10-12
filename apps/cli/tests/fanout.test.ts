import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import {
    AggregateResultSchema,
    type Content,
    collectionForKind,
    type PluginKind,
    type Result,
} from '@gobing-ai/kk-core';
import {
    type AggregateResult,
    fanout,
    runFanout,
    selectRetryTargets,
    type Target,
    type TargetOutcome,
} from '../src/fanout';
import { runInvoke } from '../src/invoke';
import { captureOutput } from './capture';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-fanout-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

const CONTENT: Content = { title: 'Demo', body: 'hello world', format: 'markdown' };

/** Build an injected dispatch recording calls; targets in `failures` resolve to failed Results. */
function makeDispatch(failures: readonly string[] = []): {
    dispatch: (t: Target) => Promise<Result>;
    called: string[];
} {
    const called: string[] = [];
    const dispatch = async (t: Target): Promise<Result> => {
        called.push(t);
        if (failures.includes(t)) {
            return { ok: false, target: t, error: `simulated failure for ${t}` };
        }
        return { ok: true, target: t, url: `https://example.com/${t}`, id: `id-${t}` };
    };
    return { dispatch, called };
}

/** Prior partial-success result matching the worked example (spec §6): 3 published, 2 failed. */
function priorResult(): AggregateResult {
    return {
        ok: false,
        summary: { total: 5, succeeded: 3, failed: 2, skipped: 0 },
        targets: [
            {
                target: 'surfdash',
                ok: true,
                status: 'published',
                url: 'https://surfdash.io/posts/1',
                id: 'surf_1',
                durationMs: 1420,
            },
            {
                target: 'medium',
                ok: true,
                status: 'published',
                url: 'https://medium.com/@gobing/1',
                id: 'med_1',
                durationMs: 2100,
            },
            {
                target: 'juejin',
                ok: true,
                status: 'published',
                url: 'https://juejin.cn/post/73912839128',
                id: 'juejin_1',
                durationMs: 1850,
            },
            {
                target: 'qiita',
                ok: false,
                status: 'failed',
                error: 'API rate limit exceeded (HTTP 429)',
                durationMs: 310,
            },
            {
                target: 'devto',
                ok: false,
                status: 'failed',
                error: 'Invalid API key in environment (HTTP 401)',
                durationMs: 280,
            },
        ],
    };
}

/** Write a publish plugin named `fake-pub` under `pluginsRoot` whose entry runs `script` on --in/--out. */
function writeFakePublishPlugin(pluginsRoot: string, script: string, kind: PluginKind = 'publish'): void {
    const dir = join(pluginsRoot, collectionForKind(kind), 'fake-pub');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
        join(dir, 'plugin.json'),
        JSON.stringify({ name: 'fake-pub', kind, entry: './src/index.ts', version: '1.0.0' }),
    );
    writeFileSync(join(dir, 'src', 'index.ts'), script);
}

/** Sleep for the overlap fixtures: long enough that process-startup jitter cannot fake an overlap. */
const SLEEP_MS = 250;

interface PublisherInterval {
    start: number;
    end: number;
}

/**
 * Write a publish plugin that stamps `start`/`end` around a real sleep into
 * `<pluginsRoot>/ledger.jsonl`, then records its Result. Two of these prove overlap from their own
 * timestamps rather than from total wall clock (0248 R1).
 */
function writeSleepingPublishPlugin(pluginsRoot: string, name: string, sleepMs: number): void {
    const dir = join(pluginsRoot, collectionForKind('publish'), name);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
        join(dir, 'plugin.json'),
        JSON.stringify({ name, kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
    );
    writeFileSync(
        join(dir, 'src', 'index.ts'),
        [
            "import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';",
            "import { join } from 'node:path';",
            'const argv = process.argv.slice(2);',
            "const inPath = argv[argv.indexOf('--in') + 1];",
            "const outPath = argv[argv.indexOf('--out') + 1];",
            // Ledger beside the kind collection: `<pluginsRoot>/ledger.jsonl`.
            "const ledger = join(import.meta.dir, '..', '..', '..', 'ledger.jsonl');",
            `const name = ${JSON.stringify(name)};`,
            "readFileSync(inPath, 'utf-8');",
            'appendFileSync(ledger, "start:" + name + ":" + Date.now() + "\\n");',
            `await Bun.sleep(${sleepMs});`,
            'appendFileSync(ledger, "end:" + name + ":" + Date.now() + "\\n");',
            "writeFileSync(outPath, JSON.stringify({ ok: true, target: name, url: 'https://example.com/' + name, id: 'id-' + name, message: 'published' }));",
        ].join('\n'),
    );
}

/**
 * Write a publish plugin whose entry hangs forever after forking a child that writes `marker` two
 * seconds later. Only a tree-wide kill reaps that child — a direct-child-only kill leaves the late
 * output (0248 R2, the invoke.ts cancellation pattern).
 */
function writeHangingPublishPlugin(pluginsRoot: string, name: string, marker: string): void {
    const dir = join(pluginsRoot, collectionForKind('publish'), name);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(
        join(dir, 'plugin.json'),
        JSON.stringify({ name, kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
    );
    const child = `setTimeout(() => { const { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(marker)}, 'late'); }, 2000); setInterval(() => {}, 1000);`;
    writeFileSync(
        join(dir, 'src', 'index.ts'),
        [
            "import { spawn } from 'node:child_process';",
            `spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore' });`,
            'setInterval(() => {}, 1000);',
        ].join('\n'),
    );
}

/** Read the named publisher's start/end pair from `<pluginsRoot>/ledger.jsonl`. */
function readPublisherInterval(pluginsRoot: string, name: string): PublisherInterval {
    let interval: PublisherInterval | undefined;
    // One entry per publisher, in start-then-end order (its own writes are sequential).
    for (const line of readFileSync(join(pluginsRoot, 'ledger.jsonl'), 'utf-8').trim().split('\n')) {
        const [phase, plugin, ms] = line.split(':');
        if (plugin !== name || ms === undefined) continue;
        const at = Number(ms);
        if (phase === 'start') interval = { start: at, end: Number.NaN };
        else if (interval !== undefined) interval.end = at;
    }
    if (interval === undefined || Number.isNaN(interval.end)) {
        throw new Error(`publisher '${name}' never stamped a complete start/end pair in the ledger`);
    }
    return interval;
}

/** True when the two windows share an instant — real overlap, not merely adjacent in time. */
function overlaps(a: PublisherInterval, b: PublisherInterval): boolean {
    return a.start < b.end && b.start < a.end;
}

describe('fanout', () => {
    it('leftover file-cli channels each contribute one aggregate Result entry', async () => {
        const { dispatch, called } = makeDispatch();
        const result = await fanout(CONTENT, ['medium-pub', 'wechatmp-pub'], dispatch);
        expect(called).toEqual(['medium-pub', 'wechatmp-pub']);
        expect(result.ok).toBe(true);
        expect(result.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
        expect(result.targets.map((t) => t.target)).toEqual(['medium-pub', 'wechatmp-pub']);
        expect(result.targets.every((t) => t.ok && t.status === 'published')).toBe(true);
    });

    it('R1 — aggregates one outcome per target, marking failures, in dispatch order', async () => {
        const { dispatch } = makeDispatch(['qiita', 'devto']);
        const targets = ['surfdash', 'medium', 'juejin', 'qiita', 'devto'];

        const result = await fanout(CONTENT, targets, dispatch);

        expect(result.ok).toBe(false);
        expect(result.summary).toEqual({ total: 5, succeeded: 3, failed: 2, skipped: 0 });
        expect(result.targets.map((t) => t.target)).toEqual(targets);
        expect(result.targets.filter((t) => t.status === 'failed')).toHaveLength(2);
        for (const t of result.targets.filter((t) => t.status === 'failed')) {
            expect(t.ok).toBe(false);
            expect(t.error).toBe(`simulated failure for ${t.target}`);
        }
        for (const t of result.targets.filter((t) => t.status === 'published')) {
            expect(t.ok).toBe(true);
            expect(t.url).toBe(`https://example.com/${t.target}`);
            expect(t.id).toBe(`id-${t.target}`);
            expect(typeof t.durationMs).toBe('number');
        }
    });

    it('reports ok:true with a full-success summary when every target publishes', async () => {
        const { dispatch } = makeDispatch();
        const result = await fanout(CONTENT, ['a', 'b', 'c'], dispatch);

        expect(result.ok).toBe(true);
        expect(result.summary).toEqual({ total: 3, succeeded: 3, failed: 0, skipped: 0 });
    });

    it('records a target as failed when its dispatch rejects', async () => {
        const dispatch = async (t: Target): Promise<Result> => {
            throw new Error(`transport down for ${t}`);
        };

        const result = await fanout(CONTENT, ['a'], dispatch);

        expect(result.ok).toBe(false);
        expect(result.targets[0]).toMatchObject({ target: 'a', ok: false, status: 'failed' });
        expect(result.targets[0]?.error).toBe('transport down for a');
    });

    it('falls back to message when a failed Result carries no error', async () => {
        const dispatch = async (): Promise<Result> => ({ ok: false, target: 'a', message: 'rejected by platform' });

        const result = await fanout(CONTENT, ['a'], dispatch);

        expect(result.targets[0]?.error).toBe('rejected by platform');
    });

    it('returns an empty all-ok result for no targets', async () => {
        const { dispatch, called } = makeDispatch();

        const result = await fanout(CONTENT, [], dispatch);

        expect(called).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.summary).toEqual({ total: 0, succeeded: 0, failed: 0, skipped: 0 });
    });
});

describe('selectRetryTargets', () => {
    it('returns exactly the previously failed targets (spec §5)', () => {
        expect(selectRetryTargets(priorResult())).toEqual(['qiita', 'devto']);
    });

    it('returns an empty set when every prior target published', () => {
        const allPublished: AggregateResult = {
            ok: true,
            summary: { total: 2, succeeded: 2, failed: 0, skipped: 0 },
            targets: [
                { target: 'a', ok: true, status: 'published', url: 'https://a' },
                { target: 'b', ok: true, status: 'published', url: 'https://b' },
            ],
        };
        expect(selectRetryTargets(allPublished)).toEqual([]);
    });

    it('retry set is always a subset of prior failures', () => {
        const failures = selectRetryTargets(priorResult());
        const priorFailed = priorResult()
            .targets.filter((t) => t.status === 'failed')
            .map((t) => t.target);
        expect(failures.every((f) => priorFailed.includes(f))).toBe(true);
    });
});

describe('runFanout', () => {
    // Negative-path tests emit via echoError intentionally; capture stderr (instead of
    // monkey-patching a logger) and keep the dots reporter clean.
    let cap: ReturnType<typeof captureOutput>;

    beforeEach(() => {
        cap = captureOutput();
    });

    afterEach(() => {
        cap.restore();
    });

    it('R1 — writes an aggregate result with per-target entries and exits non-zero on partial failure', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const { dispatch } = makeDispatch(['qiita', 'devto']);

            const code = await runFanout(
                [
                    '--content',
                    contentFile,
                    '--target',
                    'surfdash',
                    '--target',
                    'medium',
                    '--target',
                    'juejin',
                    '--target',
                    'qiita',
                    '--target',
                    'devto',
                    '--out',
                    outFile,
                ],
                { dispatch },
            );

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(false);
            expect(outData.summary).toEqual({ total: 5, succeeded: 3, failed: 2, skipped: 0 });
            expect(outData.targets).toHaveLength(5);
            expect(outData.targets.filter((t: TargetOutcome) => t.status === 'failed')).toHaveLength(2);
        });
    });

    it('exits zero and writes ok:true when every target publishes', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const { dispatch } = makeDispatch();

            const code = await runFanout(
                ['--content', contentFile, '--target', 'a', '--target', 'b', '--out', outFile],
                { dispatch },
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(true);
            expect(outData.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
        });
    });

    it('0157 R2 — a repeated --target is deduped on fresh runs (each target attempted once)', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const { dispatch, called } = makeDispatch([]);

            const code = await runFanout(
                ['--content', contentFile, '--target', 'a', '--target', 'a', '--target', 'b', '--out', outFile],
                { dispatch },
            );

            expect(code).toBe(0);
            expect(called).toEqual(['a', 'b']);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.summary.total).toBe(2);
            expect(outData.targets.map((t: TargetOutcome) => t.target)).toEqual(['a', 'b']);
        });
    });

    it('R2 — --retry-from dispatches only the prior failures and carries successes as skipped', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const priorFile = join(root, 'prior.json');
            const outFile = join(root, 'final.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            writeFileSync(priorFile, JSON.stringify(priorResult()));
            const { dispatch, called } = makeDispatch();

            const code = await runFanout(['--content', contentFile, '--retry-from', priorFile, '--out', outFile], {
                dispatch,
            });

            expect(code).toBe(0);
            // Only the two previously failed targets are dispatched (spec §5).
            expect(called).toEqual(['qiita', 'devto']);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(true);
            // Carried successes count as skipped, not succeeded (spec §3.1 counters).
            expect(outData.summary).toEqual({ total: 5, succeeded: 2, failed: 0, skipped: 3 });
            const skipped = outData.targets.filter((t: TargetOutcome) => t.status === 'skipped');
            expect(skipped).toHaveLength(3);
            // Skipped targets preserve their prior url/id (spec §5.1).
            expect(skipped.map((t: TargetOutcome) => t.id)).toEqual(['surf_1', 'med_1', 'juejin_1']);
            expect(outData.targets.filter((t: TargetOutcome) => t.status === 'published')).toHaveLength(2);
        });
    });

    it('R7 — explicit --target attempts the selection; unselected prior failures stay failed (0110)', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const priorFile = join(root, 'prior.json');
            const outFile = join(root, 'final.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            writeFileSync(priorFile, JSON.stringify(priorResult()));
            const { dispatch, called } = makeDispatch();

            const code = await runFanout(
                [
                    '--content',
                    contentFile,
                    '--target',
                    'medium',
                    '--target',
                    'devto',
                    '--retry-from',
                    priorFile,
                    '--out',
                    outFile,
                ],
                { dispatch },
            );

            // medium was published before and is skipped, never re-invoked; devto is retried;
            // qiita (unselected prior failure) is retained as failed (0110 R7).
            expect(code).toBe(1);
            expect(called).toEqual(['devto']);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(false);
            expect(outData.summary.skipped).toBe(3);
            expect(outData.summary.succeeded).toBe(1);
            expect(outData.summary.failed).toBe(1);
            expect(outData.summary.total).toBe(5);
            const qiita = outData.targets.find((t: TargetOutcome) => t.target === 'qiita');
            expect(qiita.status).toBe('failed');
            // A later retry-from the new ledger dispatches only the outstanding failure.
            const { dispatch: dispatch2, called: called2 } = makeDispatch();
            const code2 = await runFanout(['--content', contentFile, '--retry-from', outFile, '--out', outFile], {
                dispatch: dispatch2,
            });
            expect(code2).toBe(0);
            expect(called2).toEqual(['qiita']);
        });
    });

    it('0110 I4 — retry carries prior target metadata through skipped entries; primitive metadata is a named input error', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const priorFile = join(root, 'prior.json');
            const outFile = join(root, 'final.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            // surfdash carries the Surfdash postPath metadata; qiita failed and is retried.
            writeFileSync(
                priorFile,
                JSON.stringify({
                    ok: false,
                    summary: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
                    targets: [
                        {
                            target: 'surfdash',
                            ok: true,
                            status: 'published',
                            url: 'https://surfdash.io/posts/1',
                            metadata: { postPath: 'collab/posts/abc' },
                        },
                        { target: 'qiita', ok: false, status: 'failed', error: 'boom' },
                    ],
                }),
            );
            const { dispatch, called } = makeDispatch();

            const code = await runFanout(['--content', contentFile, '--retry-from', priorFile, '--out', outFile], {
                dispatch,
            });

            expect(code).toBe(0);
            expect(called).toEqual(['qiita']);
            const outData = JSON.parse(await Bun.file(outFile).text());
            const surfdash = outData.targets.find((t: TargetOutcome) => t.target === 'surfdash');
            expect(surfdash.status).toBe('skipped');
            expect(surfdash.metadata).toEqual({ postPath: 'collab/posts/abc' });

            // Primitive metadata in the prior ledger is a named input error, not a silent drop.
            const badFile = join(root, 'bad-prior.json');
            writeFileSync(
                badFile,
                JSON.stringify({
                    ok: false,
                    summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                    targets: [{ target: 'medium', ok: false, status: 'failed', metadata: 'oops' }],
                }),
            );
            const cap = captureOutput();
            try {
                const bad = await runFanout(['--content', contentFile, '--retry-from', badFile, '--out', outFile], {
                    dispatch,
                });
                expect(bad).toBe(2);
                expect(cap.readErr()).toContain("target 'medium' metadata must be an object");
            } finally {
                cap.restore();
            }
        });
    });

    it('exits zero and dispatches nothing when the prior result has an empty retry set', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const priorFile = join(root, 'prior.json');
            const outFile = join(root, 'final.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            writeFileSync(
                priorFile,
                JSON.stringify({
                    ok: true,
                    summary: { total: 2, succeeded: 2, failed: 0, skipped: 0 },
                    targets: [
                        { target: 'a', ok: true, status: 'published', url: 'https://a' },
                        { target: 'b', ok: true, status: 'published', url: 'https://b' },
                    ],
                }),
            );
            const { dispatch, called } = makeDispatch();

            const code = await runFanout(['--content', contentFile, '--retry-from', priorFile, '--out', outFile], {
                dispatch,
            });

            expect(code).toBe(0);
            expect(called).toEqual([]);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.summary).toEqual({ total: 2, succeeded: 0, failed: 0, skipped: 2 });
        });
    });

    it('exits non-zero when a retried target fails again', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const priorFile = join(root, 'prior.json');
            const outFile = join(root, 'final.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            writeFileSync(priorFile, JSON.stringify(priorResult()));
            const { dispatch } = makeDispatch(['qiita']);

            const code = await runFanout(['--content', contentFile, '--retry-from', priorFile, '--out', outFile], {
                dispatch,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            // 3 carried skipped + devto published + qiita failed again.
            expect(outData.summary).toEqual({ total: 5, succeeded: 1, failed: 1, skipped: 3 });
        });
    });

    it('fails with exit code 2 on usage errors', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            expect(await runFanout(['--target', 'a', '--out', join(root, 'r.json')])).toBe(2);
            expect(await runFanout(['--content', contentFile, '--out', join(root, 'r.json')])).toBe(2);
            expect(await runFanout(['--content', contentFile, '--target', 'a'])).toBe(2);
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--out', 'y'])).toBe(2);
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--bogus'])).toBe(2);
        });
    });

    it('fails with exit code 2 when a flag is missing its value', async () => {
        await withTempDir(async (root) => {
            expect(await runFanout(['--content'])).toBe(2);
            expect(cap.readErr()).toContain('--content requires a file path');

            cap.err.clear();
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            expect(await runFanout(['--content', contentFile, '--target'])).toBe(2);
            expect(cap.readErr()).toContain('--target requires a plugin name');

            cap.err.clear();
            expect(await runFanout(['--content', contentFile, '--out'])).toBe(2);
            expect(cap.readErr()).toContain('--out requires a file path');

            cap.err.clear();
            expect(await runFanout(['--content', contentFile, '--retry-from'])).toBe(2);
            expect(cap.readErr()).toContain('--retry-from requires a file path');
        });
    });

    it('fails with exit code 2 when the content file is missing, invalid, or off-schema', async () => {
        await withTempDir(async (root) => {
            const outFile = join(root, 'r.json');
            const missing = join(root, 'nope.json');
            expect(await runFanout(['--content', missing, '--target', 'a', '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain(missing);

            const badJson = join(root, 'bad.json');
            writeFileSync(badJson, '{ nope');
            expect(await runFanout(['--content', badJson, '--target', 'a', '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('invalid JSON');

            const offSchema = join(root, 'off.json');
            writeFileSync(offSchema, JSON.stringify({ title: 'no body' }));
            expect(await runFanout(['--content', offSchema, '--target', 'a', '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('Content schema');
        });
    });

    it('fails with exit code 2 when the --retry-from result is missing or invalid', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');

            const missing = join(root, 'no-prior.json');
            expect(await runFanout(['--content', contentFile, '--retry-from', missing, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain(missing);

            const badPrior = join(root, 'bad-prior.json');
            writeFileSync(badPrior, JSON.stringify({ ok: false }));
            expect(await runFanout(['--content', contentFile, '--retry-from', badPrior, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('aggregate result schema');
        });
    });

    it('fails with exit code 2 naming the file when the output cannot be written (CLI/input error, spec §4)', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            // A directory already occupies the out path, so the write fails (EISDIR).
            // A merely-missing parent dir is NOT an error: the ts-runtime FileSystem
            // seam creates it, matching what every ingestion/publish plugin does.
            const badOut = join(root, 'r.json');
            mkdirSync(badOut);

            const code = await runFanout(['--content', contentFile, '--target', 'a', '--out', badOut], {
                dispatch: makeDispatch().dispatch,
            });

            expect(code).toBe(2);
            expect(cap.readErr()).toContain('Failed to write output file');
        });
    });

    it('runs a real publish plugin entry through the default dispatch and records its Result', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(
                pluginsRoot,
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "const inPath = argv[argv.indexOf('--in') + 1];",
                    "const outPath = argv[argv.indexOf('--out') + 1];",
                    "readFileSync(inPath, 'utf-8');",
                    "writeFileSync(outPath, JSON.stringify({ ok: true, target: 'fake-pub', url: 'https://example.com/fake', id: 'fake-1', message: 'published' }));",
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'fake-pub', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(true);
            expect(outData.targets).toEqual([
                expect.objectContaining({
                    target: 'fake-pub',
                    status: 'published',
                    url: 'https://example.com/fake',
                    id: 'fake-1',
                }),
            ]);
        });
    });

    it('resolves targets under --plugins-root passed on argv (no deps injection)', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(
                pluginsRoot,
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "const inPath = argv[argv.indexOf('--in') + 1];",
                    "const outPath = argv[argv.indexOf('--out') + 1];",
                    "readFileSync(inPath, 'utf-8');",
                    "writeFileSync(outPath, JSON.stringify({ ok: true, target: 'fake-pub', url: 'https://example.com/fake', id: 'fake-1', message: 'published' }));",
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout([
                '--content',
                contentFile,
                '--target',
                'fake-pub',
                '--out',
                outFile,
                '--plugins-root',
                pluginsRoot,
            ]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(true);
            expect(outData.targets[0]).toMatchObject({ target: 'fake-pub', status: 'published' });
        });
    });

    it('records a target as failed when its plugin entry exits non-zero', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(pluginsRoot, "console.error('simulated publish failure');\nprocess.exit(3);");
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'fake-pub', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.targets[0]).toMatchObject({ target: 'fake-pub', status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain('simulated publish failure');
        });
    });

    it('exits 2 when a target does not resolve to a publish plugin', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            // A generator-kind plugin cannot be a publish target.
            writeFakePublishPlugin(pluginsRoot, 'export {};\n', 'generator');
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(
                ['--content', contentFile, '--target', 'fake-pub', '--out', join(root, 'r.json')],
                { pluginsRoot },
            );

            expect(code).toBe(2);
            expect(cap.readErr()).toContain('Unknown publish target(s): fake-pub');
            expect(existsSync(join(root, 'r.json'))).toBe(false);
        });
    });

    it('exits 2 when --content or --retry-from is specified more than once', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');

            expect(
                await runFanout(
                    ['--content', contentFile, '--content', contentFile, '--target', 'a', '--out', outFile],
                    { dispatch: makeDispatch().dispatch },
                ),
            ).toBe(2);
            expect(cap.readErr()).toContain('--content may be specified only once');

            cap.err.clear();
            const priorFile = join(root, 'prior.json');
            writeFileSync(priorFile, JSON.stringify(priorResult()));
            expect(
                await runFanout(
                    ['--content', contentFile, '--retry-from', priorFile, '--retry-from', priorFile, '--out', outFile],
                    { dispatch: makeDispatch().dispatch },
                ),
            ).toBe(2);
            expect(cap.readErr()).toContain('--retry-from may be specified only once');
        });
    });

    it('exits 2 when the --retry-from result is invalid JSON or not an object', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');

            const badJson = join(root, 'bad-prior.json');
            writeFileSync(badJson, '{ nope');
            expect(await runFanout(['--content', contentFile, '--retry-from', badJson, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('invalid JSON');

            cap.err.clear();
            const nullPrior = join(root, 'null-prior.json');
            writeFileSync(nullPrior, 'null');
            expect(await runFanout(['--content', contentFile, '--retry-from', nullPrior, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('not an aggregate result object');
        });
    });

    it('exits 2 when a directory is passed as --content or --retry-from', async () => {
        await withTempDir(async (root) => {
            const outFile = join(root, 'r.json');
            // A directory passes existsSync but readFileSync throws EISDIR.
            expect(await runFanout(['--content', root, '--target', 'a', '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('Failed to read content file');

            cap.err.clear();
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            expect(await runFanout(['--content', contentFile, '--retry-from', root, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('Failed to read result file');
        });
    });

    it('exits 2 when the --retry-from summary or target entries are malformed', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');

            const badSummary = join(root, 'bad-summary.json');
            writeFileSync(
                badSummary,
                JSON.stringify({
                    ok: false,
                    summary: { total: 'two', succeeded: 0, failed: 0, skipped: 0 },
                    targets: [],
                }),
            );
            expect(await runFanout(['--content', contentFile, '--retry-from', badSummary, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('summary.total');

            cap.err.clear();
            const badEntry = join(root, 'bad-entry.json');
            writeFileSync(
                badEntry,
                JSON.stringify({
                    ok: false,
                    summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                    targets: [42],
                }),
            );
            expect(await runFanout(['--content', contentFile, '--retry-from', badEntry, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('target entry');
        });
    });

    it('exits 2 when a --retry-from target entry violates the aggregate schema', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');
            const priorFile = join(root, 'prior.json');
            writeFileSync(
                priorFile,
                JSON.stringify({
                    ok: false,
                    summary: { total: 1, succeeded: 0, failed: 1, skipped: 0 },
                    targets: [{ target: 'a', ok: false, status: 'exploded' }],
                }),
            );

            expect(await runFanout(['--content', contentFile, '--retry-from', priorFile, '--out', outFile])).toBe(2);
            expect(cap.readErr()).toContain('violates the aggregate result schema (target a)');
        });
    });

    it('records a target as failed when its plugin entry script is missing', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            // plugin.json declares an entry that does not exist on disk.
            const dir = join(pluginsRoot, collectionForKind('publish'), 'ghost');
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'plugin.json'),
                JSON.stringify({ name: 'ghost', kind: 'publish', entry: './src/missing.ts', version: '1.0.0' }),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'ghost', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.targets[0]).toMatchObject({ target: 'ghost', status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain('Plugin entry script does not exist');
        });
    });

    it('records a target as failed when its plugin exits 0 without writing a result', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(
                pluginsRoot,
                [
                    "import { readFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "readFileSync(argv[argv.indexOf('--in') + 1], 'utf-8');",
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'fake-pub', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.targets[0]).toMatchObject({ target: 'fake-pub', status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain('did not write a result file');
        });
    });

    it('0157 R5 — names the target when its plugin writes invalid JSON (real dispatch)', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(
                pluginsRoot,
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "readFileSync(argv[argv.indexOf('--in') + 1], 'utf-8');",
                    "writeFileSync(argv[argv.indexOf('--out') + 1], 'not json');",
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'fake-pub', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.targets[0]).toMatchObject({ target: 'fake-pub', status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain("Plugin 'fake-pub' wrote invalid JSON");
        });
    });

    it('records a target as failed when its plugin writes an invalid Result', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFakePublishPlugin(
                pluginsRoot,
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "const inPath = argv[argv.indexOf('--in') + 1];",
                    "const outPath = argv[argv.indexOf('--out') + 1];",
                    "readFileSync(inPath, 'utf-8');",
                    'writeFileSync(outPath, JSON.stringify({ nope: true }));',
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(['--content', contentFile, '--target', 'fake-pub', '--out', outFile], {
                pluginsRoot,
            });

            expect(code).toBe(1);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.targets[0]).toMatchObject({ target: 'fake-pub', status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain('wrote an invalid Result');
        });
    });

    it('R10 — --plugins-path resolves a publish plugin in a single-plugin dir via merged discovery', async () => {
        await withTempDir(async (root) => {
            // Single plugin dir: plugin.json lives in the folder itself (ADR-012 R6).
            const extra = join(root, 'extra');
            mkdirSync(join(extra, 'src'), { recursive: true });
            writeFileSync(
                join(extra, 'plugin.json'),
                JSON.stringify({ name: 'extra-pub', kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
            );
            writeFileSync(
                join(extra, 'src', 'index.ts'),
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "const inPath = argv[argv.indexOf('--in') + 1];",
                    "const outPath = argv[argv.indexOf('--out') + 1];",
                    "readFileSync(inPath, 'utf-8');",
                    "writeFileSync(outPath, JSON.stringify({ ok: true, target: 'extra-pub', url: 'https://example.com/extra', id: 'extra-1', message: 'published' }));",
                ].join('\n'),
            );
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout([
                '--content',
                contentFile,
                '--target',
                'extra-pub',
                '--out',
                outFile,
                '--plugins-path',
                extra,
            ]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.ok).toBe(true);
            expect(outData.targets[0]).toMatchObject({ target: 'extra-pub', status: 'published' });
        });
    });

    it('R11 — --plugins-root and --plugins-path together exit 2 (mutually exclusive)', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout(
                [
                    '--content',
                    contentFile,
                    '--target',
                    'a',
                    '--out',
                    join(root, 'r.json'),
                    '--plugins-root',
                    '/tmp',
                    '--plugins-path',
                    '/tmp',
                ],
                { dispatch: makeDispatch().dispatch },
            );

            expect(code).toBe(2);
            expect(cap.readErr()).toContain('mutually exclusive');
        });
    });

    it('fails with exit code 2 on --plugins-root / --plugins-path parse errors', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            // --plugins-root without a value.
            cap.err.clear();
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--plugins-root'])).toBe(
                2,
            );
            expect(cap.readErr()).toContain('--plugins-root requires a directory path');

            // --plugins-root specified twice.
            cap.err.clear();
            expect(
                await runFanout([
                    '--content',
                    contentFile,
                    '--target',
                    'a',
                    '--out',
                    'x',
                    '--plugins-root',
                    '/tmp',
                    '--plugins-root',
                    '/tmp',
                ]),
            ).toBe(2);
            expect(cap.readErr()).toContain('--plugins-root may be specified only once');

            // --plugins-path without a value.
            cap.err.clear();
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--plugins-path'])).toBe(
                2,
            );
            expect(cap.readErr()).toContain('--plugins-path requires a directory path');
        });
    });

    it('R6 — fan-out composes the harvested zenn-pub and qiita-pub pair under the fake transport', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const origEnv = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
            try {
                const code = await runFanout(
                    ['--content', contentFile, '--target', 'zenn-pub', '--target', 'qiita-pub', '--out', outFile],
                    { pluginsRoot: join(process.cwd(), 'plugins') },
                );

                expect(code).toBe(0);
                const outData = JSON.parse(await Bun.file(outFile).text());
                expect(outData.ok).toBe(true);
                expect(outData.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
                // One per-target entry per channel, in --target order.
                expect(outData.targets.map((t: TargetOutcome) => t.target)).toEqual(['zenn-pub', 'qiita-pub']);
                for (const t of outData.targets as TargetOutcome[]) {
                    expect(t.status).toBe('published');
                    expect(t.ok).toBe(true);
                    expect(typeof t.url).toBe('string');
                }
            } finally {
                if (origEnv !== undefined) process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = origEnv;
                else delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            }
        });
    });
});

// --- E94 channels (0245 R6) ------------------------------------------------------------------
//
// The cross-plugin half of E94's R8/R9/R10: both new channels are driven through the REAL plugin
// entries (`kk fanout` spawns them), so the claims are about the shipped manifests and
// `processPublishIO`, not about injected fakes. Raw `options` travel inside the content file, which
// is the same path production dispatch passes to the plugin subprocess.
describe('E94 channels through the real fan-out path (0245 R6)', () => {
    /** The fake env is process-wide; snapshot and restore it around every case. */
    async function withFakeTransport(fn: () => Promise<void>): Promise<void> {
        const origEnv = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            await fn();
        } finally {
            if (origEnv !== undefined) process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = origEnv;
            else delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    }

    /** A Content fixture plus whatever raw `options` the case needs. */
    function writeE94Content(dir: string, extra: Record<string, unknown> = {}): string {
        const file = join(dir, 'e94-content.json');
        writeFileSync(
            file,
            JSON.stringify({ title: 'E94 fan-out', body: 'hello threads and weibo', format: 'markdown', ...extra }),
        );
        return file;
    }

    async function runE94Fanout(contentFile: string, outFile: string): Promise<{ code: number; out: AggregateResult }> {
        const code = await runFanout(
            ['--content', contentFile, '--target', 'threads-pub', '--target', 'weibo-pub', '--out', outFile],
            { pluginsRoot: join(process.cwd(), 'plugins') },
        );
        return { code, out: JSON.parse(await Bun.file(outFile).text()) as AggregateResult };
    }

    it('R6/AC2 — threads-pub and weibo-pub fan out offline, one entry per plugin name', async () => {
        await withTempDir(async (root) => {
            // The Weibo home composer has no draft, so the shared fixture opts into a live post.
            const contentFile = writeE94Content(root, { metadata: { publishStatus: 'public' } });
            const outFile = join(root, 'e94-result.json');
            await withFakeTransport(async () => {
                const { code, out } = await runE94Fanout(contentFile, outFile);

                expect(code).toBe(0);
                expect(AggregateResultSchema.parse(out).ok).toBe(true);
                expect(out.summary).toEqual({ total: 2, succeeded: 2, failed: 0, skipped: 0 });
                expect(out.targets.map((t: TargetOutcome) => t.target)).toEqual(['threads-pub', 'weibo-pub']);
                for (const target of out.targets as TargetOutcome[]) {
                    expect(target.status).toBe('published');
                    expect(target.ok).toBe(true);
                }
            });
        });
    }, 120_000);

    it('R6 — each plugin picks its own transport kind under the fake env', async () => {
        await withTempDir(async (root) => {
            const contentFile = writeE94Content(root, { metadata: { publishStatus: 'public' } });
            await withFakeTransport(async () => {
                // In fake mode the Result identity is the fake's own target, so the observable here is
                // WHICH fake each channel resolved: threads-pub is a file-cli channel, weibo-pub is a
                // browser one. The `threads` / `weibo` site names are asserted on the real transports
                // by each plugin's own suite.
                const expected: Record<string, string> = {
                    'threads-pub': 'fake-file-cli',
                    'weibo-pub': 'fake-browser',
                };
                for (const [plugin, fakeTarget] of Object.entries(expected)) {
                    const outPath = join(root, `${plugin}-result.json`);
                    const code = await runInvoke({
                        plugin,
                        inPath: contentFile,
                        outPath,
                        pluginsRoot: join(process.cwd(), 'plugins'),
                    });
                    expect(code, `${plugin} exit`).toBe(0);
                    const result = JSON.parse(await Bun.file(outPath).text()) as Result;
                    expect(result.ok, `${plugin} ok`).toBe(true);
                    expect(result.target, `${plugin} fake transport`).toBe(fakeTarget);
                }
            });
        });
    }, 120_000);

    it('R6/AC1 — an unknown operation fails each target by name and supported set', async () => {
        await withTempDir(async (root) => {
            const contentFile = writeE94Content(root, {
                metadata: { publishStatus: 'public' },
                options: { operation: 'dm' },
            });
            const outFile = join(root, 'e94-bad-op.json');
            await withFakeTransport(async () => {
                const { code, out } = await runE94Fanout(contentFile, outFile);

                expect(code).toBe(1);
                expect(AggregateResultSchema.parse(out).ok).toBe(false);
                expect(out.summary).toEqual({ total: 2, succeeded: 0, failed: 2, skipped: 0 });
                const errors = (out.targets as TargetOutcome[]).map((t) => t.error ?? '');
                // Each real plugin subprocess names its own site in the refusal.
                expect(errors[0]).toContain("unsupported operation 'dm'");
                expect(errors[0]).toContain('threads-pub');
                expect(errors[0]).toContain('post');
                expect(errors[1]).toContain("unsupported operation 'dm'");
                expect(errors[1]).toContain('weibo');
                expect(errors[1]).toContain('post, article');
            });
        });
    }, 120_000);

    it('R6/AC1 — the agent driver is refused through both real plugin entries', async () => {
        await withTempDir(async (root) => {
            const contentFile = writeE94Content(root, {
                metadata: { publishStatus: 'public' },
                options: { driver: 'agent' },
            });
            const outFile = join(root, 'e94-bad-driver.json');
            await withFakeTransport(async () => {
                const { code, out } = await runE94Fanout(contentFile, outFile);

                expect(code).toBe(1);
                const errors = (out.targets as TargetOutcome[]).map((t) => t.error ?? '');
                expect(errors[0]).toContain("unsupported driver option 'agent'");
                expect(errors[0]).toContain('threads-pub posts text only');
                expect(errors[1]).toContain("unsupported driver 'agent'");
                expect(errors[1]).toContain('script');
            });
        });
    }, 120_000);
});

// --- interior concurrency (ADR-007 R4 amendment, 2026-10-03) --------------------------------
//
// The engine runs one workflow node at a time, so `fan-out` is where N independent publishers
// actually overlap (the same split ADR-019 made for `fan-in`). These tests pin the observable
// contract: overlap by default, an ordered ledger regardless of completion order, per-target
// isolation, and the two ways to keep a target out of the batch.
describe('fanout interior concurrency', () => {
    /** Dispatch recording start/end events and the peak number of targets in flight. */
    function makeTracked(behavior: Record<string, 'ok' | 'fail' | 'hang'> = {}): {
        dispatch: (t: Target) => Promise<Result>;
        events: string[];
        inFlight: { current: number; max: number };
    } {
        const events: string[] = [];
        const inFlight = { current: 0, max: 0 };
        const dispatch = async (t: Target): Promise<Result> => {
            events.push(`start:${t}`);
            inFlight.current += 1;
            inFlight.max = Math.max(inFlight.max, inFlight.current);
            try {
                await new Promise((resolve) => setTimeout(resolve, 20));
                const mode = behavior[t] ?? 'ok';
                if (mode === 'fail') return { ok: false, target: t, error: `boom:${t}` };
                if (mode === 'hang') {
                    await new Promise(() => {});
                    return { ok: true, target: t };
                }
                return { ok: true, target: t, url: `https://example.com/${t}`, id: `id-${t}` };
            } finally {
                inFlight.current -= 1;
                events.push(`end:${t}`);
            }
        };
        return { dispatch, events, inFlight };
    }

    it('starts every target together by default and keeps the ledger in --target order', async () => {
        const { dispatch, events, inFlight } = makeTracked();
        const result = await fanout(CONTENT, ['a', 'b', 'c'], dispatch);
        expect(inFlight.max).toBe(3); // overlapped, not one after another
        expect(events.slice(0, 3)).toEqual(['start:a', 'start:b', 'start:c']);
        expect(result.targets.map((t) => t.target)).toEqual(['a', 'b', 'c']);
        expect(result.summary).toEqual({ total: 3, succeeded: 3, failed: 0, skipped: 0 });
        expect(result.ok).toBe(true);
    });

    it('isolates a failing target and leaves its siblings published', async () => {
        const { dispatch } = makeTracked({ b: 'fail' });
        const result = await fanout(CONTENT, ['a', 'b', 'c'], dispatch);
        expect(result.ok).toBe(false);
        expect(result.targets.map((t) => `${t.target}:${t.status}`)).toEqual([
            'a:published',
            'b:failed',
            'c:published',
        ]);
        expect(result.targets[1]?.error).toBe('boom:b');
    });

    it('serial mode and jobs=1 both keep a single target in flight', async () => {
        const serial = makeTracked();
        await fanout(CONTENT, ['a', 'b', 'c'], serial.dispatch, { mode: 'serial' });
        expect(serial.inFlight.max).toBe(1);

        const bounded = makeTracked();
        const result = await fanout(CONTENT, ['a', 'b', 'c'], bounded.dispatch, { jobs: 1 });
        expect(bounded.inFlight.max).toBe(1);
        // Bounding the pool must not reorder or drop entries.
        expect(result.targets.map((t) => t.target)).toEqual(['a', 'b', 'c']);
    });

    it('serialTargets run alone, after the parallel batch, still in ledger order', async () => {
        const { dispatch, events, inFlight } = makeTracked();
        const result = await fanout(CONTENT, ['a', 'wet', 'b'], dispatch, { serialTargets: ['wet'] });
        expect(events.filter((event) => event.startsWith('start')).at(-1)).toBe('start:wet');
        expect(inFlight.max).toBe(2); // a + b overlapped; `wet` never shared the window
        expect(result.targets.map((t) => t.target)).toEqual(['a', 'wet', 'b']);
    });

    it('a target overrunning its budget is recorded failed while siblings continue', async () => {
        const { dispatch } = makeTracked({ slow: 'hang' });
        const result = await fanout(CONTENT, ['fast', 'slow'], dispatch, { timeoutMs: 50 });
        expect(result.targets[0]?.status).toBe('published');
        expect(result.targets[1]?.status).toBe('failed');
        expect(result.targets[1]?.error).toContain('exceeded its 50ms budget');
    });

    it('R1/AC1 — two real publisher processes overlap under --jobs 2', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeSleepingPublishPlugin(pluginsRoot, 'slow-a-pub', SLEEP_MS);
            writeSleepingPublishPlugin(pluginsRoot, 'slow-b-pub', SLEEP_MS);
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const code = await runFanout([
                '--content',
                contentFile,
                '--target',
                'slow-a-pub',
                '--target',
                'slow-b-pub',
                '--jobs',
                '2',
                '--out',
                outFile,
                '--plugins-root',
                pluginsRoot,
            ]);

            expect(code).toBe(0);
            const a = readPublisherInterval(pluginsRoot, 'slow-a-pub');
            const b = readPublisherInterval(pluginsRoot, 'slow-b-pub');
            // Both processes really slept, and their windows intersect: the pool overlapped them.
            expect(a.end - a.start).toBeGreaterThanOrEqual(SLEEP_MS - 50);
            expect(b.end - b.start).toBeGreaterThanOrEqual(SLEEP_MS - 50);
            expect(overlaps(a, b)).toBe(true);
        });
    });

    it('R1/AC1 — --jobs 1, --serial and --serial-target keep real publishers from overlapping', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const scenarios: Array<{ label: string; flags: string[] }> = [
                { label: 'jobs-1', flags: ['--jobs', '1'] },
                { label: 'serial', flags: ['--serial'] },
                { label: 'serial-target', flags: ['--serial-target', 'slow-b-pub'] },
            ];

            for (const scenario of scenarios) {
                const pluginsRoot = join(root, `plugins-${scenario.label}`);
                writeSleepingPublishPlugin(pluginsRoot, 'slow-a-pub', SLEEP_MS);
                writeSleepingPublishPlugin(pluginsRoot, 'slow-b-pub', SLEEP_MS);

                const code = await runFanout([
                    '--content',
                    contentFile,
                    '--target',
                    'slow-a-pub',
                    '--target',
                    'slow-b-pub',
                    ...scenario.flags,
                    '--out',
                    join(root, `result-${scenario.label}.json`),
                    '--plugins-root',
                    pluginsRoot,
                ]);

                // The label rides inside each expected tuple so a failure names its scenario.
                expect([scenario.label, code]).toEqual([scenario.label, 0]);
                expect([
                    scenario.label,
                    overlaps(
                        readPublisherInterval(pluginsRoot, 'slow-a-pub'),
                        readPublisherInterval(pluginsRoot, 'slow-b-pub'),
                    ),
                ]).toEqual([scenario.label, false]);
            }
        });
    });

    it('R2/AC2 — a hanging publisher is terminated at its budget while its sibling publishes', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            // Names carry the temp-dir token so the tmpdir cleanup check below cannot match a file
            // another run left behind.
            const token = basename(root);
            const hangName = `hang-pub-${token}`;
            const fastName = `fast-pub-${token}`;
            const marker = join(root, 'late-descendant.txt');
            writeHangingPublishPlugin(pluginsRoot, hangName, marker);
            writeSleepingPublishPlugin(pluginsRoot, fastName, 0);
            const contentFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            const started = Date.now();
            const code = await runFanout([
                '--content',
                contentFile,
                '--target',
                hangName,
                '--target',
                fastName,
                '--jobs',
                '2',
                '--target-timeout',
                '300',
                '--out',
                outFile,
                '--plugins-root',
                pluginsRoot,
            ]);
            const elapsed = Date.now() - started;

            expect(code).toBe(1);
            // The run settles at the budget, not at the descendant's 2 s deadline.
            expect(elapsed).toBeLessThan(2000);
            const outData = JSON.parse(readFileSync(outFile, 'utf-8'));
            expect(outData.targets[0]).toMatchObject({ target: hangName, status: 'failed', ok: false });
            expect(outData.targets[0].error).toContain(hangName);
            expect(outData.targets[0].error).toContain('300ms');
            expect(outData.targets[1]).toMatchObject({ target: fastName, status: 'published', ok: true });
            // Cleanup ran for both the failed and the published target.
            expect(
                readdirSync(tmpdir()).filter(
                    (entry) => entry.startsWith('kk-fanout-') && entry.endsWith('.json') && entry.includes(token),
                ),
            ).toEqual([]);

            // Grace past the owned descendant's 2 s write deadline: the whole tree is dead.
            await Bun.sleep(2600);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('rejects a malformed --jobs / --target-timeout before touching the filesystem', async () => {
        // The handler reports the refusal through echoError: capture stderr (see capture.ts) so the
        // dots reporter stays clean, and pin that the message names the flag it refused.
        const cap = captureOutput();
        try {
            for (const [flag, value] of [
                ['--jobs', '0'],
                ['--jobs', 'many'],
                ['--target-timeout', '-5'],
            ] as const) {
                const seen = cap.readErr().length;
                const code = await runFanout([
                    '--content',
                    'x.json',
                    '--out',
                    'y.json',
                    '--target',
                    'zenn-pub',
                    flag,
                    value,
                ]);
                expect(code).toBe(2);
                // Only THIS iteration's output: the buffer accumulates across the loop.
                expect(cap.readErr().slice(seen)).toContain(`${flag} requires a positive integer`);
            }
        } finally {
            cap.restore();
        }
    });
});
