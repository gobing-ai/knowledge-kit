import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectionForKind } from '@gobing-ai/kk-core';
import { logger } from '@gobing-ai/utils';
import { Command } from 'commander';
import { registerPluginsCommand } from '../../src/commands/plugins';
import { main } from '../../src/main';

const FIXTURES_DIR = join(import.meta.dir, '../../../../plugins');

describe('registerPluginsCommand', () => {
    it('registers the plugins group with list and doctor subcommands', () => {
        const program = new Command();
        registerPluginsCommand(program);

        const group = program.commands.find((c) => c.name() === 'plugins');
        expect(group).toBeDefined();
        expect(group?.commands.map((c) => c.name())).toEqual(['list', 'doctor']);
        const listLongs = group?.commands.find((c) => c.name() === 'list')?.options.map((o) => o.long) ?? [];
        expect(listLongs).toEqual(expect.arrayContaining(['--kind', '--json', '--plugins-root']));
        const doctorLongs = group?.commands.find((c) => c.name() === 'doctor')?.options.map((o) => o.long) ?? [];
        expect(doctorLongs).toEqual(expect.arrayContaining(['--json', '--plugins-root']));
    });

    it('plugins list --json emits a JSON array and exits 0', async () => {
        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };
        try {
            const code = await main(['node', 'test', 'plugins', 'list', '--json', '--plugins-root', FIXTURES_DIR]);
            expect(code).toBe(0);
            expect(Array.isArray(JSON.parse(outText))).toBe(true);
        } finally {
            logger.out = originalOut;
        }
    });

    it('plugins doctor --json exits 1 when unhealthy (no process.exit in the module)', async () => {
        const tmpDir = join(import.meta.dir, 'tmp-cmd-doctor');
        const pluginDir = join(tmpDir, collectionForKind('ingestion'), 'broken');
        await mkdir(pluginDir, { recursive: true });
        await writeFile(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'broken', kind: 'ingestion', entry: './missing.js', version: '1.0.0' }),
            'utf-8',
        );

        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };
        try {
            const code = await main(['node', 'test', 'plugins', 'doctor', '--json', '--plugins-root', tmpDir]);
            expect(code).toBe(1);
            const parsed = JSON.parse(outText) as { healthy: boolean };
            expect(parsed.healthy).toBe(false);
        } finally {
            logger.out = originalOut;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
