import { describe, expect, it } from 'bun:test';
import { countContentUnits, PLATFORM_CONTENT_LIMITS, splitThreadContent, validateContentLimits } from '../src';

describe('Content Limits & Counting', () => {
    describe('countContentUnits', () => {
        it('calculates utf16_code_units correctly', () => {
            expect(countContentUnits('hello', 'utf16_code_units')).toBe(5);
            expect(countContentUnits('你好', 'utf16_code_units')).toBe(2);
            // Emoji 🚀 is surrogate pair, length = 2 in UTF-16
            expect(countContentUnits('🚀', 'utf16_code_units')).toBe(2);
            expect(countContentUnits('hello 🚀 世界', 'utf16_code_units')).toBe(11);
        });

        it('calculates unicode_code_points correctly', () => {
            expect(countContentUnits('hello', 'unicode_code_points')).toBe(5);
            expect(countContentUnits('你好', 'unicode_code_points')).toBe(2);
            // Emoji 🚀 is 1 Unicode code point
            expect(countContentUnits('🚀', 'unicode_code_points')).toBe(1);
            expect(countContentUnits('hello 🚀 世界', 'unicode_code_points')).toBe(10);
        });

        it('calculates weighted character count (Twitter / X accounting)', () => {
            // ASCII single-weight
            expect(countContentUnits('hello', 'weighted')).toBe(5);
            // CJK double-weight
            expect(countContentUnits('你好', 'weighted')).toBe(4);
            // Mixed CJK + ASCII
            expect(countContentUnits('hello 世界', 'weighted')).toBe(5 + 1 + 4);
            // URL counts as 23 characters regardless of length
            const textWithUrl = 'Check this: https://example.com/very/long/path/to/an/article';
            // 'Check this: ' is 12 chars + URL 23 = 35
            expect(countContentUnits(textWithUrl, 'weighted')).toBe(35);
        });

        it('calculates xiaohongshu_title_weighted count', () => {
            // 2 English chars count as 1, CJK counts as 1
            expect(countContentUnits('你好', 'xiaohongshu_title_weighted')).toBe(2);
            expect(countContentUnits('test', 'xiaohongshu_title_weighted')).toBe(2);
        });

        it('handles empty string gracefully', () => {
            expect(countContentUnits('', 'utf16_code_units')).toBe(0);
            expect(countContentUnits('', 'unicode_code_points')).toBe(0);
            expect(countContentUnits('', 'weighted')).toBe(0);
        });

        it('falls back to length for unmapped units', () => {
            // @ts-expect-error testing invalid unit fallback
            expect(countContentUnits('test', 'unknown_unit')).toBe(4);
        });
    });

    describe('validateContentLimits', () => {
        it('approves content within platform limits', () => {
            const result = validateContentLimits({
                platform: 'threads',
                contentType: 'dynamic',
                body: 'Short threads post within 500 characters',
            });
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('detects body limit violations on Threads (500 unicode code points)', () => {
            const longBody = 'A'.repeat(501);
            const result = validateContentLimits({
                platform: 'threads',
                contentType: 'dynamic',
                body: longBody,
            });
            expect(result.valid).toBe(false);
            expect(result.errors[0]?.field).toBe('body');
            expect(result.errors[0]?.max).toBe(500);
            expect(result.errors[0]?.current).toBe(501);
            expect(result.errors[0]?.exceededBy).toBe(1);
        });

        it('detects title limit violations on Xiaohongshu (20 weighted title units)', () => {
            const longTitle = '一二三四五六七八九十一二三四五六七八九十一'; // 21 CJK chars
            const result = validateContentLimits({
                platform: 'xiaohongshu',
                contentType: 'imageText',
                title: longTitle,
            });
            expect(result.valid).toBe(false);
            expect(result.errors[0]?.field).toBe('title');
            expect(result.errors[0]?.max).toBe(20);
        });

        it('detects tag count limit violations', () => {
            const resultVideo = validateContentLimits({
                platform: 'douyin',
                contentType: 'shortVideo',
                tags: ['t1', 't2', 't3', 't4', 't5', 't6'], // limit is 5
            });
            expect(resultVideo.valid).toBe(false);
            expect(resultVideo.errors[0]?.field).toBe('tags');
            expect(resultVideo.errors[0]?.max).toBe(5);

            const resultImageText = validateContentLimits({
                platform: 'xiaohongshu',
                contentType: 'imageText',
                tags: Array.from({ length: 11 }, (_, i) => `tag${i}`), // limit is 10
            });
            expect(resultImageText.valid).toBe(false);
            expect(resultImageText.errors[0]?.field).toBe('tags');
            expect(resultImageText.errors[0]?.max).toBe(10);
        });

        it('exposes immutable PLATFORM_CONTENT_LIMITS dictionary', () => {
            expect(PLATFORM_CONTENT_LIMITS.schemaVersion).toBe(5);
            expect(PLATFORM_CONTENT_LIMITS.tagLimits.imageText.xiaohongshu).toBe(10);
            expect(PLATFORM_CONTENT_LIMITS.tagLimits.imageText.douyin).toBe(5);
            expect(PLATFORM_CONTENT_LIMITS.tagLimits.imageText.weixin).toBe(1);
        });
    });
});

describe('Thread Segmentation (Invariant Engine)', () => {
    it('returns single segment when text is within limit', () => {
        const text = 'Short post within limit.';
        const result = splitThreadContent(text, { maxUnits: 500, unit: 'unicode_code_points' });
        expect(result.segments).toEqual([text]);
        expect(result.reconstructed).toBe(true);
    });

    it('splits text deterministically at paragraph boundaries', () => {
        const p1 = 'First paragraph with some text.';
        const p2 = 'Second paragraph with additional information.';
        const text = `${p1}\n\n${p2}`;
        const result = splitThreadContent(text, { maxUnits: 35, unit: 'unicode_code_points' });
        expect(result.segments.length).toBeGreaterThan(1);
        // INVARIANT: Concatenated segments MUST strictly equal input
        expect(result.segments.join('')).toBe(text);
        expect(result.reconstructed).toBe(true);
    });

    it('splits text deterministically at sentence punctuation', () => {
        const s1 = '第一句话很长很长。';
        const s2 = '第二句话也很长很长。';
        const text = `${s1}${s2}`;
        const result = splitThreadContent(text, { maxUnits: 12, unit: 'unicode_code_points' });
        expect(result.segments.length).toBe(2);
        expect(result.segments[0]).toBe(s1);
        expect(result.segments[1]).toBe(s2);
        expect(result.segments.join('')).toBe(text);
        expect(result.reconstructed).toBe(true);
    });

    it('protects URLs from being broken across segment boundaries', () => {
        const text =
            'Here is an important link: https://knowledge-kit.gobing.ai/docs/reference/guide and more trailing text.';
        const result = splitThreadContent(text, { maxUnits: 65, unit: 'unicode_code_points' });
        expect(result.reconstructed).toBe(true);
        expect(result.segments.join('')).toBe(text);
        // Ensure the full URL exists unbroken in one of the segments
        const hasFullUrl = result.segments.some((seg) =>
            seg.includes('https://knowledge-kit.gobing.ai/docs/reference/guide'),
        );
        expect(hasFullUrl).toBe(true);
    });

    it('enforces strict text invariant on long unstructured text without punctuation', () => {
        const longText = 'abcdefghijklmnopqrstuvwxyz'.repeat(10);
        const result = splitThreadContent(longText, { maxUnits: 50, unit: 'unicode_code_points' });
        expect(result.reconstructed).toBe(true);
        expect(result.segments.join('')).toBe(longText);
        for (const seg of result.segments) {
            expect(countContentUnits(seg, 'unicode_code_points')).toBeLessThanOrEqual(50);
        }
    });

    it('handles empty input gracefully', () => {
        const result = splitThreadContent('', { maxUnits: 500, unit: 'unicode_code_points' });
        expect(result.segments).toEqual(['']);
        expect(result.reconstructed).toBe(true);
    });
});
