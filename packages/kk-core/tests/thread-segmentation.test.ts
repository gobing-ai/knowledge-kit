import { describe, expect, it } from 'bun:test';
import { splitThreadContent } from '../src/thread-segmentation';

describe('splitThreadContent', () => {
    it('returns a single empty segment for empty input', () => {
        expect(splitThreadContent('', { maxUnits: 10, unit: 'unicode_code_points' })).toEqual({
            segments: [''],
            reconstructed: true,
            characterCounts: [0],
        });
    });

    it('coerces null input to empty', () => {
        const result = splitThreadContent(null as unknown as string, { maxUnits: 10, unit: 'utf16_code_units' });
        expect(result.segments).toEqual(['']);
        expect(result.reconstructed).toBe(true);
    });

    it('keeps text whole when it fits the limit, counting units per the unit mode', () => {
        const text = 'a🚀b';
        expect(splitThreadContent(text, { maxUnits: 3, unit: 'unicode_code_points' })).toEqual({
            segments: [text],
            reconstructed: true,
            characterCounts: [3],
        });
        expect(splitThreadContent(text, { maxUnits: 4, unit: 'utf16_code_units' }).characterCounts).toEqual([4]);
    });

    it('prefers paragraph breaks and preserves the original text exactly', () => {
        const result = splitThreadContent('aaa\n\nbbbb', { maxUnits: 3, unit: 'unicode_code_points' });
        expect(result.segments).toEqual(['aaa', '\n\n', 'bbb', 'b']);
        expect(result.reconstructed).toBe(true);
        expect(result.segments.join('')).toBe('aaa\n\nbbbb');
        expect(result.characterCounts).toEqual([3, 2, 3, 1]);
    });

    it('splits on sentence-ending punctuation', () => {
        const result = splitThreadContent('第一句。第二句。', { maxUnits: 4, unit: 'unicode_code_points' });
        expect(result.segments).toEqual(['第一句。', '第二句。']);
        expect(result.reconstructed).toBe(true);
    });

    it('splits on single newlines when no paragraph break fits', () => {
        const result = splitThreadContent('aa\nbb\ncc', { maxUnits: 3, unit: 'unicode_code_points' });
        expect(result.segments[0]).toBe('aa\n');
        expect(result.reconstructed).toBe(true);
    });

    it('splits on spaces for weighted accounting', () => {
        const result = splitThreadContent('ab cd ef', { maxUnits: 5, unit: 'weighted' });
        expect(result.segments).toEqual(['ab ', 'cd ef']);
        expect(result.characterCounts).toEqual([3, 5]);
    });

    it('handles CRLF paragraphs via invariant reconstruction', () => {
        const text = 'a\r\n\r\nb';
        const result = splitThreadContent(text, { maxUnits: 1, unit: 'unicode_code_points' });
        expect(result.segments.length).toBeGreaterThan(1);
        expect(result.reconstructed).toBe(true);
        expect(result.segments.join('')).toBe(text);
    });

    it('keeps a URL intact when a break after it fits', () => {
        // Weighted accounting: any URL counts as exactly 23 units.
        const text = 'hi https://example.com/xyz';
        const result = splitThreadContent(text, { maxUnits: 25, unit: 'weighted' });
        expect(result.segments).toEqual(['hi ', 'https://example.com/xyz']);
        expect(result.characterCounts).toEqual([3, 23]);
        expect(result.reconstructed).toBe(true);
    });

    it('never breaks inside a URL when forced splitting falls back to binary search', () => {
        const text = 'ab https://example.com/xyz cd';
        const result = splitThreadContent(text, { maxUnits: 27, unit: 'unicode_code_points' });
        expect(result.reconstructed).toBe(true);
        for (const segment of result.segments) {
            // A mid-URL cut would yield a proper non-empty substring of the URL.
            if (segment.length > 0 && 'https://example.com/xyz'.includes(segment)) {
                expect(segment).toBe('https://example.com/xyz');
            }
        }
        expect(result.segments.join('')).toBe(text);
    });

    it('hard-splits a URL longer than the limit into full-size segments instead of single code points', () => {
        const url = 'https://example.com/a-very-long-path';
        const result = splitThreadContent(url, { maxUnits: 10, unit: 'unicode_code_points' });
        expect(result.segments.join('')).toBe(url);
        expect(result.characterCounts).toEqual([10, 10, 10, 6]);
    });

    it('splits astral characters on code-point boundaries without lone surrogates', () => {
        const result = splitThreadContent('🚀🚀🚀🚀', { maxUnits: 3, unit: 'unicode_code_points' });
        expect(result.segments).toEqual(['🚀🚀🚀', '🚀']);
        expect(result.reconstructed).toBe(true);
        for (const segment of result.segments) {
            // Every code point in a segment is a whole rocket emoji — no lone surrogates.
            expect(segment).toMatch(/^(?:\uD83D\uDE80)*$/u);
        }
    });

    it('splits unbreakable text at hard limits, never returning an over-limit segment', () => {
        const result = splitThreadContent('abcdefgh', { maxUnits: 3, unit: 'unicode_code_points' });
        expect(result.segments.join('')).toBe('abcdefgh');
        for (const count of result.characterCounts) {
            expect(count).toBeLessThanOrEqual(3);
        }
        expect(result.reconstructed).toBe(true);
    });
});
