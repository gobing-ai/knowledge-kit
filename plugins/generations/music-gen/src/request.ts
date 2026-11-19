import type { AudioFormat, MusicModel } from './brief';
import type { ResolvedJob } from './presets';
import { renderBriefPrompt } from './render';

/**
 * Request mapping (task 0397 R3): the exact JSON body kk posts to
 * `POST /api/lyria/generate`, built from a resolved job alone.
 *
 * No field may fall through to an instance default:
 * - `durationTarget` is always present for `model: pro` (the instance would
 *   otherwise substitute `'3:00'`, turning a 0:30 jingle into a three-minute
 *   request) and never present for `model: clip` (clip is fixed at about 0:30).
 * - `language` is always present (the instance default is `EN`).
 * - `instrumental: true` sends `lyrics: ''`.
 * - `batchCount` is a recorded label, not a multi-sample knob — the instance
 *   makes exactly one provider call per request, so every request is
 *   single-take (`batchCount: 1`) and `takes: N` means N sequential requests.
 */

/** The wire body, in the frozen key order the goldens pin. */
export interface MusicGenerateRequest {
    prompt: string;
    lyrics?: string;
    language: string;
    model: MusicModel;
    durationTarget?: string;
    format: AudioFormat;
    title: string;
    batchCount: number;
    images?: string[];
}

/**
 * Canonical key order of the request body. `images` stays last so the body
 * reads prompt-first; the order is pinned by the golden request JSON.
 */
export const REQUEST_KEY_ORDER = [
    'prompt',
    'lyrics',
    'language',
    'model',
    'durationTarget',
    'format',
    'title',
    'batchCount',
    'images',
] as const;

/**
 * Which brief field each wire field comes from (R1 totality). `durationTarget`
 * is `null` for a clip job by contract, not by omission.
 */
export const REQUEST_FIELD_ORIGINS: Record<keyof MusicGenerateRequest, string> = {
    prompt: 'style + avoid + structure + instrumental (rendered prompt text)',
    lyrics: 'lyrics (empty string when instrumental)',
    language: 'language',
    model: 'model',
    durationTarget: 'duration_target (pro only)',
    format: 'audio_format',
    title: 'title',
    batchCount: 'takes — always 1 per request',
    images: 'images',
};

/** Build the single-take request body for a resolved job. Pure and deterministic. */
export function renderGenerateRequest(job: ResolvedJob): MusicGenerateRequest {
    const model = job.model.value;
    const durationTarget = model === 'pro' ? job.duration_target.value : undefined;
    if (model === 'pro' && durationTarget === undefined) {
        // resolveJob already refuses this; the assertion keeps a hand-built job from reaching the wire.
        throw new Error('a pro request without durationTarget would fall through to the instance default "3:00"');
    }
    const images = job.images;
    return {
        prompt: renderBriefPrompt(job),
        ...(job.lyrics === undefined ? {} : { lyrics: job.lyrics }),
        language: job.language.value,
        model,
        ...(durationTarget === undefined ? {} : { durationTarget }),
        format: job.audio_format.value,
        title: job.title,
        batchCount: 1,
        ...(images.length === 0 ? {} : { images: [...images] }),
    };
}

/**
 * One request per take: `takes: N` renders N structurally identical
 * single-take requests (the client loop lives in 0398/0400, and each take is
 * billed and persisted separately by the instance).
 */
export function renderTakeRequests(job: ResolvedJob): MusicGenerateRequest[] {
    return Array.from({ length: job.takes }, () => renderGenerateRequest(job));
}

/**
 * Serialize a request exactly as the goldens pin it: repo-standard 4-space
 * JSON plus one trailing newline, so `biome check` never rewrites a fixture.
 */
export function serializeRequest(request: MusicGenerateRequest): string {
    return `${JSON.stringify(request, null, 4)}\n`;
}
