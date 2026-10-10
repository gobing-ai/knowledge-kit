import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { applySpeed, concatWavs } from './concat';
import { isMp3Requested, type Mp3Transcoder, transcodeWavToMp3 } from './mp3';
import { auditVoiceSegments, detectLoudnessDip, TRANSCRIPTION_FIDELITY_FLOOR, transcriptionFidelity } from './qc';
import { createVoiceboxClient, type VoiceboxClient, type VoiceboxGenerateBody } from './voicebox-client';
import { ensureVoiceboxRunning } from './voicebox-server';
import {
    mergeVoiceScripts,
    parseDocToVoiceScript,
    resolveEffectsChain,
    resolveInstruct,
    VOICEBOX_CHUNK_CHARS_DEFAULT,
    VOICEBOX_CHUNK_CHARS_MAX,
    VOICEBOX_CHUNK_CHARS_MIN,
    VOICEBOX_CROSSFADE_MS_DEFAULT,
    VOICEBOX_CROSSFADE_MS_MAX,
    VOICEBOX_CROSSFADE_MS_MIN,
    validateVoiceScript,
} from './voicescript';

export * from './concat';
export * from './mp3';
export * from './qc';
export * from './voicebox-client';
export * from './voicescript';

const EMPTY_CONTENT: Content = {
    title: 'Notice',
    body: '# Notice\nNo documents provided for generation.',
    format: 'markdown',
    references: [],
};

/**
 * Read validated Doc[] input, generate validated audio Content via Voicebox, and write output files.
 */
export async function processGeneratorIO(
    inputPath: string,
    outputPath: string,
    clientOverride?: VoiceboxClient,
    transcodeMp3?: Mp3Transcoder,
    generator = 'kk:voice-gen',
): Promise<void> {
    const fs = createNodeFileSystem();
    const outDir = dirname(outputPath);
    const outStem = basename(outputPath, extname(outputPath));
    const audioPath = resolve(join(outDir, `${outStem}.wav`));
    const mp3Path = resolve(join(outDir, `${outStem}.mp3`));
    const wantMp3 = isMp3Requested();

    // Delete existing output and sibling audio at start
    await fs.deleteFile(outputPath);
    await fs.deleteFile(audioPath);
    await fs.deleteFile(mp3Path);

    let docs: Doc[];
    try {
        const raw = await fs.readFile(inputPath);
        docs = DocListSchema.parse(JSON.parse(raw));
    } catch (err: unknown) {
        throw new Error(`Invalid DocList input: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (docs.length === 0) {
        await fs.ensureDir(outDir);
        await fs.writeFile(outputPath, JSON.stringify(ContentSchema.parse(EMPTY_CONTENT), null, 2));
        return;
    }

    const client = clientOverride ?? createVoiceboxClient();

    // Auto-start the local server when it is down — only on the default client path;
    // tests inject clientOverride and skip the spawn entirely. With vdriver=ominivoice
    // (the default) this plugin never runs, so no server is needed at all.
    if (!clientOverride) {
        await ensureVoiceboxRunning();
    }

    try {
        // 1. Health check
        await client.health();

        // 2. Parse docs to VoiceScript
        const envDefaultProfile = process.env.VOICEBOX_DEFAULT_PROFILE;
        const scripts = docs.map((doc) => parseDocToVoiceScript(doc, envDefaultProfile));
        const combinedScript = mergeVoiceScripts(scripts, docs, envDefaultProfile);

        // 3. Validate VoiceScript
        validateVoiceScript(combinedScript);

        // Local render can take hours; per-segment progress + an optional total budget keep
        // long renders observable and bounded (dogfood 2026-09-12: healthy 72-min render read as a hang).
        const renderStartedAt = Date.now();
        const maxRunMs = process.env.VOICE_GEN_MAX_RUN_MS ? parseInt(process.env.VOICE_GEN_MAX_RUN_MS, 10) : 0;
        echoError(`voice-gen: ${combinedScript.segments.length} segments queued for local render`);

        // 4. Generate each segment
        const segmentWavs: Uint8Array[] = [];
        const segmentGaps: number[] = [];
        const segmentMetadata: Array<{
            generationId: string;
            profile: string;
            speaker?: string;
            emotion?: string;
            duration: number;
            verifyRetries?: number;
            transcription?: string;
            loudnessDip?: boolean;
        }> = [];
        let totalDuration = 0;

        for (const [segIndex, segment] of combinedScript.segments.entries()) {
            if (maxRunMs > 0 && Date.now() - renderStartedAt > maxRunMs) {
                throw new Error(
                    `voice-gen: render budget ${maxRunMs}ms exceeded after ${segIndex}/${combinedScript.segments.length} segments — Voicebox may be wedged; raise VOICE_GEN_MAX_RUN_MS if the render is legitimately long`,
                );
            }
            const segStartedAt = Date.now();
            const speakerConfig = segment.speaker ? combinedScript.speakers?.[segment.speaker] : undefined;
            const profileTarget =
                segment.profile_id ??
                segment.profile ??
                speakerConfig?.profile_id ??
                speakerConfig?.profile ??
                combinedScript.default_profile_id ??
                combinedScript.default_profile ??
                envDefaultProfile ??
                (typeof docs[0]?.metadata?.voiceProfile === 'string' ? docs[0].metadata.voiceProfile : undefined);

            if (!profileTarget) {
                throw new Error(
                    'No voice profile specified for segment (set profile, profile_id, speaker profile, default_profile, default_profile_id, or VOICEBOX_DEFAULT_PROFILE)',
                );
            }

            const resolvedProfile = await client.resolveProfile(profileTarget);

            const engine =
                segment.engine ?? speakerConfig?.engine ?? combinedScript.default_engine ?? process.env.VOICEBOX_ENGINE;
            const language = segment.language ?? speakerConfig?.language ?? combinedScript.language ?? 'en';
            const rawInstruct = segment.instruct ?? speakerConfig?.instruct;
            const rawEmotion = segment.emotion ?? speakerConfig?.emotion ?? combinedScript.default_emotion;
            const instruct = resolveInstruct(rawInstruct, rawEmotion);

            const personality = segment.personality ?? speakerConfig?.personality ?? false;
            const seed = segment.seed ?? null;

            const effects_chain =
                segment.effects_chain ??
                resolveEffectsChain(undefined, segment.effect_preset) ??
                speakerConfig?.effects_chain ??
                resolveEffectsChain(undefined, speakerConfig?.effect_preset) ??
                combinedScript.default_effects_chain ??
                resolveEffectsChain(undefined, combinedScript.default_effect_preset) ??
                null;

            const envChunk = process.env.VOICEBOX_MAX_CHUNK_CHARS
                ? parseInt(process.env.VOICEBOX_MAX_CHUNK_CHARS, 10)
                : undefined;
            const envCrossfade = process.env.VOICEBOX_CROSSFADE_MS
                ? parseInt(process.env.VOICEBOX_CROSSFADE_MS, 10)
                : undefined;

            const max_chunk_chars =
                segment.max_chunk_chars ?? combinedScript.max_chunk_chars ?? envChunk ?? VOICEBOX_CHUNK_CHARS_DEFAULT;
            const crossfade_ms =
                segment.crossfade_ms ?? combinedScript.crossfade_ms ?? envCrossfade ?? VOICEBOX_CROSSFADE_MS_DEFAULT;

            if (max_chunk_chars < VOICEBOX_CHUNK_CHARS_MIN || max_chunk_chars > VOICEBOX_CHUNK_CHARS_MAX) {
                throw new Error(
                    `max_chunk_chars must be between ${VOICEBOX_CHUNK_CHARS_MIN} and ${VOICEBOX_CHUNK_CHARS_MAX}`,
                );
            }
            if (crossfade_ms < VOICEBOX_CROSSFADE_MS_MIN || crossfade_ms > VOICEBOX_CROSSFADE_MS_MAX) {
                throw new Error(
                    `crossfade_ms must be between ${VOICEBOX_CROSSFADE_MS_MIN} and ${VOICEBOX_CROSSFADE_MS_MAX}`,
                );
            }

            const generateBody: VoiceboxGenerateBody = {
                profile_id: resolvedProfile.id,
                text: segment.text,
                language,
                engine,
                instruct,
                max_chunk_chars,
                crossfade_ms,
                personality,
                normalize: true,
                seed,
                effects_chain,
            };

            // Timeout retry: a hung/timeout voicebox generation must not kill a multi-hour
            // run (dogfood daily-ai-news-20260903: segment 108/132 timed out at 600s and
            // failed the whole generate state after 140 minutes).
            //
            // Verify retry: qwen with cloned profiles occasionally emits contiguous loop
            // garbage (fidelity 0.00 vs >=0.23 zh ASR floor on real audio — dogfood
            // 2026-09-03). The server's runaway detector only catches gap-shaped failures,
            // so verify per segment via transcription fidelity and regenerate failures with
            // a varied seed and halved chunk size (mirrors the server's own retry policy).
            let wavBytes: Uint8Array | undefined;
            let segDuration = 0;
            let generationId = '';
            let transcription: string | undefined;
            let verifyRetries = 0;
            let loudnessDip = false;
            let lastError: unknown;
            let attemptBody = generateBody;
            // Verify-retry budget. Hosted TTS is billed per request against a daily quota
            // (Gemini Tier 1: 100/day), and each retry is a full re-synthesis — a 41-segment
            // episode with the default 2 retries asks for up to 123 requests and dies partway
            // through the render with no audio (daily-generate failures of 2026-10-06/07/09/10).
            // Lower it for a quota-bound driver; 0 keeps the dip/fidelity result for QC instead.
            const maxVerifyAttempts = Number.parseInt(process.env.VOICEBOX_MAX_VERIFY_ATTEMPTS ?? '2', 10) || 0;
            for (let verifyAttempt = 0; verifyAttempt <= maxVerifyAttempts && wavBytes === undefined; verifyAttempt++) {
                if (verifyAttempt > 0) {
                    verifyRetries = verifyAttempt;
                    const chunkChars = Math.max(VOICEBOX_CHUNK_CHARS_MIN, Math.floor(attemptBody.max_chunk_chars / 2));
                    attemptBody = {
                        ...generateBody,
                        seed: Math.floor(Math.random() * 2 ** 31),
                        max_chunk_chars: chunkChars,
                    };
                    echoError(
                        `voice-gen: regenerating segment with seed ${attemptBody.seed} and max_chunk_chars ${chunkChars}`,
                    );
                }
                let attemptBytes: Uint8Array | undefined;
                for (let attempt = 1; attempt <= 2 && attemptBytes === undefined; attempt++) {
                    try {
                        const { id } = await client.generate(attemptBody);
                        generationId = id;
                        // Long qwen segments synthesize slower than the fixed 600s deadline
                        // (live 2026-09-04: 171s-audio segment took >600s twice, both completed
                        // server-side). Scale the poll deadline with text length: 600s base
                        // (or VOICEBOX_TIMEOUT_MS) + 60s per 100 chars, ~2x observed worst case.
                        const envTimeout = process.env.VOICEBOX_TIMEOUT_MS
                            ? parseInt(process.env.VOICEBOX_TIMEOUT_MS, 10)
                            : 600000;
                        const waitTimeout = envTimeout + Math.ceil(segment.text.length / 100) * 60_000;
                        const history = await client.waitUntilDone(id, waitTimeout);
                        if (history.status === 'failed') {
                            throw new Error(
                                `Voicebox generation failed for profile "${resolvedProfile.name}": ${history.error || 'status failed'}`,
                            );
                        }
                        attemptBytes = await client.downloadAudio(id);
                        segDuration = history.duration ?? 0;
                    } catch (err: unknown) {
                        lastError = err;
                        if (attempt === 1) {
                            echoError(
                                `voice-gen: segment failed (${err instanceof Error ? err.message : String(err)}); retrying once`,
                            );
                        }
                    }
                }
                if (attemptBytes === undefined) {
                    throw lastError instanceof Error ? lastError : new Error(String(lastError));
                }
                if (typeof client.transcribe === 'function') {
                    try {
                        const trans = await client.transcribe(attemptBytes, language);
                        const fidelity = transcriptionFidelity(segment.text, trans.text);
                        if (fidelity < TRANSCRIPTION_FIDELITY_FLOOR && verifyAttempt < maxVerifyAttempts) {
                            echoError(
                                `voice-gen: transcription fidelity ${fidelity.toFixed(2)} below ${TRANSCRIPTION_FIDELITY_FLOOR} (looped/garbage audio): "${trans.text.slice(0, 80)}..."`,
                            );
                            continue;
                        }
                        transcription = trans.text;
                    } catch {
                        // Transcription unavailable — keep audio; the QC audit backstop decides.
                    }
                }
                // Voice dent gate: Qwen3-TTS stochastically collapses loudness mid-utterance on
                // long text; a dip that survives to the last verify attempt is recorded for QC
                // (dogfood 2026-09-08 A/B: same text regenerated clean, so retry usually clears).
                const dip = detectLoudnessDip(attemptBytes);
                loudnessDip = dip.dip;
                if (dip.dip && verifyAttempt < maxVerifyAttempts) {
                    echoError(`voice-gen: loudness dip detected at ${dip.dipAtSec ?? '?'}s — regenerating segment`);
                    continue;
                }
                wavBytes = attemptBytes;
            }
            if (wavBytes === undefined) {
                // Both network attempts and all verify attempts exhausted without audio.
                throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'no audio'));
            }

            const gap = segment.gap_ms ?? 0;
            const speed = segment.speed ?? 1;

            segmentWavs.push(applySpeed(wavBytes, speed));
            segmentGaps.push(gap);

            totalDuration += segDuration / speed + gap / 1000;
            segmentMetadata.push({
                generationId,
                profile: resolvedProfile.name,
                speaker: segment.speaker,
                emotion: rawEmotion,
                duration: segDuration / speed,
                verifyRetries,
                transcription,
                loudnessDip,
                ...(speed !== 1 ? { speed } : {}),
            });
            echoError(
                `voice-gen: segment ${segIndex + 1}/${combinedScript.segments.length} done in ${((Date.now() - segStartedAt) / 1000).toFixed(1)}s${verifyRetries ? ` (${verifyRetries} verify ${verifyRetries === 1 ? 'retry' : 'retries'})` : ''}`,
            );
        }

        // 5. Concatenate audio
        const concatenatedWav = concatWavs(segmentWavs, segmentGaps);
        await fs.ensureDir(outDir);
        await Bun.write(audioPath, concatenatedWav);

        const metadata: Record<string, unknown> = {
            generator,
            audioPath,
            duration: totalDuration,
            segments: segmentMetadata,
        };

        // 6. Quality Control Audit
        const qc = await auditVoiceSegments(combinedScript, segmentWavs, segmentMetadata, client);
        metadata.qc = qc;

        if (process.env.VOICE_GEN_FAIL_ON_QC === 'true' && !qc.passed) {
            throw new Error(`Voice Quality Control failed (${qc.overallScore}/100):\n${qc.criticalIssues.join('\n')}`);
        }

        if (wantMp3) {
            const transcode = transcodeMp3 ?? transcodeWavToMp3;
            await transcode(audioPath, mp3Path);
            metadata.mp3Path = mp3Path;
        }

        // 6. Build Content
        const content: Content = {
            title: combinedScript.title || docs[0]?.title || 'Generated voice',
            body: Bun.YAML.stringify(combinedScript),
            format: 'audio',
            references: [],
            metadata,
        };

        const validatedContent = ContentSchema.parse(content);
        await fs.writeFile(outputPath, JSON.stringify(validatedContent, null, 2));
    } catch (err: unknown) {
        await fs.deleteFile(outputPath);
        await fs.deleteFile(audioPath);
        await fs.deleteFile(mp3Path);
        throw err;
    }
}

export async function main(): Promise<number> {
    const { values } = parseArgs({
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });

    if (!values.in || !values.out) {
        echoError('voice-gen failed: Missing required arguments: --in and --out');
        return 1;
    }

    try {
        await processGeneratorIO(values.in, values.out);
        return 0;
    } catch (err: unknown) {
        echoError(`voice-gen failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
