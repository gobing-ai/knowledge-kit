import { z } from 'zod';
import { PluginKindSchema } from './kinds';

/** Zod schema for plugin.json manifest validation. */
export const PluginManifestSchema = z
    .object({
        name: z.string().min(1),
        kind: PluginKindSchema,
        entry: z.string().min(1),
        version: z.string().optional(),
        description: z.string().optional(),
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
