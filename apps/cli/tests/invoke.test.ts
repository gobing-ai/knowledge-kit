import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectionForKind, type PluginKind } from '@gobing-ai/kk-core';
import { pluginEnvFromConfig, probeVerdict, runInvoke, spawnPluginEntryAsync, spawnPluginSession } from '../src/invoke';
import { captureOutput, silenceOutput } from './capture';

function pluginDirOf(root: string, kind: PluginKind, name: string): string {
    return join(root, collectionForKind(kind), name);
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-invoke-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('runInvoke', () => {
    // Negative-path tests emit via echoError intentionally; silence stderr so --dots stays clean.
    let restoreSilence: () => void;

    beforeEach(() => {
        restoreSilence = silenceOutput();
    });

    afterEach(() => {
        restoreSilence();
    });

    it('R1 — runs discovered plugin entry and verifies written output', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'gen-plugin');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-gen', kind: 'generator', entry: 'scripts/run.ts' }),
            );

            const scriptCode = `
                import { readFileSync, writeFileSync } from 'node:fs';
                const args = process.argv.slice(2);
                const inIdx = args.indexOf('--in') + 1;
                const outIdx = args.indexOf('--out') + 1;
                const inPath = args[inIdx];
                const outPath = args[outIdx];
                
                const docs = JSON.parse(readFileSync(inPath, 'utf-8'));
                const content = { body: '# Summary of ' + docs.length + ' docs', format: 'markdown' };
                writeFileSync(outPath, JSON.stringify(content));
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);

            const inFile = join(root, 'docs.json');
            const outFile = join(root, 'content.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1', body: 'Doc 1 content' }]));

            const res = await runInvoke({
                plugin: 'my-gen',
                inPath: inFile,
                outPath: outFile,
                pluginsRoot: root,
            });

            expect(res).toBe(0);

            const text = await Bun.file(outFile).text();
            const outData = JSON.parse(text);
            expect(outData.body).toBe('# Summary of 1 docs');
        });
    });

    it('R3 — resolves a plugin that exists only on an extra --plugins-path root', async () => {
        await withTempDir(async (root) => {
            // The plugin exists ONLY on the extra root — not on any default root.
            const extraRoot = join(root, 'extra');
            const pluginDir = pluginDirOf(extraRoot, 'generator', 'extra-gen');
            mkdirSync(join(pluginDir, 'scripts'), { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'extra-gen', kind: 'generator', entry: 'scripts/run.ts' }),
            );
            writeFileSync(
                join(pluginDir, 'scripts', 'run.ts'),
                [
                    "import { readFileSync, writeFileSync } from 'node:fs';",
                    'const args = process.argv.slice(2);',
                    "const inPath = args[args.indexOf('--in') + 1];",
                    "const outPath = args[args.indexOf('--out') + 1];",
                    "const docs = JSON.parse(readFileSync(inPath, 'utf-8'));",
                    "writeFileSync(outPath, JSON.stringify({ body: '# Extra gen on ' + docs.length + ' docs', format: 'markdown' }));",
                ].join('\n'),
            );

            const inFile = join(root, 'docs.json');
            const outFile = join(root, 'content.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1', body: 'Doc 1' }]));

            const res = await runInvoke({
                plugin: 'extra-gen',
                inPath: inFile,
                outPath: outFile,
                pluginsPath: [extraRoot],
            });

            expect(res).toBe(0);
            const outData = JSON.parse(await Bun.file(outFile).text());
            expect(outData.body).toBe('# Extra gen on 1 docs');
        });
    });

    it('R2 — fails before entry spawn when input violates kind schema', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'gen-plugin');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-gen', kind: 'generator', entry: 'scripts/run.ts' }),
            );

            const markerFile = join(root, 'ran.marker');
            const scriptCode = `
                import { writeFileSync } from 'node:fs';
                writeFileSync(${JSON.stringify(markerFile)}, 'ran');
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);

            const inFile = join(root, 'bad-docs.json');
            const outFile = join(root, 'content.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1' }])); // missing required 'body'

            const res = await runInvoke({
                plugin: 'my-gen',
                inPath: inFile,
                outPath: outFile,
                pluginsRoot: root,
            });

            expect(res).toBe(1);
            expect(Bun.file(markerFile).size).toBe(0);
        });
    });

    it('R4 — fails loud when plugin entry exits non-zero', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'publish', 'failing-plugin');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-failing-pub', kind: 'publish', entry: 'scripts/run.ts' }),
            );

            const scriptCode = `
                console.error('Fatal API error 500: Publish endpoint unreachable');
                process.exit(2);
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);

            const inFile = join(root, 'content.json');
            const outFile = join(root, 'result.json');
            writeFileSync(inFile, JSON.stringify({ body: 'Article content' }));

            const res = await runInvoke({
                plugin: 'my-failing-pub',
                inPath: inFile,
                outPath: outFile,
                pluginsRoot: root,
            });

            expect(res).toBe(2);
        });
    });

    it('0110 I3 — publish Doc[] input is rejected undeclared, dispatched when the manifest declares a doc-list op', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'publish', 'array-pub');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            // Recording fake plugin entry: the seam under test is the executor's
            // schema gate, not the plugin — the entry records the input shape it
            // received and emits a valid publish Result so output validation passes.
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'array-pub', kind: 'publish', entry: 'scripts/run.ts' }),
            );
            const sawFile = join(root, 'entry-saw.json');
            const scriptCode = `
                import { readFileSync, writeFileSync } from 'node:fs';
                const args = process.argv.slice(2);
                const inPath = args[args.indexOf('--in') + 1];
                const outPath = args[args.indexOf('--out') + 1];
                const input = JSON.parse(readFileSync(inPath, 'utf-8'));
                writeFileSync(${JSON.stringify(sawFile)}, JSON.stringify({ isArray: Array.isArray(input) }));
                writeFileSync(outPath, JSON.stringify({ ok: true, target: 'array-pub' }));
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);
            const outFile = join(root, 'result.json');

            // (AC5) Undeclared publish plugin + bare Doc[] array --in: rejected before the
            // child runs — the entry is never reached.
            const arrayIn = join(root, 'docs.json');
            writeFileSync(arrayIn, JSON.stringify([{ id: 'd1', body: 'episode plan doc' }]));
            let res = await runInvoke({
                plugin: 'array-pub',
                inPath: arrayIn,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(1);
            expect(existsSync(sawFile)).toBe(false);

            // Declared doc-list operation (podcast-pub show-notes shape): the array input
            // validates against DocListSchema and reaches the entry.
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({
                    name: 'array-pub',
                    kind: 'publish',
                    entry: 'scripts/run.ts',
                    operations: { 'show-notes': { input: 'doc-list', output: 'markdown' } },
                }),
            );
            res = await runInvoke({ plugin: 'array-pub', inPath: arrayIn, outPath: outFile, pluginsRoot: root });
            expect(res).toBe(0);
            expect(JSON.parse(await Bun.file(sawFile).text())).toEqual({ isArray: true });

            // Content-object --in still validates and reaches the entry exactly as before.
            const objectIn = join(root, 'content.json');
            writeFileSync(objectIn, JSON.stringify({ body: 'Article content' }));
            res = await runInvoke({ plugin: 'array-pub', inPath: objectIn, outPath: outFile, pluginsRoot: root });
            expect(res).toBe(0);
            expect(JSON.parse(await Bun.file(sawFile).text())).toEqual({ isArray: false });
        });
    });

    it('0101 — show-notes array-form publish invocations treat --out as an opaque markdown artifact', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'publish', 'markdown-pub');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({
                    name: 'markdown-pub',
                    kind: 'publish',
                    entry: 'scripts/run.ts',
                    operations: { 'show-notes': { input: 'doc-list', output: 'markdown' } },
                }),
            );

            // Fake entry switching on a MODE file so one plugin serves every leg; the
            // seam under test is the executor's output stage, not the plugin.
            const modeFile = join(root, 'mode.txt');
            const scriptCode = `
                import { readFileSync, writeFileSync } from 'node:fs';
                const args = process.argv.slice(2);
                const outPath = args[args.indexOf('--out') + 1];
                const mode = readFileSync(${JSON.stringify(modeFile)}, 'utf-8').trim();
                if (mode === 'markdown') {
                    writeFileSync(outPath, '# Show notes\\n\\n- Segment 1: intro\\n- Segment 2: deep dive\\n');
                } else if (mode === 'invalid-json') {
                    writeFileSync(outPath, 'not json at all {');
                } else if (mode === 'empty') {
                    writeFileSync(outPath, '');
                } else if (mode === 'result') {
                    writeFileSync(outPath, JSON.stringify({ ok: true, target: 'markdown-pub' }));
                }
                // mode === 'missing': writes nothing, exercising the output-exists gate.
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);

            const arrayIn = join(root, 'docs.json');
            writeFileSync(arrayIn, JSON.stringify([{ id: 'd1', body: 'episode plan doc' }]));
            const objectIn = join(root, 'content.json');
            writeFileSync(objectIn, JSON.stringify({ body: 'Episode description content' }));
            const outFile = join(root, 'show-notes.md');

            // (a) Array-in + raw markdown --out: the 0095 show-notes op writes the markdown
            // artifact itself — the output stage must NOT JSON-parse it (R1/R2).
            writeFileSync(modeFile, 'markdown');
            let res = await runInvoke({
                plugin: 'markdown-pub',
                inPath: arrayIn,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(0);
            expect(await Bun.file(outFile).text()).toBe('# Show notes\n\n- Segment 1: intro\n- Segment 2: deep dive\n');

            // (a-exists) Array-in but the entry wrote nothing: the existence gate still applies.
            // 0110 I5: the prior success's artifact is cleared up front, so 'missing' cannot
            // read as fresh success over stale bytes.
            writeFileSync(modeFile, 'missing');
            res = await runInvoke({
                plugin: 'markdown-pub',
                inPath: arrayIn,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // (a-nonempty) Array-in + empty --out: the non-emptiness gate still applies.
            writeFileSync(modeFile, 'empty');
            res = await runInvoke({
                plugin: 'markdown-pub',
                inPath: arrayIn,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // (b) Content-object --in + invalid-JSON --out: existing output validation stays
            // byte-identical — 0101 must not blanket-skip (R1/R2).
            const cap = captureOutput();
            try {
                writeFileSync(modeFile, 'invalid-json');
                res = await runInvoke({
                    plugin: 'markdown-pub',
                    inPath: objectIn,
                    outPath: outFile,
                    pluginsRoot: root,
                });
                expect(res).toBe(1);
                expect(cap.readErr()).toContain(`Output file ${outFile} is invalid JSON`);
            } finally {
                cap.restore();
            }

            // (c) Content-object --in + valid Result --out: exit 0 unchanged (R1/R2).
            writeFileSync(modeFile, 'result');
            res = await runInvoke({
                plugin: 'markdown-pub',
                inPath: objectIn,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(0);

            // 0110 I5: a failed rerun leaves no --out — the stale artifact was cleared
            // before the spawn, and a zero-exit child that writes nothing fails.
            writeFileSync(modeFile, 'missing');
            res = await runInvoke({ plugin: 'markdown-pub', inPath: objectIn, outPath: outFile, pluginsRoot: root });
            expect(res).toBe(1);
            expect(existsSync(outFile)).toBe(false);

            // 0110 I6: a zero-exit child reporting Result.ok=false is a failure — exit 1,
            // failure artifact kept on disk for inspection.
            const scriptCode2 = `${scriptCode}\nif (mode === 'ok-false') { writeFileSync(outPath, JSON.stringify({ ok: false, target: 'markdown-pub', error: 'upstream 502' })); }`;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode2);
            writeFileSync(modeFile, 'ok-false');
            const cap2 = captureOutput();
            try {
                res = await runInvoke({
                    plugin: 'markdown-pub',
                    inPath: objectIn,
                    outPath: outFile,
                    pluginsRoot: root,
                });
                expect(res).toBe(1);
                expect(cap2.readErr()).toContain('reported failure: upstream 502');
            } finally {
                cap2.restore();
            }
            expect(JSON.parse(await Bun.file(outFile).text()).ok).toBe(false);
        });
    });

    it('0110 I5 — --in and --out aliasing the same path is rejected before mutation', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'publish', 'alias-pub');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'alias-pub', kind: 'publish', entry: 'scripts/run.ts' }),
            );
            writeFileSync(join(scriptsDir, 'run.ts'), 'console.log("never runs");');

            const sameFile = join(root, 'io.json');
            writeFileSync(sameFile, JSON.stringify({ body: 'Article content' }));
            const cap = captureOutput();
            try {
                const res = await runInvoke({
                    plugin: 'alias-pub',
                    inPath: sameFile,
                    outPath: sameFile,
                    pluginsRoot: root,
                });
                expect(res).toBe(1);
                expect(cap.readErr()).toContain('alias the same path');
            } finally {
                cap.restore();
            }
            // Input untouched.
            expect(JSON.parse(await Bun.file(sameFile).text())).toEqual({ body: 'Article content' });
        });
    });

    /**
     * Fixture publish plugin for the 0157 R1 alias tests: its entry writes a marker when
     * spawned, so a test asserting the marker is absent proves the run stopped before any spawn.
     */
    function writeAliasPubPlugin(root: string, marker: string): void {
        const pluginDir = pluginDirOf(root, 'publish', 'alias-pub');
        const scriptsDir = join(pluginDir, 'scripts');
        mkdirSync(scriptsDir, { recursive: true });
        writeFileSync(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'alias-pub', kind: 'publish', entry: 'scripts/run.ts' }),
        );
        writeFileSync(
            join(scriptsDir, 'run.ts'),
            `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\n`,
        );
    }

    const ALIAS_INPUT = JSON.stringify({ body: 'Article content' });

    it('0157 R1 — --out differing only by letter case is rejected as an alias (case-insensitive fs)', async () => {
        await withTempDir(async (root) => {
            // Guard: on a case-sensitive file system the lower-case spelling is a distinct
            // (non-existent) path, so there is no alias to detect — the body is a no-op there.
            const inPath = join(root, 'In.json');
            const outPath = join(root, 'in.json');
            writeFileSync(inPath, ALIAS_INPUT);
            if (!existsSync(outPath)) return;

            const marker = join(root, 'entry-ran.marker');
            writeAliasPubPlugin(root, marker);
            const cap = captureOutput();
            try {
                const res = await runInvoke({ plugin: 'alias-pub', inPath, outPath, pluginsRoot: root });
                expect(res).toBe(1);
                expect(cap.readErr()).toContain('alias the same path');
            } finally {
                cap.restore();
            }
            // Input untouched, entry never spawned.
            expect(readFileSync(inPath, 'utf-8')).toBe(ALIAS_INPUT);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('0157 R1 — --out through a symlinked parent directory is rejected as an alias', async () => {
        await withTempDir(async (root) => {
            const dir = join(root, 'd');
            mkdirSync(dir);
            const inPath = join(dir, 'in.json');
            writeFileSync(inPath, ALIAS_INPUT);
            symlinkSync(dir, join(root, 'ld'));
            const outPath = join(root, 'ld', 'in.json');

            const marker = join(root, 'entry-ran.marker');
            writeAliasPubPlugin(root, marker);
            const cap = captureOutput();
            try {
                const res = await runInvoke({ plugin: 'alias-pub', inPath, outPath, pluginsRoot: root });
                expect(res).toBe(1);
                expect(cap.readErr()).toContain('alias the same path');
            } finally {
                cap.restore();
            }
            // Input untouched, entry never spawned.
            expect(readFileSync(inPath, 'utf-8')).toBe(ALIAS_INPUT);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('0157 R1 — --out symlinked to the input file is rejected as an alias', async () => {
        await withTempDir(async (root) => {
            const inPath = join(root, 'in.json');
            writeFileSync(inPath, ALIAS_INPUT);
            const outPath = join(root, 'out-link.json');
            symlinkSync(inPath, outPath);

            const marker = join(root, 'entry-ran.marker');
            writeAliasPubPlugin(root, marker);
            const cap = captureOutput();
            try {
                const res = await runInvoke({ plugin: 'alias-pub', inPath, outPath, pluginsRoot: root });
                expect(res).toBe(1);
                expect(cap.readErr()).toContain('alias the same path');
            } finally {
                cap.restore();
            }
            // Input untouched, entry never spawned.
            expect(readFileSync(inPath, 'utf-8')).toBe(ALIAS_INPUT);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('0110 I2 — async timeout kills the whole spawned tree, not just the direct child', async () => {
        await withTempDir(async (root) => {
            const scriptsDir = join(root, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });
            // If the grandchild survives the timeout it writes the marker at ~2s; the
            // entry itself sleeps past the timeout doing nothing else.
            const marker = join(root, 'grandchild-lived.txt');
            const grandchild = `setTimeout(() => { const { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(marker)}, 'x'); }, 2000); setInterval(() => {}, 1000);`;
            writeFileSync(
                join(scriptsDir, 'run.ts'),
                `import { spawn } from 'node:child_process';\nspawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });\nsetInterval(() => {}, 1000);\n`,
            );

            const res = await spawnPluginEntryAsync({
                entryPath: join(scriptsDir, 'run.ts'),
                cwd: root,
                inPath: join(root, 'in.json'),
                outPath: join(root, 'out.json'),
                timeoutMs: 300,
            });
            expect(res.timedOut).toBe(true);

            // Grace past the grandchild's 2s write deadline: the tree must be gone.
            await Bun.sleep(2600);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('0110 I2b — timeout reaps a grandchild whose spawn was in flight at kill time', async () => {
        await withTempDir(async (root) => {
            const scriptsDir = join(root, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });
            // The entry delays its grandchild spawn to ~250ms — inside the 300ms kill
            // window. A single-snapshot walk misses the in-flight spawn, kills the
            // root, and the grandchild registers under launchd as an unreachable
            // orphan that writes the marker at +2s. The kill must reap it: group
            // SIGKILL first (the entry runs in its own pgid, so a fork that lands
            // after any pgrep snapshot still dies with the group), then the
            // two-sweep pgrep walk as backstop.
            const marker = join(root, 'grandchild-lived.txt');
            const grandchild = `setTimeout(() => { const { writeFileSync } = require('node:fs'); writeFileSync(${JSON.stringify(marker)}, 'x'); }, 2000); setInterval(() => {}, 1000);`;
            writeFileSync(
                join(scriptsDir, 'run.ts'),
                `import { spawn } from 'node:child_process';
setTimeout(() => {
    spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' });
}, 250);
setInterval(() => {}, 1000);
`,
            );

            const res = await spawnPluginEntryAsync({
                entryPath: join(scriptsDir, 'run.ts'),
                cwd: root,
                inPath: join(root, 'in.json'),
                outPath: join(root, 'out.json'),
                timeoutMs: 300,
            });
            expect(res.timedOut).toBe(true);

            // Grace past the grandchild's 2s write deadline (marker deadline is
            // ~250ms spawn + 2000ms = 2.25s from entry start).
            await Bun.sleep(2600);
            expect(existsSync(marker)).toBe(false);
        });
    });

    it('handles ingestion kind with source path and output validation', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'ingestion', 'ingest-plugin');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });

            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-ingest', kind: 'ingestion', entry: 'scripts/run.ts' }),
            );

            const scriptCode = `
                import { writeFileSync } from 'node:fs';
                const args = process.argv.slice(2);
                const outIdx = args.indexOf('--out') + 1;
                const outPath = args[outIdx];
                writeFileSync(outPath, JSON.stringify([{ id: 'd1', body: 'Ingested content' }]));
            `;
            writeFileSync(join(scriptsDir, 'run.ts'), scriptCode);

            const sourceDir = join(root, 'source-folder');
            mkdirSync(sourceDir, { recursive: true });
            const outFile = join(root, 'docs.json');

            const res = await runInvoke({
                plugin: 'my-ingest',
                inPath: sourceDir,
                outPath: outFile,
                pluginsRoot: root,
            });

            expect(res).toBe(0);
        });
    });

    it('fails when input file is missing or contains invalid JSON', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'gen-plugin');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-gen', kind: 'generator', entry: 'run.ts' }),
            );
            writeFileSync(join(pluginDir, 'run.ts'), 'console.log("ok");');

            // Missing input file
            let res = await runInvoke({
                plugin: 'my-gen',
                inPath: join(root, 'nonexistent.json'),
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // Invalid JSON input file
            const badJsonPath = join(root, 'bad.json');
            writeFileSync(badJsonPath, '{ invalid json');
            res = await runInvoke({
                plugin: 'my-gen',
                inPath: badJsonPath,
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);
        });
    });

    it('fails when the input file exists but cannot be read (EISDIR)', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'gen-plugin');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-gen', kind: 'generator', entry: 'run.ts' }),
            );
            writeFileSync(join(pluginDir, 'run.ts'), 'console.log("ok");');

            // A directory passes existsSync but readFileSync throws EISDIR.
            const res = await runInvoke({
                plugin: 'my-gen',
                inPath: root,
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);
        });
    });

    it('fails when the output file exists but cannot be read back (EISDIR)', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'gen-plugin');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-gen', kind: 'generator', entry: 'run.ts' }),
            );
            // Entry "writes" its output as a directory: existsSync passes but
            // readFileSync throws when the output contract is validated.
            const outPath = join(root, 'out-dir');
            writeFileSync(
                join(pluginDir, 'run.ts'),
                `import { mkdirSync } from 'node:fs'; mkdirSync(${JSON.stringify(outPath)}, { recursive: true });`,
            );

            const inFile = join(root, 'in.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1', body: 'b' }]));

            const res = await runInvoke({
                plugin: 'my-gen',
                inPath: inFile,
                outPath,
                pluginsRoot: root,
            });
            expect(res).toBe(1);
        });
    });

    it('fails when ingestion source path is missing', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'ingestion', 'ingest-plugin');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'my-ingest', kind: 'ingestion', entry: 'run.ts' }),
            );
            writeFileSync(join(pluginDir, 'run.ts'), 'console.log("ok");');

            const res = await runInvoke({
                plugin: 'my-ingest',
                inPath: join(root, 'missing-source'),
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);
        });
    });

    it('fails when plugin entry script is missing or output file is missing/invalid', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'generator', 'bad-entry-plugin');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'bad-entry', kind: 'generator', entry: 'missing-script.ts' }),
            );

            const inFile = join(root, 'in.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1', body: 'b' }]));

            // Missing entry script
            let res = await runInvoke({
                plugin: 'bad-entry',
                inPath: inFile,
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // Entry runs but writes no output file
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'no-out', kind: 'generator', entry: 'noop.ts' }),
            );
            writeFileSync(join(pluginDir, 'noop.ts'), '// noop');

            res = await runInvoke({
                plugin: 'no-out',
                inPath: inFile,
                outPath: join(root, 'out.json'),
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // Entry writes invalid JSON output
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'bad-out-json', kind: 'generator', entry: 'bad-json.ts' }),
            );
            const outFile = join(root, 'out.json');
            writeFileSync(
                join(pluginDir, 'bad-json.ts'),
                `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outFile)}, 'not json');`,
            );

            res = await runInvoke({
                plugin: 'bad-out-json',
                inPath: inFile,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(1);

            // Entry writes output violating output schema (missing 'body')
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'invalid-schema-out', kind: 'generator', entry: 'invalid-out.ts' }),
            );
            writeFileSync(
                join(pluginDir, 'invalid-out.ts'),
                `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ title: "no body" }));`,
            );

            res = await runInvoke({
                plugin: 'invalid-schema-out',
                inPath: inFile,
                outPath: outFile,
                pluginsRoot: root,
            });
            expect(res).toBe(1);
        });
    });

    it('pluginEnvFromConfig reads plugins.<collection>.<name>.env and skips empty placeholders', async () => {
        await withTempDir(async (root) => {
            const configPath = join(root, 'config.yaml');
            writeFileSync(
                configPath,
                [
                    'plugins:',
                    '  generations:',
                    '    voice-gen:',
                    '      env:',
                    '        VOICEBOX_URL: "http://127.0.0.1:17493"',
                    '        VOICEBOX_DEFAULT_PROFILE: "Robin"',
                    '        VOICEBOX_TIMEOUT_MS: 600000',
                    '        VOICEBOX_SKIP: ""',
                    '  publishings:',
                    '    wechatmp-pub:',
                    '      env:',
                    '        KK_BROWSER_CHANNEL: "chrome"',
                    '    qiita-pub:',
                    '      env:',
                    '        QIITA_TOKEN: "tok"',
                    '',
                ].join('\n'),
            );

            expect(pluginEnvFromConfig('generator', 'voice-gen', configPath)).toEqual({
                VOICEBOX_URL: 'http://127.0.0.1:17493',
                VOICEBOX_DEFAULT_PROFILE: 'Robin',
                VOICEBOX_TIMEOUT_MS: '600000',
            });
            expect(pluginEnvFromConfig('publish', 'qiita-pub', configPath)).toEqual({
                KK_BROWSER_CHANNEL: 'chrome',
                QIITA_TOKEN: 'tok',
            });
            expect(pluginEnvFromConfig('publish', 'weibo-pub', configPath)).toEqual({
                KK_BROWSER_CHANNEL: 'chrome',
            });
            expect(pluginEnvFromConfig('generator', 'missing', configPath)).toEqual({});
            expect(pluginEnvFromConfig('generator', 'voice-gen', join(root, 'no-such.yaml'))).toEqual({});
        });
    });

    it('pluginEnvFromConfig inherits MICROFEED credentials from podcast-pub for surfdash-pub without overriding explicit values', async () => {
        await withTempDir(async (root) => {
            const configPath = join(root, 'config.yaml');
            writeFileSync(
                configPath,
                [
                    'plugins:',
                    '  publishings:',
                    '    podcast-pub:',
                    '      env:',
                    '        MICROFEED_BASE_URL: "https://podcast.example"',
                    '        MICROFEED_API_KEY: "mf-secret"',
                    '    surfdash-pub:',
                    '      env:',
                    '        SURFDASH_URL: "https://surfing.example"',
                    '        MICROFEED_BASE_URL: "https://override.example"',
                    '    qiita-pub:',
                    '      env:',
                    '        QIITA_TOKEN: "tok"',
                    '',
                ].join('\n'),
            );
            expect(pluginEnvFromConfig('publish', 'surfdash-pub', configPath)).toEqual({
                SURFDASH_URL: 'https://surfing.example',
                MICROFEED_BASE_URL: 'https://override.example',
                MICROFEED_API_KEY: 'mf-secret',
            });
            expect(pluginEnvFromConfig('publish', 'qiita-pub', configPath)).toEqual({
                QIITA_TOKEN: 'tok',
            });
        });
    });

    it('injects KK_CONFIG plugin env at spawn; process env wins', async () => {
        await withTempDir(async (root) => {
            const configPath = join(root, 'config.yaml');
            writeFileSync(
                configPath,
                [
                    'plugins:',
                    '  generations:',
                    '    env-gen:',
                    '      env:',
                    '        VOICEBOX_DEFAULT_PROFILE: "from-config"',
                    '        VOICEBOX_TIMEOUT_MS: "600000"',
                    '',
                ].join('\n'),
            );

            const pluginDir = pluginDirOf(root, 'generator', 'env-gen');
            mkdirSync(pluginDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'env-gen', kind: 'generator', entry: 'run.ts' }),
            );
            writeFileSync(
                join(pluginDir, 'run.ts'),
                `
                import { readFileSync, writeFileSync } from 'node:fs';
                const args = process.argv.slice(2);
                const inPath = args[args.indexOf('--in') + 1];
                const outPath = args[args.indexOf('--out') + 1];
                JSON.parse(readFileSync(inPath, 'utf-8'));
                writeFileSync(outPath, JSON.stringify({
                    body: [process.env.VOICEBOX_DEFAULT_PROFILE, process.env.VOICEBOX_TIMEOUT_MS].join(' '),
                    format: 'markdown',
                }));
                `,
            );

            const inFile = join(root, 'docs.json');
            const outFile = join(root, 'content.json');
            writeFileSync(inFile, JSON.stringify([{ id: 'd1', body: 'hi' }]));

            const savedConfig = process.env.KK_CONFIG;
            const savedProfile = process.env.VOICEBOX_DEFAULT_PROFILE;
            const savedTimeout = process.env.VOICEBOX_TIMEOUT_MS;
            process.env.KK_CONFIG = configPath;
            delete process.env.VOICEBOX_DEFAULT_PROFILE;
            delete process.env.VOICEBOX_TIMEOUT_MS;

            try {
                let res = await runInvoke({
                    plugin: 'env-gen',
                    inPath: inFile,
                    outPath: outFile,
                    pluginsRoot: root,
                });
                expect(res).toBe(0);
                expect(JSON.parse(await Bun.file(outFile).text()).body).toBe('from-config 600000');

                process.env.VOICEBOX_DEFAULT_PROFILE = 'from-env';
                res = await runInvoke({
                    plugin: 'env-gen',
                    inPath: inFile,
                    outPath: outFile,
                    pluginsRoot: root,
                });
                expect(res).toBe(0);
                expect(JSON.parse(await Bun.file(outFile).text()).body).toBe('from-env 600000');
            } finally {
                if (savedConfig === undefined) delete process.env.KK_CONFIG;
                else process.env.KK_CONFIG = savedConfig;
                if (savedProfile === undefined) delete process.env.VOICEBOX_DEFAULT_PROFILE;
                else process.env.VOICEBOX_DEFAULT_PROFILE = savedProfile;
                if (savedTimeout === undefined) delete process.env.VOICEBOX_TIMEOUT_MS;
                else process.env.VOICEBOX_TIMEOUT_MS = savedTimeout;
            }
        });
    });

    it('fails when plugin name is not found in registry', async () => {
        await withTempDir(async (root) => {
            const res = await runInvoke({
                plugin: 'non-existent',
                inPath: 'in.json',
                outPath: 'out.json',
                pluginsRoot: root,
            });

            expect(res).toBe(1);
        });
    });
});

describe('probeVerdict (ADR-032 probe contract)', () => {
    it('carries the detail of a final error line so the operator sees the cause', () => {
        const out = 'human hint\n{"status":"error","detail":"set SUBSTACK_PUBLICATION_URL"}\n';
        expect(probeVerdict(2, out)).toEqual({ status: 'error', detail: 'probe exit 2: set SUBSTACK_PUBLICATION_URL' });
    });

    it('never upgrades a verdict whose exit code disagrees with its status', () => {
        expect(probeVerdict(0, '{"status":"error","detail":"boom"}').status).toBe('error');
        expect(probeVerdict(1, '{"status":"verified"}')).toEqual({ status: 'error', detail: 'probe exit 1' });
        expect(probeVerdict(0, '{"status":"refused"}')).toEqual({ status: 'error', detail: 'probe exit 0' });
        expect(probeVerdict(2, '{"status":"verified"}')).toEqual({ status: 'error', detail: 'probe exit 2' });
    });

    it('ignores a trailing non-verdict line instead of calling the probe malformed (0381)', () => {
        // The 2026-11-15 shape: the probe printed its refusal, then a channel writer appended a line.
        const out = [
            'shipinhao profile check: reusing profile /Users/robin/.config/kk/browser-profiles/shipinhao',
            '{"status":"refused","profileDir":"/p/shipinhao","detail":"headed shipinhao readiness refused: Authentication was not confirmed within 30000ms"}',
            'browser closed',
        ].join('\n');
        expect(probeVerdict(1, out)).toEqual({
            status: 'refused',
            profileDir: '/p/shipinhao',
            detail: 'headed shipinhao readiness refused: Authentication was not confirmed within 30000ms',
        });
    });

    it('takes the last parseable verdict when several lines parse', () => {
        const out = '{"status":"error","detail":"early"}\n{"status":"refused","detail":"late"}\ntrailing';
        expect(probeVerdict(1, out)).toEqual({ status: 'refused', detail: 'late' });
    });

    it('keeps the line text out of the detail when no line is a verdict', () => {
        expect(probeVerdict(2, 'page text with a token\n{"notavverdict":true}')).toEqual({
            status: 'error',
            detail: 'probe exit 2 (malformed probe output)',
        });
    });
});

describe('spawnPluginSession (0277 R3)', () => {
    it('forwards the subcommand argv (--profile/--url) and captures the piped verdict stdout', async () => {
        await withTempDir(async (root) => {
            const entry = join(root, 'probe.ts');
            writeFileSync(
                entry,
                `
                const args = process.argv.slice(2);
                console.log(JSON.stringify({ argv: args, leasePath: process.env.KK_BOT_LEASE_PATH ?? '' }));
                process.exit(0);
                `,
            );
            const result = await spawnPluginSession({
                entryPath: entry,
                cwd: root,
                subcommand: 'open',
                profileDir: '/tmp/kk-session-profile',
                url: 'https://juejin.example.com/editor/drafts/new?v=2',
                extraEnv: {},
                pluginKind: 'publish',
                pluginName: 'juejin-pub',
            });
            expect(result.exitCode).toBe(0);
            const verdict = JSON.parse(result.stdout) as { argv: string[] };
            expect(verdict.argv).toEqual([
                'open',
                '--profile',
                '/tmp/kk-session-profile',
                '--url',
                'https://juejin.example.com/editor/drafts/new?v=2',
            ]);
        });
    });

    it('layers the scoped lease env over process.env, with extraEnv winning', async () => {
        await withTempDir(async (root) => {
            const entry = join(root, 'probe.ts');
            writeFileSync(
                entry,
                `
                console.log(JSON.stringify({
                    leasePath: process.env.KK_BOT_LEASE_PATH ?? '',
                    leaseToken: process.env.KK_BOT_LEASE_TOKEN ?? '',
                    base: process.env.KK_SESSION_BASE ?? '',
                }));
                `,
            );
            const result = await spawnPluginSession({
                entryPath: entry,
                cwd: root,
                subcommand: 'login',
                profileDir: '/tmp/kk-session-profile',
                extraEnv: {
                    KK_BOT_LEASE_PATH: '/leases/from-parent',
                    KK_BOT_LEASE_TOKEN: 'tok',
                    KK_SESSION_BASE: 'yes',
                },
                pluginKind: 'publish',
                pluginName: 'xhs-pub',
            });
            expect(result.exitCode).toBe(0);
            const verdict = JSON.parse(result.stdout) as { leasePath: string; leaseToken: string; base: string };
            expect(verdict.leasePath).toBe('/leases/from-parent');
            expect(verdict.leaseToken).toBe('tok');
            expect(verdict.base).toBe('yes');
        });
    });

    it('propagates the child exit code, and a spawn failure surfaces as exit 2', async () => {
        await withTempDir(async (root) => {
            const entry = join(root, 'probe.ts');
            writeFileSync(entry, 'process.exit(1);');
            const refused = await spawnPluginSession({
                entryPath: entry,
                cwd: root,
                subcommand: 'login',
                profileDir: '/tmp/kk-session-profile',
                extraEnv: {},
                pluginKind: 'publish',
                pluginName: 'weibo-pub',
            });
            expect(refused.exitCode).toBe(1);

            // A nonexistent cwd makes Bun.spawn itself throw (distinct from a child that starts
            // and exits nonzero): the session surface maps that to usage-shaped exit 2.
            const missing = await spawnPluginSession({
                entryPath: entry,
                cwd: join(root, 'no-such-cwd'),
                subcommand: 'login',
                profileDir: '/tmp/kk-session-profile',
                extraEnv: {},
                pluginKind: 'publish',
                pluginName: 'weibo-pub',
            });
            expect(missing.exitCode).toBe(2);
            expect(missing.stdout).toBe('');
        });
    });
});

/**
 * 2026-10-22: a plugin that succeeds while producing an empty result explains itself only on
 * stderr. Dropping that stream on exit 0 kept a dead ingestion channel (horizon-ingest emitting
 * `[]` for two days) invisible in the collect log.
 */
describe('runInvoke — successful-exit diagnostics', () => {
    it('forwards a plugin’s stderr to the caller when the exit code is 0', async () => {
        await withTempDir(async (root) => {
            const pluginDir = pluginDirOf(root, 'ingestion', 'quiet-source');
            const scriptsDir = join(pluginDir, 'scripts');
            mkdirSync(scriptsDir, { recursive: true });
            writeFileSync(
                join(pluginDir, 'plugin.json'),
                JSON.stringify({ name: 'quiet-source', kind: 'ingestion', entry: 'scripts/run.ts' }),
            );
            writeFileSync(
                join(scriptsDir, 'run.ts'),
                [
                    "import { writeFileSync } from 'node:fs';",
                    'const args = process.argv.slice(2);',
                    "const outPath = args[args.indexOf('--out') + 1];",
                    "console.error('quiet-source: no fresh digest — emitting []');",
                    'writeFileSync(outPath, JSON.stringify([]));',
                ].join('\n'),
            );

            const capture = captureOutput();
            try {
                const code = await runInvoke({
                    plugin: 'quiet-source',
                    inPath: (() => {
                        const p = join(root, 'in.json');
                        writeFileSync(p, JSON.stringify({}));
                        return p;
                    })(),
                    outPath: join(root, 'out.json'),
                    pluginsRoot: root,
                });
                expect(code).toBe(0);
                expect(capture.readErr()).toContain('[plugin:quiet-source]');
                expect(capture.readErr()).toContain('no fresh digest');
            } finally {
                capture.restore();
            }
        });
    });
});
