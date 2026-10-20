import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { Command, CommanderError } from 'commander';
import { normalizeStageArgs, registerStageCommand } from '../../src/commands/stage';
import { resolveStagesScript, runStage } from '../../src/stage';

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-stage-verb-'));
    try {
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Async twin of `withTempDir` for action-level tests driven through `parseAsync`. */
async function withTempDirAsync<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'kk-stage-verb-'));
    try {
        return await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

/** Fake installed package: dist/index.js entry + optional shipped stages script. */
function fakePkg(dir: string, stagesScript?: string): string {
    const dist = join(dir, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, 'index.js'), 'process.exit(0);\n');
    if (stagesScript !== undefined) {
        mkdirSync(join(dir, 'plugins/kk/scripts'), { recursive: true });
        writeFileSync(join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts'), stagesScript);
    }
    return join(dist, 'index.js');
}

describe('kk stage verb (0144)', () => {
    it('resolves the package-shipped stages script two levels up from the running entry', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir, 'process.exit(0);\n');
            expect(resolveStagesScript(argv1)).toBe(
                realpathSync(join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts')),
            );
        });
    });

    it('falls through to the checkout-relative copy when the entry package ships none', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir);
            const repoRoot = join(import.meta.dir, '../../../..');
            const prevCwd = process.cwd();
            process.chdir(repoRoot);
            try {
                expect(resolveStagesScript(argv1)).toBe(
                    realpathSync(join(repoRoot, 'plugins/kk/scripts/kk-workflow-stages.ts')),
                );
            } finally {
                process.chdir(prevCwd);
            }
        });
    });

    it('fails loud naming the attempted path when neither tier has the script', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir);
            const empty = mkdtempSync(join(tmpdir(), 'kk-stage-empty-'));
            const prevCwd = process.cwd();
            process.chdir(empty);
            try {
                expect(() => resolveStagesScript(argv1, '/nonexistent-checkout')).toThrow(
                    /not found at .* — install or refresh the kk package/,
                );
            } finally {
                process.chdir(prevCwd);
                rmSync(empty, { recursive: true, force: true });
            }
        });
    });

    it('runStage passes the stage exit code through', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir, 'process.exit(5);\n');
            expect(runStage(['daily-prepare', 'unused'], process.execPath, argv1)).toBe(5);
        });
    });

    it('runStage forwards stage stdout/stderr through the default output targets, not raw stdio', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(
                dir,
                "console.log('stage-out line'); console.error('stage-err line'); process.exit(0);\n",
            );
            const out = createBufferTarget();
            const err = createBufferTarget();
            const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
            try {
                expect(runStage(['daily-prepare', 'unused'], process.execPath, argv1)).toBe(0);
            } finally {
                restore();
            }
            expect(out.text()).toContain('stage-out line');
            expect(err.text()).toContain('stage-err line');
        });
    });

    it('runStage reports a spawn failure as a named error', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir, 'process.exit(0);\n');
            expect(() => runStage(['daily-prepare'], '/nonexistent/runtime', argv1)).toThrow(
                /failed to spawn stage runner/,
            );
        });
    });

    it('registers `stage` as an action-free group whose only visible verb is `run <args...>`', () => {
        const program = new Command();
        registerStageCommand(program);
        const cmd = program.commands.find((c) => c.name() === 'stage');
        expect(cmd).toBeDefined();
        // A direct noun action is exactly what A22 R1 forbids on the visible group.
        expect((cmd as unknown as { _actionHandler?: unknown })._actionHandler).toBeNull();
        // `help` is Commander's built-in subcommand, not a product verb.
        expect(
            cmd
                ?.createHelp()
                .visibleCommands(cmd)
                .map((c) => c.name())
                .filter((name) => name !== 'help'),
        ).toEqual(['run']);
        const run = cmd?.commands.find((c) => c.name() === 'run');
        expect(
            run?.registeredArguments.map(
                (a) => `${a.required ? '<' : '['}${a.name()}${a.variadic ? '...' : ''}${a.required ? '>' : ']'}`,
            ),
        ).toEqual(['<args...>']);
    });

    it('the `stage run` action maps non-zero exits to CommanderError and passes unknown flags through', async () => {
        const program = new Command();
        registerStageCommand(program);

        await withTempDirAsync(async (dir) => {
            const argv1 = fakePkg(dir, 'process.exit(3);\n');
            const stages = join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts');
            // The action resolves the runner from process.argv[1]; point it at the fake package.
            const prevArgv1 = process.argv[1] ?? '';
            process.argv[1] = argv1;
            const prevCwd = process.cwd();
            process.chdir(dir); // cwd fallback must not mask the package tier
            try {
                // The action is async (a cancellable spawn forwards host signals), so the verb is
                // driven through parseAsync; the exit-code contract is unchanged.
                await expect(program.parseAsync(['stage', 'run', 'daily-prepare'], { from: 'user' })).rejects.toThrow(
                    CommanderError,
                );
                try {
                    await program.parseAsync(['stage', 'run', 'daily-prepare'], { from: 'user' });
                } catch (err) {
                    expect((err as CommanderError).code).toBe('kk.stage.failed');
                    expect((err as CommanderError).exitCode).toBe(3);
                }
                // Unknown flags pass through to the runner as positional args.
                writeFileSync(stages, 'if (process.argv[3] === "--future-flag") process.exit(0);\nprocess.exit(1);\n');
                await expect(
                    program.parseAsync(['stage', 'run', 'daily-prepare', '--future-flag'], { from: 'user' }),
                ).resolves.toBeDefined();
            } finally {
                process.argv[1] = prevArgv1;
                process.chdir(prevCwd);
            }
        });
    });
    it('routes `itc-*` stages in process, falling back to the stages script for unknown itc names', async () => {
        const program = new Command();
        program.exitOverride();
        registerStageCommand(program);

        await withTempDirAsync(async (dir) => {
            // Native itc stage: bad usage maps exit 1 to CommanderError.
            await expect(program.parseAsync(['stage', 'run', 'itc-author-complete'], { from: 'user' })).rejects.toThrow(
                CommanderError,
            );
            // Native itc stage success: a manual-review receipt over a seeded workspace.
            mkdirSync(join(dir, '2-outline'), { recursive: true });
            writeFileSync(join(dir, '3-draft-draft-article.md'), '# T\n\nDraft.');
            writeFileSync(join(dir, '2-outline/outline-approved.md'), '# O\n\nOutline.');
            await expect(
                program.parseAsync(['stage', 'run', 'itc-author-complete', dir, 'p1', 'manual'], { from: 'user' }),
            ).resolves.toBeDefined();
            // Unknown itc name: not native, so the stages script owns it (and its exit code).
            const prevArgv1 = process.argv[1] ?? '';
            process.argv[1] = fakePkg(dir, 'process.exit(process.argv[2] === "itc-legacy" ? 0 : 4);\n');
            try {
                await expect(
                    program.parseAsync(['stage', 'run', 'itc-legacy'], { from: 'user' }),
                ).resolves.toBeDefined();
            } finally {
                process.argv[1] = prevArgv1;
            }
        });
    });
});

describe('normalizeStageArgs — legacy `kk stage <stage>` → canonical `stage run` (0275 R2)', () => {
    const kk = (...args: string[]): string[] => ['node', '/abs/kk', ...args];

    it('inserts `run` after `stage` and keeps the rest of argv byte-for-byte', () => {
        expect(normalizeStageArgs(kk('stage', 'daily-prepare', 'a', 'b'))).toEqual(
            kk('stage', 'run', 'daily-prepare', 'a', 'b'),
        );
    });

    it('preserves `--` separators, unknown options and their order', () => {
        expect(normalizeStageArgs(kk('stage', 'daily-run-report', '--future-flag', '--', 'x', '-v'))).toEqual(
            kk('stage', 'run', 'daily-run-report', '--future-flag', '--', 'x', '-v'),
        );
    });

    it('normalizes behind the root -v/--verbose globals', () => {
        expect(normalizeStageArgs(kk('-v', 'stage', 'daily-prepare'))).toEqual(
            kk('-v', 'stage', 'run', 'daily-prepare'),
        );
        expect(normalizeStageArgs(kk('--verbose', 'stage', 'daily-prepare'))).toEqual(
            kk('--verbose', 'stage', 'run', 'daily-prepare'),
        );
    });

    it('leaves canonical and non-stage invocations untouched', () => {
        const untouched = [
            [],
            kk(),
            kk('--version'),
            kk('stage'),
            kk('stage', 'run', 'daily-prepare'),
            kk('stage', '--help'),
            kk('stage', '-h'),
            kk('--verbose', 'stage', '--help'),
            kk('store', 'lock', 'acquire'),
            kk('help', 'stage'),
            // An unknown root option is Commander's error path, not a stage normalization.
            kk('--nope', 'stage', 'daily-prepare'),
        ];
        for (const argv of untouched) {
            expect(normalizeStageArgs(argv)).toEqual(argv);
        }
    });
});

const STAGES_REL = join('plugins', 'kk', 'scripts', 'kk-workflow-stages.ts');

/** Fixture checkout: source marker + source runner (exit 17) + divergent staged runner (exit 18). */
function fixtureCheckout(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-compiled-checkout-')));
    mkdirSync(join(root, 'apps/cli/src'), { recursive: true });
    mkdirSync(join(root, 'apps/cli/plugins/kk/scripts'), { recursive: true });
    mkdirSync(join(root, 'plugins/kk/scripts'), { recursive: true });
    writeFileSync(join(root, 'apps/cli/package.json'), '{"name":"kk-fixture","version":"0.0.0"}\n');
    writeFileSync(join(root, 'apps/cli/src/stage.ts'), '// checkout marker\n');
    writeFileSync(join(root, 'apps/cli/src/index.ts'), '// entry\n');
    writeFileSync(join(root, STAGES_REL), 'process.exit(17);\n');
    writeFileSync(join(root, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts'), 'process.exit(18);\n');
    return root;
}

describe('kk stage resolver — installed vs checkout identity (0178)', () => {
    it('an installed package keeps its own runner when launched inside a foreign checkout', () => {
        withTempDir((dir) => {
            const root = fixtureCheckout();
            const argv1 = fakePkg(dir, 'process.exit(18);\n');
            const prevCwd = process.cwd();
            process.chdir(root);
            try {
                expect(resolveStagesScript(argv1)).toBe(realpathSync(join(dir, STAGES_REL)));
            } finally {
                process.chdir(prevCwd);
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    it('compiled CLI in a fixture checkout runs the source runner, not the staged bundle (AC4)', async () => {
        const root = fixtureCheckout();
        const unrelatedCwd = realpathSync(mkdtempSync(join(tmpdir(), 'kk-unrelated-cwd-')));
        try {
            const checkArgs =
                "if (process.argv[2] !== 'fixture' || process.argv[3] !== '--future-flag') process.exit(99);\n";
            writeFileSync(join(root, STAGES_REL), `${checkArgs}process.exit(17);\n`);
            writeFileSync(join(root, 'apps/cli', STAGES_REL), `${checkArgs}process.exit(18);\n`);
            mkdirSync(join(unrelatedCwd, 'plugins/kk/scripts'), { recursive: true });
            writeFileSync(join(unrelatedCwd, STAGES_REL), 'process.exit(98);\n');
            // WHY a child process (harness fix 2026-10-13): once a full workspace typecheck has run in
            // this checkout AND the whole suite is loaded with coverage, the in-process bundler resolves
            // a workspace dependency to a directory and throws
            // `EISDIR reading file: .../.bun/@gobing-ai+ts-utils@0.5.24/.../dist/index.js`. Reproduced
            // 3/3 in exactly that configuration and green in every other one; the cited path stayed a
            // regular file throughout a 0.1s-interval watch, so it is a bundler-state defect, not an fs
            // condition. The identical build in a fresh child process is unaffected. Assertions below
            // are unchanged — this swaps where the build runs, not what is asserted.
            const buildScript = [
                'void (async () => {',
                '  const r = await Bun.build({',
                `    entrypoints: [${JSON.stringify(join(import.meta.dir, '../../src/index.ts'))}],`,
                "    target: 'bun',",
                // WHY external (0276): the lazy bot-harness import pulls `playwright` into the
                // graph and playwright-core's own requires (chromium-bidi, electron) cannot be
                // bundled; the production build passes `--external playwright` for the same
                // reason, so the fixture build must match it or it exercises nothing real.
                // 0317 R8 adds the same treatment for the lazily imported decision hub: its own
                // graph reaches `@johnhenry/laya`, whose optional GPU peer is not installable here.
                "    external: ['playwright', '@gobing-ai/ts-ai-decision'],",
                `    outdir: ${JSON.stringify(join(root, 'apps/cli/dist'))},`,
                '  });',
                '  if (!r.success) process.exit(1);',
                '})();',
            ].join('\n');
            const built = spawnSync(process.execPath, ['-e', buildScript], { encoding: 'utf8' });
            expect(built.status).toBe(0);
            const entry = join(root, 'apps/cli/dist/index.js');
            const run = () =>
                spawnSync(process.execPath, [entry, 'stage', 'fixture', '--future-flag'], {
                    cwd: unrelatedCwd,
                    encoding: 'utf8',
                }).status;

            // Real source entry, staged copy present: the checked-in runner wins.
            expect(run()).toBe(17);

            // Editing the source runner takes effect with no restaging.
            writeFileSync(join(root, STAGES_REL), `${checkArgs}process.exit(19);\n`);
            expect(run()).toBe(19);

            // Relocated into a package without the checkout marker: its own runner is used.
            const pkg = realpathSync(mkdtempSync(join(tmpdir(), 'kk-relocated-pkg-')));
            try {
                mkdirSync(join(pkg, 'plugins/kk/scripts'), { recursive: true });
                writeFileSync(join(pkg, 'package.json'), '{"name":"kk-relocated","version":"0.0.0"}\n');
                cpSync(join(root, 'apps/cli/dist'), join(pkg, 'dist'), { recursive: true });
                writeFileSync(join(pkg, STAGES_REL), `${checkArgs}process.exit(18);\n`);
                for (const cwd of [unrelatedCwd, root]) {
                    const relocated = spawnSync(
                        process.execPath,
                        [join(pkg, 'dist/index.js'), 'stage', 'fixture', '--future-flag'],
                        { cwd, encoding: 'utf8' },
                    );
                    expect(relocated.status).toBe(18);
                }
            } finally {
                rmSync(pkg, { recursive: true, force: true });
            }
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(unrelatedCwd, { recursive: true, force: true });
        }
    }, 30000);
});
