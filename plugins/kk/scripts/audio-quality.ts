#!/usr/bin/env bun
/**
 * Audio quality triage for narrated episodes — MEASURE ONLY, never wired into the daily pipeline.
 *
 * WHY THIS EXISTS (2026-10-20): the operator reported that episodes rendered through `voxcpm` (from
 * 2026-10-15 on) sound hollow and echoey ("瓮声瓮气，有明显回声感") while the earlier `gemini-tts`
 * episodes do not. The pipeline's `daily-voice-audit` checks speaker consistency and the duration gate
 * checks length; nothing measured the ACOUSTIC character, so a regression in the voice reference or in
 * the driver could ship for days unnoticed. This tool makes that character measurable, so a
 * driver/profile change is judged on numbers rather than memory.
 *
 * It is a `kk stage` body and NOT a pipeline node: `kk-daily-ai-voice2` never calls it, so the daily
 * generate → publish path keeps its own gates (duration, speaker audit) and this stays the tool an
 * operator reaches for when an episode sounds wrong. Living in `plugins/kk/scripts/` rather than the
 * repo's root `scripts/` is deliberate — root `scripts/` is build/release tooling run from a checkout,
 * while this measures what the installed product produces, so it must ship with the plugin and resolve
 * from an installed package (`kk stage audio-quality …`), exactly like every other stage body here.
 * It is not driver-specific either, so `plugins/generations/voxcpm-tts/scripts/` (where the
 * VoxCPM-only `audit-speaker-consistency.py` lives) would have been the wrong home.
 *
 *   kk stage audio-quality <file…>                          # human report per file
 *   kk stage audio-quality --json <file…>                   # machine report
 *   kk stage audio-quality --baseline <good> <file…>        # per-band delta against a known-good file
 *   kk stage audio-quality --treat <ref-in> <ref-out>       # de-box a REFERENCE clip (not an episode)
 *   bun run audio:quality <file…>                           # the same body from a checkout
 *
 * WHAT IS MEASURED, mapped to the two complaints:
 *
 *  "回声感" (echo / ringing)
 *   - `decay` — the energy-decay curve 50/100/200/400 ms after each speech offset whose next 500 ms
 *     stays quiet (so the following syllable cannot be mistaken for a tail). A dry studio read is
 *     -20 dB or lower at 100 ms and keeps falling; a room/echo tail plateaus around -10…-15 dB. This
 *     is the primary reverb instrument.
 *   - `cepstrum` — real-cepstrum peak in the 20–120 ms quefrency band. A single reflection puts a
 *     periodic ripple in the log spectrum, so its cepstrum peaks at the delay. Starting at 20 ms keeps
 *     the pitch period (5–12 ms for a human voice, and its multiples) out of the way; a residual peak
 *     near 2× the pitch period is why this is reported as evidence, not as the verdict.
 *   - `echo` — envelope-autocorrelation repetition (first-differenced so slow syllable modulation
 *     cannot fake a lag). Corroborates a doubled render / comb filter at a fixed delay.
 *
 *  "瓮声瓮气" (boxy / hollow)
 *   - `bands` — average spectrum in octave-ish bands, as dB relative to full band; "boxy" is a
 *     250–500 Hz plateau with a 2–4 kHz deficit, reported as `boxy` dB (positive = boxy).
 *   - `centroidHz` / `rolloff85Hz` — one number each for "dark vs bright"; speech naturally sits low,
 *     so these are compared against a baseline rather than thresholded.
 *   - `pauseFloorDb` (+ `quantiles`) — how far the quietest 20 % of frames fall below median speech.
 *     A reverb bed or a wash keeps this high; measured on this repo's corpus: gemini episodes −37 dB,
 *     voxcpm episodes −19.6 dB, the shared `robin-news.wav` reference −27.7 dB.
 *
 * Thresholds are advisory (calibrated 2026-10-20 against 10-12…10-14 gemini episodes, 10-15…10-20
 * voxcpm episodes and the reference clip); every metric is printed, so a threshold miss never hides a
 * number. `--treat` exists because the actionable repair for a cloned voice is the REFERENCE, not the
 * finished episode: the model reproduces its prompt's room, so the prompt is what gets corrected.
 */

import { spawnSync } from 'node:child_process';

/** Analysis rate: cheap, and Nyquist 12 kHz still covers everything that matters for speech. */
const ANALYSIS_RATE = 24_000;
/** Short-term envelope frame: 20 ms → 50 points per second. */
const FRAME_MS = 20;

export interface BandPowers {
    /** Band label → level in dB relative to the full-band power. */
    readonly bands: Record<string, number>;
    readonly centroidHz: number;
    readonly rolloff85Hz: number;
}

export interface CepstrumEcho {
    /** Quefrency of the cepstral peak: the delay of the repeated material, in milliseconds. */
    readonly delayMs: number;
    /** Peak height above the median cepstrum in the search range, in dB. */
    readonly prominenceDb: number;
}

export interface EchoMeasure {
    readonly lagMs: number;
    readonly strength: number;
}

export interface DecayCurve {
    readonly at50: number;
    readonly at100: number;
    readonly at200: number;
    /** First 20 ms step at or below −30 dB, in ms (500 = never), 0 when no offset qualifies. */
    readonly tailMs: number;
    /** Qualifying offsets the medians came from (0 = the audio never pauses). */
    readonly offsets: number;
}

export interface EnvelopeQuantiles {
    readonly p05: number;
    readonly p20: number;
    readonly p50: number;
    readonly p70: number;
}

export interface AudioReport {
    readonly file: string;
    readonly sampleRate: number;
    readonly seconds: number;
    readonly peakDbfs: number;
    readonly rmsDbfs: number;
    readonly crestDb: number;
    readonly dcOffset: number;
    readonly clippedSamples: number;
    readonly quantiles: EnvelopeQuantiles;
    readonly pauseFloorDb: number;
    readonly decay: DecayCurve;
    readonly cepstrum: CepstrumEcho | null;
    readonly echo: EchoMeasure | null;
    readonly spectrum: BandPowers;
    /** Advisory flags; empty means "nothing in this tool's vocabulary fired". */
    readonly flags: readonly string[];
}

/** Advisory thresholds (see the header for the calibration corpus). */
export const THRESHOLDS = {
    /** 20th-percentile frame level vs median speech; above this the read has a wash. */
    pauseFloorDb: -30,
    /** Level 200 ms after an offset, in dB: a dry read is below ~−32. */
    decay200Db: -32,
    echoStrength: 0.3,
    cepstrumDb: 25,
} as const;

const BAND_EDGES: readonly [string, number, number][] = [
    ['60-125', 60, 125],
    ['125-250', 125, 250],
    ['250-500', 250, 500],
    ['500-1k', 500, 1000],
    ['1k-2k', 1000, 2000],
    ['2k-4k', 2000, 4000],
    ['4k-8k', 4000, 8000],
    ['8k-12k', 8000, 12_000],
];

function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
    return sorted[index] as number;
}

function median(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return percentile(sorted, 50);
}

/** ffprobe the first audio stream. */
export function probe(file: string): { sampleRate: number; channels: number; seconds: number } {
    const run = spawnSync(
        'ffprobe',
        [
            '-v',
            'error',
            '-select_streams',
            'a:0',
            '-show_entries',
            'stream=sample_rate,channels',
            '-show_entries',
            'format=duration',
            '-of',
            'default=noprint_wrappers=1',
            file,
        ],
        { encoding: 'buffer' },
    );
    if (run.status !== 0) throw new Error(`ffprobe failed for ${file}: ${run.stderr?.toString().trim()}`);
    const text = run.stdout.toString();
    const value = (key: string): number => Number(new RegExp(`^${key}=(.+)$`, 'm').exec(text)?.[1] ?? 0);
    return { sampleRate: value('sample_rate'), channels: value('channels'), seconds: value('duration') };
}

/** Decode to mono s16 PCM at {@link ANALYSIS_RATE} (ffmpeg resamples). */
export function decodeMono(file: string, rate = ANALYSIS_RATE): Int16Array {
    const run = spawnSync(
        'ffmpeg',
        ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-acodec', 'pcm_s16le', '-'],
        { maxBuffer: 1024 * 1024 * 1024 },
    );
    if (run.status !== 0) throw new Error(`ffmpeg decode failed for ${file}: ${run.stderr?.toString().trim()}`);
    const buf = run.stdout as Buffer;
    return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** Short-term RMS envelope, one point per {@link FRAME_MS}. */
export function envelope(pcm: Int16Array, rate = ANALYSIS_RATE): Float64Array {
    const frame = Math.max(1, Math.round((rate * FRAME_MS) / 1000));
    const frames = Math.floor(pcm.length / frame);
    const out = new Float64Array(frames);
    for (let i = 0; i < frames; i += 1) {
        let sum = 0;
        const base = i * frame;
        for (let j = 0; j < frame; j += 1) {
            const s = (pcm[base + j] as number) / 32768;
            sum += s * s;
        }
        out[i] = Math.sqrt(sum / frame);
    }
    return out;
}

/** Envelope quantiles in dB relative to median speech (p70 = 0 by construction). */
export function envelopeQuantiles(env: Float64Array): EnvelopeQuantiles {
    const db = Array.from(env, (v) => 20 * Math.log10(Math.max(v, 1e-7))).sort((a, b) => a - b);
    const p70 = percentile(db, 70);
    return {
        p05: Number((percentile(db, 5) - p70).toFixed(1)),
        p20: Number((percentile(db, 20) - p70).toFixed(1)),
        p50: Number((percentile(db, 50) - p70).toFixed(1)),
        p70: 0,
    };
}

/** Pause floor: the 20th-percentile frame level minus median speech, in dB. */
export function pauseFloorDb(env: Float64Array): number {
    return envelopeQuantiles(env).p20;
}

/**
 * Energy-decay curve across PHRASE ENDS — the reverb instrument.
 *
 * Offsets are found as runs of frames at least 20 dB below the phrase level that last ≥80 ms; for each
 * run the peak of the preceding 100 ms is the reference, and the level 50/100/200/400 ms after that
 * peak is recorded. A dry read is already 20 dB down by 100 ms and keeps falling; a room tail plateaus
 * around −10…−15 dB. (An earlier version keyed on local maxima, which found nothing: in a continuous
 * narration read every local maximum sits mid-phrase, so "200 ms of quiet after the peak" never holds.)
 */
export function decayCurve(env: Float64Array): DecayCurve {
    const db = Array.from(env, (v) => 20 * Math.log10(Math.max(v, 1e-7)));
    const speech = percentile(
        [...db].sort((a, b) => a - b),
        70,
    );
    const quietBelow = speech - 20;
    const buckets = {
        at50: [] as number[],
        at100: [] as number[],
        at200: [] as number[],
        tail: [] as number[],
    };
    const RAMP = Math.round(80 / FRAME_MS);
    const LOOKBACK = Math.round(100 / FRAME_MS);
    for (let s = LOOKBACK; s < db.length; s += 1) {
        if ((db[s] as number) >= quietBelow) continue;
        let runEnd = s;
        while (runEnd < db.length && (db[runEnd] as number) < quietBelow) runEnd += 1;
        const runLength = runEnd - s;
        s = runEnd;
        if (runLength < RAMP) continue;
        let peakIndex = -1;
        let peak = -Infinity;
        for (let j = Math.max(0, s - runLength - LOOKBACK); j < s; j += 1) {
            if ((db[j] as number) > peak) {
                peak = db[j] as number;
                peakIndex = j;
            }
        }
        if (peakIndex < 0 || peak < speech) continue;
        const rel = (ms: number): number | null => {
            const j = peakIndex + Math.round(ms / FRAME_MS);
            return j < db.length ? Number(((db[j] as number) - peak).toFixed(1)) : null;
        };
        const v50 = rel(50);
        const v100 = rel(100);
        const v200 = rel(200);
        if (v50 === null || v100 === null || v200 === null) continue;
        buckets.at50.push(v50);
        buckets.at100.push(v100);
        buckets.at200.push(v200);
        let tail = 500;
        for (let ms = FRAME_MS; ms <= 500; ms += FRAME_MS) {
            const value = rel(ms);
            if (value !== null && value <= -30) {
                tail = ms;
                break;
            }
        }
        buckets.tail.push(tail);
    }
    const round1 = (value: number): number => Number(value.toFixed(1));
    return {
        at50: round1(median(buckets.at50)),
        at100: round1(median(buckets.at100)),
        at200: round1(median(buckets.at200)),
        tailMs: buckets.tail.length === 0 ? 0 : median(buckets.tail),
        offsets: buckets.tail.length,
    };
}

/**
 * Envelope-autocorrelation repetition in the 40–160 ms lag range, on the FIRST-DIFFERENCED envelope so
 * the slow syllable/modulation trend cannot masquerade as a repetition (measured 2026-10-20: the raw
 * envelope reported 0.83 at the minimum lag on every file, a dry gemini read included).
 */
export function echoMeasure(env: Float64Array): EchoMeasure | null {
    if (env.length < 40) return null;
    const n = env.length - 1;
    const centred = new Float64Array(n);
    let mean = 0;
    for (let i = 0; i < n; i += 1) {
        centred[i] = (env[i + 1] as number) - (env[i] as number);
        mean += centred[i] as number;
    }
    mean /= n;
    let energy = 0;
    for (let i = 0; i < n; i += 1) {
        centred[i] = (centred[i] as number) - mean;
        energy += (centred[i] as number) ** 2;
    }
    if (energy <= 0) return null;
    const minLag = Math.max(2, Math.round(40 / FRAME_MS));
    const maxLag = Math.min(n - 2, Math.round(160 / FRAME_MS));
    const scores = new Float64Array(maxLag + 2);
    let best = { lag: minLag, strength: 0 };
    for (let lag = minLag; lag <= maxLag; lag += 1) {
        let sum = 0;
        for (let i = 0; i + lag < n; i += 1) sum += (centred[i] as number) * (centred[i + lag] as number);
        const value = sum / energy;
        scores[lag] = value;
        if (value > best.strength) best = { lag, strength: value };
    }
    if (best.strength <= 0) return null;
    const neighbourhood = [scores[best.lag - 1] ?? 0, scores[best.lag + 1] ?? 0];
    if (neighbourhood.some((value) => value >= best.strength)) return null;
    return { lagMs: best.lag * FRAME_MS, strength: Number(best.strength.toFixed(3)) };
}

/** In-place iterative radix-2 FFT; `re`/`im` must be power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [re[i], re[j]] = [re[j] as number, re[i] as number];
            [im[i], im[j]] = [im[j] as number, im[i] as number];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wRe = Math.cos(angle);
        const wIm = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let curRe = 1;
            let curIm = 0;
            for (let k = 0; k < len / 2; k += 1) {
                const evenRe = re[i + k] as number;
                const evenIm = im[i + k] as number;
                const oddRe = re[i + k + len / 2] as number;
                const oddIm = im[i + k + len / 2] as number;
                const tRe = oddRe * curRe - oddIm * curIm;
                const tIm = oddRe * curIm + oddIm * curRe;
                re[i + k] = evenRe + tRe;
                im[i + k] = evenIm + tIm;
                re[i + k + len / 2] = evenRe - tRe;
                im[i + k + len / 2] = evenIm - tIm;
                const nextRe = curRe * wRe - curIm * wIm;
                curIm = curRe * wIm + curIm * wRe;
                curRe = nextRe;
            }
        }
    }
}

/**
 * Real-cepstrum echo probe. A reflection adds a periodic ripple to the log-magnitude spectrum whose
 * period is 1/delay, so the cepstrum (inverse transform of that log spectrum) peaks at the delay.
 * The search starts at 20 ms: a 5–12 ms pitch period and its multiples would otherwise dominate.
 * Frames are capped so a 20-minute episode still costs about a second.
 */
export function cepstrumEcho(pcm: Int16Array, rate = ANALYSIS_RATE): CepstrumEcho | null {
    const size = 8192;
    const frames = Math.floor(pcm.length / size);
    if (frames < 2) return null;
    const step = Math.max(1, Math.floor(frames / 400));
    const logPower = new Float64Array(size);
    const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    let used = 0;
    for (let f = 0; f < frames; f += step) {
        const re = new Float64Array(size);
        const im = new Float64Array(size);
        for (let i = 0; i < size; i += 1) re[i] = ((pcm[f * size + i] as number) / 32768) * (window[i] as number);
        fft(re, im);
        for (let k = 0; k < size; k += 1) {
            logPower[k] =
                (logPower[k] as number) + Math.log(Math.max((re[k] as number) ** 2 + (im[k] as number) ** 2, 1e-20));
        }
        used += 1;
    }
    if (used === 0) return null;
    for (let k = 0; k < size; k += 1) logPower[k] = (logPower[k] as number) / used;
    // The real cepstrum is the inverse transform of the (real, even) log spectrum; fft/N is that inverse.
    const re = Float64Array.from(logPower);
    const im = new Float64Array(size);
    fft(re, im);
    const cepstrum = Float64Array.from(re, (value) => Math.abs(value) / size);
    const perMs = rate / 1000;
    const lo = Math.max(2, Math.round(20 * perMs));
    const hi = Math.min(Math.floor(size / 2) - 1, Math.round(120 * perMs));
    const slice: number[] = [];
    for (let q = lo; q <= hi; q += 1) slice.push(cepstrum[q] as number);
    slice.sort((a, b) => a - b);
    const floor = percentile(slice, 50);
    let best = { q: lo, value: 0 };
    for (let q = lo; q <= hi; q += 1) {
        const value = cepstrum[q] as number;
        if (value > best.value) best = { q, value };
    }
    const prominenceDb = 20 * Math.log10(Math.max(best.value, 1e-12) / Math.max(floor, 1e-12));
    return { delayMs: Math.round((best.q / perMs) * 10) / 10, prominenceDb: Number(prominenceDb.toFixed(1)) };
}

/** Average power spectrum over Hann-windowed 2048-sample frames, plus bands/centroid/rolloff. */
export function spectrum(pcm: Int16Array, rate = ANALYSIS_RATE): BandPowers {
    const size = 2048;
    const frames = Math.floor(pcm.length / size);
    const power = new Float64Array(size / 2);
    const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    for (let f = 0; f < frames; f += 1) {
        const re = new Float64Array(size);
        const im = new Float64Array(size);
        for (let i = 0; i < size; i += 1) re[i] = ((pcm[f * size + i] as number) / 32768) * (window[i] as number);
        fft(re, im);
        for (let k = 0; k < size / 2; k += 1) {
            power[k] = (power[k] as number) + (re[k] as number) ** 2 + (im[k] as number) ** 2;
        }
    }
    if (frames > 0) for (let k = 0; k < power.length; k += 1) power[k] = (power[k] as number) / frames;
    const binHz = rate / size;
    const total = power.reduce((a, b) => a + b, 0) || 1;
    const bands: Record<string, number> = {};
    for (const [label, low, high] of BAND_EDGES) {
        const lo = Math.max(1, Math.floor(low / binHz));
        const hi = Math.min(power.length - 1, Math.ceil(high / binHz));
        let sum = 0;
        for (let k = lo; k <= hi; k += 1) sum += power[k] as number;
        bands[label] = Number((10 * Math.log10(Math.max(sum / total, 1e-20))).toFixed(1));
    }
    let weighted = 0;
    let cumulative = 0;
    let rolloff = 0;
    for (let k = 1; k < power.length; k += 1) {
        const p = power[k] as number;
        weighted += p * k * binHz;
        cumulative += p;
        if (rolloff === 0 && cumulative >= total * 0.85) rolloff = k * binHz;
    }
    return { bands, centroidHz: Math.round(weighted / total), rolloff85Hz: Math.round(rolloff) };
}

/** Boxy = the 250–500 Hz band sits above the 2–4 kHz band (a hollow, cupped read). */
export function boxinessDb(bands: BandPowers): number {
    return Number((((bands.bands['250-500'] as number) - (bands.bands['2k-4k'] as number)) as number).toFixed(1));
}

export function analyse(file: string): AudioReport {
    const meta = probe(file);
    const pcm = decodeMono(file);
    if (pcm.length === 0) throw new Error(`${file}: decoded no audio samples`);
    const env = envelope(pcm);
    let peak = 0;
    let sum = 0;
    let dc = 0;
    let clipped = 0;
    for (let i = 0; i < pcm.length; i += 1) {
        const s = (pcm[i] as number) / 32768;
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
        if (abs >= 0.999) clipped += 1;
        sum += s * s;
        dc += s;
    }
    const rms = Math.sqrt(sum / pcm.length);
    const quantiles = envelopeQuantiles(env);
    const decay = decayCurve(env);
    const cepstrum = cepstrumEcho(pcm);
    const echo = echoMeasure(env);
    const spec = spectrum(pcm);

    const flags: string[] = [];
    if (quantiles.p20 > THRESHOLDS.pauseFloorDb) flags.push(`washy-pauses:${quantiles.p20}dB`);
    if (decay.offsets > 0 && decay.at200 > THRESHOLDS.decay200Db) flags.push(`reverb-tail:${decay.at200}dB@200ms`);
    // A strong tail never lets the level fall 20 dB below the phrase level, so no offset qualifies:
    // absence of quiet runs, together with a high pause floor, IS the reverb finding.
    if (decay.offsets === 0 && quantiles.p20 > THRESHOLDS.pauseFloorDb) flags.push('no-quiet-runs');
    if (echo !== null && echo.strength >= THRESHOLDS.echoStrength) flags.push(`echo:${echo.lagMs}ms@${echo.strength}`);
    if (cepstrum !== null && cepstrum.prominenceDb >= THRESHOLDS.cepstrumDb) {
        flags.push(`cepstral-echo:${cepstrum.delayMs}ms@${cepstrum.prominenceDb}dB`);
    }
    if (clipped > 0) flags.push(`clipped:${clipped}`);

    return {
        file,
        sampleRate: meta.sampleRate,
        seconds: Math.round((pcm.length / ANALYSIS_RATE) * 10) / 10,
        peakDbfs: Number((20 * Math.log10(Math.max(peak, 1e-7))).toFixed(1)),
        rmsDbfs: Number((20 * Math.log10(Math.max(rms, 1e-7))).toFixed(1)),
        crestDb: Number((20 * Math.log10(Math.max(peak, 1e-7) / Math.max(rms, 1e-7))).toFixed(1)),
        dcOffset: Number((dc / pcm.length).toFixed(5)),
        clippedSamples: clipped,
        quantiles,
        pauseFloorDb: quantiles.p20,
        decay,
        cepstrum,
        echo,
        spectrum: spec,
        flags,
    };
}

/** Corrective chain for a REFERENCE clip: not a de-reverb, but it removes the boxy room tone. */
export const TREAT_FILTER =
    'highpass=f=80,equalizer=f=320:t=q:w=1.2:g=-3.5,equalizer=f=3000:t=q:w=1.0:g=2,acompressor=threshold=-18dB:ratio=2.5:attack=8:release=180,alimiter=limit=0.95';

export function treat(input: string, output: string): void {
    const { sampleRate } = probe(input);
    const run = spawnSync(
        'ffmpeg',
        [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            input,
            '-af',
            TREAT_FILTER,
            '-ar',
            String(sampleRate),
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            output,
        ],
        { encoding: 'buffer' },
    );
    if (run.status !== 0) throw new Error(`ffmpeg treat failed: ${run.stderr?.toString().trim()}`);
}

function printReport(report: AudioReport, baseline?: AudioReport): void {
    const spec = report.spectrum;
    console.log(`\n${report.file}`);
    console.log(
        `  ${report.seconds}s @ ${report.sampleRate} Hz · peak ${report.peakDbfs} dBFS · rms ${report.rmsDbfs} dBFS · crest ${report.crestDb} dB · dc ${report.dcOffset}`,
    );
    console.log(
        `  decay 50/100/200 ms: ${report.decay.at50}/${report.decay.at100}/${report.decay.at200} dB · tail ${report.decay.tailMs} ms over ${report.decay.offsets} offsets`,
    );
    console.log(
        `  pauseFloor ${report.pauseFloorDb} dB (p05/p20/p50 ${report.quantiles.p05}/${report.quantiles.p20}/${report.quantiles.p50}) · cepstrum ${
            report.cepstrum === null ? 'n/a' : `${report.cepstrum.delayMs} ms @ ${report.cepstrum.prominenceDb} dB`
        } · echo ${report.echo === null ? 'none' : `${report.echo.lagMs} ms @ ${report.echo.strength}`} · boxy ${boxinessDb(spec)} dB`,
    );
    console.log(`  centroid ${spec.centroidHz} Hz · rolloff85 ${spec.rolloff85Hz} Hz`);
    console.log(
        `  bands ${Object.entries(spec.bands)
            .map(([label, db]) => `${label}:${db}`)
            .join('  ')}`,
    );
    if (baseline !== undefined) {
        const delta = Object.entries(spec.bands)
            .map(
                ([label, db]) => `${label}:${((db as number) - (baseline.spectrum.bands[label] as number)).toFixed(1)}`,
            )
            .join('  ');
        console.log(`  Δvs baseline ${delta}`);
    }
    console.log(`  verdict ${report.flags.length === 0 ? 'no flag' : report.flags.join(', ')}`);
}

export async function main(argv: string[]): Promise<void> {
    const files: string[] = [];
    let baseline: string | undefined;
    let json = false;
    let treatMode: [string, string] | undefined;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] as string;
        if (arg === '--json') {
            json = true;
            continue;
        }
        if (arg === '--baseline') {
            i += 1;
            baseline = argv[i] as string;
            continue;
        }
        if (arg === '--treat') {
            treatMode = [argv[i + 1] as string, argv[i + 2] as string];
            i += 2;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            console.log(
                'usage: kk stage audio-quality [--json] [--baseline <file>] <file…>\n       kk stage audio-quality --treat <reference-in> <reference-out>',
            );
            return;
        }
        files.push(arg);
    }
    if (treatMode !== undefined) {
        treat(treatMode[0], treatMode[1]);
        console.log(`treated ${treatMode[0]} -> ${treatMode[1]}\n  chain ${TREAT_FILTER}`);
        return;
    }
    if (files.length === 0) {
        console.error('usage: kk stage audio-quality [--json] [--baseline <file>] <file…>');
        process.exit(2);
    }
    const baselineReport = baseline === undefined ? undefined : analyse(baseline);
    const reports = files.map((file) => analyse(file));
    if (json) {
        console.log(
            JSON.stringify(baselineReport === undefined ? reports : { baseline: baselineReport, reports }, null, 2),
        );
        return;
    }
    for (const report of reports) printReport(report, baselineReport);
}

/**
 * Stage entry point: `kk stage audio-quality [--json] [--baseline <file>] <file…>`.
 *
 * The stage runner passes the args after the stage name, so this is the same parser the direct
 * `bun run audio:quality` entry uses — one body, two spellings.
 */
export async function runAudioQuality(args: string[]): Promise<void> {
    await main(args);
}

if (import.meta.main) await runAudioQuality(process.argv.slice(2));
