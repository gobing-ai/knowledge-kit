import { z } from 'zod';

/** One ingested document unit; `body` is the primary text/markdown payload. */
export const DocSchema = z.object({
    id: z.string(),
    body: z.string(),
    title: z.string().optional(),
    sourceUri: z.string().optional(),
    mediaType: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Generator article / content output. */
export const ContentSchema = z.object({
    body: z.string(),
    title: z.string().optional(),
    format: z.string().default('markdown'),
    outline: z.string().optional(),
    references: z
        .array(
            z.object({
                url: z.string().optional(),
                title: z.string().optional(),
                cite: z.string().optional(),
            }),
        )
        .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Publish outcome; fail-loud path uses `ok: false` + `error`. */
export const ResultSchema = z.object({
    ok: z.boolean(),
    target: z.string(),
    url: z.string().optional(),
    id: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Per-target outcome in the aggregate result (spec §3.1). */
export const TargetOutcomeSchema = z.object({
    target: z.string(),
    ok: z.boolean(),
    status: z.enum(['published', 'failed', 'skipped']),
    url: z.string().optional(),
    id: z.string().optional(),
    error: z.string().optional(),
    durationMs: z.number().optional(),
    /** Transport-provided passthrough (e.g. surfdash-pub postPath) for downstream steps. */
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** Aggregate partial-success result written to `--out` (spec §3.1). */
export const AggregateResultSchema = z.object({
    ok: z.boolean(),
    summary: z.object({ total: z.number(), succeeded: z.number(), failed: z.number(), skipped: z.number() }),
    targets: z.array(TargetOutcomeSchema),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

/** List of documents (ingestion output / generator input). */
export const DocListSchema = z.array(DocSchema);

/**
 * omni-voice-gen audio output Content (docs/design/omni-voice-gen.md §4): `format: "audio"`
 * with generator-pinned metadata. Extra metadata keys pass through (QC/segment detail may grow).
 */
export const omniVoiceGenContentSchema = ContentSchema.extend({
    format: z.literal('audio'),
    metadata: z.looseObject({
        generator: z.literal('kk:omni-voice-gen'),
        audioPath: z.string(),
        duration: z.number(),
        segments: z.array(
            z.looseObject({
                generationId: z.string(),
                profile: z.string(),
                speaker: z.string().optional(),
                emotion: z.string().optional(),
                duration: z.number(),
                verifyRetries: z.number(),
                transcription: z.string().optional(),
                loudnessDip: z.boolean().optional(),
            }),
        ),
        mp3Path: z.string().optional(),
        qc: z.record(z.string(), z.unknown()).optional(),
    }),
});

/** Vertical visual treatment: Ken-Burns editorial slides, a talking head, or slides with a PiP host bubble. */
export const VideoVisualModeSchema = z.enum(['editorial', 'avatar', 'hybrid-pip']);

/** Renderer that produced the visual layer; the local provider ships first, Colab GPU providers follow. */
export const VideoRenderProviderSchema = z.enum(['local-ken-burns', 'wan21-i2v', 'musetalk', 'echomimic-v2']);

/**
 * video-gen vertical short Content (docs/design/short-form-video-promotion.md §2): `format: "video"`
 * with generator-pinned metadata describing the rendered 9:16 MP4. Extra metadata keys pass through
 * so providers can add Colab detail (CCU estimates, warnings) without another schema version.
 */
export const videoGenContentSchema = ContentSchema.extend({
    format: z.literal('video'),
    metadata: z.looseObject({
        generator: z.literal('kk:video-gen'),
        videoPath: z.string().min(1),
        coverPath: z.string().optional(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().int().positive(),
        durationSec: z.number().positive(),
        visualMode: VideoVisualModeSchema,
        renderProvider: VideoRenderProviderSchema,
        fallbackUsed: z.boolean().optional(),
        warnings: z.array(z.string()).optional(),
        ccuEstimated: z.number().nonnegative().optional(),
        captionsPath: z.string().optional(),
        tags: z.array(z.string()).optional(),
    }),
});

/** Inferred document unit from {@link DocSchema}. */
export type Doc = z.infer<typeof DocSchema>;
/** Inferred generator content from {@link ContentSchema}. */
export type Content = z.infer<typeof ContentSchema>;
/** Inferred publish result from {@link ResultSchema}. */
export type Result = z.infer<typeof ResultSchema>;
/** Inferred omni-voice-gen audio content from {@link omniVoiceGenContentSchema}. */
export type OmniVoiceGenContent = z.infer<typeof omniVoiceGenContentSchema>;
/** Inferred video-gen vertical short content from {@link videoGenContentSchema}. */
export type VideoGenContent = z.infer<typeof videoGenContentSchema>;
/** Inferred vertical visual mode from {@link VideoVisualModeSchema}. */
export type VideoVisualMode = z.infer<typeof VideoVisualModeSchema>;
/** Inferred render provider from {@link VideoRenderProviderSchema}. */
export type VideoRenderProvider = z.infer<typeof VideoRenderProviderSchema>;
/** Inferred per-target fan-out outcome from {@link TargetOutcomeSchema}. */
export type TargetOutcome = z.infer<typeof TargetOutcomeSchema>;
/** Inferred fan-out aggregate from {@link AggregateResultSchema}. */
export type AggregateResult = z.infer<typeof AggregateResultSchema>;
