import { describe, expect, test } from 'bun:test';
import { imageDimensions } from '../src/bytes';

/**
 * Task 0182 (F618 plan item 1) — the header-only dimension reader over the three
 * delivery formats providers actually return. Failure modes enumerated first: a
 * known-size fixture of each format must parse to its exact canvas; anything
 * truncated, mis-signed or unknown must answer `null` (the R3 WARN-with-omitted-
 * dims path), never throw and never guess.
 */

/** 24-byte PNG header (signature + IHDR) carrying the given canvas. */
function pngBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13); // IHDR data length
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

/** SOI + one SOFn segment (marker selectable) carrying the given canvas. */
function jpegBytes(sofMarker: number, width: number, height: number): Uint8Array {
    // SOI(2) marker(2) length(2) precision(1) height(2) width(2) channels(1)
    const bytes = new Uint8Array(13);
    const view = new DataView(bytes.buffer);
    bytes.set([0xff, 0xd8], 0);
    bytes.set([0xff, sofMarker], 2);
    view.setUint16(4, 11, false); // segment length includes itself
    bytes[6] = 8; // sample precision
    view.setUint16(7, height, false);
    view.setUint16(9, width, false);
    bytes[11] = 3; // components
    return bytes;
}

/** RIFF/WEBP wrapper around one chunk with the given FourCC and body. */
function webpBytes(chunkId: string, chunkBody: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(12 + 8 + chunkBody.byteLength);
    const view = new DataView(bytes.buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // 'RIFF'
    view.setUint32(4, bytes.byteLength - 8, true);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // 'WEBP'
    bytes.set(
        [...chunkId].map((ch) => ch.charCodeAt(0)),
        12,
    );
    view.setUint32(16, chunkBody.byteLength, true);
    bytes.set(chunkBody, 20);
    return bytes;
}

function webpLossyChunk(width: number, height: number): Uint8Array {
    const body = new Uint8Array(10);
    body.set([0x30, 0x01, 0x00], 0); // frame tag
    body.set([0x9d, 0x01, 0x2a], 3); // sync code
    const view = new DataView(body.buffer);
    view.setUint16(6, width, true);
    view.setUint16(8, height, true);
    return body;
}

function webpLosslessChunk(width: number, height: number): Uint8Array {
    const body = new Uint8Array(5);
    body[0] = 0x2f; // VP8L signature
    new DataView(body.buffer).setUint32(1, (width - 1) | ((height - 1) << 14), true);
    return body;
}

function webpExtendedChunk(width: number, height: number): Uint8Array {
    const body = new Uint8Array(10); // 4 flag/reserved + 24-bit width-1 + 24-bit height-1
    body[4] = (width - 1) & 0xff;
    body[5] = ((width - 1) >> 8) & 0xff;
    body[6] = ((width - 1) >> 16) & 0xff;
    body[7] = (height - 1) & 0xff;
    body[8] = ((height - 1) >> 8) & 0xff;
    body[9] = ((height - 1) >> 16) & 0xff;
    return body;
}

describe('imageDimensions — PNG IHDR (0180 contract, 0182 null semantics)', () => {
    test('reads the declared canvas from the header', () => {
        expect(imageDimensions(pngBytes(1080, 1440))).toEqual({ width: 1080, height: 1440 });
        expect(imageDimensions(pngBytes(1344, 576))).toEqual({ width: 1344, height: 576 });
        // Real provider fixture: the measured MiniMax xhs-card regression delivery.
        expect(imageDimensions(pngBytes(864, 1152))).toEqual({ width: 864, height: 1152 });
    });

    test('a truncated or mis-signed PNG parses to null, not a throw', () => {
        expect(imageDimensions(pngBytes(1, 1).slice(0, 20))).toBeNull();
        expect(imageDimensions(new Uint8Array(4))).toBeNull();
        const badIhdr = pngBytes(1, 1);
        new DataView(badIhdr.buffer).setUint32(8, 14); // IHDR length must be 13
        expect(imageDimensions(badIhdr)).toBeNull();
    });
});

describe('imageDimensions — JPEG SOFn (0182)', () => {
    test('reads baseline and progressive frames', () => {
        expect(imageDimensions(jpegBytes(0xc0, 1080, 1440))).toEqual({ width: 1080, height: 1440 });
        expect(imageDimensions(jpegBytes(0xc2, 864, 1152))).toEqual({ width: 864, height: 1152 });
    });

    test('skips length-bearing non-SOF segments (DHT) before the frame header', () => {
        // SOI + DHT segment (marker, declared length 6, 4 payload bytes) + SOF0 without its SOI.
        const bytes = new Uint8Array(2 + 8 + 11);
        const view = new DataView(bytes.buffer);
        bytes.set([0xff, 0xd8], 0); // SOI
        bytes.set([0xff, 0xc4], 2); // DHT marker
        view.setUint16(4, 6, false); // segment length (includes itself)
        bytes.set(jpegBytes(0xc0, 1152, 864).subarray(2), 10); // SOF0 segment follows the DHT
        expect(imageDimensions(bytes)).toEqual({ width: 1152, height: 864 });
    });

    test('a JPEG whose SOF never appears parses to null', () => {
        // SOI + APP0 with a declared length, then the buffer ends.
        const bytes = new Uint8Array(32);
        bytes.set([0xff, 0xd8], 0);
        bytes.set([0xff, 0xe0], 2);
        new DataView(bytes.buffer).setUint16(4, 16, false);
        expect(imageDimensions(bytes)).toBeNull();
    });

    test('a marker chain that ends cleanly before any SOF parses to null', () => {
        // SOI + APP0 whose declared segment consumes the remainder exactly.
        const bytes = new Uint8Array(14);
        bytes.set([0xff, 0xd8], 0);
        bytes.set([0xff, 0xe0], 2);
        new DataView(bytes.buffer).setUint16(4, 10, false);
        expect(imageDimensions(bytes)).toBeNull();
    });

    test('a desynchronised marker chain parses to null', () => {
        const bytes = jpegBytes(0xc0, 8, 8);
        bytes[5] = 0x00; // corrupt the segment length
        bytes[6] = 0x00;
        expect(imageDimensions(bytes)).toBeNull();
    });
});

describe('imageDimensions — WebP VP8/VP8L/VP8X (0182)', () => {
    test('reads the lossy VP8 canvas from the frame header', () => {
        expect(imageDimensions(webpBytes('VP8 ', webpLossyChunk(1080, 1440)))).toEqual({
            width: 1080,
            height: 1440,
        });
    });

    test('reads the lossless VP8L canvas (14-bit width-1/height-1)', () => {
        expect(imageDimensions(webpBytes('VP8L', webpLosslessChunk(864, 1152)))).toEqual({
            width: 864,
            height: 1152,
        });
    });

    test('reads the extended VP8X canvas (24-bit width-1/height-1)', () => {
        expect(imageDimensions(webpBytes('VP8X', webpExtendedChunk(1344, 576)))).toEqual({
            width: 1344,
            height: 576,
        });
    });

    test('a lossy VP8 chunk with a broken sync code parses to null', () => {
        const chunk = webpLossyChunk(1080, 1440);
        chunk[4] = 0x00; // corrupt the 0x9d 0x01 0x2a sync code
        expect(imageDimensions(webpBytes('VP8 ', chunk))).toBeNull();
    });

    test('a non-RIFF or chunkless buffer parses to null', () => {
        expect(imageDimensions(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBeNull(); // 'RIFF' only
        expect(imageDimensions(webpBytes('ANIM', new Uint8Array(16)))).toBeNull(); // no size chunk
    });
});

describe('imageDimensions — unknown bytes answer null (R3)', () => {
    test('junk provider bytes parse to null so the artifact omits dimensions', () => {
        expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
        expect(imageDimensions(new Uint8Array(0))).toBeNull();
    });
});
