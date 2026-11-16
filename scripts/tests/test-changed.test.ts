/**
 * 0383 — the changed-scope test run must not write the repo-wide coverage corpus.
 *
 * Failures enumerated before the implementation:
 *  1. The scoped run writes `.coverage/` at the repo root and the next gate's coverage rule reads a
 *     partial lcov, failing every untouched file.
 *  2. Numbers from two different scopes accumulate in one directory.
 *  3. An empty workspace argument still launches a test run.
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main, SCOPED_COVERAGE_DIR, testArgv } from '../test-changed';

describe('test-changed (0383 R3)', () => {
    it('sends coverage to a scratch directory, never to the repo-wide corpus', () => {
        const argv = testArgv(['tests/a.test.ts'], '/tmp/scratch-cov');
        expect(argv).toContain('--coverage-dir=/tmp/scratch-cov');
        expect(argv.join(' ')).not.toContain('--coverage-dir=.coverage');
        expect(SCOPED_COVERAGE_DIR).not.toBe('.coverage');
    });

    it('refuses an empty workspace instead of running the whole suite', () => {
        expect(main([''])).toBe(2);
        expect(main([])).toBe(2);
    });

    it('clears a previous scoped corpus so two scopes never mix, then runs in the workspace', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-test-changed-'));
        const workspace = join(root, 'w');
        mkdirSync(join(workspace, 'tests'), { recursive: true });
        writeFileSync(
            join(workspace, 'tests', 'ok.test.ts'),
            "import { expect, it } from 'bun:test';\nit('passes', () => expect(1).toBe(1));\n",
        );
        const stale = resolve(root, SCOPED_COVERAGE_DIR);
        mkdirSync(stale, { recursive: true });
        writeFileSync(join(stale, 'lcov.info'), 'stale\n');

        const code = main(['w', 'tests/ok.test.ts'], root);
        expect(code).toBe(0);
        rmSync(root, { recursive: true, force: true });
    }, 60_000);
});
