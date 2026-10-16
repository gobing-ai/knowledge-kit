/**
 * WeChat MP private CGI media pipeline, R1+R2 (task 0289): the article-cover `filetransfer
 * scene=8` upload and the `cropimage action=crop_multi` dual-aspect crop, executed inside the
 * already-authenticated console page (ADR-029 seam) with the session inputs 0290 extracts.
 *
 * Request shapes are frozen from the recovered v0.1.55 extension weixin.js (task 0289 Design);
 * this is versioned compatibility behavior, not an official WeChat API guarantee. Every
 * credentialed call asserts the exact https://mp.weixin.qq.com origin before any dispatch, posts
 * multipart through a page-side AbortController, refuses redirects, bounds each response to 2 MiB
 * and 30 s with no retry, and never logs or embeds session secrets in errors.
 */
import type { WechatPage } from './page';

const MP_ORIGIN = 'https://mp.weixin.qq.com';
const FILETRANSFER_URL = `${MP_ORIGIN}/cgi-bin/filetransfer`;
const CROPIMAGE_URL = `${MP_ORIGIN}/cgi-bin/cropimage`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const WIDE_COVER_ASPECT = 2.35;
const SQUARE_COVER_ASPECT = 1;

const EXTENSION_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
};

/** Bounded failure vocabulary for every CGI upload/crop refusal (task 0289 Design). */
export class WechatCgiError extends Error {
    constructor(
        readonly reason:
            | 'wrong-origin'
            | 'unreadable-file'
            | 'unsupported-extension'
            | 'image-too-large'
            | 'empty-image'
            | 'invalid-dimensions'
            | 'http-status'
            | 'response-too-large'
            | 'network-error'
            | 'bad-receipt',
        message: string,
    ) {
        super(message);
        this.name = 'WechatCgiError';
    }
}

export interface WechatCgiSession {
    token: string;
    ticket: string;
    userName: string;
    uin?: string;
}

export interface WechatUploadedImage {
    fileId: string;
    url: string;
    width: number;
    height: number;
}

export interface CropRect {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface CoverPair {
    wide: WechatUploadedImage;
    square: WechatUploadedImage;
    /**
     * The actual crop_multi boxes in [wide 2.35:1, square 1:1] order — task 0290's operate_appmsg
     * payload must carry these exact coordinates, never vendor hard-coded pixels.
     */
    crops: [CropRect, CropRect];
}

export type CgiImageInput = { path: string } | { bytes: Uint8Array; name: string };

export interface CgiImageBytes {
    bytes: Uint8Array;
    name: string;
    mime: string;
}

/** Exact-host CDN allowlist (task 0289 Design: mmbiz.qpic.cn HTTPS only, never suffix matching). */
export function isAllowedCdnUrl(candidate: string): boolean {
    try {
        const url = new URL(candidate);
        return url.protocol === 'https:' && url.host === 'mmbiz.qpic.cn';
    } catch {
        return false;
    }
}

/**
 * Centered cover-fit rectangle for one target aspect ratio, from ACTUAL image dimensions — never
 * the vendor's hard-coded pixels (0289 refine correction). Coordinates are integers inside the
 * image bounds, the form the crop_multi fields expect.
 */
export function centerCropRect(width: number, height: number, aspect: number): CropRect {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
        throw new WechatCgiError(
            'invalid-dimensions',
            `image dimensions must be positive numbers, got ${width}x${height}`,
        );
    }
    if (!Number.isFinite(aspect) || aspect <= 0) {
        throw new WechatCgiError('invalid-dimensions', `crop aspect must be positive, got ${aspect}`);
    }
    let cropWidth = width;
    let cropHeight = height;
    if (width / height > aspect) {
        cropWidth = height * aspect;
    } else {
        cropHeight = width / aspect;
    }
    const x1 = Math.floor((width - cropWidth) / 2);
    const y1 = Math.floor((height - cropHeight) / 2);
    return {
        x1,
        y1,
        x2: Math.min(width, x1 + Math.round(cropWidth)),
        y2: Math.min(height, y1 + Math.round(cropHeight)),
    };
}

function extensionMime(name: string): string {
    const lower = name.toLowerCase();
    const dot = lower.lastIndexOf('.');
    const mime = dot === -1 ? undefined : EXTENSION_MIME[lower.slice(dot)];
    if (mime === undefined) {
        throw new WechatCgiError('unsupported-extension', `accepted image extensions are PNG/JPEG/WebP, got '${name}'`);
    }
    return mime;
}

/** Validates in-memory image bytes (nonempty, ≤10 MiB, PNG/JPEG/WebP by extension). */
export function validateImageBytes(bytes: Uint8Array, name: string): CgiImageBytes {
    if (bytes.byteLength === 0) {
        throw new WechatCgiError('empty-image', `image '${name}' is empty`);
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new WechatCgiError('image-too-large', `image '${name}' exceeds the ${MAX_IMAGE_BYTES}-byte bound`);
    }
    return { bytes, name, mime: extensionMime(name) };
}

/**
 * Local cover read via the Bun FileSystem: regular, readable, nonempty file within the 10 MiB
 * per-file bound; payload crosses the page boundary as base64 only (task 0289 Design).
 */
export async function readLocalImageBytes(path: string): Promise<CgiImageBytes> {
    const name = path.replaceAll('\\', '/').split('/').pop() ?? path;
    extensionMime(name); // fail fast on the extension before any read
    const file = Bun.file(path);
    let stat: { size: number; isFile(): boolean };
    try {
        stat = await file.stat();
    } catch {
        throw new WechatCgiError('unreadable-file', `image is not a readable file: ${path}`);
    }
    if (!stat.isFile() || stat.size === 0) {
        throw new WechatCgiError('unreadable-file', `image is not a nonempty regular file: ${path}`);
    }
    if (stat.size > MAX_IMAGE_BYTES) {
        throw new WechatCgiError('image-too-large', `image '${path}' exceeds the ${MAX_IMAGE_BYTES}-byte bound`);
    }
    return validateImageBytes(new Uint8Array(await file.arrayBuffer()), name);
}

interface CgiFetchRequest {
    url: string;
    fields: Record<string, string>;
    file?: { field: string; filename: string; mime: string; base64: string };
    maxBytes: number;
    timeoutMs: number;
}

/**
 * Self-contained page script: data enters as one JSON.stringify'd literal (never interpolated
 * code), the fetch runs with the page's authenticated cookies, redirect: 'error' fails closed on
 * ANY redirect (subsumes the foreign-origin refusal), and the body is streamed against the 2 MiB
 * bound. Only a bounded JSON verdict string crosses back.
 */
function cgiFetchExpression(spec: CgiFetchRequest): string {
    return `(async () => {
        const spec = ${JSON.stringify(spec)};
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), spec.timeoutMs);
        try {
            const form = new FormData();
            for (const key of Object.keys(spec.fields)) form.append(key, spec.fields[key]);
            if (spec.file) {
                const binary = atob(spec.file.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                form.append(spec.file.field, new Blob([bytes], { type: spec.file.mime }), spec.file.filename);
            }
            const response = await fetch(spec.url, {
                method: 'POST',
                body: form,
                credentials: 'include',
                redirect: 'error',
                signal: controller.signal,
            });
            if (!response.ok) return JSON.stringify({ kind: 'http-status', status: response.status });
            if (!response.body) return JSON.stringify({ kind: 'error', detail: 'response has no body stream' });
            const reader = response.body.getReader();
            let total = 0;
            const chunks = [];
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > spec.maxBytes) {
                    controller.abort();
                    return JSON.stringify({ kind: 'too-large' });
                }
                chunks.push(value);
            }
            const text = await new Blob(chunks).text();
            return JSON.stringify({ kind: 'ok', status: response.status, text });
        } catch (error) {
            return JSON.stringify({ kind: 'error', detail: String(error) });
        } finally {
            clearTimeout(timer);
        }
    })()`;
}

type CgiVerdict =
    | { kind: 'ok'; status: number; text: string }
    | { kind: 'http-status'; status: number }
    | { kind: 'too-large' }
    | { kind: 'error'; detail: string };

/** Query strings carry ticket/token — strip them before any failure detail is surfaced. */
function stripQuery(detail: string): string {
    return detail.replace(/\?[^'"\\\s]*/g, '?…');
}

async function postCgiForm(page: WechatPage, spec: CgiFetchRequest): Promise<{ status: number; text: string }> {
    let verdict: CgiVerdict | undefined;
    const raw: unknown = await page.evaluate(cgiFetchExpression(spec));
    if (typeof raw === 'string') {
        try {
            verdict = JSON.parse(raw) as CgiVerdict;
        } catch {
            verdict = undefined;
        }
    }
    if (verdict?.kind === 'http-status') {
        throw new WechatCgiError('http-status', `CGI call returned HTTP ${verdict.status}`);
    }
    if (verdict?.kind === 'too-large') {
        throw new WechatCgiError('response-too-large', `CGI response exceeded the ${MAX_RESPONSE_BYTES}-byte bound`);
    }
    if (verdict?.kind !== 'ok') {
        const detail = verdict?.kind === 'error' ? stripQuery(verdict.detail) : 'page returned no usable verdict';
        throw new WechatCgiError('network-error', `CGI call failed before a usable response: ${detail}`);
    }
    return { status: verdict.status, text: verdict.text };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function parseJsonBody(text: string, what: string): Record<string, unknown> {
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new WechatCgiError('bad-receipt', `${what}: response is not JSON`);
    }
    if (!isRecord(body)) {
        throw new WechatCgiError('bad-receipt', `${what}: response is not a JSON object`);
    }
    return body;
}

/** ret absent or 0 is the hard gate; a present err_msg must agree with it. */
function assertBaseResp(body: Record<string, unknown>, what: string): void {
    const base = body.base_resp;
    if (base === undefined) return;
    if (!isRecord(base)) {
        throw new WechatCgiError('bad-receipt', `${what}: malformed base_resp`);
    }
    if (base.ret !== undefined && base.ret !== 0) {
        throw new WechatCgiError('bad-receipt', `${what}: base_resp.ret=${String(base.ret)}`);
    }
    if (base.err_msg !== undefined && base.err_msg !== 'ok') {
        throw new WechatCgiError('bad-receipt', `${what}: err_msg=${String(base.err_msg)}`);
    }
}

function parseFiletransferReceipt(text: string): WechatUploadedImage {
    const body = parseJsonBody(text, 'filetransfer');
    assertBaseResp(body, 'filetransfer');
    const content = body.content;
    if (typeof content !== 'string' || !/^\d+$/.test(content)) {
        throw new WechatCgiError('bad-receipt', 'filetransfer: content file ID is missing or not numeric');
    }
    const cdnUrl = body.cdn_url;
    if (typeof cdnUrl !== 'string' || !isAllowedCdnUrl(cdnUrl)) {
        throw new WechatCgiError(
            'bad-receipt',
            'filetransfer: cdn_url is missing or outside the allowed HTTPS CDN host',
        );
    }
    const width = body.width;
    const height = body.height;
    if (typeof width !== 'number' || typeof height !== 'number' || width < 1 || height < 1) {
        throw new WechatCgiError('bad-receipt', 'filetransfer: receipt did not return usable image dimensions');
    }
    return { fileId: content, url: cdnUrl, width, height };
}

function parseCropMultiReceipt(
    text: string,
    crops: readonly [CropRect, CropRect],
): [WechatUploadedImage, WechatUploadedImage] {
    const body = parseJsonBody(text, 'crop_multi');
    assertBaseResp(body, 'crop_multi');
    const entries: unknown[] = Array.isArray(body.result) ? body.result : [];
    const entryCount = entries.length;
    if (entryCount !== 2) {
        throw new WechatCgiError('bad-receipt', `crop_multi: expected exactly two result entries, got ${entryCount}`);
    }
    let wide: WechatUploadedImage | undefined;
    let square: WechatUploadedImage | undefined;
    entries.forEach((entry, index) => {
        const dims = index === 0 ? crops[0] : crops[1];
        if (!isRecord(entry)) {
            throw new WechatCgiError('bad-receipt', `crop_multi: result entry ${index} is not an object`);
        }
        const cdnurl = entry.cdnurl;
        const fileId = entry.file_id;
        if (typeof cdnurl !== 'string' || !isAllowedCdnUrl(cdnurl)) {
            throw new WechatCgiError(
                'bad-receipt',
                `crop_multi: entry ${index} cdnurl is outside the allowed HTTPS CDN host`,
            );
        }
        if (typeof fileId !== 'string' || fileId === '') {
            throw new WechatCgiError('bad-receipt', `crop_multi: entry ${index} file_id is missing`);
        }
        const image: WechatUploadedImage = {
            fileId,
            url: cdnurl,
            width: Math.max(1, dims.x2 - dims.x1),
            height: Math.max(1, dims.y2 - dims.y1),
        };
        if (index === 0) {
            wide = image;
        } else {
            square = image;
        }
    });
    if (wide === undefined || square === undefined) {
        throw new WechatCgiError('bad-receipt', 'crop_multi: receipt did not fill both crop entries');
    }
    return [wide, square];
}

function buildUrl(base: string, params: Record<string, string>): string {
    return `${base}?${new URLSearchParams(params).toString()}`;
}

function randomRequestSalt(): number {
    return Math.floor(Math.random() * 1_000_000_000);
}

/** The frozen filetransfer scene=8 query (task 0289 Design) — order and values are compatibility. */
function filetransferUrl(session: WechatCgiSession): string {
    return buildUrl(FILETRANSFER_URL, {
        action: 'upload_material',
        f: 'json',
        scene: '8',
        writetype: 'doublewrite',
        groupid: '1',
        ticket_id: session.userName,
        ticket: session.ticket,
        svr_time: String(Math.floor(Date.now() / 1000)),
        token: session.token,
        lang: 'zh_CN',
        seq: String(randomRequestSalt()),
        t: String(randomRequestSalt()),
    });
}

/** The page must already BE the authenticated console origin before anything is evaluated. */
function assertMpOrigin(page: WechatPage): void {
    let origin: string;
    try {
        origin = new URL(page.url()).origin;
    } catch {
        throw new WechatCgiError('wrong-origin', `page URL is not usable for CGI dispatch: ${page.url()}`);
    }
    if (origin !== MP_ORIGIN) {
        throw new WechatCgiError('wrong-origin', `CGI dispatch requires page origin ${MP_ORIGIN}, got ${origin}`);
    }
}

/** R1: one filetransfer scene=8 upload, validated whole or a named WechatCgiError. */
export async function uploadCoverImage(
    page: WechatPage,
    session: WechatCgiSession,
    input: CgiImageInput,
): Promise<WechatUploadedImage> {
    assertMpOrigin(page);
    const image = 'path' in input ? await readLocalImageBytes(input.path) : validateImageBytes(input.bytes, input.name);
    const now = Date.now();
    const fields: Record<string, string> = {
        type: image.mime,
        id: `kk_${now}_${randomRequestSalt()}`,
        name: image.name,
        lastModifiedDate: new Date(now).toString(),
        size: String(image.bytes.byteLength),
    };
    const { text } = await postCgiForm(page, {
        url: filetransferUrl(session),
        fields,
        file: {
            field: 'file',
            filename: image.name,
            mime: image.mime,
            base64: Buffer.from(image.bytes).toString('base64'),
        },
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return parseFiletransferReceipt(text);
}

/** R2: one crop_multi dispatch producing both aspect crops, receipts validated in expected order. */
export async function cropCoverMulti(
    page: WechatPage,
    session: WechatCgiSession,
    imageUrl: string,
    crops: readonly [CropRect, CropRect],
): Promise<[WechatUploadedImage, WechatUploadedImage]> {
    assertMpOrigin(page);
    const fields: Record<string, string> = {
        imgurl: imageUrl,
        size_count: '2',
        token: session.token,
        lang: 'zh_CN',
        f: 'json',
        ajax: '1',
    };
    crops.forEach((crop, index) => {
        fields[`size${index}_x1`] = String(crop.x1);
        fields[`size${index}_y1`] = String(crop.y1);
        fields[`size${index}_x2`] = String(crop.x2);
        fields[`size${index}_y2`] = String(crop.y2);
    });
    const { text } = await postCgiForm(page, {
        url: buildUrl(CROPIMAGE_URL, { action: 'crop_multi' }),
        fields,
        maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return parseCropMultiReceipt(text, crops);
}

/** The R1+R2 pair: upload once, crop from the receipt's ACTUAL dimensions, return wide+square. */
export async function uploadAndCropCover(
    page: WechatPage,
    session: WechatCgiSession,
    input: CgiImageInput,
): Promise<CoverPair> {
    const uploaded = await uploadCoverImage(page, session, input);
    const crops: [CropRect, CropRect] = [
        centerCropRect(uploaded.width, uploaded.height, WIDE_COVER_ASPECT),
        centerCropRect(uploaded.width, uploaded.height, SQUARE_COVER_ASPECT),
    ];
    const [wide, square] = await cropCoverMulti(page, session, uploaded.url, crops);
    return { wide, square, crops };
}
