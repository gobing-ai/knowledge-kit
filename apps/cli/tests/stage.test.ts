import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveStagesScript, runStage } from '../src/stage';

describe('resolveStagesScript', () => {
    const origCwd = process.cwd();

    afterEach(() => {
        process.chdir(origCwd);
    });

    test('falls back to the checkout-relative stages script from the repo root', () => {
        // argv[1] under bun test lives under apps/cli/tests, whose package-relative
        // candidate apps/cli/plugins/kk/... does not exist — the checkout copy wins.
        const script = resolveStagesScript('/nonexistent/kk-entry');
        expect(script.endsWith(join('plugins', 'kk', 'scripts', 'kk-workflow-stages.ts'))).toBe(true);
    });

    test('throws with install guidance when neither candidate exists', () => {
        process.chdir(mkdtempSync(join(tmpdir(), 'stage-test-')));
        expect(() => resolveStagesScript('/nonexistent/kk-entry', '/nonexistent-checkout')).toThrow(
            /install or refresh the kk package/,
        );
    });

    test('ignores a cwd-relative planted script — the checkout root is never the current directory', () => {
        const planted = mkdtempSync(join(tmpdir(), 'stage-test-'));
        mkdirSync(join(planted, 'plugins', 'kk', 'scripts'), { recursive: true });
        writeFileSync(join(planted, 'plugins', 'kk', 'scripts', 'kk-workflow-stages.ts'), 'process.exit(0);\n');
        process.chdir(planted);
        expect(() => resolveStagesScript('/nonexistent/kk-entry', '/nonexistent-checkout')).toThrow(
            /install or refresh the kk package/,
        );
    });

    test('defaults the checkout root to this module, independent of the current directory', () => {
        process.chdir(mkdtempSync(join(tmpdir(), 'stage-test-')));
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
