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

/** Inferred document unit from {@link DocSchema}. */
export type Doc = z.infer<typeof DocSchema>;
/** Inferred generator content from {@link ContentSchema}. */
export type Content = z.infer<typeof ContentSchema>;
/** Inferred publish result from {@link ResultSchema}. */
export type Result = z.infer<typeof ResultSchema>;
/** Inferred omni-voice-gen audio content from {@link omniVoiceGenContentSchema}. */
export type OmniVoiceGenContent = z.infer<typeof omniVoiceGenContentSchema>;
/** Inferred per-target fan-out outcome from {@link TargetOutcomeSchema}. */
export type TargetOutcome = z.infer<typeof TargetOutcomeSchema>;
/** Inferred fan-out aggregate from {@link AggregateResultSchema}. */
export type AggregateResult = z.infer<typeof AggregateResultSchema>;
