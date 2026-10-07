import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/main';
import { captureOutput } from './capture';

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

/**
 * Extract every visible first-layer command name from Commander help output.
 * Group aliases render as `name|alias` (e.g. `plugin|plugins`) — split on `|`
 * so each visible name is checked individually instead of being masked by a
 * loose regex that can only match a bare name at line start.
 */
function visibleCommandNames(out: string): string[] {
    const names: string[] = [];
    for (const line of out.split('\n')) {
        const entry = line.match(/^\s+([a-z][a-z0-9-]*(\|[a-z][a-z0-9-]*)*)\s/);
        const namesPart = entry?.[1];
        if (namesPart) {
            names.push(...namesPart.split('|'));
        }
    }
    return names;
}

describe('kk main exit seam', () => {
    it('R1 — bare invocation and --help/-h exit 0 and list every first-layer noun as a visible command', async () => {
        for (const args of [[], ['--help'], ['-h']]) {
            const { code, out } = await run(args);
            expect(code).toBe(0);
            expect(out).toContain('executor');
            expect(out).toContain('plugin');
            expect(out).toContain('stage');
            expect(out).toContain('store');
            expect(out).toContain('ledger');
            // Exact visible command list: the kk nouns plus Commander's built-in
            // `help` command (`kk help executor` is a shipped path). No legacy names
            // (add/invoke/fanin/fanout/plugins) and no alias rendering such as
            // `plugin|plugins` — the loose line-start regex could not see that.
            expect(visibleCommandNames(out).sort()).toEqual(['executor', 'help', 'ledger', 'plugin', 'stage', 'store']);
        }
    });

    it('R2 — executor run --help describes --in and --out; help executor names fan-in/fan-out', async () => {
        const { code, out } = await run(['executor', 'run', '--help']);
        expect(code).toBe(0);
        expect(out).toContain('--in');
        expect(out).toContain('--out');

        const helpExecutor = await run(['help', 'executor']);
        expect(helpExecutor.code).toBe(0);
        expect(helpExecutor.out).toContain('fan-in');
        expect(helpExecutor.out).toContain('fan-out');
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
        // Exercises the default writer lambdas in main() (no options object) and
        // proves they route through the ts-utils output seam, not raw process stdio.
        const cap = captureOutput();
        try {
            expect(await main(['node', 'test', '--version'])).toBe(0);
            expect(cap.read()).toContain(pkg.version);
            // Error path → default writeErr lambda.
            expect(await main(['node', 'test', 'not-a-command'])).toBe(1);
            expect(cap.readErr()).toContain('not-a-command');
        } finally {
            cap.restore();
        }
    });

    it('R4 — global --verbose is accepted and does not change the result writer', async () => {
        const fixturesDir = join(import.meta.dir, '../../../plugins');
        const cap = captureOutput();
        try {
            const { code } = await run(['--verbose', 'plugin', 'status', '--json', '--plugins-root', fixturesDir]);
            expect(code).toBe(0);
            // The entire stdout parses as JSON — no verbose diagnostics mixed into the stream.
            const parsed: unknown = JSON.parse(cap.read());
            expect(typeof (parsed as { healthy: boolean }).healthy).toBe('boolean');
            expect(Array.isArray((parsed as { plugins: unknown[] }).plugins)).toBe(true);
        } finally {
            cap.restore();
        }
    });

    it('R5 — unknown command exits non-zero and names the command on stderr', async () => {
        const { code, err } = await run(['not-a-noun']);
        expect(code).not.toBe(0);
        expect(err).toContain('not-a-noun');
    });
});
