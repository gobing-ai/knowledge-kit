import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { mergeDocLists, runFanin } from '../src/fanin';
import type { PluginEntryAsyncSpawnOptions, PluginEntrySpawnResult } from '../src/invoke';
import * as invokeModule from '../src/invoke';
import { captureOutput } from './capture';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-fanin-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('mergeDocLists', () => {
    it('R1 — merges two doc lists sharing an id into one, deduped, with both sources', () => {
        const a: Doc[] = [
            { id: 'd1', body: 'alpha' },
            { id: 'd2', body: 'first body' },
        ];
        const b: Doc[] = [
            { id: 'd2', body: 'second body' },
            { id: 'd3', body: 'gamma' },
        ];

        const merged = mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(merged.map((d) => d.id)).toEqual(['d1', 'd2', 'd3']);
        // First-seen wins: d2 keeps the first input's body.
        expect(merged[1]?.body).toBe('first body');
        // Provenance lists every originating source in input order.
        expect(merged[1]?.metadata?.sources).toEqual([{ file: 'a.json' }, { file: 'b.json' }]);
        // Unshared docs carry their single source.
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }]);
    });

    it('keeps documents in deterministic first-appearance order', () => {
        const a: Doc[] = [
            { id: 'x', body: '1' },
            { id: 'y', body: '2' },
        ];
        const b: Doc[] = [{ id: 'y', body: 'dup' }];
        const c: Doc[] = [{ id: 'z', body: '3' }];

        expect(mergeDocLists([a, b, c], ['a', 'b', 'c']).map((d) => d.id)).toEqual(['x', 'y', 'z']);
    });

    it('handles a duplicate id within a single input (first occurrence wins)', () => {
        const input: Doc[] = [
            { id: 'd1', body: 'first' },
            { id: 'd1', body: 'second' },
        ];

        const merged = mergeDocLists([input], ['a.json']);

        expect(merged).toHaveLength(1);
        expect(merged[0]?.body).toBe('first');
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }, { file: 'a.json' }]);
    });

    it('returns an empty list for empty inputs', () => {
        expect(mergeDocLists([], [])).toEqual([]);
        expect(mergeDocLists([[]], ['a.json'])).toEqual([]);
    });

    it('never mutates the input doc lists', () => {
        const a: Doc[] = [{ id: 'd1', body: 'alpha', metadata: { tag: 'keep' } }];
        const b: Doc[] = [{ id: 'd1', body: 'dup' }];
        const snapshotA = structuredClone(a);
        const snapshotB = structuredClone(b);

        mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(a).toEqual(snapshotA);
        expect(b).toEqual(snapshotB);
    });

    it('carries sourceUri into the provenance entry and preserves other metadata', () => {
        const a: Doc[] = [{ id: 'd1', body: 'alpha', sourceUri: 'https://example.com/a', metadata: { tag: 'keep' } }];
        const b: Doc[] = [{ id: 'd1', body: 'dup', sourceUri: 'https://example.com/b' }];

        const merged = mergeDocLists([a, b], ['a.json', 'b.json']);

        expect(merged[0]?.metadata?.sources).toEqual([
            { file: 'a.json', sourceUri: 'https://example.com/a' },
            { file: 'b.json', sourceUri: 'https://example.com/b' },
        ]);
        expect(merged[0]?.metadata?.tag).toBe('keep');
        // metadata.sources is replaced by fanin provenance, not accumulated.
        expect(Object.keys(merged[0]?.metadata ?? {})).toEqual(['tag', 'sources']);
    });

    it('creates metadata.sources for docs that had no metadata', () => {
        const merged = mergeDocLists([[{ id: 'd1', body: 'alpha' }]], ['a.json']);
        expect(merged[0]?.metadata?.sources).toEqual([{ file: 'a.json' }]);
    });
});

describe('runFanin', () => {
    // Negative-path tests emit via echoError intentionally; capture ts-utils stderr
    // (instead of monkey-patching a logger) and keep the dots reporter clean.
    let cap: ReturnType<typeof captureOutput>;

    beforeEach(() => {
        cap = captureOutput();
    });

    afterEach(() => {
        cap.restore();
    });

    const errLog = (): string => cap.readErr();

    it('R1 — writes one deduplicated output file with provenance for both sources', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            const bFile = join(root, 'b.json');
            const outFile = join(root, 'merged.json');
            writeFileSync(
                aFile,
                JSON.stringify([
                    { id: 'd1', body: 'alpha' },
                    { id: 'd2', body: 'first' },
                ]),
            );
            writeFileSync(bFile, JSON.stringify([{ id: 'd2', body: 'second' }]));

            const code = await runFanin(['--in', aFile, '--in', bFile, '--out', outFile]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
            // The shared document appears exactly once with both originating sources.
            expect(outData[1].metadata.sources).toEqual([{ file: aFile }, { file: bFile }]);
        });
    });

    it('accepts a single --in input', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            const outFile = join(root, 'merged.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));

            const code = await runFanin(['--in', aFile, '--out', outFile]);

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData).toEqual([{ id: 'd1', body: 'alpha', metadata: { sources: [{ file: aFile }] } }]);
        });
    });

    it('fails with non-zero exit naming the file when an input is missing', async () => {
        await withTempDir(async (root) => {
            const missing = join(root, 'nope.json');
            const code = await runFanin(['--in', missing, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog()).toContain(missing);
        });
    });

    it('fails with non-zero exit naming the file when an input is invalid JSON', async () => {
        await withTempDir(async (root) => {
            const badFile = join(root, 'bad.json');
            writeFileSync(badFile, '{ invalid json');
            const code = await runFanin(['--in', badFile, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog()).toContain(badFile);
            expect(errLog()).toContain('invalid JSON');
        });
    });

    it('fails with non-zero exit naming the file when an input violates the Doc list schema', async () => {
        await withTempDir(async (root) => {
            const badFile = join(root, 'bad-schema.json');
            writeFileSync(badFile, JSON.stringify([{ id: 'd1' }])); // missing required 'body'
            const code = await runFanin(['--in', badFile, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog()).toContain(badFile);
        });
    });

    it('fails with exit code 2 on usage errors', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));

            // Missing --out
            expect(await runFanin(['--in', aFile])).toBe(2);
            // No --in at all
            expect(await runFanin(['--out', join(root, 'merged.json')])).toBe(2);
            // Unknown flag
            expect(await runFanin(['--in', aFile, '--out', join(root, 'm.json'), '--bogus'])).toBe(2);
        });
    });

    it('fails with exit code 2 when --in or --out is missing its value', async () => {
        await withTempDir(async (root) => {
            expect(await runFanin(['--in'])).toBe(2);
            expect(errLog()).toContain('--in requires a file path');

            cap = captureOutput();
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));
            expect(await runFanin(['--in', aFile, '--out'])).toBe(2);
            expect(errLog()).toContain('--out requires a file path');
        });
    });

    it('fails with non-zero exit naming the file when an input exists but cannot be read', async () => {
        await withTempDir(async (root) => {
            // A directory exists but readFileSync cannot read it as a file (EISDIR).
            const dirInput = join(root, 'input-dir');
            mkdirSync(dirInput);

            const code = await runFanin(['--in', dirInput, '--out', join(root, 'merged.json')]);

            expect(code).toBe(1);
            expect(errLog()).toContain(dirInput);
            expect(errLog()).toContain('Failed to read input file');
        });
    });

    it('fails with non-zero exit when the output file cannot be written', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));
            // A directory already occupies the out path, so the write fails (EISDIR).
            // A merely-missing parent dir is NOT an error: the ts-runtime FileSystem
            // seam creates it, matching what every ingestion/publish plugin does.
            const badOut = join(root, 'merged.json');
            mkdirSync(badOut);

            const code = await runFanin(['--in', aFile, '--out', badOut]);

            expect(code).toBe(1);
            expect(errLog()).toContain('Failed to write output file');
        });
    });
});

/** Options for a fixture ingestion plugin written by {@link writeFixtureIngestionPlugin}. */
interface FixturePluginOptions {
    /** Sleep this many ms before writing output (concurrency / timeout tests). */
    sleepMs?: number;
    /** Exit with this code instead of writing output (failure tests). */
    exitCode?: number;
    /** Emit this many chars of stderr before the failure exit (sourceErrors truncation-cap test). */
    stderrChars?: number;
    /** Override the written Doc id (defaults to the plugin name). */
    docId?: string;
    /** Register under a non-ingestion kind (kind-mismatch test). */
    kind?: 'ingestion' | 'generator';
}

/** Write a fixture plugin named `name` under `pluginsRoot`; its entry honors `--out` per `opts`. */
function writeFixtureIngestionPlugin(pluginsRoot: string, name: string, opts: FixturePluginOptions = {}): void {
    const kind = opts.kind ?? 'ingestion';
    const collection = kind === 'ingestion' ? 'ingestions' : 'generations';
    const dir = join(pluginsRoot, collection, name);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name, kind, entry: './src/index.ts', version: '1.0.0' }));
    const lines = [
        "import { writeFileSync } from 'node:fs';",
        'const argv = process.argv.slice(2);',
        "const outPath = argv[argv.indexOf('--out') + 1];",
    ];
    if (opts.sleepMs !== undefined) {
        lines.push(`await Bun.sleep(${opts.sleepMs});`);
    }
    if (opts.exitCode !== undefined) {
        if (opts.stderrChars !== undefined) {
            lines.push(`console.error('head|' + 'x'.repeat(${opts.stderrChars}) + '|tail');`);
        } else {
            lines.push(`console.error('simulated ingestion failure');`);
        }
        lines.push(`process.exit(${opts.exitCode});`);
    } else {
        const docId = opts.docId ?? name;
        lines.push(`writeFileSync(outPath, JSON.stringify([{ id: '${docId}', body: 'doc from ${name}' }]));`);
    }
    writeFileSync(join(dir, 'src', 'index.ts'), `${lines.join('\n')}\n`);
}

/** Run `fn` with KK_PLUGIN_PATH pointing at `pluginsRoot` (multi-root discovery), restoring it afterwards. */
async function withPluginPath<T>(pluginsRoot: string, fn: () => Promise<T>): Promise<T> {
    const prev = process.env.KK_PLUGIN_PATH;
    process.env.KK_PLUGIN_PATH = pluginsRoot;
    try {
        return await fn();
    } finally {
        if (prev === undefined) {
            delete process.env.KK_PLUGIN_PATH;
        } else {
            process.env.KK_PLUGIN_PATH = prev;
        }
    }
}

/** Run `fn` with KK_PLUGIN_PATH cleared (asserts discovery comes from --plugins-root alone). */
async function withoutPluginPath<T>(fn: () => Promise<T>): Promise<T> {
    const prev = process.env.KK_PLUGIN_PATH;
    delete process.env.KK_PLUGIN_PATH;
    try {
        return await fn();
    } finally {
        if (prev !== undefined) {
            process.env.KK_PLUGIN_PATH = prev;
        }
    }
}

/** One captured `spawnPluginEntryAsync` call in the policy tests: the budget-assertion surface. */
interface SpySpawnCall {
    pluginName?: string;
    timeoutMs?: number;
}

/** A spawn promise held by the test so it controls settle order (dispatch-policy tests). */
interface HeldSpawn {
    promise: Promise<PluginEntrySpawnResult>;
    release: (result: PluginEntrySpawnResult) => void;
}

/** Success shape a fake spawn returns after writing its output file. */
const FAKE_SPAWN_SUCCESS: PluginEntrySpawnResult = { exitCode: 0, stdout: '', stderr: '' };

/** The exact timed-out `PluginEntrySpawnResult` production's async spawn returns on a leash hit. */
const FAKE_SPAWN_TIMEOUT: PluginEntrySpawnResult = { exitCode: 1, stdout: '', stderr: '', timedOut: true };

/** Create one held spawn promise; `release` resolves it and is idempotent. */
function makeHeldSpawn(): HeldSpawn {
    let release!: (result: PluginEntrySpawnResult) => void;
    const promise = new Promise<PluginEntrySpawnResult>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

/** Write a valid `Doc[]` output file for a faked successful spawn (collectSourceDocs validates it). */
function writeFakeSuccessDoc(opts: PluginEntryAsyncSpawnOptions): void {
    writeFileSync(
        opts.outPath,
        JSON.stringify([{ id: opts.pluginName ?? 'unknown', body: `fake doc from ${opts.pluginName}` }]),
    );
}

/**
 * Run `fn` with a scoped `spyOn` on the invoke module's `spawnPluginEntryAsync` export — the
 * exact boundary `runFanin`'s `collectSourceDocs` already calls. Real manifests and inputs stay
 * in place so discovery, entry checks and output validation remain exercised; only the OS spawn
 * is faked. The spy is always restored — no persistent `mock.module` replacement that could
 * poison other files. This asserts dispatch policy only: the real-spawn tests keep the actual
 * process-kill and ingestion coverage.
 */
async function withSpawnSpy<T>(
    respond: (opts: PluginEntryAsyncSpawnOptions) => PluginEntrySpawnResult | Promise<PluginEntrySpawnResult>,
    fn: (calls: SpySpawnCall[]) => Promise<T>,
): Promise<T> {
    const calls: SpySpawnCall[] = [];
    const spy = spyOn(invokeModule, 'spawnPluginEntryAsync').mockImplementation(async (opts) => {
        calls.push({ pluginName: opts.pluginName, timeoutMs: opts.timeoutMs });
        return respond(opts);
    });
    try {
        return await fn(calls);
    } finally {
        spy.mockRestore();
    }
}

describe('runFanin source-runner mode (--source)', () => {
    // Source failures echo via echoError intentionally; capture ts-utils stderr
    // (instead of monkey-patching a logger) and keep the dots reporter clean.
    let cap: ReturnType<typeof captureOutput>;

    beforeEach(() => {
        cap = captureOutput();
    });

    afterEach(() => {
        cap.restore();
    });

    const errLog = (): string => cap.readErr();

    it('R3 — --plugins-root selects the discovery root for --source without KK_PLUGIN_PATH', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'src-a', { docId: 'root-1' });
            const inFile = join(root, 'in.json');
            writeFileSync(inFile, '[]');
            const outFile = join(root, 'merged.json');

            const code = await withoutPluginPath(() =>
                runFanin(['--source', `src-a:${inFile}`, '--out', outFile, '--plugins-root', pluginsRoot]),
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['root-1']);
        });
    });

    it('R3 — --plugins-path unions the extra root into --source discovery', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'src-b', { docId: 'path-1' });
            const inFile = join(root, 'in.json');
            writeFileSync(inFile, '[]');
            const outFile = join(root, 'merged.json');

            const code = await withoutPluginPath(() =>
                runFanin(['--source', `src-b:${inFile}`, '--out', outFile, '--plugins-path', pluginsRoot]),
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['path-1']);
        });
    });

    it('R3 — --plugins-root with --plugins-path is a usage error and writes no output', async () => {
        await withTempDir(async (root) => {
            const inFile = join(root, 'in.json');
            writeFileSync(inFile, '[]');
            const outFile = join(root, 'merged.json');

            const code = await runFanin([
                '--source',
                `src-a:${inFile}`,
                '--out',
                outFile,
                '--plugins-root',
                join(root, 'p1'),
                '--plugins-path',
                join(root, 'p2'),
            ]);

            expect(code).toBe(2);
            expect(errLog()).toContain('mutually exclusive');
            expect(existsSync(outFile)).toBe(false);
        });
    });

    it('R3 — a second --plugins-root is a usage error', async () => {
        await withTempDir(async (root) => {
            const inFile = join(root, 'in.json');
            writeFileSync(inFile, '[]');
            const outFile = join(root, 'merged.json');

            const code = await runFanin([
                '--source',
                `src-a:${inFile}`,
                '--out',
                outFile,
                '--plugins-root',
                root,
                '--plugins-root',
                root,
            ]);

            expect(code).toBe(2);
            expect(errLog()).toContain('may be specified only once');
        });
    });

    it('R3 — --plugins-root with no value is a usage error', async () => {
        await withTempDir(async (root) => {
            const inFile = join(root, 'in.json');
            writeFileSync(inFile, '[]');
            const outFile = join(root, 'merged.json');

            const code = await runFanin(['--source', `src-a:${inFile}`, '--out', outFile, '--plugins-root']);

            expect(code).toBe(2);
            expect(errLog()).toContain('requires a directory path');
        });
    });

    it('R1 — dispatches every --source before any held result settles; merge stays declaration-order', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-hold-a', { docId: 'fanin-hold-a' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-hold-b', { docId: 'fanin-hold-b' });
            const outFile = join(root, 'merged.json');
            const inA = join(root, 'a-in.json');
            const inB = join(root, 'b-in.json');
            writeFileSync(inA, '[]');
            writeFileSync(inB, '[]');

            await withPluginPath(pluginsRoot, async () => {
                const calls: SpySpawnCall[] = [];
                const heldByPlugin = new Map<string, HeldSpawn>();
                let releaseGate!: () => void;
                const bothArrived = new Promise<void>((resolve) => {
                    releaseGate = resolve;
                });

                const spy = spyOn(invokeModule, 'spawnPluginEntryAsync').mockImplementation((opts) => {
                    calls.push({ pluginName: opts.pluginName, timeoutMs: opts.timeoutMs });
                    // A successful fake still writes its output file: collectSourceDocs validates it.
                    writeFakeSuccessDoc(opts);
                    const hold = makeHeldSpawn();
                    heldByPlugin.set(opts.pluginName ?? 'unknown', hold);
                    if (heldByPlugin.size === 2) {
                        releaseGate();
                    }
                    return hold.promise;
                });
                try {
                    // Start the run without awaiting it: both spawn results are held by this test.
                    const run = runFanin([
                        '--source',
                        `fanin-hold-a:${inA}`,
                        '--source',
                        `fanin-hold-b:${inB}`,
                        '--out',
                        outFile,
                    ]);

                    await bothArrived;
                    // Both dispatches are observed before either result is released — no elapsed-time
                    // ceiling. A serial-dispatch regression never gets here; the per-test watchdog
                    // fails the held run instead of racing host startup latency.
                    expect(calls).toHaveLength(2);

                    // Release in reverse declaration order; merge order must not follow settle order.
                    heldByPlugin.get('fanin-hold-b')?.release(FAKE_SPAWN_SUCCESS);
                    heldByPlugin.get('fanin-hold-a')?.release(FAKE_SPAWN_SUCCESS);

                    expect(await run).toBe(0);
                } finally {
                    // Idempotent releases keep the run from hanging if an assertion above failed.
                    for (const hold of heldByPlugin.values()) {
                        hold.release(FAKE_SPAWN_SUCCESS);
                    }
                    spy.mockRestore();
                }

                const outData = JSON.parse(await Bun.file(outFile).text());
                // Declaration-order output and provenance survive the reversed settle order.
                expect(outData.map((d: { id: string }) => d.id)).toEqual(['fanin-hold-a', 'fanin-hold-b']);
                expect(outData[0].metadata.sources).toEqual([{ file: 'fanin-hold-a' }]);
                expect(outData[1].metadata.sources).toEqual([{ file: 'fanin-hold-b' }]);
            });
        });
    });

    it('one failing source degrades: surviving docs + metadata.sourceErrors entry, exit 0', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-ok', { docId: 'ok1' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-bad', { exitCode: 3 });
            const outFile = join(root, 'merged.json');
            const inOk = join(root, 'ok-in.json');
            const inBad = join(root, 'bad-in.json');
            writeFileSync(inOk, '[]');
            writeFileSync(inBad, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin(['--source', `fanin-ok:${inOk}`, '--source', `fanin-bad:${inBad}`, '--out', outFile]),
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['ok1']);
            const errors = outData[0].metadata.sourceErrors;
            expect(errors).toHaveLength(1);
            expect(errors[0].plugin).toBe('fanin-bad');
            expect(errors[0].error).toContain('simulated ingestion failure');
            expect(typeof errors[0].durationMs).toBe('number');
            // Degradations are also echoed to the run output (never swallowed).
            expect(errLog()).toContain('fanin-bad');
        });
    });

    it('a degraded source error string is capped at 2KB before it lands in sourceErrors (P3b)', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-ok', { docId: 'ok1' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-chatty', { exitCode: 4, stderrChars: 100_000 });
            const outFile = join(root, 'merged.json');
            const inOk = join(root, 'ok-in.json');
            const inBad = join(root, 'bad-in.json');
            writeFileSync(inOk, '[]');
            writeFileSync(inBad, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin(['--source', `fanin-ok:${inOk}`, '--source', `fanin-chatty:${inBad}`, '--out', outFile]),
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['ok1']);
            const errors = outData[0].metadata.sourceErrors;
            expect(errors).toHaveLength(1);
            // Real stderr is captured (its head survives), the tail is cut, and the
            // truncation is stated explicitly — never a silent swallow.
            expect(errors[0].error).toContain('head|');
            expect(errors[0].error).toContain('truncated');
            expect(errors[0].error).not.toContain('|tail');
            // 2048-char head + prefix + truncation marker — never the raw 100k stderr.
            expect(errors[0].error.length).toBeLessThan(2200);
        });
    });

    it('a timed-out source degrades and reports the timeout without aborting siblings', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-fast', { docId: 'fast1' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-stuck', { sleepMs: 10_000 });
            // Leash 3000ms: a bun child cold-starts in ~250-350ms idle, but a 1000ms leash still cut the
            // fast sibling under full-gate load (2026-10-13); 3000ms stays far below the 10s stuck source.
            const outFile = join(root, 'merged.json');
            const inFast = join(root, 'fast-in.json');
            const inStuck = join(root, 'stuck-in.json');
            writeFileSync(inFast, '[]');
            writeFileSync(inStuck, '[]');

            const started = Date.now();
            const code = await withPluginPath(pluginsRoot, () =>
                runFanin([
                    '--source',
                    `fanin-fast:${inFast}`,
                    '--source',
                    `fanin-stuck:${inStuck}`,
                    '--source-timeout',
                    '3000',
                    '--out',
                    outFile,
                ]),
            );
            const elapsed = Date.now() - started;

            expect(code).toBe(0);
            // The 10s source was cut at ~3000ms; the run did not wait for it.
            expect(elapsed).toBeLessThan(8000);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['fast1']);
            const errors = outData[0].metadata.sourceErrors;
            expect(errors).toHaveLength(1);
            expect(errors[0].plugin).toBe('fanin-stuck');
            expect(errors[0].error).toContain('timed out after 3000ms');
            expect(errors[0].durationMs).toBeLessThan(8000);
        });
    }, 20_000);

    it('R2 — override reaches only its source; siblings keep the global leash and one timeout degrades alone (policy)', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-t-ovr', { docId: 'fanin-t-ovr' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-t-ok', { docId: 'fanin-t-ok' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-t-slow', { docId: 'fanin-t-slow' });
            const outFile = join(root, 'merged.json');
            const inOvr = join(root, 'ovr-in.json');
            const inOk = join(root, 'ok-in.json');
            const inSlow = join(root, 'slow-in.json');
            writeFileSync(inOvr, '[]');
            writeFileSync(inOk, '[]');
            writeFileSync(inSlow, '[]');

            await withPluginPath(pluginsRoot, () =>
                withSpawnSpy(
                    (opts) => {
                        if (opts.pluginName === 'fanin-t-slow') {
                            return FAKE_SPAWN_TIMEOUT;
                        }
                        writeFakeSuccessDoc(opts);
                        return FAKE_SPAWN_SUCCESS;
                    },
                    async (calls) => {
                        const code = await runFanin([
                            '--source',
                            `fanin-t-ovr:${inOvr}`,
                            '--source',
                            `fanin-t-ok:${inOk}`,
                            '--source',
                            `fanin-t-slow:${inSlow}`,
                            '--source-timeout',
                            '5000',
                            '--source-timeout-override',
                            'fanin-t-ovr:9000',
                            '--out',
                            outFile,
                        ]);

                        expect(code).toBe(0);
                        // The exact timeoutMs handed to each spawn: the override reaches only its
                        // own source; both siblings get the global value (override > global).
                        expect(calls).toHaveLength(3);
                        const budgetByPlugin = new Map<string | undefined, number | undefined>(
                            calls.map((call) => [call.pluginName, call.timeoutMs]),
                        );
                        expect(budgetByPlugin.get('fanin-t-ovr')).toBe(9000);
                        expect(budgetByPlugin.get('fanin-t-ok')).toBe(5000);
                        expect(budgetByPlugin.get('fanin-t-slow')).toBe(5000);

                        const outData = JSON.parse(await Bun.file(outFile).text());
                        // The overridden source and the successful sibling survive; merge order holds.
                        expect(outData.map((d: { id: string }) => d.id)).toEqual(['fanin-t-ovr', 'fanin-t-ok']);
                        const errors = outData[0].metadata.sourceErrors;
                        // The simulated timed-out sibling contributes only its own attributed entry.
                        expect(errors).toHaveLength(1);
                        expect(errors[0].plugin).toBe('fanin-t-slow');
                        expect(errors[0].error).toContain('timed out after 5000ms');
                        expect(typeof errors[0].durationMs).toBe('number');
                        // Degradations still echo to the run output (never swallowed).
                        expect(errLog()).toContain('fanin-t-slow');
                    },
                ),
            );
        });
    });

    it('R2 — no global leash: the ordinary source keeps the 30-minute default and the override tightens only itself (policy)', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-t-plain', { docId: 'fanin-t-plain' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-t-tight', { docId: 'fanin-t-tight' });
            const outFile = join(root, 'merged.json');
            const inPlain = join(root, 'plain-in.json');
            const inTight = join(root, 'tight-in.json');
            writeFileSync(inPlain, '[]');
            writeFileSync(inTight, '[]');

            await withPluginPath(pluginsRoot, () =>
                withSpawnSpy(
                    (opts) => {
                        if (opts.pluginName === 'fanin-t-tight') {
                            return FAKE_SPAWN_TIMEOUT;
                        }
                        writeFakeSuccessDoc(opts);
                        return FAKE_SPAWN_SUCCESS;
                    },
                    async (calls) => {
                        const code = await runFanin([
                            '--source',
                            `fanin-t-plain:${inPlain}`,
                            '--source',
                            `fanin-t-tight:${inTight}`,
                            '--source-timeout-override',
                            'fanin-t-tight:250',
                            '--out',
                            outFile,
                        ]);

                        expect(code).toBe(0);
                        expect(calls).toHaveLength(2);
                        const budgetByPlugin = new Map<string | undefined, number | undefined>(
                            calls.map((call) => [call.pluginName, call.timeoutMs]),
                        );
                        // fanin.ts DEFAULT_SOURCE_TIMEOUT_MS (kept module-private): the ordinary
                        // source gets the existing 30-minute default, only the override tightens.
                        expect(budgetByPlugin.get('fanin-t-plain')).toBe(30 * 60 * 1000);
                        expect(budgetByPlugin.get('fanin-t-tight')).toBe(250);

                        const outData = JSON.parse(await Bun.file(outFile).text());
                        expect(outData.map((d: { id: string }) => d.id)).toEqual(['fanin-t-plain']);
                        const errors = outData[0].metadata.sourceErrors;
                        expect(errors).toHaveLength(1);
                        expect(errors[0].plugin).toBe('fanin-t-tight');
                        expect(errors[0].error).toContain('timed out after 250ms');
                    },
                ),
            );
        });
    });

    it('--source-timeout-override tightens ONE source below the default without a global flag', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-ovr-ok', { docId: 'ok1' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-ovr-stuck', { sleepMs: 10_000 });
            const outFile = join(root, 'merged.json');
            const inOk = join(root, 'ok-in.json');
            const inStuck = join(root, 'stuck-in.json');
            writeFileSync(inOk, '[]');
            writeFileSync(inStuck, '[]');

            // No --source-timeout: the default is 30m, so only the per-source override can cut the stuck source.
            const started = Date.now();
            const code = await withPluginPath(pluginsRoot, () =>
                runFanin([
                    '--source',
                    `fanin-ovr-ok:${inOk}`,
                    '--source',
                    `fanin-ovr-stuck:${inStuck}`,
                    '--source-timeout-override',
                    'fanin-ovr-stuck:300',
                    '--out',
                    outFile,
                ]),
            );
            const elapsed = Date.now() - started;

            expect(code).toBe(0);
            expect(elapsed).toBeLessThan(5000);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['ok1']);
            const errors = outData[0].metadata.sourceErrors;
            expect(errors).toHaveLength(1);
            expect(errors[0].plugin).toBe('fanin-ovr-stuck');
            expect(errors[0].error).toContain('timed out after 300ms');
        });
    });

    it('all sources fail → exit 1, no out.json', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-bad1', { exitCode: 2 });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-bad2', { exitCode: 5 });
            const outFile = join(root, 'merged.json');
            const inA = join(root, 'a-in.json');
            const inB = join(root, 'b-in.json');
            writeFileSync(inA, '[]');
            writeFileSync(inB, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin(['--source', `fanin-bad1:${inA}`, '--source', `fanin-bad2:${inB}`, '--out', outFile]),
            );

            expect(code).toBe(1);
            expect(existsSync(outFile)).toBe(false);
            expect(errLog()).toContain('fanin-bad1');
            expect(errLog()).toContain('fanin-bad2');
            expect(errLog()).toContain('all 2 source(s) failed');
        });
    });

    it('an unknown or non-ingestion plugin degrades like a failed source', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-generator', { kind: 'generator' });
            const outFile = join(root, 'merged.json');
            const inA = join(root, 'a-in.json');
            const inGen = join(root, 'gen-in.json');
            writeFileSync(inA, '[]');
            writeFileSync(inGen, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin([
                    '--source',
                    `no-such-plugin:${inA}`,
                    '--source',
                    `fanin-generator:${inGen}`,
                    '--out',
                    outFile,
                ]),
            );

            // Every source failed → exit 1, no output.
            expect(code).toBe(1);
            expect(existsSync(outFile)).toBe(false);
            expect(errLog()).toContain("Plugin 'no-such-plugin' not found");
            expect(errLog()).toContain("Plugin 'fanin-generator' is kind 'generator', not 'ingestion'");
        });
    });

    it('a source writing invalid or schema-violating output degrades', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            const dir = join(pluginsRoot, 'ingestions', 'fanin-junk');
            mkdirSync(join(dir, 'src'), { recursive: true });
            writeFileSync(
                join(dir, 'plugin.json'),
                JSON.stringify({ name: 'fanin-junk', kind: 'ingestion', entry: './src/index.ts', version: '1.0.0' }),
            );
            // Exit 0 but write a non-Doc[] payload.
            writeFileSync(
                join(dir, 'src', 'index.ts'),
                [
                    "import { writeFileSync } from 'node:fs';",
                    'const argv = process.argv.slice(2);',
                    "const outPath = argv[argv.indexOf('--out') + 1];",
                    'writeFileSync(outPath, JSON.stringify({ nope: true }));',
                ].join('\n'),
            );
            const outFile = join(root, 'merged.json');
            const inA = join(root, 'a-in.json');
            writeFileSync(inA, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin(['--source', `fanin-junk:${inA}`, '--out', outFile]),
            );

            expect(code).toBe(1);
            expect(existsSync(outFile)).toBe(false);
            expect(errLog()).toContain('Doc list schema');
        });
    });

    it('combines --in and --source: --in docs first, source docs in declaration order, per-origin provenance', async () => {
        await withTempDir(async (root) => {
            const pluginsRoot = join(root, 'plugins');
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-mix-a', { docId: 's1' });
            writeFixtureIngestionPlugin(pluginsRoot, 'fanin-mix-b', { docId: 's2' });
            const outFile = join(root, 'merged.json');
            const inFile = join(root, 'file.json');
            const inA = join(root, 'a-in.json');
            const inB = join(root, 'b-in.json');
            writeFileSync(
                inFile,
                JSON.stringify([
                    { id: 'f1', body: 'from file' },
                    { id: 's1', body: 'dup' },
                ]),
            );
            writeFileSync(inA, '[]');
            writeFileSync(inB, '[]');

            const code = await withPluginPath(pluginsRoot, () =>
                runFanin([
                    '--in',
                    inFile,
                    '--source',
                    `fanin-mix-a:${inA}`,
                    '--source',
                    `fanin-mix-b:${inB}`,
                    '--out',
                    outFile,
                ]),
            );

            expect(code).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            // --in docs keep first-appearance order; sources append in declaration order.
            expect(outData.map((d: { id: string }) => d.id)).toEqual(['f1', 's1', 's2']);
            expect(outData[0].metadata.sources).toEqual([{ file: inFile }]);
            expect(outData[1].metadata.sources).toEqual([{ file: inFile }, { file: 'fanin-mix-a' }]);
            expect(outData[2].metadata.sources).toEqual([{ file: 'fanin-mix-b' }]);
            // No failures → no sourceErrors on the output.
            expect(outData[0].metadata.sourceErrors).toBeUndefined();
        });
    });

    it('exits 2 on source-flag usage errors', async () => {
        await withTempDir(async (root) => {
            const aFile = join(root, 'a.json');
            const outFile = join(root, 'merged.json');
            writeFileSync(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]));

            // --source without a value.
            expect(await runFanin(['--source', '--out', outFile])).toBe(2);
            expect(errLog()).toContain('--source requires <plugin>:<inputFile>');

            cap = captureOutput();
            // --source without the ':' separator, or with an empty side.
            expect(await runFanin(['--source', 'just-a-file', '--out', outFile])).toBe(2);
            cap = captureOutput();
            expect(await runFanin(['--source', ':no-plugin.json', '--out', outFile])).toBe(2);
            cap = captureOutput();
            expect(await runFanin(['--source', 'no-file:', '--out', outFile])).toBe(2);

            // --source-timeout must be a positive integer, given at most once, and only with --source.
            cap = captureOutput();
            expect(await runFanin(['--source', `p:${aFile}`, '--source-timeout', 'abc', '--out', outFile])).toBe(2);
            cap = captureOutput();
            expect(await runFanin(['--source', `p:${aFile}`, '--source-timeout', '0', '--out', outFile])).toBe(2);
            cap = captureOutput();
            expect(await runFanin(['--source', `p:${aFile}`, '--source-timeout', '-5', '--out', outFile])).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin([
                    '--source',
                    `p:${aFile}`,
                    '--source-timeout',
                    '10',
                    '--source-timeout',
                    '20',
                    '--out',
                    outFile,
                ]),
            ).toBe(2);
            cap = captureOutput();
            expect(await runFanin(['--in', aFile, '--source-timeout', '10', '--out', outFile])).toBe(2);
            expect(errLog()).toContain('--source-timeout requires at least one --source');

            // --source-timeout-override requires <plugin>:<ms>, a positive integer ms, known
            // plugins only, at most one entry per plugin, and at least one --source.
            cap = captureOutput();
            expect(
                await runFanin([
                    '--source',
                    `p:${aFile}`,
                    '--source-timeout-override',
                    'no-separator',
                    '--out',
                    outFile,
                ]),
            ).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin(['--source', `p:${aFile}`, '--source-timeout-override', ':100', '--out', outFile]),
            ).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin(['--source', `p:${aFile}`, '--source-timeout-override', 'p:abc', '--out', outFile]),
            ).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin(['--source', `p:${aFile}`, '--source-timeout-override', 'p:0', '--out', outFile]),
            ).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin([
                    '--source',
                    `p:${aFile}`,
                    '--source-timeout-override',
                    'p:10',
                    '--source-timeout-override',
                    'p:20',
                    '--out',
                    outFile,
                ]),
            ).toBe(2);
            cap = captureOutput();
            expect(
                await runFanin(['--source', `p:${aFile}`, '--source-timeout-override', 'other:10', '--out', outFile]),
            ).toBe(2);
            expect(errLog()).toContain('not among the --source plugins');
            cap = captureOutput();
            expect(await runFanin(['--in', aFile, '--source-timeout-override', 'p:10', '--out', outFile])).toBe(2);
            expect(errLog()).toContain('--source-timeout-override requires at least one --source');

            // Neither --in nor --source.
            cap = captureOutput();
            expect(await runFanin(['--out', outFile])).toBe(2);
            expect(errLog()).toContain('at least one --in file or --source is required');
        });
    });
});
