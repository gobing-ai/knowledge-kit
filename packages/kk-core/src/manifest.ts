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
 * Content count unit schema matching {@link ContentCountUnit}.
 */
export const ContentCountUnitSchema = z.enum([
    'utf16_code_units',
    'unicode_code_points',
    'weighted',
    'xiaohongshu_title_weighted',
]);

const LimitEntrySchema = z
    .object({
        max: z.number().int().positive(),
        unit: ContentCountUnitSchema,
    })
    .strict();

/** Optional title/body length limits a publishing profile enforces. */
export const PublishingProfileLimitsSchema = z
    .object({
        title: LimitEntrySchema.optional(),
        body: LimitEntrySchema.optional(),
    })
    .strict();

/** Parsed publishing-profile length limits. */
export type PublishingProfileLimits = z.infer<typeof PublishingProfileLimitsSchema>;

/** Assets a publishing profile requires (cover, ordered images). */
export const PublishingProfileRequiresSchema = z
    .object({
        cover: z.boolean().optional(),
        orderedImages: z.boolean().optional(),
    })
    .strict();

/** Parsed publishing-profile asset requirements. */
export type PublishingProfileRequires = z.infer<typeof PublishingProfileRequiresSchema>;

/** Channel metadata bound to one publish mode (draft or live). */
export const PublishingProfileModeBindingSchema = z
    .object({
        metadata: z.record(z.string(), z.unknown()),
    })
    .strict();

/** Parsed per-mode metadata binding. */
export type PublishingProfileModeBinding = z.infer<typeof PublishingProfileModeBindingSchema>;

/** Draft/live mode bindings; at least one mode must be declared. */
export const PublishingProfileModesSchema = z
    .object({
        draft: PublishingProfileModeBindingSchema.optional(),
        live: PublishingProfileModeBindingSchema.optional(),
    })
    .strict()
    .superRefine((modes, ctx) => {
        if (modes.draft === undefined && modes.live === undefined) {
            ctx.addIssue({
                code: 'custom',
                message: 'modes must define at least one of "draft" or "live"',
            });
        }
    });

/** Parsed draft/live mode bindings. */
export type PublishingProfileModes = z.infer<typeof PublishingProfileModesSchema>;

/** One named publishing profile: format, locale, limits, requirements and modes. */
export const PublishingProfileSchema = z
    .object({
        format: z.string().min(1),
        locale: z.string().regex(/^(source|[a-z]{2,3}(-[A-Za-z0-9]+)*)$/, {
            message: 'locale must be "source" or a valid language tag',
        }),
        limits: PublishingProfileLimitsSchema.optional(),
        requires: PublishingProfileRequiresSchema.optional(),
        modes: PublishingProfileModesSchema,
    })
    .strict();

/** Parsed publishing profile. */
export type PublishingProfile = z.infer<typeof PublishingProfileSchema>;

/** Publish-plugin capabilities: nonempty profile map plus a default that must reference one of them. */
export const PublishingCapabilitiesSchema = z
    .object({
        defaultProfile: z.string().min(1),
        profiles: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), PublishingProfileSchema),
    })
    .strict()
    .superRefine((data, ctx) => {
        const keys = Object.keys(data.profiles);
        if (keys.length === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['profiles'],
                message: 'profiles record must be nonempty',
            });
        }
        if (!(data.defaultProfile in data.profiles)) {
            ctx.addIssue({
                code: 'custom',
                path: ['defaultProfile'],
                message: `defaultProfile "${data.defaultProfile}" must reference a declared profile`,
            });
        }
    });

/** Parsed publish-plugin capabilities. */
export type PublishingCapabilities = z.infer<typeof PublishingCapabilitiesSchema>;

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
    // Declared browser session (0277 R1, ingestion widened by 0346): a plugin that also declares
    // the probe entry owning its login/check/open routines — enforced by `superRefine` below.
    browserSession: BrowserSessionDescriptorSchema.optional(),
    // Declared publishing capabilities (0298 / ADR-040): publish plugins describe operation-specific
    // profiles, limits, format, and mode bindings.
    publishing: PublishingCapabilitiesSchema.optional(),
});

// A browser session is drivable by a publish OR ingestion plugin that also declares the probe
// entry owning the site-specific login/check/open routines (0277 R1; ingestion widened by 0346 —
// the collection runner drives the same profile from inside the plugin child, ADR-038 amendment).
export const PluginManifestSchema = PluginManifestSchemaBase.superRefine((manifest, ctx) => {
    if (manifest.browserSession !== undefined) {
        if (manifest.kind !== 'publish' && manifest.kind !== 'ingestion') {
            ctx.addIssue({
                code: 'custom',
                path: ['browserSession'],
                message: `browserSession requires kind "publish" or "ingestion", not "${manifest.kind}"`,
            });
        }
        if (manifest.check === undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['browserSession'],
                message: 'browserSession requires a check probe entry that owns the session routines',
            });
        }
    }
    if (manifest.publishing !== undefined && manifest.kind !== 'publish') {
        ctx.addIssue({
            code: 'custom',
            path: ['publishing'],
            message: `publishing requires kind "publish", not "${manifest.kind}"`,
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
