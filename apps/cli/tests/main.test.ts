import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '@gobing-ai/utils';
import { main } from '../src/main';

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8')) as {
    version: string;
};

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

describe('kk main exit seam', () => {
    it('R1 — bare invocation and --help/-h exit 0 and list shipped commands', async () => {
        for (const args of [[], ['--help'], ['-h']]) {
            const { code, out } = await run(args);
            expect(code).toBe(0);
            expect(out).toContain('kk');
            for (const cmd of ['add', 'invoke', 'plugins', 'fanin', 'fanout']) {
                expect(out).toContain(cmd);
            }
        }
    });

    it('R2 — help invoke and invoke --help describe --in and --out', async () => {
        for (const args of [
            ['help', 'invoke'],
            ['invoke', '--help'],
        ]) {
            const { code, out } = await run(args);
            expect(code).toBe(0);
            expect(out).toContain('--in');
            expect(out).toContain('--out');
        }
    });

    it('R3 — --version/-V print the package version, never the hard-coded 0.0.0', async () => {
        expect(pkg.version).not.toBe('0.0.0');
        for (const args of [['--version'], ['-V']]) {
            const { code, out } = await run(args);
            expect(code).toBe(0);
            expect(out).toContain(pkg.version);
            expect(out).not.toContain('0.0.0');
        }
    });

    it('falls back to the real stdout/stderr writers when no overrides are passed', async () => {
        // Exercises the default writer lambdas in main() (no options object).
        expect(await main(['node', 'test', '--version'])).toBe(0);
        // Error path → default writeErr lambda.
        expect(await main(['node', 'test', 'not-a-command'])).toBe(1);
    });

    it('R4 — global --verbose is accepted and does not change the result writer', async () => {
        for (const args of [
            ['--verbose', 'add', '1', '2'],
            ['add', '1', '2', '-v'],
        ]) {
            let outText = '';
            const originalOut = logger.out;
            logger.out = (msg: string) => {
                outText += msg;
            };
            try {
                const { code } = await run(args);
                expect(code).toBe(0);
                expect(outText).toBe('3\n');
            } finally {
                logger.out = originalOut;
            }
        }
    });

    it('R4 — --verbose plus plugins list --json still emits a pure JSON array', async () => {
        const fixturesDir = join(import.meta.dir, '../../../plugins');
        let outText = '';
        const originalOut = logger.out;
        logger.out = (msg: string) => {
            outText += msg;
        };
        try {
            const { code } = await run(['--verbose', 'plugins', 'list', '--json', '--plugins-root', fixturesDir]);
            expect(code).toBe(0);
            // The entire stdout parses as JSON — no verbose diagnostics mixed into the stream.
            const parsed: unknown = JSON.parse(outText);
            expect(Array.isArray(parsed)).toBe(true);
            expect((parsed as Array<{ name: string }>).some((p) => p.name === 'karakeep-local')).toBe(true);
        } finally {
            logger.out = originalOut;
        }
    });

    it('R5 — unknown command exits non-zero and names the command on stderr', async () => {
        const { code, err } = await run(['not-a-command']);
        expect(code).not.toBe(0);
        expect(err).toContain('not-a-command');
    });
});
