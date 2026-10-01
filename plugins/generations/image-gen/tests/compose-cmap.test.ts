import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { imageDimensions, readBytes } from '../src/bytes';
import { glyphCoverage } from '../src/compose/cmap';

/**
 * Pure-parser tests for task 0180 (F616 R4): the cmap coverage check that fails
 * loud before provider spend, and the PNG dimension reader used to assert the
 * declared canvas on composed cards. Both run against the shipped Noto Sans SC
 * bytes — the same bytes the composer typesets with.
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

describe('imageDimensions — PNG IHDR reader (0180; 0182 extends to JPEG/WebP)', () => {
    function pngHeader(width: number, height: number): Uint8Array {
        const bytes = new Uint8Array(24);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
        new DataView(bytes.buffer).setUint32(8, 13); // IHDR length
        bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
        new DataView(bytes.buffer).setUint32(16, width);
        new DataView(bytes.buffer).setUint32(20, height);
        return bytes;
    }

    test('reads the declared canvas from a composed card header', () => {
        expect(imageDimensions(pngHeader(1080, 1440))).toEqual({ width: 1080, height: 1440 });
        expect(imageDimensions(pngHeader(1344, 576))).toEqual({ width: 1344, height: 576 });
    });

    test('a non-PNG byte stream fails loud', () => {
        const jpeg = new Uint8Array(24);
        jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
        expect(() => imageDimensions(jpeg)).toThrow(/not a PNG/);
    });

    test('a truncated PNG fails loud', () => {
        expect(() => imageDimensions(pngHeader(1, 1).slice(0, 20))).toThrow(/not a PNG/);
        expect(() => imageDimensions(new Uint8Array(4))).toThrow(/not a PNG/);
    });
});
