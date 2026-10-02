import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { readBytes } from '../src/bytes';
import { glyphCoverage } from '../src/compose/cmap';

/**
 * Pure-parser tests for task 0180 (F616 R4): the cmap coverage check that fails
 * loud before provider spend. Both run against the shipped Noto Sans SC bytes —
 * the same bytes the composer typesets with. (The imageDimensions reader moved
 * to tests/bytes.test.ts in 0182, which extended it to JPEG/WebP + null.)
 */

const FONTS_DIR = join(import.meta.dir, '..', 'assets', 'fonts');

async function shippedFont(name: string): Promise<Uint8Array> {
    return readBytes(join(FONTS_DIR, name));
}

describe('glyphCoverage — cmap format 12/4 over the shipped Noto Sans SC (0180 R4)', () => {
    test('CJK, ASCII and full-width punctuation are covered in both shipped weights', async () => {
        for (const name of ['NotoSansSC-Regular.otf', 'NotoSansSC-Bold.otf']) {
            const covers = glyphCoverage(await shippedFont(name));
            for (const ch of ['微', '服', '务', '拆', '分', '核', '心', '：', '、', '「', '」']) {
                expect(covers(ch.codePointAt(0) as number), `${name} covers '${ch}'`).toBeTrue();
            }
            for (const ch of ['A', 'z', '0', '9', ' ', '.', ',']) {
                expect(covers(ch.codePointAt(0) as number), `${name} covers '${ch}'`).toBeTrue();
            }
        }
    });

    test('an emoji outside the font is not covered', async () => {
        const covers = glyphCoverage(await shippedFont('NotoSansSC-Bold.otf'));
        expect(covers(0x1f600)).toBeFalse(); // 😀 U+1F600
        expect(covers(0xe000)).toBeFalse(); // private-use area
    });

    test('a truncated font throws instead of answering', async () => {
        const font = await shippedFont('NotoSansSC-Regular.otf');
        expect(() => glyphCoverage(font.slice(0, 64))).toThrow();
        expect(() => glyphCoverage(font.slice(0, 8))).toThrow();
    });
});
