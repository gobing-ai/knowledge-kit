import { describe, expect, it } from 'bun:test';
import {
    boxinessDb,
    cepstrumEcho,
    decayCurve,
    envelope,
    envelopeQuantiles,
    fft,
    pauseFloorDb,
    spectrum,
    THRESHOLDS,
} from '../scripts/audio-quality';

/**
 * Falsification suite for `plugins/kk/scripts/audio-quality.ts` — the diagnostic that answers "does this narration
 * sound echoey/hollow, and by how much".
 *
 * Failure-first list (written before the assertions):
 *  1. The FFT is wrong, so every band/centroid/cepstrum number is fiction.
 *  2. A DELAYED COPY is not detected — the tool would pass a genuinely echoey render (the 2026-10-20
 *     voxcpm complaint).
 *  3. A DRY signal is flagged as echoey — the tool would condemn a clean render and push the operator
 *     to change a driver for no reason. (The first implementation did exactly this: raw-envelope
 *     autocorrelation reported 0.83 at the minimum lag on every file.)
 *  4. A reverb tail and a hard gate are indistinguishable, so "ringing" cannot be separated from a
 *     normal pause.
 *  5. The band metrics do not react to a band-limited (boxy/dull) signal.
 *
 * Signals are synthesized in-memory, so the suite needs no fixtures and no ffmpeg.
 */

const RATE = 24_000;

/** Band-limited pseudo-noise bursts separated by silence — a stand-in for narration. */
function narration(options: { burstMs: number; gapMs: number; totalMs: number; tailDbPer100ms?: number }): Int16Array {
    const { burstMs, gapMs, totalMs, tailDbPer100ms } = options;
    const total = Math.round((totalMs / 1000) * RATE);
    const out = new Float64Array(total);
    let seed = 12345;
    const noise = (): number => {
        seed = (seed * 1103515245 + 12345) % 2 ** 31;
        return (seed / 2 ** 31) * 2 - 1;
    };
    const burstSamples = Math.round((burstMs / 1000) * RATE);
    const period = burstSamples + Math.round((gapMs / 1000) * RATE);
    for (let start = 0; start + burstSamples < total; start += period) {
        // One-pole low-pass gives a speech-like tilt rather than white noise.
        let lp = 0;
        for (let i = 0; i < burstSamples; i += 1) {
            lp = lp * 0.9 + noise() * 0.1;
            out[start + i] = lp * 6;
        }
        if (tailDbPer100ms === undefined) continue;
        // An exponential tail at the requested decay rate, over the following gap.
        const gain = 10 ** (tailDbPer100ms / 20 / 100);
        let level = 1;
        for (let i = 1; i < period - burstSamples && start + burstSamples + i < total; i += 1) {
            level *= gain ** (1000 / RATE);
            const src = start + burstSamples - (i % burstSamples) - 1;
            out[start + burstSamples + i] = out[src] * level;
        }
    }
    return Int16Array.from(out, (value) => Math.max(-32768, Math.min(32767, Math.round(value * 32767))));
}

/** Sum with a single delayed copy: the comb-filter / reflection signature. */
function withEcho(pcm: Int16Array, delayMs: number, gain: number): Int16Array {
    const delay = Math.round((delayMs / 1000) * RATE);
    const out = Int16Array.from(pcm);
    for (let i = delay; i < pcm.length; i += 1) {
        const mixed = (out[i] as number) + (pcm[i - delay] as number) * gain;
        out[i] = Math.max(-32768, Math.min(32767, Math.round(mixed)));
    }
    return out;
}

describe('fft', () => {
    it('puts a pure tone in the bin for its frequency', () => {
        const size = 1024;
        const re = new Float64Array(size);
        const im = new Float64Array(size);
        const bin = 64;
        for (let i = 0; i < size; i += 1) re[i] = Math.cos((2 * Math.PI * bin * i) / size);
        fft(re, im);
        const magnitude = Array.from({ length: size / 2 }, (_, k) => (re[k] as number) ** 2 + (im[k] as number) ** 2);
        const peak = magnitude.indexOf(Math.max(...magnitude));
        expect(peak).toBe(bin);
    });
});

describe('decayCurve — reverb tail vs a hard pause', () => {
    it('reports a fast decay for bursts separated by near-silence', () => {
        const dry = decayCurve(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 8000 })));
        expect(dry.offsets).toBeGreaterThan(4);
        expect(dry.at200).toBeLessThan(-40);
    });

    it('reports a slow decay when every burst leaves a tail', () => {
        const wet = decayCurve(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 8000, tailDbPer100ms: -6 })));
        const dry = decayCurve(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 8000 })));
        expect(wet.at200).toBeGreaterThan(dry.at200 + 10);
    });
});

describe('cepstrumEcho — the instrument that answers "回声感"', () => {
    const dry = narration({ burstMs: 300, gapMs: 200, totalMs: 6000 });

    it('finds the delay of a single reflection', () => {
        for (const delayMs of [30, 45, 80]) {
            const cepstrum = cepstrumEcho(withEcho(dry, delayMs, 0.6));
            expect(cepstrum).not.toBeNull();
            expect(Math.abs((cepstrum as { delayMs: number }).delayMs - delayMs)).toBeLessThanOrEqual(2);
            expect((cepstrum as { prominenceDb: number }).prominenceDb).toBeGreaterThan(THRESHOLDS.cepstrumDb);
        }
    });

    it('does not flag the dry signal (negative control)', () => {
        const cepstrum = cepstrumEcho(dry);
        expect(cepstrum).not.toBeNull();
        expect((cepstrum as { prominenceDb: number }).prominenceDb).toBeLessThan(THRESHOLDS.cepstrumDb);
    });
});

describe('band metrics', () => {
    it('reacts to a band-limited signal in the 250–500 Hz band', () => {
        const size = RATE;
        const out = new Float64Array(size);
        for (let i = 0; i < size; i += 1) {
            out[i] = Math.sin((2 * Math.PI * 350 * i) / RATE) * 0.5 + Math.sin((2 * Math.PI * 3000 * i) / RATE) * 0.02;
        }
        const pcm = Int16Array.from(out, (value) => Math.round(value * 32767));
        const bands = spectrum(pcm, RATE);
        expect(bands.centroidHz).toBeGreaterThan(250);
        expect(bands.centroidHz).toBeLessThan(600);
        // 250–500 dominates 2k–4k by a wide margin: the boxy signature.
        expect(boxinessDb(bands)).toBeGreaterThan(10);
    });

    it('reports pause quantiles relative to the phrase level', () => {
        const quantiles = envelopeQuantiles(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 8000 })));
        expect(quantiles.p70).toBe(0);
        expect(quantiles.p20).toBeLessThan(-30);
        expect(pauseFloorDb(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 8000 })))).toBe(quantiles.p20);
    });
});

/**
 * The ffmpeg-backed half. `analyse`/`treat`/`main` are what an operator actually runs, so the suite
 * drives them over a real file rather than trusting the pure functions alone (the repo's coverage
 * gate is per file, and an untested CLI path is the one that breaks first).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, echoMeasure, main, runAudioQuality, treat } from '../scripts/audio-quality';

/** Minimal 16-bit mono WAV writer: no ffmpeg needed to produce the input. */
function writeWav(path: string, pcm: Int16Array, rate = RATE): void {
    const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    writeFileSync(path, Buffer.concat([header, data]));
}

describe('echoMeasure — envelope repetition', () => {
    it('finds a periodic envelope repetition and stays quiet on the dry signal', () => {
        // Amplitude modulation every 120 ms: an envelope repetition the detector must find.
        const pcm = narration({ burstMs: 300, gapMs: 200, totalMs: 6000 });
        const modulated = Int16Array.from(pcm, (value, i) => Math.round(value * (i % 2880 < 1440 ? 1 : 0.35)));
        const found = echoMeasure(envelope(modulated));
        expect(found).not.toBeNull();
        expect((found as { lagMs: number }).lagMs).toBeGreaterThanOrEqual(40);
        const dry = echoMeasure(envelope(narration({ burstMs: 300, gapMs: 500, totalMs: 6000 })));
        expect(dry === null || dry.strength < THRESHOLDS.echoStrength).toBe(true);
    });
});

describe('analyse / treat / main over a real file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kk-audio-quality-'));
    const dryWav = join(dir, 'dry.wav');
    const wetWav = join(dir, 'wet.wav');
    const treatedWav = join(dir, 'treated.wav');
    const source = narration({ burstMs: 400, gapMs: 400, totalMs: 6000 });
    writeWav(dryWav, source);
    writeWav(wetWav, withEcho(source, 45, 0.7));

    it('separates a dry read from one with a reflection', () => {
        const dry = analyse(dryWav);
        const wet = analyse(wetWav);
        expect(dry.sampleRate).toBe(RATE);
        expect(dry.seconds).toBeGreaterThan(5);
        expect(dry.flags.some((flag) => flag.startsWith('cepstral-echo'))).toBe(false);
        expect(wet.flags.some((flag) => flag.startsWith('cepstral-echo'))).toBe(true);
        // The synthetic gaps are digital silence, so the pause-floor comparison belongs to the real
        // corpus (documented in the tool header), not here: p20 bottoms out at the same floor for both.
    });

    it('treats a reference clip into a readable file', () => {
        treat(dryWav, treatedWav);
        const treated = analyse(treatedWav);
        expect(treated.seconds).toBeGreaterThan(5);
        expect(treated.peakDbfs).toBeLessThanOrEqual(-0.4);
    });

    it('prints a human report and a JSON report', async () => {
        const lines: string[] = [];
        const original = console.log;
        console.log = (...args: unknown[]) => {
            lines.push(args.join(' '));
        };
        try {
            await main([dryWav]);
            // The stage entry point `kk stage audio-quality` shares this parser.
            await runAudioQuality(['--json', '--baseline', dryWav, wetWav]);
            await main(['--help']);
            await main(['--treat', dryWav, join(dir, 'treated-by-main.wav')]);
        } finally {
            console.log = original;
        }
        const output = lines.join('\n');
        expect(output).toContain('pauseFloor');
        expect(output).toContain('bands');
        expect(output).toContain('"cepstrum"');
        expect(output).toContain('usage: kk stage audio-quality');
        expect(output).toContain('treated');
    });

    it('cleans up', () => {
        rmSync(dir, { recursive: true, force: true });
        expect(true).toBe(true);
    });
});
