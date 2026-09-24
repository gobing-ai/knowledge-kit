import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { readBytes } from '../bytes';
import { mimeForPath } from './refs';
import { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Google Gemini / Imagen adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/google.ts
 * (MIT © 2026 Jim Liu), mapped from `CliArgs` onto `ImageRequest`.
 */

const GOOGLE_MULTIMODAL_MODELS = [
    'gemini-3-pro-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image-preview',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-image-preview',
];
const GOOGLE_IMAGEN_MODELS = ['imagen-3.0-generate-002', 'imagen-3.0-generate-001'];

const DEFAULT_MODEL = 'gemini-3-pro-image';

export function normalizeGoogleModelId(model: string): string {
    return model.startsWith('models/') ? model.slice('models/'.length) : model;
}

export function isGoogleMultimodal(model: string): boolean {
    const normalized = normalizeGoogleModelId(model);
    return GOOGLE_MULTIMODAL_MODELS.some((fragment) => normalized.includes(fragment));
}

export function isGoogleImagen(model: string): boolean {
    const normalized = normalizeGoogleModelId(model);
    return GOOGLE_IMAGEN_MODELS.some((fragment) => normalized.includes(fragment));
}

export function buildGoogleUrl(base: string, pathname: string): string {
    const cleaned = base.replace(/\/+$/g, '').replace(/^\/+/g, '');
    const cleanedPath = pathname.replace(/^\/+/g, '');
    if (cleaned.endsWith('/v1beta')) return `${cleaned}/${cleanedPath}`;
    return `${cleaned}/v1beta/${cleanedPath}`;
}

/** Aspect hint appended verbatim; 2k adds the resolution segment (baoyu buildPromptWithAspect). */
export function buildPromptWithAspect(
    prompt: string,
    aspectRatio: string | undefined,
    quality: 'normal' | '2k' | undefined,
): string {
    let result = prompt;
    if (aspectRatio !== undefined) result += ` Aspect ratio: ${aspectRatio}.`;
    if (quality === '2k') result += ' High resolution 2048px.';
    return result;
}

export function extractInlineImageData(response: {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
}): string | null {
    for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
            const data = part.inlineData?.data;
            if (typeof data === 'string' && data.length > 0) return data;
        }
    }
    return null;
}

interface PredictedEntry {
    imageBytes?: unknown;
    bytesBase64Encoded?: unknown;
    data?: unknown;
    image?: unknown;
}

export function extractPredictedImageData(response: {
    predictions?: PredictedEntry[];
    generatedImages?: PredictedEntry[];
}): string | null {
    for (const candidate of [...(response.predictions ?? []), ...(response.generatedImages ?? [])]) {
        if (candidate === null || typeof candidate !== 'object') continue;
        const fields: string[] = [candidate.imageBytes, candidate.bytesBase64Encoded, candidate.data].flatMap(
            (value) => (typeof value === 'string' && value.length > 0 ? [value] : []),
        );
        if (fields.length > 0) return fields[0] ?? null;
        const image = candidate.image;
        if (image !== null && typeof image === 'object') {
            const record = image as PredictedEntry;
            for (const value of [record.imageBytes, record.bytesBase64Encoded, record.data]) {
                if (typeof value === 'string' && value.length > 0) return value;
            }
        }
    }
    return null;
}

function resolveSize(req: ImageRequest): '1K' | '2K' | '4K' | undefined {
    if (req.width !== undefined && req.height !== undefined) {
        return Math.max(req.width, req.height) <= 1024 ? '1K' : Math.max(req.width, req.height) <= 2048 ? '2K' : '4K';
    }
    return undefined;
}

function getHttpProxy(readEnv: (key: string) => string): string | null {
    return (
        readEnv('https_proxy') ||
        readEnv('HTTPS_PROXY') ||
        readEnv('http_proxy') ||
        readEnv('HTTP_PROXY') ||
        readEnv('ALL_PROXY') ||
        null
    );
}

/**
 * curl config-file quoting: backslash-escape `\` and `"` inside a double-quoted value.
 * curl's config parser is not a shell, but it does honour these two escapes.
 */
const curlQuote = (s: string): string => `"${s.replace(/[\\"]/g, '\\$&')}"`;

/** Replaces every secret with `***`; empty entries are skipped so `''` cannot mangle the text. */
const redact = (s: string, secrets: string[]): string =>
    secrets.filter((x) => x !== '').reduce((acc, x) => acc.replaceAll(x, '***'), s);

/** Decoded password from a proxy URL, or '' when the URL carries none or does not parse. */
function proxyPassword(proxy: string): string {
    try {
        return decodeURIComponent(new URL(proxy).password);
    } catch {
        return '';
    }
}

interface GeminiResponse {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
}

interface ImagenResponse {
    predictions?: PredictedEntry[];
    generatedImages?: PredictedEntry[];
}

export const createGoogle: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const timeoutMs = options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';
    const refModels = [
        'gemini-3-pro-image',
        'gemini-3.1-flash-image',
        'gemini-3-pro-image-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-image-preview',
    ];
    const supportsRef = (model: string): boolean =>
        refModels.some((fragment) => normalizeGoogleModelId(model).includes(fragment));

    async function postGoogleJson<T>(pathname: string, body: unknown): Promise<T> {
        const apiKey = readEnv('GOOGLE_API_KEY') || readEnv('GEMINI_API_KEY');
        if (apiKey === '') throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY is required');
        const base = readEnv('GOOGLE_BASE_URL') || 'https://generativelanguage.googleapis.com';
        const url = buildGoogleUrl(base, pathname);
        const proxy = getHttpProxy(readEnv);
        // Bun's fetch drops long-lived proxied sockets; upstream works around it with curl (0115 port).
        if (proxy !== null && options?.fetch === undefined) {
            // Secrets stay out of argv: curl reads the proxy and the API key from a config file
            // (`-K <path>`), and the request body arrives on stdin (`-d @-`). `execFileSync` embeds the
            // full argv in `error.message`, so `-x <proxy>` / `-H 'x-goog-api-key: …'` would leak both
            // the key and the proxy password into logs. `-sS` (not `-s`) keeps curl's own diagnostic on
            // stderr, so `details` no longer falls back to that argv-bearing message.
            //
            // File IO goes through the `@gobing-ai/ts-runtime` seam (`no-direct-fs-io`): the seam is
            // text-only with no `mode` argument, and the file lives in `os.tmpdir()`, which is a
            // per-user directory (0700 on macOS).
            const configPath = join(tmpdir(), `kk-image-gen-${randomUUID()}.curlrc`);
            const config = `proxy = ${curlQuote(proxy)}\nheader = ${curlQuote(`x-goog-api-key: ${apiKey}`)}\n`;
            const fileSystem = createNodeFileSystem();
            await fileSystem.writeFile(configPath, config);
            let result: string;
            try {
                result = execFileSync(
                    'curl',
                    [
                        '-sS',
                        '--connect-timeout',
                        '30',
                        '--max-time',
                        '300',
                        '-K',
                        configPath,
                        '-H',
                        'Content-Type: application/json',
                        '-d',
                        '@-',
                        url,
                    ],
                    { input: JSON.stringify(body), encoding: 'utf8', timeout: 310_000 },
                );
            } catch (error: unknown) {
                const e = error as { message?: string; stderr?: string | Buffer };
                const details =
                    (typeof e.stderr === 'string' ? e.stderr.trim() : '') || e.message || 'curl request failed';
                // Redact the raw `user:pass@host` form as well as the decoded password.
                throw new Error(
                    `Google API request failed via curl: ${redact(details, [apiKey, proxyPassword(proxy), proxy])}`,
                );
            } finally {
                await fileSystem.deleteFile(configPath);
            }
            const parsed = JSON.parse(result) as T & { error?: { code?: string; message?: string } };
            if (parsed.error !== undefined) {
                throw new Error(`Google API error (${parsed.error.code}): ${parsed.error.message}`);
            }
            return parsed;
        }
        const res = await fetchFn(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`Google API error (${res.status}): ${err}`);
        }
        return (await res.json()) as T;
    }

    async function generateWithGemini(req: ImageRequest): Promise<Uint8Array> {
        const promptWithAspect = buildPromptWithAspect(req.prompt, req.aspectRatio, req.quality);
        const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
        for (const refPath of req.referenceImages ?? []) {
            parts.push({
                inlineData: {
                    data: Buffer.from(await readBytes(refPath)).toString('base64'),
                    mimeType: mimeForPath(refPath),
                },
            });
        }
        parts.push({ text: promptWithAspect });
        const response = await postGoogleJson<GeminiResponse>(
            `models/${normalizeGoogleModelId(req.model)}:generateContent`,
            {
                contents: [{ role: 'user', parts }],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    imageConfig: { imageSize: resolveSize(req) ?? (req.quality === '2k' ? '2K' : '1K') },
                },
            },
        );
        const imageData = extractInlineImageData(response);
        if (imageData !== null) return Uint8Array.from(Buffer.from(imageData, 'base64'));
        throw new Error('No image in response');
    }

    async function generateWithImagen(req: ImageRequest): Promise<Uint8Array> {
        const fullPrompt = buildPromptWithAspect(req.prompt, req.aspectRatio, req.quality);
        const imageSize = resolveSize(req) ?? (req.quality === '2k' ? '2K' : '1K');
        const parameters: Record<string, unknown> = { sampleCount: req.n ?? 1 };
        if (req.aspectRatio !== undefined) parameters.aspectRatio = req.aspectRatio;
        parameters.imageSize = imageSize === '4K' ? '2K' : imageSize;
        const response = await postGoogleJson<ImagenResponse>(`models/${normalizeGoogleModelId(req.model)}:predict`, {
            instances: [{ prompt: fullPrompt }],
            parameters,
        });
        const imageData = extractPredictedImageData(response);
        if (imageData !== null) return Uint8Array.from(Buffer.from(imageData, 'base64'));
        throw new Error('No image in response');
    }

    async function generate(req: ImageRequest): Promise<ImageResult> {
        const refs = req.referenceImages;
        if (isGoogleImagen(req.model)) {
            if (refs !== undefined && refs.length > 0) {
                throw new Error(
                    'Reference images are not supported with Imagen models. Use a Gemini multimodal model such as gemini-3-pro-image, gemini-3.1-flash-image, gemini-3-pro-image-preview, gemini-3-flash-preview, or gemini-3.1-flash-image-preview.',
                );
            }
            return { bytes: await generateWithImagen(req), extension: 'png', provider: 'google', model: req.model };
        }
        if (!isGoogleMultimodal(req.model) && refs !== undefined && refs.length > 0) {
            throw new Error(
                'Reference images are only supported with Gemini multimodal models such as gemini-3-pro-image, gemini-3.1-flash-image, gemini-3-pro-image-preview, gemini-3-flash-preview, or gemini-3.1-flash-image-preview.',
            );
        }
        const bytes = await generateWithGemini(req);
        return { bytes, extension: 'png', provider: 'google', model: req.model };
    }

    return {
        name: 'google',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => (readEnv('GOOGLE_API_KEY') || readEnv('GEMINI_API_KEY')) !== '',
        supportsReferenceImages: supportsRef,
        validate(req: ImageRequest): void {
            if ((req.referenceImages?.length ?? 0) > 0 && !supportsRef(req.model)) {
                throw new Error(
                    `google model '${req.model}' does not accept reference images; use a Gemini multimodal model`,
                );
            }
        },
        generate,
    };
};
