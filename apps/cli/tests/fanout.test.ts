import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, collectionForKind, type PluginKind, type Result } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import {
    type AggregateResult,
    fanout,
    runFanout,
    selectRetryTargets,
    type Target,
    type TargetOutcome,
} from '../src/fanout';

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

describe('fanout', () => {
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
    // Negative-path tests call logger.error intentionally; silence stderr so --dots stays clean.
    let origError: typeof logger.error;
    let errLog: string[];

    beforeEach(() => {
        errLog = [];
        origError = logger.error;
        logger.error = (msg: string) => {
            errLog.push(msg);
        };
    });

    afterEach(() => {
        logger.error = origError;
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

    it('R2 — explicit --target narrows the retry to still-unpublished targets only', async () => {
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

            expect(code).toBe(0);
            // medium was published before and is skipped, never re-invoked; devto is retried.
            expect(called).toEqual(['devto']);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.summary.skipped).toBe(3);
            expect(outData.summary.succeeded).toBe(1);
            expect(outData.summary.total).toBe(4);
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
            expect(errLog.join('\n')).toContain('--content requires a file path');

            errLog = [];
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            expect(await runFanout(['--content', contentFile, '--target'])).toBe(2);
            expect(errLog.join('\n')).toContain('--target requires a plugin name');

            errLog = [];
            expect(await runFanout(['--content', contentFile, '--out'])).toBe(2);
            expect(errLog.join('\n')).toContain('--out requires a file path');

            errLog = [];
            expect(await runFanout(['--content', contentFile, '--retry-from'])).toBe(2);
            expect(errLog.join('\n')).toContain('--retry-from requires a file path');
        });
    });

    it('fails with exit code 2 when the content file is missing, invalid, or off-schema', async () => {
        await withTempDir(async (root) => {
            const outFile = join(root, 'r.json');
            const missing = join(root, 'nope.json');
            expect(await runFanout(['--content', missing, '--target', 'a', '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain(missing);

            const badJson = join(root, 'bad.json');
            writeFileSync(badJson, '{ nope');
            expect(await runFanout(['--content', badJson, '--target', 'a', '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('invalid JSON');

            const offSchema = join(root, 'off.json');
            writeFileSync(offSchema, JSON.stringify({ title: 'no body' }));
            expect(await runFanout(['--content', offSchema, '--target', 'a', '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('Content schema');
        });
    });

    it('fails with exit code 2 when the --retry-from result is missing or invalid', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const outFile = join(root, 'r.json');

            const missing = join(root, 'no-prior.json');
            expect(await runFanout(['--content', contentFile, '--retry-from', missing, '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain(missing);

            const badPrior = join(root, 'bad-prior.json');
            writeFileSync(badPrior, JSON.stringify({ ok: false }));
            expect(await runFanout(['--content', contentFile, '--retry-from', badPrior, '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('aggregate result schema');
        });
    });

    it('fails with exit code 2 naming the file when the output cannot be written (CLI/input error, spec §4)', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            const badOut = join(root, 'missing-dir', 'r.json');

            const code = await runFanout(['--content', contentFile, '--target', 'a', '--out', badOut], {
                dispatch: makeDispatch().dispatch,
            });

            expect(code).toBe(2);
            expect(errLog.join('\n')).toContain('Failed to write output file');
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
            expect(errLog.join('\n')).toContain('Unknown publish target(s): fake-pub');
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
            expect(errLog.join('\n')).toContain('--content may be specified only once');

            errLog = [];
            const priorFile = join(root, 'prior.json');
            writeFileSync(priorFile, JSON.stringify(priorResult()));
            expect(
                await runFanout(
                    ['--content', contentFile, '--retry-from', priorFile, '--retry-from', priorFile, '--out', outFile],
                    { dispatch: makeDispatch().dispatch },
                ),
            ).toBe(2);
            expect(errLog.join('\n')).toContain('--retry-from may be specified only once');
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
            expect(errLog.join('\n')).toContain('invalid JSON');

            errLog = [];
            const nullPrior = join(root, 'null-prior.json');
            writeFileSync(nullPrior, 'null');
            expect(await runFanout(['--content', contentFile, '--retry-from', nullPrior, '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('not an aggregate result object');
        });
    });

    it('exits 2 when a directory is passed as --content or --retry-from', async () => {
        await withTempDir(async (root) => {
            const outFile = join(root, 'r.json');
            // A directory passes existsSync but readFileSync throws EISDIR.
            expect(await runFanout(['--content', root, '--target', 'a', '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('Failed to read content file');

            errLog = [];
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));
            expect(await runFanout(['--content', contentFile, '--retry-from', root, '--out', outFile])).toBe(2);
            expect(errLog.join('\n')).toContain('Failed to read result file');
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
            expect(errLog.join('\n')).toContain('summary.total');

            errLog = [];
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
            expect(errLog.join('\n')).toContain('target entry');
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
            expect(errLog.join('\n')).toContain('violates the aggregate result schema (target a)');
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
            expect(errLog.join('\n')).toContain('mutually exclusive');
        });
    });

    it('fails with exit code 2 on --plugins-root / --plugins-path parse errors', async () => {
        await withTempDir(async (root) => {
            const contentFile = join(root, 'content.json');
            writeFileSync(contentFile, JSON.stringify(CONTENT));

            // --plugins-root without a value.
            errLog = [];
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--plugins-root'])).toBe(
                2,
            );
            expect(errLog.join('\n')).toContain('--plugins-root requires a directory path');

            // --plugins-root specified twice.
            errLog = [];
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
            expect(errLog.join('\n')).toContain('--plugins-root may be specified only once');

            // --plugins-path without a value.
            errLog = [];
            expect(await runFanout(['--content', contentFile, '--target', 'a', '--out', 'x', '--plugins-path'])).toBe(
                2,
            );
            expect(errLog.join('\n')).toContain('--plugins-path requires a directory path');
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
