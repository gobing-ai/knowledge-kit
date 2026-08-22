import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import { concatWavs } from './concat';
import { isMp3Requested, type Mp3Transcoder, transcodeWavToMp3 } from './mp3';
import { auditVoiceSegments } from './qc';
import { createVoiceboxClient, type VoiceboxClient, type VoiceboxGenerateBody } from './voicebox-client';
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

    try {
        // 1. Health check
        await client.health();

        // 2. Parse docs to VoiceScript
        const envDefaultProfile = process.env.VOICEBOX_DEFAULT_PROFILE;
        const scripts = docs.map((doc) => parseDocToVoiceScript(doc, envDefaultProfile));
        const combinedScript = mergeVoiceScripts(scripts, docs, envDefaultProfile);

        // 3. Validate VoiceScript
        validateVoiceScript(combinedScript);

        // 4. Generate each segment
        const segmentWavs: Uint8Array[] = [];
        const segmentGaps: number[] = [];
        const segmentMetadata: Array<{
            generationId: string;
            profile: string;
            speaker?: string;
            emotion?: string;
            duration: number;
        }> = [];
        let totalDuration = 0;

        for (const segment of combinedScript.segments) {
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

            const engine = segment.engine ?? speakerConfig?.engine ?? combinedScript.default_engine;
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

            const { id } = await client.generate(generateBody);
            const history = await client.waitUntilDone(id);
            if (history.status === 'failed') {
                throw new Error(
                    `Voicebox generation failed for profile "${resolvedProfile.name}": ${history.error || 'status failed'}`,
                );
            }

            const wavBytes = await client.downloadAudio(id);
            const gap = segment.gap_ms ?? 0;

            segmentWavs.push(wavBytes);
            segmentGaps.push(gap);

            const segDuration = history.duration ?? 0;
            totalDuration += segDuration + gap / 1000;
            segmentMetadata.push({
                generationId: id,
                profile: resolvedProfile.name,
                speaker: segment.speaker,
                emotion: rawEmotion,
                duration: segDuration,
            });
        }

        // 5. Concatenate audio
        const concatenatedWav = concatWavs(segmentWavs, segmentGaps);
        await fs.ensureDir(outDir);
        await Bun.write(audioPath, concatenatedWav);

        const metadata: Record<string, unknown> = {
            generator: 'kk:voice-gen',
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
