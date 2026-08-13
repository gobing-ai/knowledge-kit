import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionForKind } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerPluginCommand } from '../../src/commands/plugin';
import { main } from '../../src/main';

const FIXTURES_DIR = join(import.meta.dir, '../../../../plugins');

interface PluginStatusJson {
    healthy: boolean;
    plugins: Array<{
        name: string;
        kind: string;
        healthy: boolean;
        diagnostics: Array<{ code: string; path: string; reason: string }>;
    }>;
    diagnostics: Array<{ code: string; path: string; reason: string }>;
}

/** Run main with captured logger.out / logger.error into strings. */
async function runCaptured(args: string[]): Promise<{ code: number; out: string; err: string }> {
    let out = '';
    let err = '';
    const originalOut = logger.out;
    const originalError = logger.error;
    logger.out = (msg: string) => {
        out += msg;
    };
    logger.error = (msg: string) => {
        err += msg;
    };
    try {
        const code = await main(['node', 'test', ...args]);
        return { code, out, err };
    } finally {
        logger.out = originalOut;
        logger.error = originalError;
    }
}

describe('registerPluginCommand', () => {
    it('registers the plugin group (status, hidden list/doctor) and a hidden top-level plugins alias command', () => {
        const program = new Command();
        registerPluginCommand(program);

        const group = program.commands.find((c) => c.name() === 'plugin');
        expect(group).toBeDefined();
        // The group carries no visible alias; the deprecated `plugins` path is a
        // hidden top-level command so `kk --help` never renders `plugin|plugins`.
        expect(group?.aliases()).toEqual([]);
        for (const name of ['status', 'list', 'doctor']) {
            const cmd = group?.commands.find((c) => c.name() === name);
            expect(cmd).toBeDefined();
        }
        // The group help lists status but never the hidden list/doctor aliases.
        const help = group?.helpInformation() ?? '';
        expect(help).toMatch(/^\s+status\s/m);
        expect(help).not.toMatch(/^\s+(list|doctor)\s/m);

        // Hidden top-level `plugins` delegation command: same status verbs.
        const plugins = program.commands.find((c) => c.name() === 'plugins');
        expect(plugins).toBeDefined();
        expect(plugins?.commands.map((c) => c.name())).toEqual(['status', 'list', 'doctor']);
        // The deprecated `plugins` path never renders as a visible first-layer command.
        expect(program.helpInformation()).not.toContain('plugin|plugins');
        expect(program.helpInformation()).not.toMatch(/^\s+plugins\s/m);

        const status = group?.commands.find((c) => c.name() === 'status');
        const longs = status?.options.map((o) => o.long) ?? [];
        expect(longs).toEqual(expect.arrayContaining(['--kind', '--json', '--plugins-root']));
    });

    it('plugin status --json emits the unified health report and exits 0 when healthy', async () => {
        const { code, out } = await runCaptured(['plugin', 'status', '--json', '--plugins-root', FIXTURES_DIR]);
        expect(code).toBe(0);
        const parsed = JSON.parse(out) as PluginStatusJson;
        expect(Object.keys(parsed).sort()).toEqual(['diagnostics', 'healthy', 'plugins']);
        expect(parsed.healthy).toBe(true);
        expect(parsed.plugins.some((p) => p.name === 'karakeep-local')).toBe(true);
        for (const p of parsed.plugins) {
            expect(typeof p.healthy).toBe('boolean');
            expect(Array.isArray(p.diagnostics)).toBe(true);
            expect(p.healthy).toBe(true);
        }
        expect(parsed.diagnostics).toEqual([]);
    });

    it('plugin status text output groups plugins by kind with per-plugin health marks and honors --kind', async () => {
        const { code, out } = await runCaptured([
            'plugin',
            'status',
            '--kind',
            'ingestion',
            '--plugins-root',
            FIXTURES_DIR,
        ]);
        expect(code).toBe(0);
        expect(out).toContain('INGESTION PLUGINS');
        expect(out).toContain('karakeep-local');
        expect(out).toContain('[healthy]');
        expect(out).not.toContain('GENERATOR PLUGINS');
        expect(out).not.toContain('PUBLISH PLUGINS');
    });

    it('plugin status exits 1 on invalid --kind argument', async () => {
        const { code, err } = await runCaptured(['plugin', 'status', '--kind', 'invalid-kind']);
        expect(code).toBe(1);
        expect(err).toContain('Invalid plugin kind');
    });

    it('plugin status outputs notice when no plugins are found', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-empty');
        await mkdir(tmpDir, { recursive: true });
        try {
            const { code, out } = await runCaptured(['plugin', 'status', '--plugins-root', tmpDir]);
            expect(code).toBe(0);
            expect(out).toContain('No plugins found.');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status --json attaches missing_entry to the plugin and exits 1', async () => {
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

        const { code, out } = await runCaptured(['plugin', 'status', '--json', '--plugins-root', tmpDir]);
        try {
            expect(code).toBe(1);
            const parsed = JSON.parse(out) as PluginStatusJson;
            expect(parsed.healthy).toBe(false);
            const plugin = parsed.plugins.find((p) => p.name === 'missing-entry-plugin');
            expect(plugin).toBeDefined();
            expect(plugin?.healthy).toBe(false);
            expect(plugin?.diagnostics.some((d) => d.code === 'missing_entry')).toBe(true);
            // Tree-level diagnostics stay in the top-level array; missing_entry does not.
            expect(parsed.diagnostics.some((d) => d.code === 'missing_entry')).toBe(false);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status --json keeps tree-level diagnostics in top-level diagnostics', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-misplaced');
        // A stray directory at the plugins root carrying a plugin.json is a
        // misplaced manifest (tree-level diagnostic — no PluginRecord).
        const strayDir = join(tmpDir, 'stray');
        await mkdir(strayDir, { recursive: true });
        await writeFile(
            join(strayDir, 'plugin.json'),
            JSON.stringify({ name: 'stray', kind: 'ingestion', entry: './index.js' }),
            'utf-8',
        );

        const { code, out } = await runCaptured(['plugin', 'status', '--json', '--plugins-root', tmpDir]);
        try {
            expect(code).toBe(1);
            const parsed = JSON.parse(out) as PluginStatusJson;
            expect(parsed.healthy).toBe(false);
            expect(parsed.plugins).toEqual([]);
            expect(parsed.diagnostics.some((d) => d.code === 'misplaced')).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status text mode exits 1 when the root has only tree-level diagnostics and no records', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-misplaced-text');
        const strayDir = join(tmpDir, 'stray');
        await mkdir(strayDir, { recursive: true });
        await writeFile(
            join(strayDir, 'plugin.json'),
            JSON.stringify({ name: 'stray', kind: 'ingestion', entry: './index.js' }),
            'utf-8',
        );

        const { code, out, err } = await runCaptured(['plugin', 'status', '--plugins-root', tmpDir]);
        try {
            expect(code).toBe(1);
            expect(out).toContain('No plugins found.');
            expect(err).toContain('misplaced');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('plugin status text mode exits 1 with diagnostics for an unhealthy root', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-status-unhealthy-text');
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

        const { code, out, err } = await runCaptured(['plugin', 'status', '--plugins-root', tmpDir]);
        try {
            expect(code).toBe(1);
            expect(out).toContain('[unhealthy]');
            expect(err).toContain('missing_entry');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('hidden aliases plugins list and plugins doctor reach the unified status engine', async () => {
        // Both old paths emit the unified JSON object and fail loud on diagnostics.
        const healthy = await runCaptured(['plugins', 'list', '--json', '--plugins-root', FIXTURES_DIR]);
        expect(healthy.code).toBe(0);
        const parsed = JSON.parse(healthy.out) as PluginStatusJson;
        expect(parsed.plugins.some((p) => p.name === 'karakeep-local')).toBe(true);

        const tmpDir = join(import.meta.dir, 'tmp-status-alias-doctor');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'broken');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'broken', kind: 'ingestion', entry: './missing.js', version: '1.0.0' }),
            'utf-8',
        );
        try {
            const unhealthy = await runCaptured(['plugins', 'doctor', '--json', '--plugins-root', tmpDir]);
            expect(unhealthy.code).toBe(1);
            const doctorParsed = JSON.parse(unhealthy.out) as PluginStatusJson;
            expect(doctorParsed.healthy).toBe(false);
            expect(doctorParsed.plugins.find((p) => p.name === 'broken')?.healthy).toBe(false);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
