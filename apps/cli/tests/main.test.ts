import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { createProgram } from '../src/cli';
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
            expect(out).toContain('bot');
            expect(out).toContain('daily');
            expect(out).toContain('executor');
            expect(out).toContain('itc');
            expect(out).toContain('article');
            expect(out).toContain('news');
            expect(out).toContain('plugin');
            expect(out).toContain('stage');
            expect(out).toContain('store');
            expect(out).toContain('ledger');
            expect(out).toContain('schedule');
            // Exact visible command list: the kk nouns plus Commander's built-in
            // `help` command (`kk help executor` is a shipped path). No legacy names
            // (add/invoke/fanin/fanout/plugins) and no alias rendering such as
            // `plugin|plugins` — the loose line-start regex could not see that.
            expect(visibleCommandNames(out).sort()).toEqual([
                'article',
                'board',
                'bot',
                'daily',
                'executor',
                'help',
                'itc',
                'ledger',
                'lock',
                'news',
                'plugin',
                'schedule',
                'stage',
                'store',
                'wiki',
            ]);
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

interface TreeNode {
    path: string;
    hidden: boolean;
    hasAction: boolean;
    subs: number;
}

/**
 * Walk the real registered tree. `hidden` is inherited: Commander hides a nested command only
 * through its parent, but the tree test treats any command under a hidden parent as hidden so an
 * escaped grandchild can never masquerade as canonical surface.
 */
function walkTree(): TreeNode[] {
    const nodes: TreeNode[] = [];
    const walk = (parent: Command, prefix: string[], inheritedHidden: boolean): void => {
        for (const cmd of parent.commands) {
            // Commander keeps visibility and the action handler on private fields; the tree shape
            // is exactly what this test must read, so read them deliberately and narrowly.
            const hidden = inheritedHidden || (cmd as unknown as { _hidden?: boolean })._hidden === true;
            const hasAction = (cmd as unknown as { _actionHandler?: unknown })._actionHandler != null;
            const path = [...prefix, cmd.name()];
            nodes.push({ path: path.join(' '), hidden, hasAction, subs: cmd.commands.length });
            walk(cmd, path, hidden);
        }
    };
    walk(createProgram(), [], false);
    return nodes;
}

describe('kk command tree shape (0275 AC1 — A22 R1)', () => {
    it('every visible executable operation is `kk <noun> <verb>` — no noun action, no third word', () => {
        const nodes = walkTree();
        const visible = nodes.filter((n) => !n.hidden);
        for (const node of visible) {
            const words = node.path.split(' ');
            if (words.length === 1) {
                // A first-layer noun is a group: it owns verbs and never runs data itself.
                expect(`${node.path}: subs=${node.subs}`).toBe(`${node.path}: subs=${Math.max(node.subs, 1)}`);
                expect(node.hasAction).toBe(false);
            } else {
                // Two command words and an action handler — never a nested third word.
                expect(`${node.path}: words=${words.length} action=${node.hasAction}`).toBe(
                    `${node.path}: words=2 action=true`,
                );
            }
        }
    });

    it('the visible leaf inventory is exactly the canonical A22 surface', () => {
        const visibleLeaves = walkTree()
            .filter((n) => !n.hidden && n.hasAction)
            .map((n) => n.path)
            .sort();
        expect(visibleLeaves).toEqual([
            'article generate',
            'article new',
            'article publish',
            'article publish-check',
            'article publish-plan',
            'article publish-report',
            'article publish-send',
            'article publish-settle',
            'article status',
            'board capture',
            'board serve',
            'bot exec',
            'bot list',
            'bot login',
            'bot logout',
            'bot open',
            'bot plan',
            'daily prepare',
            'daily publish-classify',
            'daily run-report',
            'executor fan-in',
            'executor fan-out',
            'executor run',
            'itc candidates',
            'ledger append',
            'ledger cutover-check',
            'ledger sync',
            'lock acquire',
            'lock release',
            'news generate',
            'news new',
            'news publish',
            'news publish-check',
            'news publish-plan',
            'news publish-report',
            'news publish-send',
            'news publish-settle',
            'news status',
            'plugin check',
            'plugin login',
            'plugin status',
            'schedule render',
            'stage run',
            'store backfill-facts',
            'store extract',
            'store ingest',
            'store label',
            'store mark-published',
            'store migrate',
            'store pool-count',
            'store release',
            'store select',
            'store stats',
            'wiki compile',
            'wiki context',
            'wiki gc',
            'wiki ingest',
            'wiki link',
            'wiki lint',
            'wiki merge',
            'wiki publish',
            'wiki query',
            'wiki summarize',
            'wiki sync',
            'wiki synthesize',
        ]);
    });

    it('the hidden legacy routes are an explicit allowlist, not an accidental third shape (no hidden bot route)', () => {
        const hidden = walkTree()
            .filter((n) => n.hidden)
            .map((n) => n.path)
            .sort();
        expect(hidden).toEqual([
            'fanin',
            'fanout',
            'invoke',
            'plugin doctor',
            'plugin list',
            'plugins',
            'plugins doctor',
            'plugins list',
            'plugins status',
            'store lock',
            'store lock acquire',
            'store lock release',
        ]);
    });
});

/**
 * Run `kk …` in-process with the ts-utils output seam captured. Unlike `run()` above (commander
 * writers only), this sees the child stage runner's forwarded stdout/stderr too — which is what a
 * dispatch-equivalence assertion needs.
 */
async function runCaptured(args: string[]): Promise<RunResult> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

describe('kk stage legacy argv normalization through main() (0275 AC2 — A22 R2)', () => {
    it('dispatches `kk stage <legacy>` and `kk stage run <legacy>` to the same engine, output and exit code', async () => {
        // A stage name the runner refuses keeps the probe side-effect free while still proving
        // the arguments crossed the main() → runStage seam.
        const args = ['nope-not-a-stage', '--future-flag', '--', 'positional'];
        const legacy = await runCaptured(['stage', ...args]);
        const canonical = await runCaptured(['stage', 'run', ...args]);
        expect(legacy.code).toBe(1);
        expect(legacy.out).toBe(canonical.out);
        expect(legacy.err).toBe(canonical.err);
        expect(legacy.err).toContain('unknown stage: nope-not-a-stage');
    });

    it('normalizes the legacy spelling behind the root -v/--verbose globals', async () => {
        const verbose = await runCaptured(['--verbose', 'stage', 'nope-not-a-stage']);
        expect(verbose.code).toBe(1);
        expect(verbose.err).toContain('unknown stage: nope-not-a-stage');
    });

    it('keeps group help, verb help and the missing-stage usage error canonical', async () => {
        // `kk stage` alone is usage, never data work.
        const group = await runCaptured(['stage']);
        expect(group.code).not.toBe(0);
        expect(`${group.out}${group.err}`).toContain('run <args...>');

        // `stage run --help` is the canonical verb help.
        const verbHelp = await runCaptured(['stage', 'run', '--help']);
        expect(verbHelp.code).toBe(0);
        expect(verbHelp.out).toContain('Usage: kk stage run');
        expect(verbHelp.out).toContain('Run one stage by name');

        // `stage --help` shows the group, not the verb.
        const groupHelp = await runCaptured(['stage', '--help']);
        expect(groupHelp.code).toBe(0);
        expect(groupHelp.out).toContain('Usage: kk stage [options] [command]');
        expect(groupHelp.out).toContain('run <args...>');

        // `stage run` with no stage is a canonical usage error.
        const missing = await runCaptured(['stage', 'run']);
        expect(missing.code).not.toBe(0);
        expect(missing.err).toContain('missing required argument');
    });
});
