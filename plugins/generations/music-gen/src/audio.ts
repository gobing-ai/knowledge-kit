import type { AudioFormat } from './brief';

/**
 * Audio bytes knowledge (task 0398 R2/R4): the *delivered* container is read
 * from the returned bytes, never assumed from the request's `format` field
 * (`docs/design/music-gen.md` §6.2), and the offline adapter emits a
 * deterministic silent WAV from the same module.
 */

/** Content-type → container map for the case where the bytes are truncated or unrecognised. */
const CONTENT_TYPE_FORMATS: Readonly<Record<string, AudioFormat>> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mpeg3': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
};

/** True when the first bytes are an MPEG audio frame header or an ID3 tag. */
function looksLikeMp3(bytes: Uint8Array): boolean {
    if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        return true; // 'ID3'
    }
    const first = bytes[0];
    const second = bytes[1];
    if (first === undefined || second === undefined) {
        return false;
    }
    // 11-bit frame sync (0xFFE) with a non-zero version/layer nibble.
    return first === 0xff && (second & 0xe0) === 0xe0 && (second & 0x06) !== 0;
}

/** True when the bytes open with a RIFF/WAVE container. */
function looksLikeWav(bytes: Uint8Array): boolean {
    if (bytes.length < 12) {
        return false;
    }
    const ascii = (from: number, length: number): string =>
        String.fromCharCode(...Array.from(bytes.slice(from, from + length)));
    return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE';
}

/**
 * Detect the delivered audio container. Magic bytes win; the content type is
 * only a fallback, and `null` means "this response carries no audio" — an
 * ambiguous post-send outcome, never a silent assumption.
 */
export function detectAudioFormat(bytes: Uint8Array, contentType?: string): AudioFormat | null {
    if (looksLikeWav(bytes)) {
        return 'wav';
    }
    if (looksLikeMp3(bytes)) {
        return 'mp3';
    }
    if (contentType !== undefined) {
        const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
        const mapped = CONTENT_TYPE_FORMATS[base];
        if (mapped !== undefined) {
            return mapped;
        }
    }
    return null;
}

/** Sample rate of the offline WAV: 8 kHz mono 16-bit keeps the fixture tiny and byte-stable. */
export const SILENT_WAV_SAMPLE_RATE = 8_000;

/** Duration of the offline WAV in whole seconds. */
export const SILENT_WAV_SECONDS = 1;

/** Write a 16-bit little-endian value at `offset`. */
function writeUint16LE(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >> 8) & 0xff;
}

/** Write a 32-bit little-endian value at `offset`. */
function writeUint32LE(target: Uint8Array, offset: number, value: number): void {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >> 8) & 0xff;
    target[offset + 2] = (value >> 16) & 0xff;
    target[offset + 3] = (value >> 24) & 0xff;
}

/**
 * A deterministic silent WAV (R4): every sample is zero, so the bytes depend on
 * the duration alone. No clock, no randomness — two runs produce identical
 * bytes, which is what lets the offline suite assert on them.
 */
export function silentWav(seconds: number = SILENT_WAV_SECONDS): Uint8Array {
    if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error(`silentWav needs a positive integer duration in seconds (got ${String(seconds)})`);
    }
    const channels = 1;
    const bitsPerSample = 16;
    const blockAlign = (channels * bitsPerSample) / 8;
    const dataBytes = SILENT_WAV_SAMPLE_RATE * seconds * blockAlign;
    const bytes = new Uint8Array(44 + dataBytes);
    const header = 'RIFF';
    for (const [index, char] of [...header].entries()) {
        bytes[index] = char.charCodeAt(0);
    }
    writeUint32LE(bytes, 4, 36 + dataBytes);
    const wave = 'WAVEfmt ';
    for (const [index, char] of [...wave].entries()) {
        bytes[8 + index] = char.charCodeAt(0);
    }
    writeUint32LE(bytes, 16, 16); // PCM chunk size
    writeUint16LE(bytes, 20, 1); // PCM
    writeUint16LE(bytes, 22, channels);
    writeUint32LE(bytes, 24, SILENT_WAV_SAMPLE_RATE);
    writeUint32LE(bytes, 28, SILENT_WAV_SAMPLE_RATE * blockAlign); // byte rate
    writeUint16LE(bytes, 32, blockAlign);
    writeUint16LE(bytes, 34, bitsPerSample);
    const data = 'data';
    for (const [index, char] of [...data].entries()) {
        bytes[36 + index] = char.charCodeAt(0);
    }
    writeUint32LE(bytes, 40, dataBytes);
    return bytes;
}
