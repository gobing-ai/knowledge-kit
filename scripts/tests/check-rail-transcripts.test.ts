import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkRailHeader,
    checkRailHeaders,
    cliMain,
    formatFinding,
    legacyNotices,
    railModules,
    runCli,
    splitArgs,
} from '../check-rail-transcripts';

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kk-rail-headers-'));
    mkdirSync(join(root, 'x-pub', 'src'), { recursive: true });
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function module(name: string, body: string): string {
    const path = join(root, 'x-pub', 'src', name);
    writeFileSync(path, body);
    return path;
}

describe('railModules', () => {
    test('finds rail and flow modules under src and skips generated, test and non-src trees', () => {
        module('post-rail.ts', '// transcript: none — new\n');
        module('flow.ts', '// transcript: none — new\n');
        module('post-rail.generated.ts', '// generated\n');
        module('helpers.ts', 'export const x = 1;\n');
        mkdirSync(join(root, 'x-pub', 'tests'), { recursive: true });
        writeFileSync(join(root, 'x-pub', 'tests', 'flow.test.ts'), '// transcript: none — test\n');

        expect(railModules(root).map((path) => path.slice(root.length + 1))).toEqual([
            'x-pub/src/flow.ts',
            'x-pub/src/post-rail.ts',
        ]);
    });
});

describe('checkRailHeader', () => {
    test('a named transcript passes', () => {
        const path = module(
            'post-rail.ts',
            '// transcript: packages/publish-harness/tests/fixtures/bot-record/x.json\n\nexport const a = 1;\n',
        );

        expect(checkRailHeader(path)).toBeNull();
    });

    test('a reasoned none passes', () => {
        const path = module('post-rail.ts', '// transcript: none — the site exposes no stable selector\n');

        expect(checkRailHeader(path)).toBeNull();
    });

    test('a module with no header is a missing-header finding', () => {
        const path = module('post-rail.ts', 'export const a = 1;\n');

        expect(checkRailHeader(path)).toEqual({ file: path, reason: 'missing-header' });
    });

    test('`none` with no reason is a finding, not a pass', () => {
        const path = module('post-rail.ts', '// transcript: none\n');

        expect(checkRailHeader(path)).toEqual({ file: path, reason: 'empty-reason' });
    });

    test('a header below the header window does not count', () => {
        const path = module('post-rail.ts', `${'\n'.repeat(25)}// transcript: none — too late\n`);

        expect(checkRailHeader(path)).toEqual({ file: path, reason: 'missing-header' });
    });
});

describe('checkRailHeaders', () => {
    test('reports one finding per offending module and none for a clean set', () => {
        const good = module('flow.ts', '// transcript: none — measured by hand\n');
        const bad = module('post-rail.ts', 'export const a = 1;\n');

        expect(checkRailHeaders([good, bad])).toEqual([{ file: bad, reason: 'missing-header' }]);
        expect(checkRailHeaders([good])).toEqual([]);
    });
});

describe('formatFinding', () => {
    test('each reason reads as an instruction, not a status', () => {
        const missing = formatFinding({ file: join(root, 'x-pub', 'src', 'post-rail.ts'), reason: 'missing-header' });
        const empty = formatFinding({ file: join(root, 'x-pub', 'src', 'flow.ts'), reason: 'empty-reason' });

        expect(missing).toContain('carries no `// transcript:` header');
        expect(empty).toContain('gives no reason');
        expect(missing).toStartWith('INVALID: ');
    });
});

describe('the CLI leaf', () => {
    const script = join(import.meta.dir, '..', 'check-rail-transcripts.ts');

    /** In-process run: the CLI body is `runCli`, so the leaf itself stays covered. */
    function cli(args: string[]) {
        const out: string[] = [];
        const err: string[] = [];
        const result = runCli(args, (channel, text) => (channel === 'out' ? out : err).push(text));
        return { result, out: out.join(''), err: err.join('') };
    }

    test('reports ok with --json on a clean file and a finding on a bare rail', () => {
        module('flow.ts', '// transcript: none — measured by hand\n');
        const ok = cli(['--json', join(root, 'x-pub', 'src', 'flow.ts')]);
        expect(ok.result.ok).toBe(true);
        expect(JSON.parse(ok.out)).toMatchObject({ ok: true, checked: 1 });

        module('post-rail.ts', 'export const a = 1;\n');
        const bad = cli([join(root, 'x-pub', 'src', 'post-rail.ts')]);
        expect(bad.result.ok).toBe(false);
        expect(bad.err).toContain('carries no `// transcript:` header');
    });

    test('cliMain wires real argv to the exit code', () => {
        module('flow.ts', '// transcript: none — measured by hand\n');
        expect(cliMain([join(root, 'x-pub', 'src', 'flow.ts')])).toBe(0);

        module('post-rail.ts', 'export const a = 1;\n');
        expect(cliMain([join(root, 'x-pub', 'src', 'post-rail.ts')])).toBe(1);
    });

    test('the real process exits 1 on a finding and 0 on a clean file', () => {
        module('flow.ts', '// transcript: none — measured by hand\n');
        const ok = Bun.spawnSync({ cmd: ['bun', script, join(root, 'x-pub', 'src', 'flow.ts')] });
        expect(ok.exitCode).toBe(0);

        module('post-rail.ts', 'export const a = 1;\n');
        const bad = Bun.spawnSync({ cmd: ['bun', script, join(root, 'x-pub', 'src', 'post-rail.ts')] });
        expect(bad.exitCode).toBe(1);
    });

    test('the repo sweep reports every un-annotated rail, which is why the rule names exemptions', () => {
        const sweep = Bun.spawnSync({ cmd: ['bun', script, '--json'], cwd: join(import.meta.dir, '..', '..') });
        const report = JSON.parse(sweep.stdout.toString()) as { ok: boolean; checked: number };

        expect(report.checked).toBeGreaterThanOrEqual(10);
        expect(report.ok).toBe(false); // today's rails predate the header; the rule exempts them by name
    });
});

describe('the legacy registry', () => {
    test('--legacy entries are split out of the check targets', () => {
        expect(splitArgs(['--json', '--legacy=plugins/a/src/flow.ts', 'plugins/b/src/post-rail.ts'])).toEqual({
            legacy: ['plugins/a/src/flow.ts'],
            explicit: ['plugins/b/src/post-rail.ts'],
        });
    });

    test('each exemption prints a NOTICE, so the carve-out is never silent', () => {
        const notices = legacyNotices([join(root, 'x-pub', 'src', 'flow.ts')]);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toStartWith('NOTE: ');
        expect(notices[0]).toContain('predates the rail-transcript rule');
    });

    test('an exempt module is skipped while a rail outside the registry is still judged', () => {
        const legacy = module('flow.ts', 'export const a = 1;\n');
        const fresh = module('post-rail.ts', 'export const b = 2;\n');
        const result = Bun.spawnSync({
            cmd: ['bun', join(import.meta.dir, '..', 'check-rail-transcripts.ts'), `--legacy=${legacy}`, fresh],
        });

        expect(result.stderr.toString()).toContain('predates the rail-transcript rule');
        expect(result.stderr.toString()).toContain('post-rail.ts');
        expect(result.exitCode).toBe(1);
    });

    test('the rule passes on this tree with its declared registry', () => {
        const rule = join(import.meta.dir, '..', '..', '.spur', 'rules', 'structure', 'rail-transcript-header.yaml');
        const legacy = [...readFileSync(rule, 'utf8').matchAll(/--legacy=([^"\s]+)/g)].map(
            (match: RegExpMatchArray) => match[1],
        );
        const result = Bun.spawnSync({
            cmd: [
                'bun',
                join(import.meta.dir, '..', 'check-rail-transcripts.ts'),
                ...legacy.map((path: string) => `--legacy=${path}`),
            ],
            cwd: join(import.meta.dir, '..', '..'),
        });

        expect(legacy.length).toBeGreaterThanOrEqual(10);
        expect(result.exitCode).toBe(0);
    });
});
