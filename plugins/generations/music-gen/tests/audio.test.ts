import { describe, expect, test } from 'bun:test';
import { detectAudioFormat, SILENT_WAV_SAMPLE_RATE, SILENT_WAV_SECONDS, silentWav } from '../src/audio';
import { mp3Bytes } from './stub-instance';

/**
 * R2/R4 — the delivered container is read from the bytes (§6.2) and the offline
 * WAV is byte-stable.
 */

describe('AC2 — format detection reads the bytes', () => {
    test('an ID3 tag is mp3', () => {
        expect(detectAudioFormat(mp3Bytes())).toBe('mp3');
    });

    test('a bare MPEG frame sync is mp3', () => {
        expect(detectAudioFormat(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('mp3');
    });

    test('RIFF/WAVE is wav', () => {
        expect(detectAudioFormat(silentWav())).toBe('wav');
    });

    test('the content type is only a fallback', () => {
        expect(detectAudioFormat(new Uint8Array([0, 1, 2, 3]), 'audio/mpeg')).toBe('mp3');
        expect(detectAudioFormat(new Uint8Array([0, 1, 2, 3]), 'audio/x-wav')).toBe('wav');
        expect(detectAudioFormat(new Uint8Array([0, 1, 2, 3]), 'application/json')).toBeNull();
        expect(detectAudioFormat(new Uint8Array([0, 1, 2, 3]))).toBeNull();
    });

    test('bytes win over a contradicting content type', () => {
        expect(detectAudioFormat(mp3Bytes(), 'audio/wav')).toBe('mp3');
    });
});

describe('AC4 — the offline WAV is deterministic', () => {
    test('two calls produce identical bytes with a valid header', () => {
        const first = silentWav();
        const second = silentWav();
        expect(Array.from(first)).toEqual(Array.from(second));
        const header = new TextDecoder('latin1').decode(first.slice(0, 12));
        expect(header.slice(0, 4)).toBe('RIFF');
        expect(header.slice(8, 12)).toBe('WAVE');
        const expectedData = SILENT_WAV_SAMPLE_RATE * SILENT_WAV_SECONDS * 2;
        expect(first.byteLength).toBe(44 + expectedData);
        expect(first.slice(44).every((byte) => byte === 0)).toBe(true);
    });

    test('a non-positive or fractional duration is refused', () => {
        expect(() => silentWav(0)).toThrow();
        expect(() => silentWav(1.5)).toThrow();
    });
});
