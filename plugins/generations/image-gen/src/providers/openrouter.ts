import { Buffer } from 'node:buffer';
import { refToDataUri } from './refs';
import { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * OpenRouter adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/openrouter.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes `ImageRequest.width/height`.
 */

const DEFAULT_MODEL = 'google/gemini-3.1-flash-image';
const COMMON_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const GEMINI_EXTENDED_ASPECT_RATIOS = ['1:4', '4:1', '1:8', '8:1'];

interface OpenRouterImageEntry {
    image_url?: string | { url?: string | null } | null;
    imageUrl?: string | { url?: string | null } | null;
}

interface OpenRouterMessagePart extends OpenRouterImageEntry {
    type?: string;
    text?: string;
}

interface OpenRouterResponse {
    choices?: Array<{
        finish_reason?: string | null;
        native_finish_reason?: string | null;
        message?: {
            images?: OpenRouterImageEntry[];
            content?: string | OpenRouterMessagePart[] | null;
        };
    }>;
}

function normalizeModelId(model: string): string {
    return model.trim().toLowerCase().split(':')[0] as string;
}

export function isTextAndImageModel(model: string): boolean {
    const normalized = normalizeModelId(model);
    if (normalized === 'openrouter/auto') return true;
    if (normalized.startsWith('google/gemini-') && normalized.includes('image')) return true;
    if (normalized.startsWith('openai/gpt-') && normalized.includes('image')) return true;
    return false;
}

function getSupportedAspectRatios(model: string): Set<string> {
    const normalized = normalizeModelId(model);
    if (normalized !== 'google/gemini-3.1-flash-image' && normalized !== 'google/gemini-3.1-flash-image-preview') {
        return new Set(COMMON_ASPECT_RATIOS);
    }
    return new Set([...COMMON_ASPECT_RATIOS, ...GEMINI_EXTENDED_ASPECT_RATIOS]);
}

function gcd(a: number, b: number): number {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y !== 0) {
        const next = x % y;
        x = y;
        y = next;
    }
    return x || 1;
}

function inferAspectRatio(size: string | null): string | null {
    if (size === null) return null;
    const parsed = size.match(/^(\d+)\s*[xX]\s*(\d+)$/);
    if (parsed === null) return null;
    const width = Number.parseInt(parsed[1] as string, 10);
    const height = Number.parseInt(parsed[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

function inferImageSize(size: string | null): '1K' | '2K' | '4K' | null {
    if (size === null) return null;
    const parsed = size.match(/^(\d+)\s*[xX]\s*(\d+)$/);
    if (parsed === null) return null;
    const width = Number.parseInt(parsed[1] as string, 10);
    const height = Number.parseInt(parsed[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const longestEdge = Math.max(width, height);
    if (longestEdge <= 1024) return '1K';
    if (longestEdge <= 2048) return '2K';
    return '4K';
}

export function getImageSize(req: Pick<ImageRequest, 'width' | 'height' | 'quality'>): '1K' | '2K' | '4K' | null {
    if (req.width !== undefined && req.height !== undefined) return inferImageSize(`${req.width}x${req.height}`);
    if (req.quality === 'normal') return '1K';
    if (req.quality === '2k') return '2K';
    return null;
}

export function getAspectRatio(preferred: string | null, size: string | null, model: string): string | null {
    if (preferred !== null) return preferred;
    const inferred = inferAspectRatio(size);
    if (inferred === null || !getSupportedAspectRatios(model).has(inferred)) return null;
    return inferred;
}

/** Reject explicit ratios (or width/height ratios) the model cannot honour, before spend. */
export function validateAspectRatio(model: string, aspectRatio: string | null, size: string | null): void {
    const requested = aspectRatio ?? inferAspectRatio(size);
    if (requested === null) return;
    const supported = getSupportedAspectRatios(model);
    if (supported.has(requested)) return;
    const requestedValue =
        aspectRatio !== null ? `aspect ratio ${requested}` : `size ${size} (aspect ratio ${requested})`;
    throw new Error(
        `OpenRouter model ${model} does not support ${requestedValue}. Supported values: ${Array.from(supported).join(', ')}`,
    );
}

export function buildContent(prompt: string, referenceImages: string[]): string | Array<Record<string, unknown>> {
    if (referenceImages.length === 0) return prompt;
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    for (const imageUrl of referenceImages) {
        content.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
    return content;
}

function extractImageUrl(entry: OpenRouterImageEntry | OpenRouterMessagePart): string | null {
    const value = entry.image_url ?? entry.imageUrl;
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    return value.url ?? null;
}

function decodeDataUrl(value: string): Uint8Array | null {
    const match = value.match(/^data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)$/);
    if (match === null) return null;
    return Uint8Array.from(Buffer.from(match[1] as string, 'base64'));
}

async function downloadImage(
    value: string,
    fetchFn: typeof fetch,
    timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Uint8Array> {
    const inline = decodeDataUrl(value);
    if (inline !== null) return inline;
    if (value.startsWith('http://') || value.startsWith('https://')) {
        const response = await fetchFn(value, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`Failed to download OpenRouter image: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    return Uint8Array.from(Buffer.from(value, 'base64'));
}

export async function extractImageFromResponse(
    result: OpenRouterResponse,
    fetchFn: typeof fetch = fetch,
    timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Uint8Array> {
    const choice = result.choices?.[0];
    const message = choice?.message;
    for (const image of message?.images ?? []) {
        const imageUrl = extractImageUrl(image);
        if (imageUrl !== null) return downloadImage(imageUrl, fetchFn, timeoutMs);
    }
    if (Array.isArray(message?.content)) {
        for (const item of message.content) {
            const imageUrl = extractImageUrl(item);
            if (imageUrl !== null) return downloadImage(imageUrl, fetchFn);
            if (item.type === 'text' && item.text !== undefined) {
                const inline = decodeDataUrl(item.text);
                if (inline !== null) return inline;
            }
        }
    } else if (typeof message?.content === 'string') {
        const inline = decodeDataUrl(message.content);
        if (inline !== null) return inline;
    }
    const finishReason = choice?.native_finish_reason || choice?.finish_reason || 'unknown';
    throw new Error(`No image in OpenRouter response (finish_reason=${finishReason})`);
}

export function buildRequestBody(
    prompt: string,
    model: string,
    req: ImageRequest,
    referenceImages: string[],
): Record<string, unknown> {
    validateAspectRatio(
        model,
        req.aspectRatio ?? null,
        req.width !== undefined && req.height !== undefined ? `${req.width}x${req.height}` : null,
    );

    const imageConfig: Record<string, string> = {};
    const imageSize = getImageSize(req);
    if (imageSize !== null) imageConfig.image_size = imageSize;
    const aspectRatio = getAspectRatio(
        req.aspectRatio ?? null,
        req.width !== undefined && req.height !== undefined ? `${req.width}x${req.height}` : null,
        model,
    );
    if (aspectRatio !== null) imageConfig.aspect_ratio = aspectRatio;

    const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: buildContent(prompt, referenceImages) }],
        modalities: isTextAndImageModel(model) ? ['image', 'text'] : ['image'],
        stream: false,
    };
    if (Object.keys(imageConfig).length > 0) {
        body.image_config = imageConfig;
        body.provider = { require_parameters: true };
    }
    return body;
}

export const createOpenrouter: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const timeoutMs = options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'openrouter',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('OPENROUTER_API_KEY') !== '',
        supportsReferenceImages: () => true,
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = readEnv('OPENROUTER_API_KEY');
            if (apiKey === '')
                throw new Error('OPENROUTER_API_KEY is required. Get one at https://openrouter.ai/settings/keys');

            const headers: Record<string, string> = {
                'content-type': 'application/json',
                authorization: `Bearer ${apiKey}`,
            };
            const referer = readEnv('OPENROUTER_HTTP_REFERER').trim();
            if (referer !== '') headers['HTTP-Referer'] = referer;
            const title = readEnv('OPENROUTER_TITLE').trim();
            if (title !== '') {
                headers['X-OpenRouter-Title'] = title;
                headers['X-Title'] = title;
            }

            const referenceImages: string[] = [];
            for (const refPath of req.referenceImages ?? []) {
                referenceImages.push(await refToDataUri(refPath));
            }
            const body = { model: req.model, ...buildRequestBody(req.prompt, req.model, req, referenceImages) };
            const base = (readEnv('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/+$/g, '');
            const response = await fetchFn(`${base}/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) {
                throw new Error(`OpenRouter API error (${response.status}): ${await response.text()}`);
            }
            const bytes = await extractImageFromResponse(
                (await response.json()) as OpenRouterResponse,
                fetchFn,
                timeoutMs,
            );
            return { bytes, extension: 'png', provider: 'openrouter', model: req.model };
        },
    };
};
