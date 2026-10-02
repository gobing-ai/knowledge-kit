import { readFile, writeFile } from 'node:fs/promises';

/**
 * no-direct-fs-io seam exemption (recorded in .spur/rules/strict/runtime-boundaries.yaml):
 * the ts-runtime FileSystem seam is text-only, and image generation is a binary
 * byte-writer by definition — same class as voice-gen's WAV writer and podcast-pub's
 * upload reader. Every path here is produced by `artifactPath`, so a hostile provider
 * extension or stem cannot escape `--out`'s directory.
 */

/** Write generated image bytes beside `--out` (0107 R1). */
export async function writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await writeFile(path, bytes);
}

/** Read a reference image for image-to-image requests (0105 legacy — local paths become data URIs). */
export async function readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(path));
}

/**
 * Task 0180 (PNG) + task 0182 (JPEG/WebP, `null` contract) — pure header-only dimension
 * reader. Reads `width`/`height` from PNG (IHDR), JPEG (SOF0–SOF15 except DHT/DAC/JPG)
 * and WebP (VP8 lossy, VP8L lossless, VP8X extended) bytes; no decode. Returns `null`
 * when the bytes cannot be parsed — the caller decides whether that is fatal (the compose
 * canvas assertion) or a WARN with dimensions omitted (artifact recording, R3: the bytes
 * are already paid for).
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (isPng(bytes)) return pngDimensions(bytes);
    if (isJpeg(bytes)) return jpegDimensions(bytes);
    if (isWebp(bytes)) return webpDimensions(bytes);
    return null;
}

function isPng(b: Uint8Array): boolean {
    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.byteLength < 24) return false;
    for (let i = 0; i < 8; i++) {
        if (b[i] !== PNG_SIG[i]) return false;
    }
    return true;
}

function pngDimensions(b: Uint8Array): { width: number; height: number } | null {
    // IHDR chunk: offset 8 = chunk data length (must be 13), offset 12 = 'IHDR' tag.
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const ihdrLength = view.getUint32(8, false);
    if (ihdrLength !== 13 || view.getUint32(12, false) !== 0x49484452) {
        return null;
    }
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

function isJpeg(b: Uint8Array): boolean {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // SOI + the first marker's 0xFF prefix.
    return b.byteLength >= 4 && view.getUint16(0, false) === 0xffd8 && view.getUint8(2) === 0xff;
}

function jpegDimensions(b: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let at = 2; // after SOI
    while (at + 4 <= b.byteLength) {
        if (view.getUint8(at) !== 0xff) return null; // marker desync — not a parseable JPEG stream
        const marker = view.getUint8(at + 1);
        at += 2;
        // Standalone markers (TEM, RSTn) carry no length segment.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (at + 2 > b.byteLength) return null;
        const length = view.getUint16(at, false);
        if (length < 2) return null;
        // SOF0–SOF15 minus DHT (C4), JPG (C8) and DAC (CC) carry the canvas.
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
            // SOF segment: length(2) precision(1) height(2) width(2).
            if (at + 7 > b.byteLength) return null;
            return { height: view.getUint16(at + 3, false), width: view.getUint16(at + 5, false) };
        }
        at += length;
    }
    return null;
}

function isWebp(b: Uint8Array): boolean {
    if (b.byteLength < 20) return false;
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return view.getUint32(0, true) === 0x46464952 && view.getUint32(8, true) === 0x50424557; // 'RIFF' 'WEBP'
}

function webpDimensions(b: Uint8Array): { width: number; height: number } | null {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    // Walk the RIFF chunks after the 12-byte file header until a size-bearing chunk appears.
    let at = 12;
    while (at + 8 <= b.byteLength) {
        const id = String.fromCharCode(
            view.getUint8(at),
            view.getUint8(at + 1),
            view.getUint8(at + 2),
            view.getUint8(at + 3),
        );
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (id === 'VP8 ') {
            // Lossy: frame tag (3) + sync code 0x9d 0x01 0x2a + 14-bit LE width/height.
            if (size < 10 || body + 10 > b.byteLength) return null;
            if (
                view.getUint8(body + 3) !== 0x9d ||
                view.getUint8(body + 4) !== 0x01 ||
                view.getUint8(body + 5) !== 0x2a
            ) {
                return null;
            }
            return {
                width: view.getUint16(body + 6, true) & 0x3fff,
                height: view.getUint16(body + 8, true) & 0x3fff,
            };
        }
        if (id === 'VP8L') {
            // Lossless: signature 0x2f, then 14-bit width-1 / height-1 packed little-endian.
            if (size < 5 || body + 5 > b.byteLength || view.getUint8(body) !== 0x2f) return null;
            const bits = view.getUint32(body + 1, true);
            return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        if (id === 'VP8X') {
            // Extended: 4 flag/reserved bytes, then 24-bit LE width-1 / height-1.
            if (size < 10 || body + 10 > b.byteLength) return null;
            const width = view.getUint8(body + 4) | (view.getUint8(body + 5) << 8) | (view.getUint8(body + 6) << 16);
            const height = view.getUint8(body + 7) | (view.getUint8(body + 8) << 8) | (view.getUint8(body + 9) << 16);
            return { width: width + 1, height: height + 1 };
        }
        at = body + size + (size % 2); // RIFF chunks pad to even sizes
    }
    return null;
}
