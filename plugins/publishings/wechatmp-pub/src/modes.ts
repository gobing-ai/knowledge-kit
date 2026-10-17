import { isAbsolute } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/**
 * The wechatmp channel's publishing TYPES, declared and validated (ADR-029).
 *
 * One plugin per channel: the four console modes a single authenticated MP session offers
 * (文章 / 贴图 / 视频 / 播客, `createType` 0/8/5/7) are `operations` of this plugin — selected from
 * `options.operation ?? content.metadata.operation`, resolved against {@link WECHATMP_OPERATIONS},
 * and refused by name **before** a browser is launched or a profile is resolved. Each operation owns
 * its own entry, artifact set, limits and flow (`./flow`); the channel owns the profile dir,
 * session, preflight and `Content → Result` mapping (`./index`).
 *
 * Labels, routes and constraints come from the live console walk
 * (`docs/design/wechatmp-ui-discovery.md`). Everything here is pre-browser: it decides whether the
 * run is allowed to open a session at all.
 */

export const TARGET = 'wechatmp';

/** Console entry; it redirects to `/cgi-bin/home?…&token=<N>` for an authenticated session. */
export const CONSOLE_URL = 'https://mp.weixin.qq.com/';
/** The authenticated console home fragment — the readiness signal the preflight and flow share. */
export const CONSOLE_HOME_FRAGMENT = '/cgi-bin/home';

export const WECHATMP_OPERATIONS = ['文章', '贴图', '视频', '播客'] as const;

export type WechatmpOperation = (typeof WECHATMP_OPERATIONS)[number];

/**
 * No operation requested ⇒ 文章. The daily workflow's `wechat-publish` state dispatches this plugin
 * without one (`kk-workflow-stages.ts` `daily-publish-wechat`), and its packaged `Content` is the
 * episode article.
 */
export const DEFAULT_WECHATMP_OPERATION: WechatmpOperation = '文章';

/**
 * `createType` per mode. Verified for all four on the live console (discovery §2): each creation
 * type lands on the same editor route with its own value.
 */
export const CREATE_TYPES: Record<WechatmpOperation, number> = {
    文章: 0,
    贴图: 8,
    视频: 5,
    播客: 7,
};

/**
 * The editor route template (discovery §2), minus `createType` / `token` / `timestamp`. A stored
 * editor URL is NOT reusable (W2): the token is per-session and the timestamp is per-visit.
 */
export const EDITOR_ROUTE = '/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77';

/** Every console route carries the per-session token (discovery §1), so it is read, never stored. */
const CONSOLE_TOKEN_PATTERN = /[?&]token=([0-9]+)/;

/** The token carried by a console URL, or `undefined` when the URL is not an authenticated route. */
export function readConsoleToken(url: string): string | undefined {
    return CONSOLE_TOKEN_PATTERN.exec(url)?.[1];
}

/**
 * The editor deep-link for one mode, built at run time from the console's own session token
 * (discovery §1: "the token is per-session, so stored console URLs cannot be reused verbatim") and
 * a freshly generated `timestamp` — never a baked-in one.
 */
export function editorUrl(operation: WechatmpOperation, token: string, timestamp: number = Date.now()): string {
    const base = `${CONSOLE_URL.replace(/\/$/, '')}${EDITOR_ROUTE}`;
    return `${base}&createType=${CREATE_TYPES[operation]}&token=${encodeURIComponent(token)}&lang=zh_CN&timestamp=${timestamp}`;
}

/** The `createType` an editor URL reports, or `undefined` when it does not carry the field. */
export function readCreateType(url: string): number | undefined {
    const found = /[?&]createType=([0-9]+)/.exec(url)?.[1];
    return found === undefined ? undefined : Number(found);
}

/** Exit-early resolution of the requested operation (ADR-029 dispatch). */
export function resolveWechatmpOperation(
    options?: Record<string, unknown>,
    content?: Content,
): { operation: WechatmpOperation; error?: undefined } | { operation?: undefined; error: string } {
    const raw = options?.operation ?? content?.metadata?.operation;
    if (raw === undefined) return { operation: DEFAULT_WECHATMP_OPERATION };
    if (typeof raw !== 'string' || !(WECHATMP_OPERATIONS as readonly string[]).includes(raw)) {
        return {
            error: `unsupported operation '${String(raw)}' for ${TARGET}: expected one of ${WECHATMP_OPERATIONS.join(', ')}`,
        };
    }
    return { operation: raw as WechatmpOperation };
}

/** Extensions the editor's image input accepts (`accept="image/gif,image/jpeg,image/jpg,image/png,image/svg,image/webp"`). */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;
const IMAGE_LIST = 'png|jpg|jpeg|gif|webp|svg';
/**
 * Video extensions for the 视频 media modal. The walk recorded the modal's controls (`本地上传`,
 * `确定`) but not its picker's `accept` list, so this set is the union MP's own video surfaces
 * accept — the live dogfood confirms it.
 */
const VIDEO_EXTENSIONS = /\.(mp4|mov|flv|f4v|mkv|m4v|mpg|mpeg|ts)$/i;
const VIDEO_LIST = 'mp4|mov|flv|f4v|mkv|m4v|mpg|mpeg|ts';
/** Audio extensions for the 播客 media modal (`上传音频`; the walk recorded no `accept` list). */
const AUDIO_EXTENSIONS = /\.(mp3|wav|aac|flac|m4a)$/i;
const AUDIO_LIST = 'mp3|wav|aac|flac|m4a';

/**
 * The 贴图 image ceiling. The walk recorded **no** cap (discovery §3/§5.2 name none) and this
 * repository does not invent platform limits, so none is enforced — the constant is the recorded
 * absence, and the live dogfood is where a real cap would be entered.
 */
export const STICKER_IMAGE_MAX: number | undefined = undefined;

/** The 摘要 derivation's cap (the pre-ADR-029 heuristic: the body's first non-empty line, ≤54 chars). */
const DERIVED_DIGEST_MAX = 54;

/** Per-mode field ceilings, as recorded by the console walk (discovery §3/§5.2). */
export interface ModeLimits {
    /** Title characters: 0/64 for 文章, 0/20 for 视频/播客. Absent = no recorded ceiling. */
    titleMax?: number;
    /** The mode refuses an untitled draft: the title placeholder is 请在这里输入标题, not （选填）. */
    titleRequired?: boolean;
    /** 摘要 characters (`textarea#js_description`, 0/120). */
    digestMax?: number;
    /** 作者 characters (`input#author`, 0/8, labelled 原创 and gated on 原创 verification). */
    authorMax?: number;
}

export const MODE_LIMITS: Record<WechatmpOperation, ModeLimits> = {
    // 文章: title 0/64 required, 摘要 0/120 选填, 作者 0/8 (discovery §5.2).
    文章: { titleRequired: true, titleMax: 64, digestMax: 120, authorMax: 8 },
    // 贴图: the title block is `请在这里输入标题（选填）` (no required flag, no recorded ceiling).
    贴图: { authorMax: 8 },
    // 视频 / 播客: the same editor route with a 0/20 title limit (discovery §5.2).
    视频: { titleMax: 20, authorMax: 8 },
    播客: { titleMax: 20, authorMax: 8 },
};

/**
 * A validated mode input: the operation plus the artifacts and fields that mode requires.
 * Discriminated on `operation` so every flow narrows to exactly the artifacts it may use.
 */
export type ModeInput =
    | { operation: '文章'; images: string[]; digest?: string }
    | { operation: '贴图'; images: string[] }
    | { operation: '视频'; video: string }
    | { operation: '播客'; audio: string; cover: string };

/** Validated artifacts in attachment order — the evidence a Result reports. */
export function artifactPaths(input: ModeInput): string[] {
    switch (input.operation) {
        case '文章':
            return input.images;
        case '贴图':
            return input.images;
        case '视频':
            return [input.video];
        case '播客':
            return [input.audio, input.cover];
    }
}

/** The body image the cover panel's 默认首图为封面 rule turns into the mode's cover. */
export function coverPath(input: ModeInput): string | undefined {
    return input.operation === '文章' || input.operation === '贴图' ? input.images[0] : undefined;
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
 * either bare (`metadata.coverImage`) or as a `{ path }` descriptor, so both are accepted here;
 * the error always names the `metadata` key.
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
 * The body-image set for the two image-carrying modes, in attachment order.
 *
 * `metadata.images` is the repo's ordered convention (xhs reads the same key). The daily MP stage
 * instead supplies `metadata.wechatmp.coverPath` — the operator's cover — which is attached FIRST
 * because the cover panel states 默认首图为封面 (discovery §5.2): the first body image is the cover.
 */
async function resolveBodyImages(content: Content): Promise<{ paths?: string[]; error?: string }> {
    const ordered = content.metadata?.images;
    if (ordered !== undefined && !Array.isArray(ordered)) {
        return { error: 'images validation: metadata.images must be an array' };
    }
    const descriptors = Array.isArray(ordered) ? ordered : [];
    const cover =
        typeof content.metadata?.wechatmp === 'object' && content.metadata.wechatmp !== null
            ? (content.metadata.wechatmp as Record<string, unknown>).coverPath
            : undefined;
    const candidates: Array<{ path: string; what: string }> = [];
    if (typeof cover === 'string' && cover.length > 0)
        candidates.push({ path: cover, what: 'metadata.wechatmp.coverPath' });
    // Repo-wide single-cover convention (itc pipeline writes this; surfdash/xhs read it too).
    const genericCover = content.metadata?.coverImage;
    const genericCoverPath =
        typeof genericCover === 'string'
            ? genericCover
            : typeof (genericCover as { path?: unknown } | undefined)?.path === 'string'
              ? (genericCover as { path: string }).path
              : undefined;
    if (genericCoverPath !== undefined && genericCoverPath.length > 0)
        candidates.push({ path: genericCoverPath, what: 'metadata.coverImage' });
    for (const [index, image] of descriptors.entries()) {
        const path = typeof image === 'string' ? image : (image as { path?: unknown })?.path;
        if (typeof path !== 'string' || path.length === 0) {
            return { error: `images validation: images[${index}] carries no path` };
        }
        candidates.push({ path, what: `metadata.images[${index}]` });
    }

    const paths: string[] = [];
    for (const { path, what } of candidates) {
        if (!isAbsolute(path)) {
            return { error: `images validation: ${what} must be absolute, got '${path}'` };
        }
        if (!IMAGE_EXTENSIONS.test(path)) {
            return {
                error: `images validation: ${what} has unsupported extension (expected ${IMAGE_LIST}): '${path}'`,
            };
        }
        if (!(await createNodeFileSystem().exists(path))) {
            return { error: `images validation: ${what} does not exist: '${path}'` };
        }
        paths.push(path);
    }
    return { paths };
}

/**
 * The 摘要 for 文章: `metadata.digest` when the operator sets one, else the body's first non-empty
 * line (the pre-ADR-029 derivation, kept). `textarea#js_description` is 0/120 and 选填.
 */
export function deriveDigest(content: Content): string | undefined {
    const explicit = content.metadata?.digest;
    if (typeof explicit === 'string') return explicit;
    const body = content.body ?? '';
    const first = body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '');
    return first === undefined ? undefined : first.slice(0, DERIVED_DIGEST_MAX);
}

/**
 * `publishStatus` is the operator's explicit live-publish request: absent means draft, `public`
 * means the flow may click the console's 发表 control, and anything else is refused here — before a
 * browser opens, so a typo can never reach a real publish control (ADR-022/ADR-026).
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

function validateTitle(content: Content, operation: WechatmpOperation): { error?: string } {
    const limits = MODE_LIMITS[operation];
    const title = content.title ?? '';
    if (limits.titleRequired === true && title.trim().length === 0) {
        return {
            error: `title validation: Content.title is required for ${operation} (the editor's placeholder is 请在这里输入标题)`,
        };
    }
    if (limits.titleMax !== undefined && title.length > limits.titleMax) {
        return {
            error: `title validation: Content.title is ${title.length} chars but ${operation} accepts ≤${limits.titleMax}`,
        };
    }
    return {};
}

function validateDigest(content: Content, operation: WechatmpOperation): { digest?: string; error?: string } {
    const max = MODE_LIMITS[operation].digestMax;
    if (max === undefined) return {};
    const digest = deriveDigest(content);
    if (digest !== undefined && digest.length > max) {
        return { error: `digest validation: the 摘要 is ${digest.length} chars but ${operation} accepts ≤${max}` };
    }
    return digest === undefined ? {} : { digest };
}

function validateAuthor(content: Content, operation: WechatmpOperation): { author?: string; error?: string } {
    const max = MODE_LIMITS[operation].authorMax;
    const author = content.metadata?.author;
    if (typeof author !== 'string' || author.length === 0) return {};
    if (max !== undefined && author.length > max) {
        return {
            error: `author validation: Content.metadata.author is ${author.length} chars but ${operation} accepts ≤${max}`,
        };
    }
    return { author };
}

export type ModeValidation = { input: ModeInput; error?: undefined } | { input?: undefined; error: string };

/**
 * Pre-browser validation for the requested operation: what it needs, and whether it fits.
 *
 * A failure here is returned as `ok:false` naming the missing artifact, field or limit — the run
 * never opens a browser or resolves a profile for input the console cannot accept. The 视频/播客
 * media modal covers the save bar (discovery §5.1), so a missing artifact must be caught here and
 * not after a console visit.
 */
export async function validateModeInput(operation: WechatmpOperation, content: Content): Promise<ModeValidation> {
    const status = validatePublishStatus(content);
    if (status.error) return { error: status.error };
    const title = validateTitle(content, operation);
    if (title.error) return { error: title.error };
    const author = validateAuthor(content, operation);
    if (author.error) return { error: author.error };

    switch (operation) {
        case '文章': {
            if ((content.body ?? '').trim().length === 0) {
                return { error: 'body validation: Content.body is required for 文章' };
            }
            const digest = validateDigest(content, operation);
            if (digest.error) return { error: digest.error };
            const images = await resolveBodyImages(content);
            if (images.error) return { error: images.error };
            if ((images.paths ?? []).length === 0) {
                return {
                    error: 'cover validation: 文章 takes its cover from a body image (默认首图为封面) but none was supplied — set metadata.wechatmp.coverPath, metadata.coverImage or metadata.images[]',
                };
            }
            return {
                input: {
                    operation,
                    images: images.paths ?? [],
                    ...(digest.digest === undefined ? {} : { digest: digest.digest }),
                },
            };
        }
        case '贴图': {
            const images = await resolveBodyImages(content);
            if (images.error) return { error: images.error };
            if ((images.paths ?? []).length === 0) {
                return {
                    error: 'image validation: 贴图 requires at least one image (metadata.images[] or metadata.wechatmp.coverPath)',
                };
            }
            return { input: { operation, images: images.paths ?? [] } };
        }
        case '视频': {
            const video = await resolveMediaPath(content, {
                key: 'video',
                label: 'video validation',
                extensions: VIDEO_EXTENSIONS,
                list: VIDEO_LIST,
            });
            if (video.error) return { error: video.error };
            return { input: { operation, video: video.path ?? '' } };
        }
        case '播客': {
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
