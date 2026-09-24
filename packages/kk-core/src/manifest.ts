import { z } from 'zod';
import { PluginKindSchema } from './kinds';

/** IO form of a declared auxiliary operation (0110 I3). */
export const OperationIOSchema = z.enum(['doc-list', 'markdown']);

/** Inferred IO form. */
export type OperationIO = z.infer<typeof OperationIOSchema>;

/** One declared auxiliary operation: input and output IO forms. */
const PluginOperationSchema = z.object({ input: OperationIOSchema, output: OperationIOSchema });

/** Inferred declared auxiliary operation from {@link PluginOperationSchema} (0155 R9). */
export type PluginOperation = z.infer<typeof PluginOperationSchema>;

/**
 * Zod schema for plugin.json manifest validation. Loose object (0155 R8): unknown keys are
 * preserved, not rejected — the Zod 4 idiom, consistent with `schemas.ts`.
 */
export const PluginManifestSchema = z.looseObject({
    name: z.string().min(1),
    kind: PluginKindSchema,
    entry: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    // Declared auxiliary operations (0110 I3): the executor validates and
    // dispatches an input form only when the manifest declares it. Without a
    // declaration the kind contract alone applies (publish = Content → Result).
    operations: z.record(z.string(), PluginOperationSchema).optional(),
});

/** Inferred plugin manifest from {@link PluginManifestSchema}. */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Parse and validate a plugin.json manifest.
 * @throws {z.ZodError} when validation fails
 */
export function parsePluginManifest(data: unknown): PluginManifest {
    return PluginManifestSchema.parse(data);
}
