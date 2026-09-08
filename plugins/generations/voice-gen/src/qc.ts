import { type ParsedWav, parseWav } from './concat';
import type { VoiceboxClient } from './voicebox-client';
import type { VoiceScript, VoiceSegment } from './voicescript';

export interface SegmentQualityAudit {
    segmentIndex: number;
    text: string;
    duration: number;
    expectedDurationRange: [number, number];
    speechRateCharsPerSec: number;
    transcription?: string;
    repetitionDetected: boolean;
    durationAnomaly: boolean;
    /** True when a loudness dip (voice dent) was detected in the final audio and survived regeneration. */
    loudnessDip?: boolean;
    issues: string[];
    passed: boolean;
}

export interface VoiceQualityReport {
    passed: boolean;
    totalDuration: number;
    overallScore: number; // 0 to 100
    segmentAudits: SegmentQualityAudit[];
    criticalIssues: string[];
}

/**
 * Detects stuttering, repetitive loops, or mode collapse in text.
 * E.g., "酒酒酒酒酒", "这种这种这种这种", "我会帮您收拾到最新的节目我会帮您收拾到最新的节目"
 */
export function detectRepetitions(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length < 4) {
        return false;
    }

    // 1. Single character repeated 3+ times (e.g. "酒酒酒" or "诶诶诶")
    if (/(.)\1{2,}/u.test(trimmed)) {
        return true;
    }

    // 2. 2-to-3 character word repeated 3+ times (e.g. "这种这种这种")
    if (/(.{2,3}?)\1{2,}/u.test(trimmed)) {
        return true;
    }

    // 3. 4-to-30 character phrase repeated 2+ times consecutively
    if (/(.{4,30}?)\1{1,}/u.test(trimmed)) {
        return true;
    }

    return false;
}

/** Below this character-bigram coverage, audio is treated as looped/garbage (dogfood 2026-09-03). */
export const TRANSCRIPTION_FIDELITY_FLOOR = 0.15;

/**
 * Character-bigram coverage of the source text by the transcription. Whisper zh ASR is
 * lossy on good audio (0.23–0.8 across dogfood runs); looped/garbage TTS audio scores ≤0.05.
 */
export function transcriptionFidelity(source: string, transcription: string): number {
    const bigrams = (t: string): Set<string> => {
        const clean = t.replace(/\s+/g, '');
        return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, i) => clean.slice(i, i + 2)));
    };
    const a = bigrams(source);
    const b = bigrams(transcription);
    if (a.size === 0) return 1;
    let inter = 0;
    for (const g of a) if (b.has(g)) inter++;
    return inter / a.size;
}

/**
 * A ~1s window whose RMS sits below this fraction of its louder neighbour is a dent.
 * Calibrated on dogfood 2026-09-08: audible Qwen3-TTS collapses measured 0.24–0.37 of
 * the louder neighbour (rms 0.033–0.048); normal quieter phrases sit ≥0.45.
 */
export const DIP_RATIO = 0.4;

/** A window below this RMS is a real pause (silence), not a dent — dents are quiet-but-not-silent. */
export const DIP_SILENCE_FLOOR = 0.008;

/** Windows above this absolute RMS are normal quieter narration, not collapses (file p25 ≈ 0.08). */
export const DIP_ABS_CEILING = 0.06;

/** Neighbour windows below this RMS carry no speech signal to compare against. */
export const DIP_NEIGHBOR_FLOOR = 0.02;

/**
 * Detect a loudness dip (voice dent): a ~1s window of quiet-but-not-silent audio
 * sandwiched between louder speech on both sides. Qwen3-TTS (AR clone, MLX) stochastically
 * collapses loudness mid-utterance on long text (dogfood 2026-09-08 A/B: same text regenerated
 * clean; official docs list "loudness drops" among AR long-form instabilities). The detector
 * returns the first dip position; voice-gen regenerates on it (stochastic → retry usually clears).
 * Returns null when the wav is too short or unparseable.
 */
export function detectLoudnessDip(wav: Uint8Array): { dip: boolean; dipAtSec: number | null } {
    let parsed: ParsedWav;
    try {
        parsed = parseWav(wav);
    } catch {
        return { dip: false, dipAtSec: null };
    }
    if (parsed.bitsPerSample !== 16 && parsed.bitsPerSample !== 8) return { dip: false, dipAtSec: null };
    const rate = parsed.sampleRate;
    if (rate <= 0) return { dip: false, dipAtSec: null };
    const data = parsed.dataBytes;
    const bytesPerSample = parsed.bitsPerSample === 8 ? 1 : 2;
    const frameBytes = parsed.numChannels * bytesPerSample;
    const totalFrames = Math.floor(data.length / frameBytes);
    const windowFrames = rate; // 1s windows
    if (totalFrames < windowFrames * 5) return { dip: false, dipAtSec: null };

    const sampleAt = (frame: number, channel = 0): number => {
        const off = (frame * parsed.numChannels + channel) * bytesPerSample;
        if (bytesPerSample === 1) return ((data[off] ?? 0) - 128) / 128;
        let s = (data[off] ?? 0) | ((data[off + 1] ?? 0) << 8);
        if (s >= 0x8000) s -= 0x10000;
        return s / 32768;
    };

    // Non-overlapping 1s windows (step = window): a dent spans ~1s → exactly one window,
    // with loud speech before and after. Frame-stepped windows would smear a 1s dent into a
    // 24000-index plateau with equal neighbours, invisible to any adjacent comparison.
    const nWins = Math.floor(totalFrames / windowFrames);
    if (nWins < 7) return { dip: false, dipAtSec: null };
    const windowRms: number[] = [];
    for (let w = 0; w < nWins; w++) {
        const base = w * windowFrames;
        let sum = 0;
        for (let f = base; f < base + windowFrames; f++) {
            const v = sampleAt(f);
            sum += v * v;
        }
        windowRms.push(Math.sqrt(sum / windowFrames));
    }

    // A dent = one ~1s window of quiet-but-not-silent audio (rms 0.008..0.06) that is
    // notably quieter than BOTH its immediate 1s neighbours (ratio < 0.4) — an isolated
    // loudness collapse amid otherwise steady speech. Non-overlapping windows keep
    // neighbour semantics exact (a frame-stepped window would smear a 1s dent into a
    // many-index plateau with equal neighbours). Sentence pauses are excluded by the
    // silence floor; normal quieter phrases by the absolute ceiling (calibrated on
    // dogfood 2026-09-08 prod audio: audible dents 0.047/0.042/0.048 vs normal p25 0.080).
    for (let j = 1; j < windowRms.length - 1; j++) {
        const center = windowRms[j] ?? 0;
        if (center <= DIP_SILENCE_FLOOR) continue; // real pause, not a dent
        if (center >= DIP_ABS_CEILING) continue; // normal quieter narration
        const nbr = Math.max(windowRms[j - 1] ?? 0, windowRms[j + 1] ?? 0);
        if (nbr <= DIP_NEIGHBOR_FLOOR) continue;
        if (center < nbr * DIP_RATIO) return { dip: true, dipAtSec: j };
    }
    return { dip: false, dipAtSec: null };
}

/**
 * Compute expected speech duration range given text and language.
 */
export function computeExpectedDurationRange(text: string, language = 'zh'): [number, number] {
    const cleanText = text.replace(/\[[^\]]+\]/g, '').trim(); // ignore [laugh] tags
    const isZh = language.toLowerCase().startsWith('zh');

    if (isZh) {
        const charCount = cleanText.replace(/\s+/g, '').length;
        const minSec = Math.max(1.0, charCount / 7.0);
        const maxSec = Math.max(2.5, charCount / 2.2 + 2.5);
        return [Number(minSec.toFixed(2)), Number(maxSec.toFixed(2))];
    }

    const wordCount = cleanText.split(/\s+/).filter(Boolean).length;
    const minSec = Math.max(1.0, wordCount / 5.0);
    const maxSec = Math.max(2.5, wordCount / 1.5 + 2.5);
    return [Number(minSec.toFixed(2)), Number(maxSec.toFixed(2))];
}

/**
 * Audit the quality of synthesized voice segments.
 */
export async function auditVoiceSegments(
    script: VoiceScript,
    segmentWavs: Uint8Array[],
    segmentMetadata: Array<{
        generationId: string;
        profile: string;
        duration: number;
        transcription?: string;
        verifyRetries?: number;
        loudnessDip?: boolean;
    }>,
    client?: VoiceboxClient,
): Promise<VoiceQualityReport> {
    const audits: SegmentQualityAudit[] = [];
    const criticalIssues: string[] = [];
    let totalDuration = 0;

    for (let i = 0; i < script.segments.length; i++) {
        const segment = script.segments[i] as VoiceSegment;
        const meta = segmentMetadata[i];
        const wavBytes = segmentWavs[i];
        const duration = meta?.duration ?? 0;
        totalDuration += duration;

        const lang = segment.language ?? script.language ?? 'zh';
        const [minExpected, maxExpected] = computeExpectedDurationRange(segment.text, lang);
        const cleanLen = segment.text.replace(/\s+/g, '').length;
        const speechRate = duration > 0 ? cleanLen / duration : 0;

        const issues: string[] = [];
        let durationAnomaly = false;

        // Check duration anomaly: duration exceeds 1.5x max expected or rate < 1.8 chars/sec on >= 8 chars
        if (cleanLen >= 8 && (duration > maxExpected * 1.5 || speechRate < 1.8)) {
            durationAnomaly = true;
            issues.push(
                `Duration anomaly: ${duration.toFixed(2)}s is unusually long for ${cleanLen} chars (expected ${minExpected}-${maxExpected}s, rate ${speechRate.toFixed(1)} chars/s)`,
            );
        }

        let transcriptionText: string | undefined;
        let repetitionDetected = false;

        if (meta && typeof meta.transcription === 'string') {
            // Precomputed during generation (verify step) — reuse instead of re-transcribing.
            transcriptionText = meta.transcription;
        } else if (client && wavBytes && typeof client.transcribe === 'function') {
            try {
                const trans = await client.transcribe(wavBytes, lang);
                transcriptionText = trans.text;
            } catch {
                // Transcription service unavailable or optional
            }
        }
        if (transcriptionText !== undefined && detectRepetitions(transcriptionText)) {
            repetitionDetected = true;
            // Whisper loops over trailing gap/silence and emits phantom repetitions whose
            // audio duration stays normal; a real TTS loop always inflates duration.
            // Fail only when the duration channel corroborates (dogfood 2026-09-03:
            // 15/22 segments flagged with in-range durations = ASR artifacts).
            if (durationAnomaly) {
                issues.push(
                    `Repetition hallucination corroborated by duration anomaly: "${transcriptionText.slice(0, 80)}..."`,
                );
            }
        }

        let lowFidelity = false;
        if (transcriptionText !== undefined) {
            const fidelity = transcriptionFidelity(segment.text, transcriptionText);
            if (fidelity < TRANSCRIPTION_FIDELITY_FLOOR) {
                lowFidelity = true;
                issues.push(
                    `Transcription fidelity ${fidelity.toFixed(2)} below ${TRANSCRIPTION_FIDELITY_FLOOR} — audio diverges from source text: "${transcriptionText.slice(0, 80)}..."`,
                );
            }
        }

        // Loudness dip (voice dent) that survived regeneration — record, don't fail the
        // pipeline: the verify loop already regenerated on it, and a stubborn single dent
        // is better surfaced than a whole-episode failure (dogfood 2026-09-08).
        let loudnessDip = false;
        if (meta?.loudnessDip === true) {
            loudnessDip = true;
            issues.push(
                `Loudness dip persisted after regeneration (voice-gen auto-retried with varied seed; verifyRetries=${meta.verifyRetries ?? 0})`,
            );
        }

        const passed = !durationAnomaly && !(repetitionDetected && durationAnomaly) && !lowFidelity;
        if (!passed) {
            criticalIssues.push(`Segment ${i + 1} (${meta?.profile || 'Unknown'}): ${issues.join('; ')}`);
        }

        audits.push({
            segmentIndex: i,
            text: segment.text,
            duration,
            expectedDurationRange: [minExpected, maxExpected],
            speechRateCharsPerSec: Number(speechRate.toFixed(2)),
            transcription: transcriptionText,
            repetitionDetected,
            durationAnomaly,
            loudnessDip,
            issues,
            passed,
        });
    }

    const passedCount = audits.filter((a) => a.passed).length;
    const overallScore = audits.length > 0 ? Math.round((passedCount / audits.length) * 100) : 100;
    const allPassed = criticalIssues.length === 0;

    return {
        passed: allPassed,
        totalDuration: Number(totalDuration.toFixed(2)),
        overallScore,
        segmentAudits: audits,
        criticalIssues,
    };
}
