/**
 * WeChat MP article body media preparation, R3+R4 (task 0289): bounded in-body image CDN
 * migration plus external-anchor normalization, executed against the already-authenticated
 * console page (ADR-029 seam) on top of the chunk-1 cover pipeline (`./cgi`).
 *
 * HTML is only ever parsed with DOMParser inside the page (never regex-only rewriting); every
 * dispatch asserts the exact https://mp.weixin.qq.com origin first; a failed required image
 * throws before any mutated HTML is returned, so the caller's markup survives intact.
 */

import type { CoverPair, WechatCgiSession, WechatUploadedImage } from './cgi';
import { isAllowedCdnUrl, readLocalImageBytes, uploadAndCropCover, uploadCoverImage } from './cgi';
import type { WechatPage } from './page';

const MP_ORIGIN = 'https://mp.weixin.qq.com';
const UPLOADIMG2CDN_URL = `${MP_ORIGIN}/cgi-bin/uploadimg2cdn`;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const TOTAL_DEADLINE_MS = 180_000;
const MAX_AGGREGATE_BYTES = 20 * 1024 * 1024;
const MAX_BODY_SOURCES = 30;
const MAX_SOURCE_DETAIL_LENGTH = 120;

/** Bounded failure vocabulary for body-media preparation (task 0289 Design). */
export class WechatMediaError extends Error {
    constructor(
        readonly reason:
            | 'wrong-origin'
            | 'unmapped-source'
            | 'too-many-sources'
            | 'aggregate-too-large'
            | 'deadline-exceeded'
            | 'transfer-failed'
            | 'bad-transfer-receipt',
        message: string,
    ) {
        super(message);
        this.name = 'WechatMediaError';
    }
}

export interface WechatArticleMediaInput {
    html: string;
    coverPath: string;
    localImages: Record<string, string>;
}

export interface WechatArticleMedia {
    html: string;
    cover: CoverPair;
    images: WechatUploadedImage[];
}

/** Signed/query strings are secrets: error detail keeps the bare, truncated source only. */
function safeSource(source: string): string {
    const bare = source.replace(/[?#].*$/, '');
    return bare.length > MAX_SOURCE_DETAIL_LENGTH ? `${bare.slice(0, MAX_SOURCE_DETAIL_LENGTH)}…` : bare;
}

/** Query strings carry ticket/token — strip them before any failure detail is surfaced. */
function stripQuery(detail: string): string {
    return detail.replace(/\?[^'"\\\s]*/g, '?…');
}

function assertMpOrigin(page: WechatPage): void {
    let origin: string;
    try {
        origin = new URL(page.url()).origin;
    } catch {
        throw new WechatMediaError('wrong-origin', `page URL is not usable for media preparation: ${page.url()}`);
    }
    if (origin !== MP_ORIGIN) {
        throw new WechatMediaError(
            'wrong-origin',
            `media preparation requires page origin ${MP_ORIGIN}, got ${origin}`,
        );
    }
}

function assertDeadline(deadlineAt: number): void {
    if (Date.now() > deadlineAt) {
        throw new WechatMediaError(
            'deadline-exceeded',
            `article media preparation exceeded the ${TOTAL_DEADLINE_MS}ms deadline`,
        );
    }
}

/**
 * The frozen input carries no verified article origin, so relative sources without a localImages
 * mapping are always refused, and every href anchor is normalized (external-only detection needs
 * that origin — fail-safe direction is to normalize).
 */
function assertPublicHttpSource(source: string): void {
    let url: URL;
    try {
        url = new URL(source);
    } catch {
        throw new WechatMediaError(
            'unmapped-source',
            `body image source is not absolute and has no localImages mapping: ${safeSource(source)}`,
        );
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new WechatMediaError(
            'unmapped-source',
            `body image source scheme ${url.protocol} requires a localImages mapping: ${safeSource(source)}`,
        );
    }
    if (url.username !== '' || url.password !== '') {
        throw new WechatMediaError(
            'unmapped-source',
            `body image source carries credentials and is not transferable: ${safeSource(source)}`,
        );
    }
    if (isLocalHostLiteral(url.hostname)) {
        throw new WechatMediaError(
            'unmapped-source',
            `body image source is a local-IP literal and is not transferable: ${safeSource(source)}`,
        );
    }
}

function isLocalHostLiteral(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
        host === 'localhost' ||
        host === '::1' ||
        host === '0.0.0.0' ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^(f[cd]|fe80)/.test(host)
    );
}

/**
 * Self-contained page script: anchors with href become spans (children preserved), event-handler
 * and dangerous-scheme attributes are dropped (never the content), img sources are collected
 * exact-string deduplicated in document order.
 */
function parseArticleExpression(html: string): string {
    return `(function () {
    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    const dangerous = (value) => {
        const compact = String(value).toLowerCase().replace(/\\s+/g, '');
        return ['javascript:', 'data:', 'vbscript:'].some((scheme) => compact.startsWith(scheme));
    };
    doc.body.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on') || dangerous(attr.value)) el.removeAttribute(attr.name);
        });
    });
    doc.body.querySelectorAll('a[href]').forEach((a) => {
        const span = doc.createElement('span');
        while (a.firstChild) span.appendChild(a.firstChild);
        a.replaceWith(span);
    });
    const sources = [];
    const seen = new Set();
    doc.body.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (src !== '' && !seen.has(src)) {
            seen.add(src);
            sources.push(src);
        }
    });
    return JSON.stringify({ kind: 'ok', sources, html: doc.body.innerHTML });
})()`;
}

/** Second DOMParser pass: swap every affected img node's src for its migrated CDN URL. */
function applyReplacementsExpression(html: string, replacements: Record<string, string>): string {
    return `(function () {
    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    const map = ${JSON.stringify(replacements)};
    doc.body.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (map[src]) img.setAttribute('src', map[src]);
    });
    return JSON.stringify({ kind: 'ok', html: doc.body.innerHTML });
})()`;
}

/**
 * Field-only POST with the page's cookies: redirect refusal, streamed against the byte bound,
 * only a bounded JSON verdict crosses back (same closed shape as the chunk-1 CGI dispatch).
 */
function transferExpression(spec: { url: string; fields: Record<string, string>; maxBytes: number }): string {
    return `(async () => {
    const spec = ${JSON.stringify(spec)};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${REQUEST_TIMEOUT_MS});
    try {
        const form = new FormData();
        for (const key of Object.keys(spec.fields)) form.append(key, spec.fields[key]);
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
        return JSON.stringify({ kind: 'ok', text });
    } catch (error) {
        return JSON.stringify({ kind: 'error', detail: String(error) });
    } finally {
        clearTimeout(timer);
    }
})()`;
}

type PageVerdict =
    | { kind: 'ok'; sources?: string[]; html?: string; text?: string }
    | { kind: 'http-status'; status: number }
    | { kind: 'too-large' }
    | { kind: 'error'; detail: string };

async function evaluateJson(page: WechatPage, expression: string, what: string): Promise<PageVerdict> {
    const raw: unknown = await page.evaluate(expression);
    if (typeof raw !== 'string') {
        throw new WechatMediaError('transfer-failed', `${what}: page returned no usable verdict`);
    }
    try {
        return JSON.parse(raw) as PageVerdict;
    } catch {
        throw new WechatMediaError('transfer-failed', `${what}: page verdict is not JSON`);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/** uploadimg2cdn receipts carry no dimensions (frozen contract): 0 marks unknown. */
function parseTransferReceipt(text: string, source: string): WechatUploadedImage {
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch {
        throw new WechatMediaError(
            'bad-transfer-receipt',
            `uploadimg2cdn: response is not JSON for ${safeSource(source)}`,
        );
    }
    if (!isRecord(body) || body.errcode !== 0) {
        throw new WechatMediaError(
            'bad-transfer-receipt',
            `uploadimg2cdn: errcode=${String(isRecord(body) ? body.errcode : body)} for ${safeSource(source)}`,
        );
    }
    const fileId = body.file_id;
    const url = body.url;
    if (typeof fileId !== 'string' || fileId === '' || typeof url !== 'string' || !isAllowedCdnUrl(url)) {
        throw new WechatMediaError(
            'bad-transfer-receipt',
            `uploadimg2cdn: file_id/url missing or outside the allowed HTTPS CDN host for ${safeSource(source)}`,
        );
    }
    return { fileId, url, width: 0, height: 0 };
}

/** One frozen uploadimg2cdn dispatch: query lang/token/t; multipart imgurl + editor contract. */
async function transferPublicImage(
    page: WechatPage,
    session: WechatCgiSession,
    source: string,
): Promise<WechatUploadedImage> {
    const query = new URLSearchParams({
        lang: 'zh_CN',
        token: session.token,
        t: String(Math.floor(Math.random() * 1_000_000_000)),
    });
    const verdict = await evaluateJson(
        page,
        transferExpression({
            url: `${UPLOADIMG2CDN_URL}?${query.toString()}`,
            fields: {
                imgurl: source,
                t: 'ajax-editor-upload-img',
                token: session.token,
                lang: 'zh_CN',
                f: 'json',
                ajax: '1',
            },
            maxBytes: MAX_RESPONSE_BYTES,
        }),
        'uploadimg2cdn',
    );
    if (verdict.kind === 'http-status') {
        throw new WechatMediaError('transfer-failed', `uploadimg2cdn returned HTTP ${verdict.status}`);
    }
    if (verdict.kind === 'too-large') {
        throw new WechatMediaError(
            'transfer-failed',
            `uploadimg2cdn response exceeded the ${MAX_RESPONSE_BYTES}-byte bound`,
        );
    }
    if (verdict.kind !== 'ok' || typeof verdict.text !== 'string') {
        const detail = verdict.kind === 'error' ? stripQuery(verdict.detail) : 'page returned no usable verdict';
        throw new WechatMediaError('transfer-failed', `uploadimg2cdn failed before a usable response: ${detail}`);
    }
    return parseTransferReceipt(verdict.text, source);
}

/**
 * R1..R4 composition: normalize anchors, migrate every required body image source (already-CDN
 * kept as-is, localImages mappings transferred as base64 via the chunk-1 upload, public HTTP(S)
 * fetched by WeChat in-page), then the cover pair. Validates the whole result or throws; the
 * caller's input HTML is never returned mutated on failure.
 */
export async function prepareArticleMedia(
    page: WechatPage,
    session: WechatCgiSession,
    input: WechatArticleMediaInput,
): Promise<WechatArticleMedia> {
    assertMpOrigin(page);
    const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;
    const parsed = await evaluateJson(page, parseArticleExpression(input.html), 'article body parse');
    if (parsed.kind !== 'ok' || !Array.isArray(parsed.sources) || typeof parsed.html !== 'string') {
        throw new WechatMediaError('transfer-failed', 'article body parse did not return a usable verdict');
    }
    if (parsed.sources.length > MAX_BODY_SOURCES) {
        throw new WechatMediaError(
            'too-many-sources',
            `article body has ${parsed.sources.length} distinct image sources, bound is ${MAX_BODY_SOURCES}`,
        );
    }
    assertDeadline(deadlineAt);
    const cover = await uploadAndCropCover(page, session, { path: input.coverPath });
    const replacements: Record<string, string> = {};
    const images: WechatUploadedImage[] = [];
    let aggregateBytes = 0;
    for (const source of parsed.sources) {
        assertDeadline(deadlineAt);
        if (isAllowedCdnUrl(source)) continue; // exact mmbiz.qpic.cn HTTPS host: already migrated
        const mappedPath = input.localImages[source];
        let uploaded: WechatUploadedImage;
        if (mappedPath !== undefined) {
            const image = await readLocalImageBytes(mappedPath);
            aggregateBytes += image.bytes.byteLength;
            if (aggregateBytes > MAX_AGGREGATE_BYTES) {
                throw new WechatMediaError(
                    'aggregate-too-large',
                    `local body images exceed the ${MAX_AGGREGATE_BYTES}-byte aggregate bound`,
                );
            }
            uploaded = await uploadCoverImage(page, session, { path: mappedPath });
        } else {
            assertPublicHttpSource(source);
            uploaded = await transferPublicImage(page, session, source);
        }
        replacements[source] = uploaded.url;
        images.push(uploaded);
    }
    const applied = await evaluateJson(page, applyReplacementsExpression(parsed.html, replacements), 'CDN replacement');
    if (applied.kind !== 'ok' || typeof applied.html !== 'string') {
        throw new WechatMediaError('transfer-failed', 'CDN replacement did not return a usable verdict');
    }
    return { html: applied.html, cover, images };
}
