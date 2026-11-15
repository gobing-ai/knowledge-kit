import { isAbsolute } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/**
 * The xhs channel's publishing TYPES, declared and validated (ADR-029).
 *
 * One plugin per channel: the four console modes a single authenticated session offers are
 * `operations` of this plugin — selected from `options.operation ?? content.metadata.operation`,
 * resolved against {@link XHS_OPERATIONS}, and refused by name **before** a browser is launched or
 * a profile is resolved. Each operation owns its own entry step, artifact set, limits and flow
 * (`./flow`); the channel owns the profile dir, session readiness and `Content → Result` mapping
 * (`./index`).
 *
 * Labels and constraints come from the live console walk (`docs/design/xhs-ui-discovery.md`).
 * Everything here is pre-browser: it decides whether the run is allowed to open a session at all.
 */

export const TARGET = 'xhs';

/**
 * Channel-wide console facts, shared by the session gate (`./index`) and the flows (`./flow`):
 * every mode is reached from this one creator-console entry, and a completed publish is marked in
 * the console's own URL (measured live 2026-09-26).
 */
export const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
export const PUBLISHED_MARKER = 'published=true';

export const XHS_OPERATIONS = ['上传图文', '上传视频', '写长文', '发播客'] as const;

export type XhsOperation = (typeof XHS_OPERATIONS)[number];

/**
 * No operation requested ⇒ the note/composer mode this channel shipped with. The daily pipeline's
 * card-series stage (`kk-workflow-stages.ts` E8) still dispatches xhs-pub without one, and its
 * packaged `Content` is exactly an image-text note.
 */
export const DEFAULT_XHS_OPERATION: XhsOperation = '上传图文';

/** Exit-early resolution of the requested operation (ADR-029 dispatch). */
export function resolveXhsOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: XhsOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation;
    if (raw === undefined) return { operation: DEFAULT_XHS_OPERATION };
    if (typeof raw !== 'string' || !(XHS_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${String(raw)}' for ${TARGET}: expected one of ${XHS_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as XhsOperation };
}

/** Image extensions the 图文 grid accepts (`accept=".jpg,.jpeg,.png,.webp"`). */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const IMAGE_LIST = 'png|jpg|jpeg|webp';
/** Video extensions the dropzone accepts (`accept=".mp4,.mov,…,.ts"`). */
const VIDEO_EXTENSIONS = /\.(mp4|mov|flv|f4v|mkv|rm|rmvb|m4v|mpg|mpeg|ts)$/i;
const VIDEO_LIST = 'mp4|mov|flv|f4v|mkv|rm|rmvb|m4v|mpg|mpeg|ts';
/** Audio extensions the 发播客 modal's picker accepts (`accept=".mp3,.wav,.aac,.flac,.m4a"`). */
const AUDIO_EXTENSIONS = /\.(mp3|wav|aac|flac|m4a)$/i;
const AUDIO_LIST = 'mp3|wav|aac|flac|m4a';

/** Images the 图文 grid accepts before it refuses the batch (discovery §2: ≤18). */
export const XHS_IMAGE_MAX = 18;
/**
 * Note-title characters. The daily card-series stage enforces the same cap on the plan it packages
 * for this channel (`kk-workflow-stages.ts` XHS_TITLE_CAP), which is exactly the content this
 * plugin receives.
 */
export const XHS_NOTE_TITLE_MAX = 20;
/** Note-body characters, read off the 图文 editor's own `0/1000` counter (discovery §2). */
export const XHS_NOTE_BODY_MAX = 1000;

/** Per-mode field ceilings, as recorded by the console walk. */
export interface ModeLimits {
    /** Images the 图文 grid accepts before it refuses the batch. */
    imageMax?: number;
    /** Title characters; the same cap the daily card-series stage already enforces on the plan. */
    titleMax?: number;
    /** Note-body characters, read off the editor's own `0/1000` counter. */
    bodyMax?: number;
}

export const MODE_LIMITS: Record<XhsOperation, ModeLimits> = {
    // 图文: image grid ≤18, note title 20, note body 0/1000 (discovery §2).
    上传图文: { imageMax: XHS_IMAGE_MAX, titleMax: XHS_NOTE_TITLE_MAX, bodyMax: XHS_NOTE_BODY_MAX },
    // 视频: one video file; the same note composer carries the title. No body counter was recorded
    // for the video note, so none is enforced.
    上传视频: { titleMax: XHS_NOTE_TITLE_MAX },
    // 写长文: no upload and no recorded ceiling — it is the long-form surface.
    写长文: {},
    // 发播客: the artifacts are the audio and its cover; no text ceiling was recorded.
    发播客: {},
};

/**
 * A validated mode input: the operation plus the artifacts and limits that mode requires.
 * Discriminated on `operation` so every flow narrows to exactly the artifacts it may use.
 */
export type ModeInput =
    | { operation: '上传图文'; images: string[] }
    | { operation: '上传视频'; video: string }
    | { operation: '写长文' }
    | { operation: '发播客'; audio: string; cover: string };

/** Validated artifacts in upload order — the evidence a Result reports. */
export function artifactPaths(input: ModeInput): string[] {
    switch (input.operation) {
        case '上传图文':
            return input.images;
        case '上传视频':
            return [input.video];
        case '写长文':
            return [];
        case '发播客':
            return [input.audio, input.cover];
    }
}

interface MediaSpec {
    /** `metadata` key the artifact is read from. */
    key: 'video' | 'audio' | 'coverImage';
    /** Error prefix, e.g. `video validation`. */
    label: string;
    extensions: RegExp;
    /** Accepted extensions for the error text. */
    list: string;
}

/**
 * Reads one local media artifact out of `Content.metadata`. The repo spells a single artifact
 * either bare (`metadata.coverImage`, `metadata.audioFile`) or as a `{ path }` descriptor
 * (`metadata.images[]`), so both are accepted here; the error always names the `metadata` key.
 */
async function resolveMediaPath(content: Content, spec: MediaSpec): Promise<{ path?: string; error?: string }> {
    const raw = content.metadata?.[spec.key];
    const path =
        typeof raw === 'string'
            ? raw
            : typeof (raw as { path?: unknown } | undefined)?.path === 'string'
              ? ((raw as { path: string }).path as string)
              : undefined;
    if (path === undefined || path.length === 0) {
        return {
            error: `${spec.label}: Content.metadata.${spec.key} is required (absolute path to an existing ${spec.list} file)`,
        };
    }
    if (!isAbsolute(path)) {
        return { error: `${spec.label}: Content.metadata.${spec.key} must be absolute, got '${path}'` };
    }
    if (!spec.extensions.test(path)) {
        return {
            error: `${spec.label}: Content.metadata.${spec.key} has unsupported extension (expected ${spec.list}): '${path}'`,
        };
    }
    if (!(await createNodeFileSystem().exists(path))) {
        return { error: `${spec.label}: Content.metadata.${spec.key} does not exist: '${path}'` };
    }
    return { path };
}

/**
 * Pure pre-browser validation of one image-text note: `publishStatus`, the ordered image batch and
 * the mode's caps. Kept as the 图文 entry point (and exported for its own tests).
 */
export async function validatePublishInput(content: Content): Promise<{ paths?: string[]; error?: string }> {
    const status = validatePublishStatus(content);
    if (status.error) return { error: status.error };
    const images = content.metadata?.images;
    if (!Array.isArray(images) || images.length === 0) {
        return { error: 'images validation: metadata.images must be a non-empty ordered array' };
    }
    const max = XHS_IMAGE_MAX;
    if (images.length > max) {
        return {
            error: `images validation: metadata.images holds ${images.length} entries but the 上传图文 grid accepts ≤${max}`,
        };
    }
    const paths: string[] = [];
    for (const [i, image] of images.entries()) {
        const path = (image as { path?: unknown })?.path;
        if (typeof path !== 'string' || path.length === 0) {
            return { error: `images validation: images[${i}].path is missing` };
        }
        if (!isAbsolute(path)) {
            return { error: `images validation: images[${i}].path must be absolute, got '${path}'` };
        }
        if (!IMAGE_EXTENSIONS.test(path)) {
            return {
                error: `images validation: images[${i}].path has unsupported extension (expected ${IMAGE_LIST}): '${path}'`,
            };
        }
        if (!(await createNodeFileSystem().exists(path))) {
            return { error: `images validation: images[${i}].path does not exist: '${path}'` };
        }
        paths.push(path);
    }
    return { paths };
}

/**
 * `publishStatus` is the operator's explicit live-publish request: absent means draft, `public`
 * means the flow may click the console's 发布 control, and anything else is refused here — before
 * a browser opens, so a typo can never reach a real publish control.
 */
function validatePublishStatus(content: Content): { error?: string } {
    const status = content.metadata?.publishStatus;
    if (status !== undefined && status !== 'draft' && status !== 'public') {
        return {
            error: `publishStatus validation: unknown publishStatus '${String(status)}' (expected 'draft' or 'public')`,
        };
    }
    return {};
}

/** The note title cap is shared by the two note-composer modes. */
function validateTitle(content: Content, operation: XhsOperation): { error?: string } {
    const max = MODE_LIMITS[operation].titleMax;
    if (max === undefined) return {};
    const title = content.title ?? '';
    if (title.length > max) {
        return {
            error: `title validation: Content.title is ${title.length} chars but ${operation} accepts ≤${max}`,
        };
    }
    return {};
}

function validateBody(content: Content, operation: XhsOperation): { error?: string } {
    const max = MODE_LIMITS[operation].bodyMax;
    if (max === undefined) return {};
    if (content.body.length > max) {
        return {
            error: `body validation: Content.body is ${content.body.length} chars but ${operation} accepts ≤${max}`,
        };
    }
    return {};
}

export type ModeValidation = { input: ModeInput; error?: undefined } | { input?: undefined; error: string };

/**
 * Pre-browser validation for the requested operation: what it needs, and whether it fits.
 * A failure here is returned as `ok:false` naming the missing artifact, field or limit — the run
 * never opens a browser or resolves a profile for input the console cannot accept.
 */
export async function validateModeInput(operation: XhsOperation, content: Content): Promise<ModeValidation> {
    const status = validatePublishStatus(content);
    if (status.error) return { error: status.error };

    switch (operation) {
        case '上传图文': {
            const title = validateTitle(content, operation);
            if (title.error) return { error: title.error };
            const body = validateBody(content, operation);
            if (body.error) return { error: body.error };
            const images = await validatePublishInput(content);
            if (images.error) return { error: images.error };
            return { input: { operation, images: images.paths ?? [] } };
        }
        case '上传视频': {
            const title = validateTitle(content, operation);
            if (title.error) return { error: title.error };
            const video = await resolveMediaPath(content, {
                key: 'video',
                label: 'video validation',
                extensions: VIDEO_EXTENSIONS,
                list: VIDEO_LIST,
            });
            if (video.error) return { error: video.error };
            return { input: { operation, video: video.path ?? '' } };
        }
        case '写长文': {
            // No upload: the body IS the artifact, authored in place in the console editor.
            if (content.body.trim().length === 0) {
                return { error: 'body validation: Content.body must be non-empty for 写长文 (authored in place)' };
            }
            return { input: { operation } };
        }
        case '发播客': {
            const audio = await resolveMediaPath(content, {
                key: 'audio',
                label: 'audio validation',
                extensions: AUDIO_EXTENSIONS,
                list: AUDIO_LIST,
            });
            if (audio.error) return { error: audio.error };
            const cover = await resolveMediaPath(content, {
                key: 'coverImage',
                label: 'cover validation',
                extensions: IMAGE_EXTENSIONS,
                list: IMAGE_LIST,
            });
            if (cover.error) return { error: cover.error };
            return { input: { operation, audio: audio.path ?? '', cover: cover.path ?? '' } };
        }
    }
}
