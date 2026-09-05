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
    segmentMetadata: Array<{ generationId: string; profile: string; duration: number }>,
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

        if (client && wavBytes && typeof client.transcribe === 'function') {
            try {
                const trans = await client.transcribe(wavBytes, lang);

                transcriptionText = trans.text;
                if (detectRepetitions(transcriptionText)) {
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
            } catch {
                // Transcription service unavailable or optional
            }
        }

        // Fidelity gate: when the transcription diverges from the source near-totally, the
        // audio is looped/garbage regardless of duration (the published noise episodes scored
        // ≤0.05 while real-but-noisy zh ASR stays ≥0.23 — dogfood daily-ai-news-20260903).
        let lowFidelity = false;
        if (transcriptionText !== undefined) {
            const fidelity = transcriptionFidelity(segment.text, transcriptionText);
            if (fidelity < 0.15) {
                lowFidelity = true;
                issues.push(
                    `Transcription fidelity ${fidelity.toFixed(2)} below 0.15 — audio diverges from source text: "${transcriptionText.slice(0, 80)}..."`,
                );
            }
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
