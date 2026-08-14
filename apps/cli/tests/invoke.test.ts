import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectionForKind, type PluginKind } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { runInvoke } from '../src/invoke';

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
    // Negative-path tests call logger.error intentionally; silence stderr so --dots stays clean.
    let origError: typeof logger.error;

    beforeEach(() => {
        origError = logger.error;
        logger.error = () => {};
    });

    afterEach(() => {
        logger.error = origError;
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
