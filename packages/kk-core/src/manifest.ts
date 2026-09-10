import { z } from 'zod';
import { PluginKindSchema } from './kinds';

/** IO form of a declared auxiliary operation (0110 I3). */
export const OperationIOSchema = z.enum(['doc-list', 'markdown']);

/** Inferred IO form. */
export type OperationIO = z.infer<typeof OperationIOSchema>;

/** One declared auxiliary operation: input and output IO forms. */
export interface PluginOperation {
    input: OperationIO;
    output: OperationIO;
}

/** Zod schema for plugin.json manifest validation. */
export const PluginManifestSchema = z
    .object({
        name: z.string().min(1),
        kind: PluginKindSchema,
        entry: z.string().min(1),
        version: z.string().optional(),
        description: z.string().optional(),
        // Declared auxiliary operations (0110 I3): the executor validates and
        // dispatches an input form only when the manifest declares it. Without a
        // declaration the kind contract alone applies (publish = Content → Result).
        operations: z.record(z.string(), z.object({ input: OperationIOSchema, output: OperationIOSchema })).optional(),
    })
    .passthrough();

/** Inferred plugin manifest from {@link PluginManifestSchema}. */
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/**
 * Parse and validate a plugin.json manifest.
 * @throws {z.ZodError} when validation fails
 */
export function parsePluginManifest(data: unknown): PluginManifest {
    return PluginManifestSchema.parse(data);
}
