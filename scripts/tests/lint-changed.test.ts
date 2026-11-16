/**
 * Task 0383 — failure-first contract for the `lint-changed` action override.
 *
 * Failures enumerated before the implementation:
 *  1. A docs-only change set fails the gate because Biome had nothing to process.
 *  2. A real formatter/lint error in a checkable file is swallowed.
 *  3. A deleted path in the change set is handed to Biome and errors "no such file".
 *  4. The wrapper silently passes an empty argument list.
 */

import { describe, expect, it } from 'bun:test';
import { checkable, existing, main, runBiome } from '../lint-changed';
import { captureMain, captureSpawn } from './capture-output';

describe('lint-changed (0383 R2)', () => {
    it('skips everything Biome cannot process instead of failing the gate', () => {
        expect(checkable(['docs/tasks/a.md', 'docs/04_DESIGN.md'])).toEqual([]);
        const skipped = captureMain(() => main(['docs/tasks/a.md', 'docs/04_DESIGN.md']));
        expect(skipped.code).toBe(0);
        expect(skipped.stdout).toContain('nothing Biome can check');
    });

    it('keeps every checkable extension', () => {
        expect(checkable(['a.ts', 'b.tsx', 'c.json', 'd.md'])).toEqual(['a.ts', 'b.tsx', 'c.json']);
    });

    it('drops deleted paths rather than handing Biome a missing file', () => {
        expect(existing(['docs/gone.md', 'scripts/gone.ts'])).toEqual([]);
    });

    it('never swallows a real finding: a non-zero Biome status is returned unchanged', () => {
        expect(main(['scripts/lint-changed.ts'], () => 1)).toBe(1);
        expect(main(['scripts/lint-changed.ts'], () => 0)).toBe(0);
    });

    it('does not invoke the checker at all when nothing is checkable', () => {
        let called = false;
        const skipped = captureMain(() =>
            main(['docs/a.md'], () => {
                called = true;
                return 1;
            }),
        );
        expect(skipped.code).toBe(0);
        expect(skipped.stdout).toContain('nothing Biome can check');
        expect(called).toBe(false);
    });

    it('runs the real checker over a clean file that Biome can see', () => {
        const output = { stdout: '', stderr: '' };
        expect(runBiome(['scripts/lint-changed.ts'], captureSpawn(output))).toBe(0);
        expect(output.stdout).toContain('Checked 1 file');
    }, 60_000);
});
