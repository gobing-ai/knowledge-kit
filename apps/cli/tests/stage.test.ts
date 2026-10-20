import { afterEach, describe, expect, it, test } from 'bun:test';
import { spawn } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveStagesScript, runStage, runStageCancellable } from '../src/stage';

/** True while the pid is still alive; a signal-0 probe never throws for a live process. */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** Fixture checkout: source marker + source runner (exit 17) + divergent staged runner (exit 18). */
function fixtureCheckout(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-checkout-')));
    mkdirSync(join(root, 'apps/cli/src'), { recursive: true });
    mkdirSync(join(root, 'apps/cli/plugins/kk/scripts'), { recursive: true });
    mkdirSync(join(root, 'plugins/kk/scripts'), { recursive: true });
    writeFileSync(join(root, 'apps/cli/src/stage.ts'), '// checkout marker\n');
    writeFileSync(join(root, 'apps/cli/src/index.ts'), '// entry\n');
    writeFileSync(join(root, 'plugins/kk/scripts/kk-workflow-stages.ts'), 'process.exit(17);\n');
    writeFileSync(join(root, 'apps/cli/plugins/kk/scripts/kk-workflow-stages.ts'), 'process.exit(18);\n');
    return root;
}

const STAGES_REL = join('plugins', 'kk', 'scripts', 'kk-workflow-stages.ts');

describe('resolveStagesScript', () => {
    const origCwd = process.cwd();
    const made: string[] = [];

    afterEach(() => {
        process.chdir(origCwd);
        for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    test('falls back to the checkout-relative stages script from the repo root', () => {
        // An unresolvable entry uses the module-anchored source regardless of staged-copy presence.
        const script = resolveStagesScript('/nonexistent/kk-entry');
        expect(script.endsWith(join('plugins', 'kk', 'scripts', 'kk-workflow-stages.ts'))).toBe(true);
    });

    test('throws with install guidance when neither candidate exists', () => {
        const dir = mkdtempSync(join(tmpdir(), 'stage-test-'));
        made.push(dir);
        process.chdir(dir);
        expect(() => resolveStagesScript('/nonexistent/kk-entry', '/nonexistent-checkout')).toThrow(
            /install or refresh the kk package/,
        );
    });

    test('ignores a cwd-relative planted script — the checkout root is never the current directory', () => {
        const planted = mkdtempSync(join(tmpdir(), 'stage-test-'));
        made.push(planted);
        mkdirSync(join(planted, 'plugins', 'kk', 'scripts'), { recursive: true });
        writeFileSync(join(planted, 'plugins', 'kk', 'scripts', 'kk-workflow-stages.ts'), 'process.exit(0);\n');
        process.chdir(planted);
        expect(() => resolveStagesScript('/nonexistent/kk-entry', '/nonexistent-checkout')).toThrow(
            /install or refresh the kk package/,
        );
    });

    test('defaults the checkout root to this module, independent of the current directory', () => {
        const dir = mkdtempSync(join(tmpdir(), 'stage-test-'));
        made.push(dir);
        process.chdir(dir);
        const script = resolveStagesScript('/nonexistent/kk-entry');
        expect(script.endsWith(join('plugins', 'kk', 'scripts', 'kk-workflow-stages.ts'))).toBe(true);
    });
});

describe('runStage', () => {
    test('returns the spawned process exit code (silent runner exits 0)', () => {
        // execPath override keeps the test hermetic: /usr/bin/true ignores its args and prints nothing,
        // so nothing leaks onto the test reporter's inherited stdout.
        expect(runStage(['--anything'], '/usr/bin/true', '/nonexistent/kk-entry')).toBe(0);
    });

    test('fails loud when the executable cannot be spawned', () => {
        expect(() => runStage(['--anything'], '/nonexistent/binary-xyz', '/nonexistent/kk-entry')).toThrow(
            /failed to spawn stage runner/,
        );
    });
});

describe('resolveStagesScript — checkout source precedence (0178)', () => {
    const made: string[] = [];

    afterEach(() => {
        for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function checkout(): string {
        const root = fixtureCheckout();
        made.push(root);
        return root;
    }

    test('a checkout entry executes the checked-in source runner, not the divergent staged copy', () => {
        const root = checkout();
        expect(resolveStagesScript(join(root, 'apps/cli/src/index.ts'), root)).toBe(join(root, STAGES_REL));
    });

    test('a symlinked checkout entry resolves the same source runner', () => {
        const root = checkout();
        const link = join(root, 'kk-entry-link.ts');
        symlinkSync(join(root, 'apps/cli/src/index.ts'), link);
        expect(resolveStagesScript(link, root)).toBe(join(root, STAGES_REL));
    });

    test('a recognized checkout with its source runner absent fails naming the source path', () => {
        const root = checkout();
        rmSync(join(root, STAGES_REL));
        let message = '';
        try {
            resolveStagesScript(join(root, 'apps/cli/src/index.ts'), root);
        } catch (err) {
            message = (err as Error).message;
        }
        // The staged copy still exists, yet the failure names the source path — never the stale copy.
        expect(message).toContain(join(root, STAGES_REL));
        expect(message).toContain('install or refresh the kk package');
    });

    test('an unresolvable entry still resolves the module-anchored checkout fallback', () => {
        const root = checkout();
        expect(resolveStagesScript('/nonexistent/kk-entry', root)).toBe(join(root, STAGES_REL));
    });

    test('a tree without the source marker never becomes a checkout runner', () => {
        const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-no-marker-')));
        made.push(root);
        mkdirSync(join(root, 'plugins/kk/scripts'), { recursive: true });
        writeFileSync(join(root, STAGES_REL), 'process.exit(17);\n');
        expect(() => resolveStagesScript('/nonexistent/kk-entry', root)).toThrow(/install or refresh the kk package/);
    });

    test('an unstattable checkout root fails loud instead of crashing', () => {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-file-root-')));
        made.push(dir);
        const file = join(dir, 'not-a-directory');
        writeFileSync(file, 'x');
        expect(() => resolveStagesScript('/nonexistent/kk-entry', file)).toThrow(/install or refresh the kk package/);
    });
});

describe('runStageCancellable — host cancellation reaches the stage and its children (0285)', () => {
    it('maps the stage exit code and forwards a host signal to the whole stage process group', async () => {
        const repoRoot = resolve(import.meta.dir, '../../..');
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-stage-cancel-')));
        const bin = join(dir, 'bin');
        const workDir = join(dir, 'work');
        mkdirSync(bin, { recursive: true });
        mkdirSync(workDir, { recursive: true });
        // A grandchild the stage spawns: recording its pid is how the test proves it died too.
        const stubPidFile = join(dir, 'stub.pid');
        writeFileSync(join(bin, 'spur'), `#!/bin/sh\nprintf '%s\\n' "$$" >> "${stubPidFile}"\nsleep 60\n`);
        chmodSync(join(bin, 'spur'), 0o755);
        writeFileSync(
            join(workDir, 'options.json'),
            JSON.stringify({
                url: 'https://example.com',
                locale: 'en-US',
                business_context: '',
                max_pages: 60,
                max_depth: 5,
                max_requests: 200,
                deadline_seconds: 600,
                semantic_pages: 20,
                max_pairs: 10,
                max_keywords: 10,
                max_decision_calls: 320,
                performance: false,
                visibility_file: '',
                fixture: '',
            }),
        );
        writeFileSync(
            join(workDir, 'crawl.json'),
            readFileSync(join(repoRoot, 'plugins/kk/tests/fixtures/smart-seo-minimal-crawl.json'), 'utf-8'),
        );

        // The real CLI drives the real stage runner; SIGTERM addresses only the CLI process.
        const cli = spawn('bun', [join(repoRoot, 'apps/cli/src/index.ts'), 'stage', 'run', 'seo-judge', workDir], {
            cwd: repoRoot,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` },
        });
        // Await the exit event itself: a `let exited` holder narrows to `null` under TypeScript's
        // control-flow analysis because the assignment happens in a callback.
        const closed = new Promise<number | null>((resolvePromise) => cli.on('close', resolvePromise));
        try {
            const deadline = Date.now() + 20_000;
            while (!existsSync(stubPidFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
            expect(existsSync(stubPidFile)).toBe(true);
            const stubPid = Number(readFileSync(stubPidFile, 'utf-8').trim());

            cli.kill('SIGTERM');
            expect(await closed).toBe(143);
            expect(alive(stubPid)).toBe(false);
        } finally {
            try {
                cli.kill('SIGKILL');
            } catch {
                // already gone
            }
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

describe('runStageCancellable — exit status, spawn failure and signal forwarding (0285)', () => {
    const made: string[] = [];
    afterEach(() => {
        for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
    });
    /** Fake installed package: a dist entry plus the stages script this test controls. */
    function pkg(body: string): string {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-cancel-unit-')));
        made.push(dir);
        mkdirSync(join(dir, 'dist'), { recursive: true });
        mkdirSync(join(dir, 'plugins/kk/scripts'), { recursive: true });
        writeFileSync(join(dir, 'dist/index.js'), 'process.exit(0);\n');
        writeFileSync(join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts'), body);
        return join(dir, 'dist/index.js');
    }

    it('resolves the child exit code (no signal) through the cancellable path', async () => {
        // The child writes to both streams so the captured-output forwarding is exercised too.
        const argv1 = pkg('console.log("stage-out"); console.error("stage-err"); process.exit(7);\n');
        await expect(runStageCancellable(['daily-prepare'], process.execPath, argv1)).resolves.toBe(7);
    });

    it('maps a child killed by a forwarded signal to the conventional status', async () => {
        // The child dies by SIGTERM, so the close event carries a null code and the signal instead.
        const argv1 = pkg('process.kill(process.pid, "SIGTERM");\n');
        await expect(runStageCancellable(['daily-prepare'], process.execPath, argv1)).resolves.toBe(143);
    });

    it('rejects with a named error when the runner cannot be spawned', async () => {
        await expect(runStageCancellable(['x'], '/nonexistent/binary-xyz', '/nonexistent/kk-entry')).rejects.toThrow(
            /failed to spawn stage runner/,
        );
    });

    it('forwards a host signal to the stage process group and disarms afterwards', async () => {
        // The child swallows SIGTERM and exits 0 on its own, so the escalation timer is armed and then
        // disarmed by the close handler — a real cancellation is proven end to end in the test above.
        // The child announces its handler through a ready file: a fixed sleep raced child startup under
        // full-suite load, delivering SIGTERM before the handler existed (exit 143 instead of 0).
        const readyDir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-cancel-ready-')));
        made.push(readyDir);
        const ready = join(readyDir, 'ready');
        const argv1 = pkg(
            `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(ready)}, "1"); setTimeout(() => process.exit(0), 300);\n`,
        );
        const pending = runStageCancellable(['daily-prepare'], process.execPath, argv1);
        const deadline = Date.now() + 20_000;
        while (!existsSync(ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
        expect(existsSync(ready)).toBe(true);
        process.emit('SIGTERM');
        await expect(pending).resolves.toBe(0);
        // Handlers are removed on close: a further signal must not reach the finished run.
        process.emit('SIGTERM');
    }, 30_000);
});

describe('runStageCancellable — escalation of a stage that ignores the signal (0285)', () => {
    it('force-kills the process group when the stage outlives the grace period', async () => {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kk-cancel-esc-')));
        try {
            mkdirSync(join(dir, 'dist'), { recursive: true });
            mkdirSync(join(dir, 'plugins/kk/scripts'), { recursive: true });
            writeFileSync(join(dir, 'dist/index.js'), 'process.exit(0);\n');
            // Swallows SIGTERM and lingers past CANCEL_ESCALATION_MS (5 s), so the escalation fires.
            // The ready file is written only after the handler is installed: a fixed sleep raced it
            // under load and the child died of the forwarded SIGTERM (143) instead of the SIGKILL.
            const ready = join(dir, 'ready');
            writeFileSync(
                join(dir, 'plugins/kk/scripts/kk-workflow-stages.ts'),
                `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(ready)}, "1"); setTimeout(() => process.exit(0), 30000);\n`,
            );
            const pending = runStageCancellable(['daily-prepare'], process.execPath, join(dir, 'dist/index.js'));
            const deadline = Date.now() + 20_000;
            while (!existsSync(ready) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
            expect(existsSync(ready)).toBe(true);
            process.emit('SIGTERM');
            // The child is SIGKILLed, which is not one of the forwarded signals: exit status falls to 1.
            await expect(pending).resolves.toBe(1);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});
