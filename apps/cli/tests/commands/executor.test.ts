import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionForKind } from '@gobing-ai/kk-core';
import { Command } from 'commander';
import { registerExecutorCommand } from '../../src/commands/executor';
import { main } from '../../src/main';
import { captureOutput, silenceOutput } from '../capture';

describe('registerExecutorCommand', () => {
    it('registers the executor group with run, fan-in, fan-out and hidden invoke/fanin/fanout aliases', () => {
        const program = new Command();
        registerExecutorCommand(program);

        const group = program.commands.find((c) => c.name() === 'executor');
        expect(group).toBeDefined();
        // Hyphenated verbs are canonical; aliases are attached to the same commands.
        expect(group?.commands.map((c) => c.name())).toEqual(['run', 'fan-in', 'fan-out']);
        expect(group?.commands.find((c) => c.name() === 'fan-in')?.aliases()).toEqual(['fanin']);
        expect(group?.commands.find((c) => c.name() === 'fan-out')?.aliases()).toEqual(['fanout']);

        // Hidden one-release aliases exist but are not visible first-layer commands.
        for (const name of ['invoke', 'fanin', 'fanout']) {
            const cmd = program.commands.find((c) => c.name() === name);
            expect(cmd).toBeDefined();
        }
        // The program help lists executor as a command but never the hidden aliases.
        const help = program.helpInformation();
        expect(help).toMatch(/^\s+executor\s/m);
        expect(help).not.toMatch(/^\s+(invoke|fanin|fanout)\s/m);
    });

    it('registers executor run with the shipped invoke flags (--in/--out required, --plugins-root optional)', () => {
        const program = new Command();
        registerExecutorCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'executor')?.commands.find((c) => c.name() === 'run');
        expect(cmd).toBeDefined();
        const longs = cmd?.options.map((o) => o.long) ?? [];
        expect(longs).toEqual(expect.arrayContaining(['--in', '--out', '--plugins-root']));
        for (const required of ['--in', '--out']) {
            expect(cmd?.options.find((o) => o.long === required)?.mandatory).toBe(true);
        }
        expect(cmd?.options.find((o) => o.long === '--plugins-root')?.mandatory).toBe(false);
    });

    it('registers executor fan-in with repeatable --in and required --out', () => {
        const program = new Command();
        registerExecutorCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'executor')?.commands.find((c) => c.name() === 'fan-in');
        expect(cmd).toBeDefined();
        const inOpt = cmd?.options.find((o) => o.long === '--in');
        const outOpt = cmd?.options.find((o) => o.long === '--out');
        expect(inOpt?.required).toBe(true);
        expect(outOpt?.required).toBe(true);
    });

    it('registers executor fan-out with the shipped flags (--content/--out required)', () => {
        const program = new Command();
        registerExecutorCommand(program);

        const cmd = program.commands.find((c) => c.name() === 'executor')?.commands.find((c) => c.name() === 'fan-out');
        expect(cmd).toBeDefined();
        const longs = cmd?.options.map((o) => o.long) ?? [];
        expect(longs).toEqual(
            expect.arrayContaining(['--content', '--target', '--out', '--retry-from', '--plugins-root']),
        );
        for (const required of ['--content', '--out']) {
            expect(cmd?.options.find((o) => o.long === required)?.mandatory).toBe(true);
        }
        expect(cmd?.options.find((o) => o.long === '--target')?.mandatory).toBe(false);
    });

    it('kk help executor names the hyphenated verbs fan-in and fan-out', async () => {
        const cap = captureOutput();
        try {
            const code = await main(['node', 'test', 'help', 'executor']);
            expect(code).toBe(0);
            expect(cap.read()).toContain('fan-in');
            expect(cap.read()).toContain('fan-out');
        } finally {
            cap.restore();
        }
    });

    it('main returns 1 when the plugin is missing (no process.exit in the module)', async () => {
        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'run',
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

    it('R11 — --plugins-root and --plugins-path together are a usage error (exit 2)', async () => {
        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'run',
                'any-plugin',
                '--in',
                'in.json',
                '--out',
                'out.json',
                '--plugins-root',
                '/tmp',
                '--plugins-path',
                '/tmp',
            ]);
            expect(code).toBe(2);
        } finally {
            restoreSilence();
        }
    });

    it('main surfaces a failing plugin entry exit code through executor run (R2)', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-run-entry-exit');
        const pluginDir = join(tmpDir, collectionForKind('publish'), 'failing-entry');
        await mkdir(join(pluginDir, 'scripts'), { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'failing-entry', kind: 'publish', entry: 'scripts/run.ts' }),
            'utf-8',
        );
        await writeFile(
            join(pluginDir, 'scripts', 'run.ts'),
            ["console.error('Fatal API error 500: Publish endpoint unreachable');", 'process.exit(3);'].join('\n'),
            'utf-8',
        );
        const contentFile = join(tmpDir, 'content.json');
        const outFile = join(tmpDir, 'result.json');
        await writeFile(contentFile, JSON.stringify({ body: 'Article content' }), 'utf-8');

        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'run',
                'failing-entry',
                '--in',
                contentFile,
                '--out',
                outFile,
                '--plugins-root',
                tmpDir,
            ]);
            // The entry's own exit code (3) surfaces through the CLI, not collapsed to 1.
            expect(code).toBe(3);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('main returns 1 when a fan-in input file is missing', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanin-missing');
        await mkdir(tmpDir, { recursive: true });

        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'fan-in',
                '--in',
                join(tmpDir, 'nope.json'),
                '--out',
                join(tmpDir, 'merged.json'),
            ]);
            expect(code).toBe(1);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('main merges fan-in inputs and exits 0', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanin-merge');
        await mkdir(tmpDir, { recursive: true });
        const aFile = join(tmpDir, 'a.json');
        const outFile = join(tmpDir, 'merged.json');
        await writeFile(aFile, JSON.stringify([{ id: 'd1', body: 'alpha' }]), 'utf-8');

        try {
            const code = await main(['node', 'test', 'executor', 'fan-in', '--in', aFile, '--out', outFile]);
            expect(code).toBe(0);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('main returns 2 when a fan-out target cannot be resolved', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanout-missing');
        await mkdir(tmpDir, { recursive: true });
        const contentFile = join(tmpDir, 'content.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');

        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
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

    it('executor fan-out --retry-from carries prior successes as skipped and retries only failures (R10)', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-fanout-retry');
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
        const priorFile = join(tmpDir, 'prior.json');
        const outFile = join(tmpDir, 'result.json');
        await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');
        await writeFile(
            priorFile,
            JSON.stringify({
                ok: false,
                summary: { total: 2, succeeded: 1, failed: 1, skipped: 0 },
                targets: [
                    {
                        target: 'fake-pub',
                        ok: true,
                        status: 'published',
                        url: 'https://example.com/fake',
                        id: 'fake-1',
                    },
                    { target: 'fake-pub', ok: false, status: 'failed', error: 'previous outage' },
                ],
            }),
            'utf-8',
        );

        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'fan-out',
                '--content',
                contentFile,
                '--out',
                outFile,
                '--retry-from',
                priorFile,
                '--plugins-root',
                tmpDir,
            ]);
            expect(code).toBe(0);

            const result = JSON.parse(await readFile(outFile, 'utf-8'));
            // Prior published target carried over as skipped with its url; only the failed one retried.
            expect(result.targets).toEqual([
                expect.objectContaining({ target: 'fake-pub', status: 'skipped', url: 'https://example.com/fake' }),
                expect.objectContaining({ target: 'fake-pub', status: 'published' }),
            ]);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('hidden top-level aliases invoke/fanin/fanout reach the same engines', async () => {
        const restoreSilence = silenceOutput();

        const tmpDir = join(import.meta.dir, 'tmp-cmd-alias');
        await mkdir(tmpDir, { recursive: true });

        try {
            // invoke alias → runInvoke engine (missing plugin exits 1).
            const invokeCode = await main([
                'node',
                'test',
                'invoke',
                'non-existent',
                '--in',
                'in.json',
                '--out',
                'out.json',
                '--plugins-root',
                '/tmp',
            ]);
            expect(invokeCode).toBe(1);

            // fanin alias → runFanin engine (missing input exits 1).
            const faninCode = await main([
                'node',
                'test',
                'fanin',
                '--in',
                join(tmpDir, 'nope.json'),
                '--out',
                join(tmpDir, 'merged.json'),
            ]);
            expect(faninCode).toBe(1);

            // fanout alias → runFanout engine (unresolvable target exits 2).
            const contentFile = join(tmpDir, 'content.json');
            await writeFile(contentFile, JSON.stringify({ title: 'Demo', body: 'hello world' }), 'utf-8');
            const fanoutCode = await main([
                'node',
                'test',
                'fanout',
                '--content',
                contentFile,
                '--target',
                'no-such-publish-plugin',
                '--out',
                join(tmpDir, 'result.json'),
            ]);
            expect(fanoutCode).toBe(2);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('group aliases executor fanin/fanout reach the same engines', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-group-alias');
        await mkdir(tmpDir, { recursive: true });

        const restoreSilence = silenceOutput();
        try {
            const code = await main([
                'node',
                'test',
                'executor',
                'fanin',
                '--in',
                join(tmpDir, 'nope.json'),
                '--out',
                join(tmpDir, 'merged.json'),
            ]);
            expect(code).toBe(1);
        } finally {
            restoreSilence();
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
