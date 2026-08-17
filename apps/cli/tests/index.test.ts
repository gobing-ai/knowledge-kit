import { describe, expect, it } from 'bun:test';
import { main } from '../src/main';
import { silenceOutput } from './capture';

describe('cli', () => {
    it('createProgram returns a commander instance with executor and plugin groups', async () => {
        const { createProgram } = await import('../src/cli');
        const program = createProgram();
        const executor = program.commands.find((c) => c.name() === 'executor');
        const plugin = program.commands.find((c) => c.name() === 'plugin');
        expect(executor).toBeDefined();
        expect(plugin).toBeDefined();
        // add is no longer registered (R7).
        expect(program.commands.find((c) => c.name() === 'add')).toBeUndefined();
    });

    it('add command is gone: kk add exits non-zero (R7 CLI)', async () => {
        const restore = silenceOutput();
        try {
            const code = await main(['node', 'test', 'add', '1', '2']);
            expect(code).not.toBe(0);
        } finally {
            restore();
        }
    });

    it('executor run exits non-zero when plugin is missing (R4 CLI fail-loud)', async () => {
        const restore = silenceOutput();

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
            restore();
        }
    });
});
