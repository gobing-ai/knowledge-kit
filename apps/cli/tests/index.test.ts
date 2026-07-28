import { describe, expect, it } from 'bun:test';
import { logger } from '@gobing-ai/utils';

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
        const exits: number[] = [];
        const originalExit = process.exit;
        const originalError = logger.error;
        process.exit = ((code?: number) => {
            exits.push(code ?? 0);
            throw new Error(`process.exit(${code ?? 0})`);
        }) as typeof process.exit;
        logger.error = () => {};

        try {
            const { createProgram } = await import('../src/cli');
            const program = createProgram();
            program.exitOverride();
            try {
                await program.parseAsync([
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
            } catch {
                // process.exit mock throws so the test process is not killed
            }
            expect(exits).toContain(1);
        } finally {
            process.exit = originalExit;
            logger.error = originalError;
        }
    });
});
