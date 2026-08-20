export interface ParsedWav {
    audioFormat: number;
    numChannels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
    dataBytes: Uint8Array;
}

/**
 * Parse a RIFF WAVE buffer into its format fields and raw audio data.
 */
export function parseWav(buffer: Uint8Array): ParsedWav {
    if (buffer.length < 44) {
        throw new Error('Invalid WAV buffer: buffer too short');
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    const b0 = buffer[0];
    const b1 = buffer[1];
    const b2 = buffer[2];
    const b3 = buffer[3];
    const b8 = buffer[8];
    const b9 = buffer[9];
    const b10 = buffer[10];
    const b11 = buffer[11];

    if (
        b0 === undefined ||
        b1 === undefined ||
        b2 === undefined ||
        b3 === undefined ||
        b8 === undefined ||
        b9 === undefined ||
        b10 === undefined ||
        b11 === undefined
    ) {
        throw new Error('Invalid WAV buffer: buffer too short');
    }

    const riffTag = String.fromCharCode(b0, b1, b2, b3);
    const waveTag = String.fromCharCode(b8, b9, b10, b11);

    if (riffTag !== 'RIFF' || waveTag !== 'WAVE') {
        throw new Error(`Invalid WAV buffer: expected RIFF/WAVE header, got ${riffTag}/${waveTag}`);
    }

    let offset = 12;
    let formatInfo:
        | {
              audioFormat: number;
              numChannels: number;
              sampleRate: number;
              byteRate: number;
              blockAlign: number;
              bitsPerSample: number;
          }
        | undefined;
    let dataBytes: Uint8Array | undefined;

    while (offset + 8 <= buffer.length) {
        const c0 = buffer[offset];
        const c1 = buffer[offset + 1];
        const c2 = buffer[offset + 2];
        const c3 = buffer[offset + 3];
        if (c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined) {
            break;
        }

        const chunkId = String.fromCharCode(c0, c1, c2, c3);
        const chunkSize = view.getUint32(offset + 4, true);
        const chunkDataOffset = offset + 8;

        if (chunkId === 'fmt ') {
            if (chunkSize < 16) {
                throw new Error('Invalid WAV fmt chunk size');
            }
            const audioFormat = view.getUint16(chunkDataOffset, true);
            const numChannels = view.getUint16(chunkDataOffset + 2, true);
            const sampleRate = view.getUint32(chunkDataOffset + 4, true);
            const byteRate = view.getUint32(chunkDataOffset + 8, true);
            const blockAlign = view.getUint16(chunkDataOffset + 12, true);
            const bitsPerSample = view.getUint16(chunkDataOffset + 14, true);

            formatInfo = {
                audioFormat,
                numChannels,
                sampleRate,
                byteRate,
                blockAlign,
                bitsPerSample,
            };
        } else if (chunkId === 'data') {
            const end = Math.min(chunkDataOffset + chunkSize, buffer.length);
            dataBytes = buffer.subarray(chunkDataOffset, end);
        }

        // Advance to next chunk (aligned to 2 bytes)
        offset = chunkDataOffset + chunkSize + (chunkSize % 2 === 1 ? 1 : 0);
    }

    if (!formatInfo) {
        throw new Error('Invalid WAV: missing "fmt " chunk');
    }
    if (!dataBytes) {
        throw new Error('Invalid WAV: missing "data" chunk');
    }

    return {
        ...formatInfo,
        dataBytes,
    };
}

/**
 * Concatenate multiple WAV audio buffers in order, inserting gap_ms of silence before clips.
 */
export function concatWavs(wavBuffers: Uint8Array[], gapsMs: number[] = []): Uint8Array {
    if (wavBuffers.length === 0) {
        return new Uint8Array(0);
    }

    const parsedWavs = wavBuffers.map((buf) => parseWav(buf));
    const first = parsedWavs[0];
    if (!first) {
        return new Uint8Array(0);
    }

    // Verify format compatibility
    for (let i = 1; i < parsedWavs.length; i++) {
        const current = parsedWavs[i];
        if (!current) {
            continue;
        }
        if (current.sampleRate !== first.sampleRate) {
            throw new Error(`WAV sample rate mismatch: expected ${first.sampleRate} Hz, got ${current.sampleRate} Hz`);
        }
        if (
            current.audioFormat !== first.audioFormat ||
            current.numChannels !== first.numChannels ||
            current.bitsPerSample !== first.bitsPerSample
        ) {
            throw new Error(
                `WAV format mismatch between segment 0 and segment ${i}: format ${first.audioFormat} vs ${current.audioFormat}, channels ${first.numChannels} vs ${current.numChannels}, bits ${first.bitsPerSample} vs ${current.bitsPerSample}`,
            );
        }
    }

    // Compute total combined data length
    let totalDataLength = 0;
    const pieces: Uint8Array[] = [];

    for (let i = 0; i < parsedWavs.length; i++) {
        const wav = parsedWavs[i];
        if (!wav) {
            continue;
        }
        const gap = gapsMs[i] ?? 0;
        if (gap > 0) {
            const numGapBytes = Math.floor(first.sampleRate * (gap / 1000)) * first.blockAlign;
            if (numGapBytes > 0) {
                const silence = new Uint8Array(numGapBytes);
                pieces.push(silence);
                totalDataLength += numGapBytes;
            }
        }
        pieces.push(wav.dataBytes);
        totalDataLength += wav.dataBytes.length;
    }

    // Build the consolidated WAV buffer
    const headerSize = 44;
    const totalFileSize = headerSize + totalDataLength;
    const output = new Uint8Array(totalFileSize);
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength);

    // RIFF chunk descriptor
    output[0] = 'R'.charCodeAt(0);
    output[1] = 'I'.charCodeAt(0);
    output[2] = 'F'.charCodeAt(0);
    output[3] = 'F'.charCodeAt(0);
    view.setUint32(4, 36 + totalDataLength, true);
    output[8] = 'W'.charCodeAt(0);
    output[9] = 'A'.charCodeAt(0);
    output[10] = 'V'.charCodeAt(0);
    output[11] = 'E'.charCodeAt(0);

    // fmt sub-chunk
    output[12] = 'f'.charCodeAt(0);
    output[13] = 'm'.charCodeAt(0);
    output[14] = 't'.charCodeAt(0);
    output[15] = ' '.charCodeAt(0);
    view.setUint32(16, 16, true);
    view.setUint16(20, first.audioFormat, true);
    view.setUint16(22, first.numChannels, true);
    view.setUint32(24, first.sampleRate, true);
    view.setUint32(28, first.byteRate, true);
    view.setUint16(32, first.blockAlign, true);
    view.setUint16(34, first.bitsPerSample, true);

    // data sub-chunk
    output[36] = 'd'.charCodeAt(0);
    output[37] = 'a'.charCodeAt(0);
    output[38] = 't'.charCodeAt(0);
    output[39] = 'a'.charCodeAt(0);
    view.setUint32(40, totalDataLength, true);

    // Copy audio data pieces
    let currentOffset = headerSize;
    for (const piece of pieces) {
        output.set(piece, currentOffset);
        currentOffset += piece.length;
    }

    return output;
}
