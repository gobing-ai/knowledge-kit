import { extname, isAbsolute } from 'node:path';
import { VideoRenderProviderSchema, type VideoVisualMode, VideoVisualModeSchema } from '@gobing-ai/kk-core';
import { z } from 'zod';

/**
 * Visual modes this milestone actually renders. `avatar` and `hybrid-pip` are declared in the
 * shared contract but ship with 0452, so naming one here fails closed instead of rendering a
 * silent editorial fallback the operator did not ask for.
 */
/** Visual modes this build renders (0452 lifts the editorial-only guard). */
export const SHIPPED_VISUAL_MODES = ['editorial', 'avatar', 'hybrid-pip'] as const;

/** Visual providers this build can actually produce. */
export const SHIPPED_PROVIDERS = ['local-ken-burns', 'wan21-i2v', 'musetalk', 'echomimic-v2'] as const;

/** Providers an editorial reel can render. */
export const EDITORIAL_PROVIDERS = ['local-ken-burns', 'wan21-i2v'] as const;

/** Providers an avatar request may name; `hybrid-pip` overlays a MuseTalk bubble only. */
export const AVATAR_PROVIDERS = ['musetalk', 'echomimic-v2'] as const;

/** Image extensions an accepted host portrait may carry. */
export const PORTRAIT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

/** Explicit teaser window; both bounds are seconds into the episode audio. */
export const HookWindowSchema = z.strictObject({
    startSec: z.number().min(0),
    endSec: z.number().positive(),
});

/** Colab GPU options (0451); ignored unless `provider` is `wan21-i2v`. */
export const ColabRequestSchema = z.strictObject({
    gpu: z.enum(['T4', 'L4', 'A100']).optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxMonthlyCcu: z.number().positive().optional(),
    cacheDir: z.string().min(1).optional(),
});

/**
 * Plugin-local generator request (`--in`). The output contract is shared in `@gobing-ai/kk-core`;
 * the request stays here because generators own their own input shape (no `Brief` schema in core).
 */
export const VideoGenRequestSchema = z.strictObject({
    workDir: z.string().min(1),
    runDate: z.string().regex(/^\d{8}$/),
    visualMode: VideoVisualModeSchema,
    hook: HookWindowSchema.optional(),
    /** Visual provider; absent means the local Ken-Burns reel (editorial) or `musetalk` (avatar). */
    provider: VideoRenderProviderSchema.optional(),
    colab: ColabRequestSchema.optional(),
    /** The operator's own (or consented) portrait for `avatar`/`hybrid-pip`; never discovered. */
    hostPortraitPath: z.string().min(1).optional(),
});

/** Parsed {@link VideoGenRequestSchema} payload. */
export type VideoGenRequest = z.infer<typeof VideoGenRequestSchema>;

/** Parsed explicit hook window from {@link HookWindowSchema}. */
export type RequestedHookWindow = z.infer<typeof HookWindowSchema>;

function describeIssues(error: z.ZodError): string {
    return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

/**
 * Validate the request JSON, failing closed on shape and on a mode this milestone does not ship.
 * Runs before any `ffprobe`/`ffmpeg`/`uv`/Chromium spawn (R6).
 */
export function parseVideoGenRequest(raw: unknown): VideoGenRequest {
    const parsed = VideoGenRequestSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`video-gen: invalid request: ${describeIssues(parsed.error)}`);
    }
    // The zod enum already refuses an unknown mode/provider, and every enumerated value is shipped
    // (0452 lifts the editorial-only guard) — the checks below are about MODE/PROVIDER agreement.
    const mode: VideoVisualMode = parsed.data.visualMode;
    const provider = parsed.data.provider;
    if (mode === 'editorial') {
        // The avatar providers drive the presenter shells; an editorial reel cannot use them.
        if (provider !== undefined && !(EDITORIAL_PROVIDERS as readonly string[]).includes(provider)) {
            throw new Error(
                `video-gen: visualMode "editorial" renders ${EDITORIAL_PROVIDERS.join(' or ')}; "${provider}" needs visualMode "avatar"`,
            );
        }
        return parsed.data;
    }
    // 0452 R4: avatar modes fail closed on the request before any Colab spawn.
    const avatarProvider = provider ?? 'musetalk';
    if (!(AVATAR_PROVIDERS as readonly string[]).includes(avatarProvider)) {
        throw new Error(
            `video-gen: visualMode "${mode}" needs a presenter provider (${AVATAR_PROVIDERS.join(', ')}), got "${avatarProvider}"`,
        );
    }
    if (mode === 'hybrid-pip' && avatarProvider !== 'musetalk') {
        throw new Error(`video-gen: hybrid-pip overlays a musetalk bubble only; got provider "${avatarProvider}"`);
    }
    const portrait = parsed.data.hostPortraitPath;
    if (portrait === undefined) {
        throw new Error(
            `video-gen: visualMode "${mode}" requires hostPortraitPath (the operator's own or consented portrait)`,
        );
    }
    if (!isAbsolute(portrait)) {
        throw new Error(`video-gen: hostPortraitPath must be absolute, got "${portrait}"`);
    }
    const portraitExtension = extname(portrait).toLowerCase();
    if (!(PORTRAIT_EXTENSIONS as readonly string[]).includes(portraitExtension)) {
        throw new Error(
            `video-gen: hostPortraitPath must be an image (${PORTRAIT_EXTENSIONS.join(', ')}), got "${portraitExtension || '(none)'}"`,
        );
    }
    return { ...parsed.data, provider: avatarProvider };
}

/**
 * Read the request out of an executor input file.
 *
 * WHY two shapes: `kk executor run` validates a generator's `--in` against the kind contract, which
 * requires a `Doc[]` (ADR-009), so the plugin's own request rides in the first Doc's `metadata` —
 * the same way every other generator receives its work. A bare request object stays accepted for a
 * direct `bun src/index.ts --in request.json` run (dogfood/debug).
 */
export function parseVideoGenRequestInput(raw: unknown): VideoGenRequest {
    if (!Array.isArray(raw)) return parseVideoGenRequest(raw);
    const first = raw[0];
    if (typeof first !== 'object' || first === null) {
        throw new Error('video-gen: --in must be a Doc[] whose first entry carries the request in metadata');
    }
    const metadata = (first as { metadata?: unknown }).metadata;
    if (typeof metadata !== 'object' || metadata === null) {
        throw new Error('video-gen: --in Doc[0] carries no metadata (workDir/runDate/visualMode are required)');
    }
    return parseVideoGenRequest(metadata);
}
