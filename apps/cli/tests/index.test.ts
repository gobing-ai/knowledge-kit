import { describe, expect, it } from 'bun:test';
import { logger } from '@gobing-ai/utils';
import { main } from '../src/main';

describe('cli', () => {
    it('createProgram returns a commander instance with add and invoke commands', async () => {
        const { createProgram } = await import('../src/cli');
        const program = createProgram();
        const addCmd = program.commands.find((c) => c.name() === 'add');
        const invokeCmd = program.commands.find((c) => c.name() === 'invoke');
        expect(addCmd).toBeDefined();
        expect(invokeCmd).toBeDefined();
    });

    it('add command runs without throwing', async () => {
        const origWrite = Bun.write;
        // biome-ignore lint/suspicious/noExplicitAny: suppressing test output to terminal
        Bun.write = (() => Promise.resolve(0)) as any;
        try {
            const { createProgram } = await import('../src/cli');
            const program = createProgram();
            expect(() => program.parse(['add', '3', '4'], { from: 'user' })).not.toThrow();
        } finally {
            Bun.write = origWrite;
        }
    });

    it('invoke command exits non-zero when plugin is missing (R4 CLI fail-loud)', async () => {
        const originalError = logger.error;
        logger.error = () => {};

        try {
            const code = await main([
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
            expect(code).toBe(1);
        } finally {
            logger.error = originalError;
        }
    });
});
