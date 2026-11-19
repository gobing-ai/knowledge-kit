import type { Doc } from '@gobing-ai/kk-core';
import { z } from 'zod';
import { AUDIO_FORMATS, MUSIC_MODELS, type MusicBrief, parseMusicBriefYaml, StructureEntrySchema } from './brief';
import type { PresetLayer, PresetLayers, ResolvedJob } from './presets';
import { resolveJob } from './presets';

/**
 * The `--in` envelope (task 0398 R1/R5).
 *
 * A generator plugin's only input channel is the `--in` JSON (the spawn argv is
 * frozen at `--in`/`--out`), so the brief rides inside one doc and everything
 * the plugin needs besides the brief rides the first doc's `metadata`.
 *
 * - **The brief is `docs[0].body`, parsed as the YAML authoring form** the plugin
 *   README documents. One authored document, one schema (`MusicBriefSchema`) —
 *   voice-gen's `parseDocToVoiceScript` is the precedent for YAML-in-body.
 * - **`docs[0].metadata.musicGen`** carries only what is not the brief: the
 *   preset layers 0399 will load from disk (accepted inline so this task does not
 *   depend on 0399's loader), the `outputStem` override, and the `force`/`reason`
 *   pair 0400's spend guard records. Strict on purpose: a typo'd key fails loud
 *   instead of vanishing into a paid request.
 */

/** `metadata` key this plugin owns. */
export const MUSIC_JOB_METADATA_KEY = 'musicGen';

/** One preset layer, as 0399's loader will hand it over. `name` is required so `explainJob` can cite it. */
export const PresetLayerSchema = z.strictObject({
    name: z.string().min(1),
    model: z.enum(MUSIC_MODELS).optional(),
    duration_target: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    instrumental: z.boolean().optional(),
    lyrics_policy: z.enum(['allowed', 'forbidden']).optional(),
    audio_format: z.enum(AUDIO_FORMATS).optional(),
    style: z.string().min(1).optional(),
    avoid: z.array(z.string().min(1)).optional(),
    structure: z.array(StructureEntrySchema).optional(),
});

/** The three preset layers in precedence order (`brief > workflow > theme > format`). */
export const PresetLayersSchema = z.strictObject({
    workflow: PresetLayerSchema.optional(),
    theme: PresetLayerSchema.optional(),
    format: PresetLayerSchema.optional(),
});

/** The plugin-level knobs that are not the brief. */
export const MusicJobSpecSchema = z.strictObject({
    presets: PresetLayersSchema.optional(),
    /** Overrides the `--out` basename for artifact naming (image-gen's `outputStem` precedent). */
    outputStem: z.string().min(1).optional(),
    /** True when the operator accepted a paid re-send (0400 records it; 0398 only mirrors it into the sidecar). */
    force: z.boolean().optional(),
    /** Why `force` was passed. Required by 0400's policy; recorded verbatim here. */
    reason: z.string().min(1).optional(),
});

/** Parsed `metadata.musicGen`. */
export type MusicJobSpec = z.infer<typeof MusicJobSpecSchema>;

/** One resolved job plus the plugin knobs and the brief it came from. */
export interface MusicJob {
    brief: MusicBrief;
    spec: MusicJobSpec;
    job: ResolvedJob;
}

/** Render zod issues as one actionable line. */
function zodIssues(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`).join('; ');
}

/** Parse `docs[0].metadata.musicGen`; absent means "brief only, no preset layers". */
export function parseMusicJobSpec(docs: readonly Doc[]): MusicJobSpec {
    const raw = docs[0]?.metadata?.[MUSIC_JOB_METADATA_KEY];
    if (raw === undefined || raw === null) {
        return {};
    }
    const result = MusicJobSpecSchema.safeParse(raw);
    if (!result.success) {
        throw new Error(`Invalid music job spec at metadata.${MUSIC_JOB_METADATA_KEY}: ${zodIssues(result.error)}`);
    }
    return result.data;
}

/** Parse the brief out of `docs[0].body` (the YAML authoring form). */
export function parseMusicJobBrief(docs: readonly Doc[]): MusicBrief {
    const body = docs[0]?.body ?? '';
    if (body.trim() === '') {
        throw new Error(
            'Invalid music job input: docs[0].body must carry the music brief as YAML (the plugin README authoring form)',
        );
    }
    try {
        return parseMusicBriefYaml(body);
    } catch (error: unknown) {
        throw new Error(
            `Invalid music brief in docs[0].body: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/** Cast a parsed preset layer to the resolution layer type (the schemas cover the same fields). */
function asPresetLayers(spec: MusicJobSpec): PresetLayers {
    const layer = (value: z.infer<typeof PresetLayerSchema> | undefined): PresetLayer | undefined =>
        value === undefined ? undefined : (value as PresetLayer);
    const presets = spec.presets;
    if (presets === undefined) {
        return {};
    }
    const workflow = layer(presets.workflow);
    const theme = layer(presets.theme);
    const format = layer(presets.format);
    return {
        ...(workflow === undefined ? {} : { workflow }),
        ...(theme === undefined ? {} : { theme }),
        ...(format === undefined ? {} : { format }),
    };
}

/**
 * Parse and resolve the whole job: brief from the body, preset layers from
 * metadata, then 0397's `resolveJob`. Every authoring error fails here — before
 * the adapter is built, so before any spend.
 */
export function parseMusicJob(docs: readonly Doc[]): MusicJob {
    const brief = parseMusicJobBrief(docs);
    const spec = parseMusicJobSpec(docs);
    return { brief, spec, job: resolveJob(brief, asPresetLayers(spec)) };
}
