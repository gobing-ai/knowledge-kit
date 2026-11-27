/**
 * G84/0444 — the line diff behind an `edit-artifact` preview.
 *
 * Failure list written before the code: an unchanged pair must render nothing (a preview that always
 * shows a hunk trains the operator to ignore it); empty sides must not emit a phantom line; a
 * missing trailing newline must be marked rather than silently added; and a single-line change must
 * keep the surrounding lines out of the hunk.
 */

import { describe, expect, it } from 'bun:test';
import { unifiedDiff } from '../../src/board/text-diff';

describe('unifiedDiff', () => {
    it('renders nothing for an unchanged pair', () => {
        expect(unifiedDiff('a\nb\n', 'a\nb\n', 'x.md', 'x.md')).toBe('');
        expect(unifiedDiff('', '', 'x.md', 'x.md')).toBe('');
    });

    it('renders an add-only hunk for an empty before side', () => {
        expect(unifiedDiff('', 'one\ntwo\n', 'x.md', 'x.md')).toBe(
            ['--- a/x.md', '+++ b/x.md', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n'),
        );
    });

    it('renders a remove-only hunk for an empty after side', () => {
        expect(unifiedDiff('one\n', '', 'x.md', 'x.md')).toBe(
            ['--- a/x.md', '+++ b/x.md', '@@ -1,1 +0,0 @@', '-one', ''].join('\n'),
        );
    });

    it('reports one changed line without repeating the unchanged neighbours', () => {
        const diff = unifiedDiff('a\nb\nc\n', 'a\nB\nc\n', 'x.md', 'x.md');
        expect(diff).toContain('@@ -2,1 +2,1 @@');
        expect(diff).toContain('-b');
        expect(diff).toContain('+B');
        expect(diff).not.toContain('-a');
        expect(diff).not.toContain('+c');
    });

    it('marks a side that has no trailing newline', () => {
        const diff = unifiedDiff('a\nb', 'a\nb\n', 'x.md', 'x.md');
        expect(diff).toContain('\\ No newline at end of file');
        expect(diff).toContain('-b');
        expect(diff).toContain('+b');
    });
});
