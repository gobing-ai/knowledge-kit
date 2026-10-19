/**
 * Unit tests for the pure compose modules (task 0180, F616):
 * - card.ts: cardHtml document building, HTML escaping, assertCoverage exemptions
 * - cmap.ts: sfnt cmap parsing against the real pinned Noto Sans SC fonts and
 *   synthetic minimal fonts for format 4 / format 12 / error paths.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertCoverage, type CardInput, type ComposeBlock, cardHtml } from '../src/compose/card';
import { glyphCoverage } from '../src/compose/cmap';

const FONTS_DIR = join(import.meta.dir, '../assets/fonts');

const CFG: ComposeBlock = {
    engine: 'text-card',
    safeArea: 72,
    headlineMinPx: 64,
    bodyMinPx: 36,
    illustrationHeight: 640,
    palette: { background: '#FFFFFF', text: '#1F2328', accent: '#FF2442' },
    fonts: { headline: 'NotoSansSC-Bold.otf', body: 'NotoSansSC-Regular.otf' },
};

function input(overrides: Partial<CardInput> = {}): CardInput {
    return {
        headline: '默认标题',
        points: ['要点一', '要点二'],
        role: 'content',
        compose: CFG,
        width: 1080,
        height: 1440,
        ...overrides,
    };
}

function urls(): Map<string, string> {
    return new Map([
        ['NotoSansSC-Bold.otf', 'http://kk-fonts.local/NotoSansSC-Bold.otf'],
        ['NotoSansSC-Regular.otf', 'http://kk-fonts.local/NotoSansSC-Regular.otf'],
    ]);
}

describe('cardHtml', () => {
    test('declares the preset canvas and palette as fixed CSS', () => {
        const html = cardHtml(input(), urls());
        expect(html).toContain('width: 1080px');
        expect(html).toContain('height: 1440px');
        expect(html).toContain('background: #FFFFFF');
        expect(html).toContain('color: #1F2328');
    });

    test('marks every text element with data-field for safe-area measurement', () => {
        const html = cardHtml(input(), urls());
        expect(html).toContain('data-field="headline"');
        expect(html).toContain('data-field="points[0]"');
        expect(html).toContain('data-field="points[1]"');
        expect(html).toContain('id="safe-area-sentinel"');
    });

    test('bullets use bodyMinPx and the text panel inset equals the safe area', () => {
        const html = cardHtml(input(), urls());
        expect(html).toContain('font-size:36px;');
        expect(html).toContain(`padding: ${CFG.safeArea}px`);
    });

    test('headline fit starts at 1.5x headlineMinPx and never below the floor', () => {
        const html = cardHtml(input(), urls());
        expect(html).toContain('font-size: 96px');
        expect(html).toContain('var headlineMinPx = 64');
    });

    // 2026-10-19: the fit loop used to measure a WRAPPING headline, so scrollWidth never exceeded
    // the safe width and the font never stepped down. A 10-char cover headline wrapped to two lines,
    // pushed the points past the safe bottom, and the composer refused every retry (only points are
    // rewritable) — 4 cards unrendered and the whole episode unpublished. The measurement must be
    // unwrapped; wrapping is restored afterwards for a headline that cannot fit even at the floor.
    test('headline fit measures the unwrapped width, then restores wrapping', () => {
        const html = cardHtml(input(), urls());
        const measure = html.indexOf("headline.style.whiteSpace = 'nowrap'");
        const loop = html.indexOf('headline.scrollWidth <= safeWidth');
        const restore = html.indexOf("headline.style.whiteSpace = 'normal'");
        expect(measure).toBeGreaterThan(-1);
        expect(loop).toBeGreaterThan(measure);
        expect(restore).toBeGreaterThan(loop);
    });

    test('embeds the illustration as a data URL when bytes are present', () => {
        const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
        const html = cardHtml(input({ illustration: { bytes, mime: 'image/png' } }), urls());
        const b64 = Buffer.from(bytes).toString('base64');
        expect(html).toContain(`<img src="data:image/png;base64,${b64}"`);
    });

    test('renders a placeholder band and no img when the probe has no illustration', () => {
        const html = cardHtml(input(), urls());
        expect(html).not.toContain('<img');
        expect(html).toContain('illustration-band');
    });

    test('escapes HTML-sensitive characters in headline and points', () => {
        const html = cardHtml(input({ headline: '<a>&"', points: ['<script>'] }), urls());
        expect(html).toContain('&lt;a&gt;&amp;&quot;');
        expect(html).toContain('&lt;script&gt;');
    });

    test('references the compose fonts by their provided URLs', () => {
        const html = cardHtml(input(), urls());
        expect(html).toContain("url('http://kk-fonts.local/NotoSansSC-Bold.otf')");
        expect(html).toContain("url('http://kk-fonts.local/NotoSansSC-Regular.otf')");
    });
});

describe('assertCoverage', () => {
    const narrow = (cps: number[]) => {
        const set = new Set(cps);
        return (cp: number) => set.has(cp);
    };
    const fonts = new Map<string, (cp: number) => boolean>([
        ['NotoSansSC-Bold.otf', narrow([0x9ed1])], // 黑
        ['NotoSansSC-Regular.otf', narrow([0x4e00])], // 一
    ]);

    test('passes when every headline and point character is covered', () => {
        const inp = input({ headline: '黑', points: ['一', ''] });
        expect(() => assertCoverage(inp, fonts)).not.toThrow();
    });

    test('fails loud naming the field, code point, glyph, and headline font', () => {
        const inp = input({ headline: '黑😀' });
        expect(() => assertCoverage(inp, fonts)).toThrow(/headline has U\+1F600 '😀' not covered by NotoSansSC-Bold/);
    });

    test('fails loud naming points[i] against the body font', () => {
        const inp = input({ headline: '黑', points: ['一乙'] });
        expect(() => assertCoverage(inp, fonts)).toThrow(
            /points\[0\] has U\+4E59 '乙' not covered by NotoSansSC-Regular/,
        );
    });

    test('exempts whitespace, newlines, and line separators', () => {
        const inp = input({ headline: '黑 \n\t\u00A0\u3000黑', points: ['一 '] });
        expect(() => assertCoverage(inp, fonts)).not.toThrow();
    });

    test('fails loud when a declared compose font is not loaded', () => {
        const missing = new Map([['NotoSansSC-Bold.otf', narrow([0x9ed1])]]);
        expect(() => assertCoverage(input(), missing)).toThrow(
            "compose: body font 'NotoSansSC-Regular.otf' not loaded",
        );
    });
});

/**
 * Minimal sfnt builders. Layout: 12-byte header, one table record, cmap table
 * (version, numSubtables, encoding records, subtable bytes).
 */
function sfnt(
    cmapBody: Uint8Array,
    encodings: Array<{ platform: number; encoding: number; offset: number }>,
): Uint8Array {
    const numTables = 1;
    const headerLen = 12 + numTables * 16;
    const cmapOffset = headerLen;
    const total = cmapOffset + cmapBody.length;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x00010000, false); // TrueType magic
    dv.setUint16(4, numTables, false);
    dv.setUint16(12, 0x636d, false); // 'cm'
    dv.setUint16(14, 0x6170, false); // 'ap'
    dv.setUint32(20, cmapOffset, false);
    dv.setUint32(24, cmapBody.length, false);
    new Uint8Array(buf.buffer).set(cmapBody, cmapOffset);
    const cdv = new DataView(buf.buffer, cmapOffset);
    cdv.setUint16(0, 0, false); // version
    cdv.setUint16(2, encodings.length, false);
    encodings.forEach((e, i) => {
        const base = 4 + i * 8;
        cdv.setUint16(base, e.platform, false);
        cdv.setUint16(base + 2, e.encoding, false);
        cdv.setUint32(base + 4, e.offset, false);
    });
    return buf;
}

/** cmap body with one format 4 subtable covering [0x41, 0x5A] via idDelta. */
function fmt4Body(platform = 3): Uint8Array {
    const segCount = 2;
    const subtableOffset = 4 + 8;
    const body = new Uint8Array(subtableOffset + 14 + segCount * 8 + 2);
    const dv = new DataView(body.buffer);
    dv.setUint16(0, 0, false);
    dv.setUint16(2, 1, false); // numSubtables
    dv.setUint16(4, platform, false);
    dv.setUint16(6, platform === 3 ? 1 : 0, false);
    dv.setUint32(8, 12, false); // subtable at cmap offset 12
    const st = subtableOffset;
    dv.setUint16(st, 4, false); // format 4
    dv.setUint16(st + 2, 32, false); // length
    dv.setUint16(st + 6, segCount * 2, false);
    const endBase = st + 14;
    dv.setUint16(endBase, 0x5a, false); // segment 1 end
    dv.setUint16(endBase + 2, 0xffff, false);
    dv.setUint16(endBase + segCount * 2 + 2, 0x41, false); // segment 1 start
    dv.setUint16(endBase + segCount * 2 + 4, 0xffff, false);
    const deltaBase = endBase + segCount * 4 + 2;
    dv.setUint16(deltaBase, 1, false); // idDelta: 'A'(0x41)+1=0x42 ≠ 0 → covered
    const rangeBase = deltaBase + segCount * 2;
    dv.setUint16(rangeBase, 0, false);
    dv.setUint16(rangeBase + 2, 0, false);
    return body;
}

/** cmap body with one format 12 subtable covering U+4E00 (一) as glyph 5. */
function fmt12Body(platform = 0): Uint8Array {
    const subtableOffset = 4 + 8 + 4; // pad to 16 for alignment simplicity
    const body = new Uint8Array(subtableOffset + 16 + 12);
    const dv = new DataView(body.buffer);
    dv.setUint16(0, 0, false);
    dv.setUint16(2, 1, false);
    dv.setUint16(4, platform, false);
    dv.setUint16(6, 4, false); // Unicode variation sequence-compatible? platform 0/4
    dv.setUint32(8, 16, false); // subtable offset
    const st = subtableOffset;
    dv.setUint16(st, 12, false); // format 12
    dv.setUint32(st + 12, 1, false); // numGroups
    const g = st + 16;
    dv.setUint32(g, 0x4e00, false);
    dv.setUint32(g + 4, 0x4e00, false);
    dv.setUint32(g + 8, 5, false);
    return body;
}

describe('glyphCoverage', () => {
    test('real pinned Noto Sans SC Bold covers CJK and Latin, not emoji', () => {
        const font = readFileSync(join(FONTS_DIR, 'NotoSansSC-Bold.otf'));
        const covers = glyphCoverage(new Uint8Array(font));
        expect(covers('中'.codePointAt(0) as number)).toBeTrue();
        expect(covers('A'.charCodeAt(0))).toBeTrue();
        expect(covers(0x1f600)).toBeFalse();
    });

    test('prefers format 12 when both subtable kinds are present', () => {
        // Build a cmap with two encoding records sharing one body space: fmt12 at 16.
        const f4 = fmt4Body();
        const f12 = fmt12Body();
        const body = new Uint8Array(4 + 2 * 8 + f4.length + f12.length + 16);
        const dv = new DataView(body.buffer);
        dv.setUint16(0, 0, false);
        dv.setUint16(2, 2, false);
        dv.setUint16(4, 3, false); // Windows
        dv.setUint16(6, 1, false);
        dv.setUint32(8, 20, false); // fmt4 subtable offset (after header+records, padded)
        dv.setUint16(12, 3, false);
        dv.setUint16(14, 10, false); // platform 3 encoding 10 → skipped for fmt4
        dv.setUint32(16, 20 + f4.length, false); // fmt12 after fmt4
        body.set(f4.subarray(12), 20); // fmt4 subtable bytes
        body.set(f12.subarray(16), 20 + f4.length); // fmt12 subtable bytes
        const font = sfnt(body, [
            { platform: 3, encoding: 1, offset: 20 },
            { platform: 3, encoding: 10, offset: 20 + f4.length },
        ]);
        const covers = glyphCoverage(font);
        expect(covers(0x4e00)).toBeTrue(); // only fmt12 groups cover → proves preference
        expect(covers(0x41)).toBeFalse(); // fmt4 segments ignored when fmt12 present
    });

    test('format 4 (platform 0) fallback covers only its segments', () => {
        const font = sfnt(fmt4Body(0), [{ platform: 0, encoding: 3, offset: 12 }]);
        const covers = glyphCoverage(font);
        expect(covers(0x41)).toBeTrue();
        expect(covers(0x7a)).toBeFalse(); // outside [0x41,0x5A]
        expect(covers(0x4e00)).toBeFalse(); // not in segments
    });

    test('rejects non-sfnt bytes, headerless fonts, and fonts without a usable cmap', () => {
        expect(() => glyphCoverage(new Uint8Array(11))).toThrow(/too small for sfnt header/);
        const bad = new Uint8Array(64);
        new DataView(bad.buffer).setUint32(0, 0xdeadbeef, false);
        expect(() => glyphCoverage(bad)).toThrow(/not a valid sfnt font/);
        const noCmap = new Uint8Array(64);
        new DataView(noCmap.buffer).setUint32(0, 0x00010000, false);
        new DataView(noCmap.buffer).setUint16(4, 0, false);
        expect(() => glyphCoverage(noCmap)).toThrow(/cmap table not found/);
        const emptyCmap = sfnt(new Uint8Array(4), []);
        expect(() => glyphCoverage(emptyCmap)).toThrow(/no usable cmap subtable/);
    });
});
