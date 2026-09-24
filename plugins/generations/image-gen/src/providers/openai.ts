import { Buffer } from 'node:buffer';
import { basename } from 'node:path';
import { readBytes } from '../bytes';
import { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * OpenAI Images adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/openai.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes `ImageRequest.width/height`.
 */

const DEFAULT_MODEL = 'gpt-image-2';

export interface OpenAIImageResponse {
    data: Array<{ url?: string; b64_json?: string }>;
}

/** Size target for openai-native dialect; pick a value only when width+height are known (0115). */
function explicitSize(req: ImageRequest): string | undefined {
    return req.width !== undefined && req.height !== undefined ? `${req.width}x${req.height}` : undefined;
}

interface AspectAndSizeArgs {
    aspectRatio: string | undefined;
    size: string | undefined;
    quality: 'normal' | '2k' | undefined;
    imageApiDialect?: 'openai-native' | 'ratio-metadata' | undefined;
}

export function parseAspectRatio(ar: string): { width: number; height: number } | null {
    const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match === null) return null;
    const w = Number.parseFloat(match[1] as string);
    const h = Number.parseFloat(match[2] as string);
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h };
}

function roundToMultiple(value: number, multiple: number): number {
    return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function buildGptImage2SizeFromAspectRatio(ratio: number, quality: 'normal' | '2k' | undefined): string {
    if (Math.abs(ratio - 1) < 0.1) {
        const edge = quality === '2k' ? 2048 : 1024;
        return `${edge}x${edge}`;
    }
    const targetLongEdge = quality === '2k' ? 2048 : 1024;
    let width: number;
    let height: number;
    if (ratio > 1) {
        width = targetLongEdge;
        height = roundToMultiple(width / ratio, 16);
    } else {
        height = targetLongEdge;
        width = roundToMultiple(height * ratio, 16);
    }
    while (width * height < 655_360) {
        if (ratio > 1) {
            width += 16;
            height = roundToMultiple(width / ratio, 16);
        } else {
            height += 16;
            width = roundToMultiple(height * ratio, 16);
        }
    }
    return `${width}x${height}`;
}

export function getOpenAISize(model: string, ar: string | null, quality: 'normal' | '2k' | undefined): string {
    const isDalle2 = model.includes('dall-e-2');
    const isDalle3 = model.includes('dall-e-3');
    const isGptImage2 = model.includes('gpt-image-2');

    if (isDalle2) return '1024x1024';

    if (isGptImage2) {
        const parsed = ar === null ? null : parseAspectRatio(ar);
        const ratio = parsed === null ? 1 : parsed.width / parsed.height;
        return buildGptImage2SizeFromAspectRatio(ratio, quality);
    }

    const sizes = isDalle3
        ? { square: '1024x1024', landscape: '1792x1024', portrait: '1024x1792' }
        : { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' };
    if (ar === null) return sizes.square;
    const parsed = parseAspectRatio(ar);
    if (parsed === null) return sizes.square;
    const ratio = parsed.width / parsed.height;
    if (Math.abs(ratio - 1) < 0.1) return sizes.square;
    if (ratio > 1.5) return sizes.landscape;
    if (ratio < 0.67) return sizes.portrait;
    return sizes.square;
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

export function inferAspectRatioFromSize(size: string | null): string | null {
    if (size === null) return null;
    const parsed = size.match(/^(\d+)\s*[xX]\s*(\d+)$/);
    if (parsed === null) return null;
    const width = Number.parseInt(parsed[1] as string, 10);
    const height = Number.parseInt(parsed[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
}

export function inferResolutionFromSize(size: string | null): '1K' | '2K' | '4K' | null {
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

export function getOpenAIAspectRatio(args: { aspectRatio: string | undefined; size: string | undefined }): string {
    return args.aspectRatio ?? inferAspectRatioFromSize(args.size ?? null) ?? '1:1';
}

export function getOpenAIResolution(args: {
    size: string | undefined;
    quality: 'normal' | '2k' | undefined;
}): '1K' | '2K' | '4K' {
    const inferred = inferResolutionFromSize(args.size ?? null);
    if (inferred !== null) return inferred;
    return args.quality === 'normal' ? '1K' : '2K';
}

type OpenAIQuality = 'standard' | 'hd' | 'medium' | 'high';

function getOpenAIQuality(model: string, quality: 'normal' | '2k' | undefined): OpenAIQuality | null {
    if (model.includes('dall-e-3')) return quality === '2k' ? 'hd' : 'standard';
    if (model.includes('gpt-image')) return quality === '2k' ? 'high' : 'medium';
    return null;
}

export function getOrientationFromAspectRatio(ar: string): 'landscape' | 'portrait' | null {
    const parsed = parseAspectRatio(ar);
    if (parsed === null) return null;
    const ratio = parsed.width / parsed.height;
    if (Math.abs(ratio - 1) < 0.1) return null;
    return ratio > 1 ? 'landscape' : 'portrait';
}

export function buildOpenAIGenerationsBody(
    prompt: string,
    model: string,
    args: AspectAndSizeArgs,
): Record<string, unknown> {
    if ((args.imageApiDialect ?? 'openai-native') === 'ratio-metadata') {
        const aspectRatio = getOpenAIAspectRatio(args);
        const metadata: Record<string, string> = {
            resolution: getOpenAIResolution({ size: args.size, quality: args.quality }),
        };
        const orientation = getOrientationFromAspectRatio(aspectRatio);
        if (orientation !== null) metadata.orientation = orientation;
        return { model, prompt, size: aspectRatio, metadata };
    }
    const body: Record<string, unknown> = {
        model,
        prompt,
        size: args.size ?? getOpenAISize(model, args.aspectRatio ?? null, args.quality),
    };
    const quality = getOpenAIQuality(model, args.quality);
    if (quality !== null) body.quality = quality;
    return body;
}

/** gpt-image-2 custom size constraints (baoyu validateArgs, px size from width/height). */
export function validateGptImage2Size(width: number, height: number): void {
    const ratio = Math.max(width, height) / Math.min(width, height);
    if (Math.max(width, height) > 3840)
        throw new Error('gpt-image-2 --size maximum edge length must be 3840px or less.');
    if (width % 16 !== 0 || height % 16 !== 0) {
        throw new Error('gpt-image-2 --size width and height must both be multiples of 16px.');
    }
    if (ratio > 3) throw new Error('gpt-image-2 --size long edge to short edge ratio must not exceed 3:1.');
    const totalPixels = width * height;
    if (totalPixels < 655_360 || totalPixels > 8_294_400) {
        throw new Error('gpt-image-2 --size total pixels must be between 655,360 and 8,294,400.');
    }
}

export function getMimeType(filename: string): string {
    const ext = basename(filename).toLowerCase();
    if (ext.includes('.jpg') || ext.includes('.jpeg')) return 'image/jpeg';
    if (ext.includes('.webp')) return 'image/webp';
    if (ext.includes('.gif')) return 'image/gif';
    return 'image/png';
}

export async function extractImageFromResponse(
    result: OpenAIImageResponse,
    fetchFn: typeof fetch = fetch,
    timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Uint8Array> {
    const img = result.data[0];
    if (img?.b64_json !== undefined && img.b64_json !== '') {
        return Uint8Array.from(Buffer.from(img.b64_json, 'base64'));
    }
    if (img?.url !== undefined) {
        const imgRes = await fetchFn(img.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!imgRes.ok) throw new Error('Failed to download image');
        return new Uint8Array(await imgRes.arrayBuffer());
    }
    throw new Error('No image in response');
}

export const createOpenai: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const timeoutMs = options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';
    const supportsRef = (model: string): boolean => model.includes('gpt-image');

    return {
        name: 'openai',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('OPENAI_API_KEY') !== '',
        supportsReferenceImages: supportsRef,
        validate(req: ImageRequest): void {
            if ((req.referenceImages?.length ?? 0) > 0 && !supportsRef(req.model)) {
                throw new Error(
                    `Reference images with OpenAI require GPT Image models. Use --model gpt-image-2 (or another gpt-image model); '${req.model}' is not one.`,
                );
            }
            if (req.width !== undefined && req.height !== undefined && req.model.includes('gpt-image-2')) {
                validateGptImage2Size(req.width, req.height);
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const baseURL = readEnv('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
            const apiKey = readEnv('OPENAI_API_KEY');
            if (apiKey === '') {
                throw new Error(
                    'OPENAI_API_KEY is required. Codex/ChatGPT desktop login does not automatically grant OpenAI Images API access.',
                );
            }

            if (readEnv('OPENAI_IMAGE_USE_CHAT') === 'true') {
                const chatRes = await fetchFn(`${baseURL}/chat/completions`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: req.model, messages: [{ role: 'user', content: req.prompt }] }),
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (!chatRes.ok) throw new Error(`OpenAI API error: ${await chatRes.text()}`);
                const content =
                    ((await chatRes.json()) as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]
                        ?.message?.content ?? '';
                const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
                if (match !== null && match[1] !== undefined) {
                    return {
                        bytes: Uint8Array.from(Buffer.from(match[1], 'base64')),
                        extension: 'png',
                        provider: 'openai',
                        model: req.model,
                    };
                }
                throw new Error('No image found in chat completions response');
            }

            const refs = req.referenceImages ?? [];
            const args: AspectAndSizeArgs = {
                aspectRatio: req.aspectRatio,
                size: explicitSize(req),
                quality: req.quality,
            };
            const bytes = await (async (): Promise<Uint8Array> => {
                if (refs.length > 0 && (req.model.includes('dall-e-2') || req.model.includes('dall-e-3'))) {
                    throw new Error(
                        `Reference images with OpenAI require GPT Image models. Use --model gpt-image-2 (or another gpt-image model).`,
                    );
                }
                if (refs.length > 0) {
                    const size = args.size ?? getOpenAISize(req.model, args.aspectRatio ?? null, args.quality);
                    const form = new FormData();
                    form.append('model', req.model);
                    form.append('prompt', req.prompt);
                    form.append('size', size);
                    const quality = getOpenAIQuality(req.model, args.quality);
                    if (quality !== null && quality !== 'standard' && quality !== 'hd') form.append('quality', quality);
                    for (const refPath of refs) {
                        const bytes = await readBytes(refPath);
                        const filename = basename(refPath);
                        form.append('image[]', new Blob([bytes], { type: getMimeType(filename) }), filename);
                    }
                    const res = await fetchFn(`${baseURL}/images/edits`, {
                        method: 'POST',
                        headers: { authorization: `Bearer ${apiKey}` },
                        body: form,
                        signal: AbortSignal.timeout(timeoutMs),
                    });
                    if (!res.ok) throw new Error(`OpenAI edits API error: ${await res.text()}`);
                    return extractImageFromResponse((await res.json()) as OpenAIImageResponse, fetchFn, timeoutMs);
                }
                const res = await fetchFn(`${baseURL}/images/generations`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify(buildOpenAIGenerationsBody(req.prompt, req.model, args)),
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (!res.ok) throw new Error(`OpenAI API error: ${await res.text()}`);
                return extractImageFromResponse((await res.json()) as OpenAIImageResponse, fetchFn, timeoutMs);
            })();
            return { bytes, extension: 'png', provider: 'openai', model: req.model };
        },
    };
};
