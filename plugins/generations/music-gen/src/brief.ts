import { z } from 'zod';

/**
 * MusicBrief contract (task 0397 R1): the single authored input document for a
 * music job, its `m:ss` duration helpers and the field→target mapping that
 * makes the wire mapping total.
 *
 * Authority: `docs/design/music-gen.md` §2. The YAML authoring form is
 * documented once in `plugins/generations/music-gen/README.md` — there is no
 * second schema.
 */

/** `m:ss` — the only duration shape the brief, the preset defaults and the instance request accept. */
export const MMSS_PATTERN = /^\d{1,2}:[0-5]\d$/;

/**
 * Provider ceiling for `model: pro` ("up to roughly three minutes"). A target
 * beyond it cannot be honoured, so the schema rejects it instead of shipping a
 * request the model will silently truncate.
 */
export const MAX_DURATION_SECONDS = 180;

/** Below five seconds a target is not a musical statement; it is a click. */
export const MIN_DURATION_SECONDS = 5;

/** The instance accepts at most ten reference images per request. */
export const MAX_IMAGES = 10;

/** Hard cap on takes per invocation (task 0400 R4); takes are sequential requests, never one batched call. */
export const MAX_TAKES = 4;

/** Built-in take count when the brief is silent. */
export const DEFAULT_TAKES = 1;

/** The instance's two model selectors; `pro` and `clip` are instance-side model ids, not API model ids. */
export const MUSIC_MODELS = ['pro', 'clip'] as const;
export type MusicModel = (typeof MUSIC_MODELS)[number];

/** Requested audio container. The response format is authoritative (task 0398 R2). */
export const AUDIO_FORMATS = ['mp3', 'wav'] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Short language tag (`EN`, `zh-CN`); always sent so the instance default `EN` never applies. */
export const LANGUAGE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** Parse `m:ss` into whole seconds; throws on anything the schema would reject. */
export function durationSeconds(value: string): number {
    if (!MMSS_PATTERN.test(value)) {
        throw new Error(`duration "${value}" is not m:ss`);
    }
    const [minutes, seconds] = value.split(':');
    return Number(minutes) * 60 + Number(seconds);
}

/** Render whole seconds back to `m:ss` (0405 measures a delivered file against the recorded target). */
export function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** One timestamped structure line. `note` is the musical instruction for that section. */
export const StructureEntrySchema = z
    .object({
        at: z.string().regex(MMSS_PATTERN, 'structure.at must be m:ss'),
        section: z.string().min(1),
        note: z.string().min(1).optional(),
    })
    .strict();

export type StructureEntry = z.infer<typeof StructureEntrySchema>;

/**
 * Where one brief field goes. Every schema key must carry one entry
 * ({@link BRIEF_FIELD_TARGETS} is checked against `MusicBriefSchema.shape`), so
 * no field can be silently dropped — the total-mapping requirement of R1.
 */
export interface BriefFieldTarget {
    /** Prompt segment the field renders into (R2), when it renders at all. */
    prompt?: string;
    /** Instance request field(s) the field maps to (R3). */
    request?: readonly string[];
    /** True when the field selects or overrides a preset layer (R4). */
    resolution?: boolean;
    /** Where a value that never reaches the wire is recorded. */
    recording?: string;
}

/**
 * R1 totality table: brief field → prompt segment / request field / resolution
 * input / recording slot. `meta` is the one field that is recorded only.
 */
export const BRIEF_FIELD_TARGETS: Record<string, BriefFieldTarget> = {
    title: { request: ['title'] },
    model: { request: ['model'], resolution: true },
    format: {
        resolution: true,
        recording: 'resolved job (`format` names the format preset; instance `format` is audio_format)',
    },
    theme: { resolution: true, recording: 'resolved job (`theme` names the theme preset)' },
    duration_target: {
        request: ['durationTarget'],
        resolution: true,
        recording: 'resolved job + take sidecar for 0405 measurement',
    },
    language: { request: ['language'], resolution: true },
    instrumental: { prompt: 'Instrumental only — no vocals.', request: ['lyrics'], resolution: true },
    audio_format: { request: ['format'], resolution: true },
    style: { prompt: 'technical direction (first segment)', resolution: true },
    avoid: { prompt: 'Avoid: … (second segment, omitted when empty)', resolution: true },
    structure: { prompt: 'timestamped structure lines (third segment)', resolution: true },
    lyrics: { request: ['lyrics'] },
    images: { request: ['images'] },
    takes: { recording: 'N sequential single-take requests (batchCount=1 each) + take sidecar' },
    meta: { recording: 'take sidecar only; never sent to the instance' },
};

/**
 * The authored brief. Optional fields fall through to preset resolution
 * (R4); a field that survives every layer as `undefined` and has no built-in
 * default makes `resolveJob` fail loudly rather than letting the instance
 * substitute its own default (R3).
 */
export const MusicBriefSchema = z
    .object({
        title: z.string().min(1),
        model: z.enum(MUSIC_MODELS).optional(),
        format: z.string().min(1),
        theme: z.string().min(1),
        duration_target: z.string().regex(MMSS_PATTERN, 'duration_target must be m:ss').optional(),
        language: z.string().regex(LANGUAGE_PATTERN, 'language must be a short tag such as EN or zh-CN').optional(),
        instrumental: z.boolean().optional(),
        audio_format: z.enum(AUDIO_FORMATS).optional(),
        style: z.string().min(1).optional(),
        avoid: z.array(z.string().min(1)).optional(),
        structure: z.array(StructureEntrySchema).optional(),
        lyrics: z.string().optional(),
        images: z.array(z.string().min(1)).max(MAX_IMAGES).optional(),
        takes: z.number().int().min(1).max(MAX_TAKES).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
    })
    .strict()
    .superRefine((brief, ctx) => {
        const structure = brief.structure ?? [];
        for (let index = 1; index < structure.length; index += 1) {
            const previous = structure[index - 1];
            const current = structure[index];
            if (previous === undefined || current === undefined) {
                continue;
            }
            // The field schema already reports a malformed timestamp; do not throw from a refinement.
            if (!MMSS_PATTERN.test(previous.at) || !MMSS_PATTERN.test(current.at)) {
                continue;
            }
            if (durationSeconds(current.at) < durationSeconds(previous.at)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['structure', index, 'at'],
                    message: `structure must not move backwards (${current.at} follows ${previous.at})`,
                });
            }
        }
        if (brief.duration_target !== undefined && MMSS_PATTERN.test(brief.duration_target)) {
            const seconds = durationSeconds(brief.duration_target);
            if (seconds < MIN_DURATION_SECONDS || seconds > MAX_DURATION_SECONDS) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['duration_target'],
                    message: `duration_target must be between 0:05 and 3:00 (got ${brief.duration_target})`,
                });
            }
        }
        if (brief.instrumental === true && (brief.lyrics ?? '').trim() !== '') {
            ctx.addIssue({
                code: 'custom',
                path: ['lyrics'],
                message: 'an instrumental brief must not carry lyrics — drop the lyrics or the instrumental flag',
            });
        }
    });

export type MusicBrief = z.infer<typeof MusicBriefSchema>;

/** Parse an already-decoded document. Throws `ZodError` on the first invalid field set. */
export function parseMusicBrief(value: unknown): MusicBrief {
    return MusicBriefSchema.parse(value);
}

/** Parse a YAML brief document (the authoring form in the plugin README). */
export function parseMusicBriefYaml(text: string): MusicBrief {
    return parseMusicBrief(Bun.YAML.parse(text));
}
