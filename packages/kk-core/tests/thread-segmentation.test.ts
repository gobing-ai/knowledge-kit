import { describe, expect, it } from 'bun:test';
import { splitThreadContent } from '../src/thread-segmentation';

describe('thread segmentation', () => {
    it('handles empty input', () => {
        const res = splitThreadContent('', { maxUnits: 100, unit: 'unicode_code_points' });
        expect(res.segments).toEqual(['']);
        expect(res.reconstructed).toBe(true);
        expect(res.characterCounts).toEqual([0]);
    });

    it('returns single segment when text fits within maxUnits', () => {
        const text = 'Hello world, this is a short post.';
        const res = splitThreadContent(text, { maxUnits: 100, unit: 'unicode_code_points' });
        expect(res.segments).toEqual([text]);
        expect(res.reconstructed).toBe(true);
        expect(res.characterCounts[0]).toBe(text.length);
    });

    it('splits longer text and strictly preserves reconstructed text', () => {
        const text = 'First sentence here. Second sentence follows. Third sentence is also here. And fourth sentence.';
        const res = splitThreadContent(text, { maxUnits: 35, unit: 'unicode_code_points' });
        expect(res.segments.length).toBeGreaterThan(1);
        expect(res.segments.join('')).toBe(text);
        expect(res.reconstructed).toBe(true);
        for (const seg of res.segments) {
            expect(seg.length).toBeLessThanOrEqual(35);
        }
    });

    it('protects URLs from being broken across segment boundaries', () => {
        const text =
            'Introductory text before the link: https://example.com/very/long/url/that/should/not/be/broken. Then more text.';
        const res = splitThreadContent(text, { maxUnits: 80, unit: 'unicode_code_points' });
        expect(res.segments.join('')).toBe(text);
        expect(res.reconstructed).toBe(true);
        const fullUrl = 'https://example.com/very/long/url/that/should/not/be/broken';
        const hasUrlIntact = res.segments.some((seg) => seg.includes(fullUrl));
        expect(hasUrlIntact).toBe(true);
    });
});
