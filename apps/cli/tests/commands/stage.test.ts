import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command, CommanderError } from 'commander';
import { registerStageCommand } from '../../src/commands/stage';
import { resolveStagesScript, runStage } from '../../src/stage';

function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'kk-stage-verb-'));
    try {
        return fn(dir);
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

    it('runStage passes the stage exit code through and inherits stdio', () => {
        withTempDir((dir) => {
            const argv1 = fakePkg(dir, 'process.exit(5);\n');
            expect(runStage(['daily-prepare', 'unused'], process.execPath, argv1)).toBe(5);
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

    it('registers a variadic `stage` command that maps non-zero exits to CommanderError', () => {
        const program = new Command();
        registerStageCommand(program);
        const cmd = program.commands.find((c) => c.name() === 'stage');
        expect(cmd).toBeDefined();

        withTempDir((dir) => {
            const argv1 = fakePkg(dir, 'process.exit(3);\n');
            const stages = join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts');
            // The action resolves the runner from process.argv[1]; point it at the fake package.
            const prevArgv1 = process.argv[1] ?? '';
            process.argv[1] = argv1;
            const prevCwd = process.cwd();
            process.chdir(dir); // cwd fallback must not mask the package tier
            try {
                // from:'user' parses from index 0: argv[0] is the program/verb itself.
                expect(() => program.parse(['stage', 'daily-prepare'], { from: 'user' })).toThrow(CommanderError);
                try {
                    program.parse(['stage', 'daily-prepare'], { from: 'user' });
                } catch (err) {
                    expect((err as CommanderError).code).toBe('kk.stage.failed');
                    expect((err as CommanderError).exitCode).toBe(3);
                }
                // Unknown flags pass through to the runner as positional args.
                writeFileSync(stages, 'if (process.argv[3] === "--future-flag") process.exit(0);\nprocess.exit(1);\n');
                expect(() =>
                    program.parse(['stage', 'daily-prepare', '--future-flag'], { from: 'user' }),
                ).not.toThrow();
            } finally {
                process.argv[1] = prevArgv1;
                process.chdir(prevCwd);
            }
        });
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
            const built = await Bun.build({
                entrypoints: [join(import.meta.dir, '../../src/index.ts')],
                target: 'bun',
                outdir: join(root, 'apps/cli/dist'),
            });
            expect(built.success).toBe(true);
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
