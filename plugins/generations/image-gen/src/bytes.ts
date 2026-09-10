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
