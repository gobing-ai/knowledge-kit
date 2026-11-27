import type { VideoRenderProvider, VideoVisualMode } from '@gobing-ai/kk-core';
import type { ColabGpu } from './ccu-ledger';
import type { ColabJob, ColabJobResult } from './colab-runner';

/**
 * The pluggable visual layer (design §3 step 4). `local-ken-burns` ships here; 0451 adds
 * `wan21-i2v` returning `kind: 'clips'`, and 0452 adds the avatar providers — this interface is the
 * seam they extend, never fork.
 */

/** What a provider gets to work with: the ordered stills resolved from the daily run. */
export interface VisualContext {
    images: string[];
}

/** A stills reel (Ken-Burns animates each image) or pre-rendered clips composited beneath the shell. */
export type VisualLayer = { kind: 'stills'; images: string[] } | { kind: 'clips'; clips: string[] };

/** One visual provider: an id matching the shared enum, and a prepare step. */
export interface VisualProvider {
    readonly id: VideoRenderProvider;
    prepare(ctx: VisualContext): Promise<VisualLayer>;
}

/**
 * 100% local provider: hands the shell the cover + card stills and lets Remotion pan/zoom them.
 * No network, no GPU, no child process (R5).
 */
export const localKenBurns: VisualProvider = {
    id: 'local-ken-burns',
    prepare: async (ctx) => {
        if (ctx.images.length === 0) {
            throw new Error('video-gen: editorial mode needs at least one still (cover or card image)');
        }
        return { kind: 'stills', images: [...ctx.images] };
    },
};

/** Pick the provider for a mode. Only `editorial` is wired in this milestone (fail closed otherwise). */
export function resolveVisualProvider(mode: VideoVisualMode): VisualProvider {
    if (mode === 'editorial') return localKenBurns;
    throw new Error(`video-gen: no local provider for visualMode "${mode}" (0451/0452 own the Colab providers)`);
}

/** Options for the `wan21-i2v` provider: the runner seam plus where the clips land. */
export interface Wan21ProviderOptions {
    /** Runs one Colab job (injected in tests, real in production). */
    runJob: (job: ColabJob) => Promise<ColabJobResult>;
    /** Local directory the downloaded clips land in. */
    outputDir: string;
    /** Episode run date, used in the session name and the clip names. */
    runDate: string;
    /** Worker script path on disk. */
    script: string;
    /** Remote directory the worker writes into. */
    remoteDir: string;
    /** Existence probe for the downloaded clips (R5: a missing output is a fallback cause). */
    exists?: (path: string) => Promise<boolean>;
    gpu?: ColabGpu;
    timeoutMs?: number;
    env?: Record<string, string>;
}

/** Wan2.1 I2V ships 14B checkpoints only, which do not fit a 16 GB T4 (0451 refine). */
export const WAN21_REFUSED_GPUS: readonly ColabGpu[] = ['T4'];
/** 14B on an A100 is the default; L4 is allowed with CPU offload. */
export const WAN21_DEFAULT_GPU: ColabGpu = 'A100';
export const WAN21_DEFAULT_TIMEOUT_MS = 600_000;

/**
 * The `wan21-i2v` provider (0451 R4): one Colab job turns the cover/card stills into 3–5s 9:16
 * motion loops, which the Remotion shell then composites.
 */
export function createWan21Provider(options: Wan21ProviderOptions): VisualProvider {
    const gpu = options.gpu ?? WAN21_DEFAULT_GPU;
    return {
        id: 'wan21-i2v',
        prepare: async (ctx) => {
            if (ctx.images.length === 0) {
                throw new Error('video-gen: wan21-i2v needs at least one still (cover or card image)');
            }
            if (WAN21_REFUSED_GPUS.includes(gpu)) {
                throw new Error(
                    `video-gen: wan21-i2v cannot run on ${gpu} (14B checkpoints need an A100, or an L4 with CPU offload)`,
                );
            }
            const outputNames = ctx.images.map((_, index) => `${options.runDate}_clip-${index}.mp4`);
            const result = await options.runJob({
                jobType: 'wan21-i2v',
                gpu,
                script: options.script,
                outputNames,
                remoteDir: options.remoteDir,
                runDate: options.runDate,
                timeoutMs: options.timeoutMs ?? WAN21_DEFAULT_TIMEOUT_MS,
                env: options.env ?? {},
            });
            if (!result.ok) {
                throw new Error(result.error ?? 'wan21-i2v job failed');
            }
            if (result.outputs.length === 0) {
                throw new Error('wan21-i2v job produced no clips');
            }
            if (options.exists !== undefined) {
                for (const clip of result.outputs) {
                    if (!(await options.exists(clip))) {
                        throw new Error(`wan21-i2v reported ${clip} but the file is not on disk`);
                    }
                }
            }
            return { kind: 'clips', clips: result.outputs };
        },
    };
}

/** Options for the `wan21-i2v` fallback decision. */
export interface PrepareLayerArgs {
    mode: VideoVisualMode;
    providerId: VideoRenderProvider;
    images: string[];
    /** Present only when the request asked for `wan21-i2v`. */
    wan21?: Wan21ProviderOptions;
}

/** The layer plus the provider actually used and any fallback warning. */
export interface PreparedLayer {
    layer: VisualLayer;
    providerId: VideoRenderProvider;
    fallbackUsed: boolean;
    warnings: string[];
}

/**
 * Resolve the visual layer (R4/R5): `wan21-i2v` when asked and available, otherwise — or on **any**
 * Colab failure, which includes a budget refusal — the local Ken-Burns reel with a named warning.
 * A fallback never fails the run: the daily cron must always get a video.
 */
export async function prepareVisualLayer(args: PrepareLayerArgs): Promise<PreparedLayer> {
    if (args.providerId === 'wan21-i2v') {
        if (args.wan21 === undefined) {
            return {
                layer: await localKenBurns.prepare({ images: args.images }),
                providerId: 'local-ken-burns',
                fallbackUsed: true,
                warnings: ['wan21-i2v requested without Colab options; used local Ken-Burns'],
            };
        }
        try {
            const layer = await createWan21Provider(args.wan21).prepare({ images: args.images });
            return { layer, providerId: 'wan21-i2v', fallbackUsed: false, warnings: [] };
        } catch (error: unknown) {
            return {
                layer: await localKenBurns.prepare({ images: args.images }),
                providerId: 'local-ken-burns',
                fallbackUsed: true,
                warnings: [
                    `wan21-i2v failed, fell back to local Ken-Burns: ${error instanceof Error ? error.message : String(error)}`,
                ],
            };
        }
    }
    return {
        layer: await resolveVisualProvider(args.mode).prepare({ images: args.images }),
        providerId: 'local-ken-burns',
        fallbackUsed: false,
        warnings: [],
    };
}

/** Options shared by the two avatar providers. */
export interface AvatarProviderOptions extends Wan21ProviderOptions {
    /** Absolute path of the operator's (or consented) portrait. */
    portraitPath: string;
}

/** GPU defaults and deadlines from design §4 / 0452 refine. */
export const MUSETALK_DEFAULT_GPU: ColabGpu = 'T4';
export const MUSETALK_DEFAULT_TIMEOUT_MS = 600_000;
export const ECHOMIMIC_DEFAULT_GPU: ColabGpu = 'A100';
export const ECHOMIMIC_DEFAULT_TIMEOUT_MS = 900_000;
/** EchoMimicV2 (half-body, 14B-class) does not fit a 16 GB T4. */
export const ECHOMIMIC_REFUSED_GPUS: readonly ColabGpu[] = ['T4'];

function createAvatarProvider(jobType: 'musetalk' | 'echomimic-v2', options: AvatarProviderOptions): VisualProvider {
    const gpu = options.gpu ?? (jobType === 'musetalk' ? MUSETALK_DEFAULT_GPU : ECHOMIMIC_DEFAULT_GPU);
    const timeoutMs =
        options.timeoutMs ?? (jobType === 'musetalk' ? MUSETALK_DEFAULT_TIMEOUT_MS : ECHOMIMIC_DEFAULT_TIMEOUT_MS);
    return {
        id: jobType,
        prepare: async () => {
            if (jobType === 'echomimic-v2' && ECHOMIMIC_REFUSED_GPUS.includes(gpu)) {
                throw new Error(
                    `video-gen: echomimic-v2 cannot run on ${gpu} (half-body synthesis needs an A100, or an L4)`,
                );
            }
            const outputName = `${options.runDate}_presenter.mp4`;
            const result = await options.runJob({
                jobType,
                gpu,
                script: options.script,
                outputNames: [outputName],
                remoteDir: options.remoteDir,
                runDate: options.runDate,
                timeoutMs,
                env: { ...(options.env ?? {}), KK_HOST_PORTRAIT: options.portraitPath },
            });
            if (!result.ok) throw new Error(result.error ?? `${jobType} job failed`);
            const [clip] = result.outputs;
            if (clip === undefined) throw new Error(`${jobType} job produced no presenter clip`);
            if (options.exists !== undefined && !(await options.exists(clip))) {
                throw new Error(`${jobType} reported ${clip} but the file is not on disk`);
            }
            return { kind: 'clips', clips: [clip] };
        },
    };
}

/** MuseTalk lip-sync presenter (T4 by default) — full-frame avatar or the hybrid-PiP bubble. */
export function createMusetalkProvider(options: AvatarProviderOptions): VisualProvider {
    return createAvatarProvider('musetalk', options);
}

/** EchoMimicV2 half-body presenter (A100 by default, T4 refused). */
export function createEchomimicV2Provider(options: AvatarProviderOptions): VisualProvider {
    return createAvatarProvider('echomimic-v2', options);
}

/** Which avatar provider a (already validated) request resolves to. */
export function resolveAvatarProvider(providerId: VideoRenderProvider, options: AvatarProviderOptions): VisualProvider {
    return providerId === 'echomimic-v2' ? createEchomimicV2Provider(options) : createMusetalkProvider(options);
}
