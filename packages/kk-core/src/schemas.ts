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

/** List of documents (ingestion output / generator input). */
export const DocListSchema = z.array(DocSchema);

/** Inferred document unit from {@link DocSchema}. */
export type Doc = z.infer<typeof DocSchema>;
/** Inferred generator content from {@link ContentSchema}. */
export type Content = z.infer<typeof ContentSchema>;
/** Inferred publish result from {@link ResultSchema}. */
export type Result = z.infer<typeof ResultSchema>;
