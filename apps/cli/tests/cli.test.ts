import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionForKind } from '@gobing-ai/kk-core';
import { main } from '../src/main';
import { captureOutput, silenceOutput } from './capture';

const FIXTURES_DIR = join(import.meta.dir, '../../../plugins');

interface RunResult {
    code: number;
    out: string;
    err: string;
}

/** Run main with captured stdout/stderr; argv omits node/script (main slices them). */
async function run(args: string[]): Promise<RunResult> {
    let out = '';
    let err = '';
    const code = await main(['node', 'test', ...args], {
        stdout: (text: string) => {
            out += text;
        },
        stderr: (text: string) => {
            err += text;
        },
    });
    return { code, out, err };
}

/** Capture ts-utils echo output (command action stdout) into a string. */
function captureOut(): { read: () => string; restore: () => void } {
    const cap = captureOutput();
    return { read: () => cap.read(), restore: cap.restore };
}

describe('plugin status subcommand', () => {
    it('plugin status --json emits the unified health report and exits 0', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugin', 'status', '--plugins-root', FIXTURES_DIR, '--json']);
            expect(code).toBe(0);
            const parsed = JSON.parse(read()) as {
                healthy: boolean;
                plugins: Array<{ name: string }>;
                diagnostics: unknown[];
            };
            expect(typeof parsed.healthy).toBe('boolean');
            expect(Array.isArray(parsed.plugins)).toBe(true);
            expect(Array.isArray(parsed.diagnostics)).toBe(true);
            expect(parsed.plugins.some((p) => p.name === 'karakeep-local')).toBe(true);
        } finally {
            restore();
        }
    });

    it('plugin status supports --kind filter and formatted text output with health marks', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugin', 'status', '--kind', 'ingestion', '--plugins-root', FIXTURES_DIR]);
            expect(code).toBe(0);
            expect(read()).toContain('INGESTION PLUGINS');
            expect(read()).toContain('karakeep-local');
            expect(read()).toContain('[healthy]');
        } finally {
            restore();
        }
    });

    it('plugin status exits 1 on invalid --kind argument', async () => {
        const cap = captureOutput();
        try {
            const { code } = await run(['plugin', 'status', '--kind', 'invalid-kind']);
            expect(code).toBe(1);
            expect(cap.readErr()).toContain('Invalid plugin kind');
        } finally {
            cap.restore();
        }
    });

    it('plugin status outputs notice when no plugins are found', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-empty-plugins');
        await mkdir(tmpDir, { recursive: true });
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugin', 'status', '--plugins-root', tmpDir]);
            expect(code).toBe(0);
            expect(read()).toContain('No plugins found.');
        } finally {
            restore();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status --json exits 1 with plugin-level missing_entry for an unhealthy root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-missing-entry');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'missing-entry-plugin');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({
                name: 'missing-entry-plugin',
                kind: 'ingestion',
                entry: './non-existent-file.js',
                version: '1.0.0',
            }),
            'utf-8',
        );

        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugin', 'status', '--plugins-root', tmpDir, '--json']);
            expect(code).toBe(1);
            const parsed = JSON.parse(read()) as {
                healthy: boolean;
                plugins: Array<{ name: string; healthy: boolean; diagnostics: Array<{ code: string }> }>;
            };
            expect(parsed.healthy).toBe(false);
            expect(parsed.plugins.find((p) => p.name === 'missing-entry-plugin')?.healthy).toBe(false);
            expect(
                parsed.plugins
                    .find((p) => p.name === 'missing-entry-plugin')
                    ?.diagnostics.some((d) => d.code === 'missing_entry'),
            ).toBe(true);
        } finally {
            restore();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status exits 1 with text diagnostics for an unhealthy root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-missing-entry-text');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'missing-entry-plugin');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({
                name: 'missing-entry-plugin',
                kind: 'ingestion',
                entry: './non-existent-file.js',
                version: '1.0.0',
            }),
            'utf-8',
        );

        const cap = captureOutput();
        try {
            const { code } = await run(['plugin', 'status', '--plugins-root', tmpDir]);
            expect(code).toBe(1);
            expect(cap.readErr()).toContain('missing_entry');
        } finally {
            cap.restore();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('executor fan-in subcommand', () => {
    it('merges repeated --in inputs into one deduplicated --out file', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanin-merge');
        await mkdir(tmpDir, { recursive: true });
        const aFile = join(tmpDir, 'a.json');
        const bFile = join(tmpDir, 'b.json');
        const outFile = join(tmpDir, 'merged.json');
        await writeFile(
            aFile,
            JSON.stringify([
                { id: 'd1', body: 'alpha' },
                { id: 'd2', body: 'first' },
            ]),
            'utf-8',
        );
        await writeFile(bFile, JSON.stringify([{ id: 'd2', body: 'second' }]), 'utf-8');

        try {
            const { code } = await run(['executor', 'fan-in', '--in', aFile, '--in', bFile, '--out', outFile]);
            expect(code).toBe(0);

            const merged = JSON.parse(await readFile(outFile, 'utf-8'));
            expect(merged.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
            expect(merged[1].metadata.sources).toEqual([{ file: aFile }, { file: bFile }]);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('propagates a non-zero exit when an input file is missing', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanin-missing');
        await mkdir(tmpDir, { recursive: true });
        const missing = join(tmpDir, 'nope.json');

        const restoreSilence = silenceOutput();
        try {
            const { code } = await run(['executor', 'fan-in', '--in', missing, '--out', join(tmpDir, 'merged.json')]);
            expect(code).toBe(1);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('executor fan-out subcommand', () => {
    it('propagates a non-zero exit when a target cannot be resolved to a publish plugin', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanout-missing');
        await mkdir(tmpDir, { recursive: true });
        const contentFile = join(tmpDir, 'content.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        const restoreSilence = silenceOutput();
        try {
            const { code } = await run([
                'executor',
                'fan-out',
                '--content',
                contentFile,
                '--target',
                'no-such-publish-plugin',
                '--out',
                join(tmpDir, 'result.json'),
            ]);
            expect(code).toBe(2);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('accepts --plugins-root and resolves publish targets under the given root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-fanout-plugins-root');
        const pluginDir = join(tmpDir, collectionForKind('publish'), 'fake-pub');
        await mkdir(join(pluginDir, 'src'), { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'fake-pub', kind: 'publish', entry: './src/index.ts', version: '1.0.0' }),
            'utf-8',
        );
        await writeFile(
            join(pluginDir, 'src', 'index.ts'),
            [
                "import { readFileSync, writeFileSync } from 'node:fs';",
                'const argv = process.argv.slice(2);',
                "const inPath = argv[argv.indexOf('--in') + 1];",
                "const outPath = argv[argv.indexOf('--out') + 1];",
                "readFileSync(inPath, 'utf-8');",
                "writeFileSync(outPath, JSON.stringify({ ok: true, target: 'fake-pub', url: 'https://example.com/fake', id: 'fake-1', message: 'published' }));",
            ].join('\n'),
            'utf-8',
        );
        const contentFile = join(tmpDir, 'content.json');
        const outFile = join(tmpDir, 'result.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        try {
            const { code } = await run([
                'executor',
                'fan-out',
                '--content',
                contentFile,
                '--target',
                'fake-pub',
                '--out',
                outFile,
                '--plugins-root',
                tmpDir,
            ]);
            expect(code).toBe(0);

            const result = JSON.parse(await readFile(outFile, 'utf-8'));
            expect(result.ok).toBe(true);
            expect(result.targets[0]).toMatchObject({ target: 'fake-pub', status: 'published' });
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('hidden one-release aliases', () => {
    it('kk invoke reaches the executor run engine (missing plugin exits 1)', async () => {
        const restoreSilence = silenceOutput();
        try {
            const { code } = await run([
                'invoke',
                'non-existent',
                '--in',
                'in.json',
                '--out',
                'out.json',
                '--plugins-root',
                '/tmp',
            ]);
            expect(code).toBe(1);
        } finally {
            restoreSilence();
        }
    });

    it('kk fanin and kk fanout reach the executor fan-in/fan-out engines', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-alias-fanin');
        await mkdir(tmpDir, { recursive: true });

        const restoreSilence = silenceOutput();
        try {
            const faninCode = await run(['fanin', '--in', join(tmpDir, 'nope.json'), '--out', join(tmpDir, 'm.json')]);
            expect(faninCode.code).toBe(1);

            const contentFile = join(tmpDir, 'content.json');
            await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');
            const fanoutCode = await run([
                'fanout',
                '--content',
                contentFile,
                '--target',
                'no-such-publish-plugin',
                '--out',
                join(tmpDir, 'result.json'),
            ]);
            expect(fanoutCode.code).toBe(2);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('kk plugins list and kk plugins doctor reach the plugin status engine with the unified JSON object', async () => {
        const { read, restore } = captureOut();
        try {
            const { code } = await run(['plugins', 'list', '--plugins-root', FIXTURES_DIR, '--json']);
            expect(code).toBe(0);
            const parsed = JSON.parse(read()) as { healthy: boolean; plugins: unknown[]; diagnostics: unknown[] };
            expect(typeof parsed.healthy).toBe('boolean');
            expect(Array.isArray(parsed.plugins)).toBe(true);
        } finally {
            restore();
        }

        const tmpDir = join(import.meta.dir, 'tmp-alias-doctor');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'broken');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'broken', kind: 'ingestion', entry: './missing.js', version: '1.0.0' }),
            'utf-8',
        );
        const { read: readDoctor, restore: restoreDoctor } = captureOut();
        try {
            const { code } = await run(['plugins', 'doctor', '--plugins-root', tmpDir, '--json']);
            expect(code).toBe(1);
            const parsed = JSON.parse(readDoctor()) as { healthy: boolean; plugins: Array<{ name: string }> };
            expect(parsed.healthy).toBe(false);
            expect(parsed.plugins.some((p) => p.name === 'broken')).toBe(true);
        } finally {
            restoreDoctor();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
