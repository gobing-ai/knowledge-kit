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
 * Task 0180 — pure PNG-only dimension reader (IHDR chunk).
 * Reads `width` and `height` from the PNG IHDR chunk. Non-PNG bytes and
 * truncated headers throw. Task 0182 will extend this to JPEG/WebP (escalation
 * decision A — do not preempt that task's scope here).
 */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
    // PNG signature (8 bytes) + IHDR chunk length (4) + 'IHDR' tag (4) + width (4) + height (4) = 24
    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.byteLength < 24) {
        throw new Error('imageDimensions: not a PNG — buffer too small');
    }
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== PNG_SIG[i]) {
            throw new Error('imageDimensions: not a PNG — invalid signature');
        }
    }
    // IHDR chunk: offset 8 = chunk data length (must be 13), offset 12 = 'IHDR' tag.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ihdrLength = view.getUint32(8, false);
    if (ihdrLength !== 13 || bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
        throw new Error('imageDimensions: not a PNG — IHDR chunk not found at offset 8');
    }
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { width, height };
}
