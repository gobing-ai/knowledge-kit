import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStagesScript, runStage } from '../src/stage';

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
