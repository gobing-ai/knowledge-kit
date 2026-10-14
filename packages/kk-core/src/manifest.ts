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
 * A plugin-declared browser session (0277 R1): which named bot profile the plugin's own
 * probe routine drives and, optionally, the fixed non-secret URL a session opens. The
 * profile name doubles as the default `~/.config/kk/browser-profiles/<profileName>` dir,
 * so it shares the safe-name rule with bot metadata (`bot.json`). `homeUrl` is a trusted
 * plugin constant, still validated as plain http(s) without embedded credentials.
 */
export const BrowserSessionDescriptorSchema = z
    .object({
        /** Safe profile name; also the shared-profile directory leaf under the bot root. */
        profileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/),
        /** Fixed canonical open URL; optional (Substack resolves it per publication). */
        homeUrl: z
            .string()
            .url()
            .refine((value) => {
                try {
                    const url = new URL(value);
                    return (
                        (url.protocol === 'https:' || url.protocol === 'http:') &&
                        url.username === '' &&
                        url.password === '' &&
                        url.hash === ''
                    );
                } catch {
                    return false;
                }
            })
            .optional(),
    })
    .strict();

/** Inferred plugin-declared browser session from {@link BrowserSessionDescriptorSchema}. */
export type BrowserSessionDescriptor = z.infer<typeof BrowserSessionDescriptorSchema>;

/**
 * Zod schema for plugin.json manifest validation. Loose object (0155 R8): unknown keys are
 * preserved, not rejected — the Zod 4 idiom, consistent with `schemas.ts`.
 */
const PluginManifestSchemaBase = z.looseObject({
    name: z.string().min(1),
    kind: PluginKindSchema,
    entry: z.string().min(1),
    // Optional readiness-probe entry (ADR-032): a script spawned by `kk plugin
    // check` / `kk plugin login`, relative to the plugin dir. Status stays
    // side-effect-free; probes are opt-in per verb.
    check: z.string().min(1).optional(),
    version: z.string().optional(),
    description: z.string().optional(),
    // Declared auxiliary operations (0110 I3): the executor validates and
    // dispatches an input form only when the manifest declares it. Without a
    // declaration the kind contract alone applies (publish = Content → Result).
    operations: z.record(z.string(), PluginOperationSchema).optional(),
    // Declared browser session (0277 R1): publish plugins with a probe entry only, enforced
    // by `superRefine` below (a session without a probe script could never be driven).
    browserSession: BrowserSessionDescriptorSchema.optional(),
});

// A browser session is drivable only by a publish plugin that also declares the probe
// entry which owns the site-specific login/check/open routines (0277 R1).
export const PluginManifestSchema = PluginManifestSchemaBase.superRefine((manifest, ctx) => {
    if (manifest.browserSession === undefined) return;
    if (manifest.kind !== 'publish') {
        ctx.addIssue({
            code: 'custom',
            path: ['browserSession'],
            message: `browserSession requires kind "publish", not "${manifest.kind}"`,
        });
    }
    if (manifest.check === undefined) {
        ctx.addIssue({
            code: 'custom',
            path: ['browserSession'],
            message: 'browserSession requires a check probe entry that owns the session routines',
        });
    }
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
