import { refToDataUri } from './refs';
import { extensionFromUrl } from './seedream';
import { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Replicate adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/replicate.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes width/height; per-family input
 * builders, polling and output extraction ride verbatim.
 */

const DEFAULT_MODEL = 'google/nano-banana-2';
const SYNC_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 300_000;
const DOCUMENTED_REPLICATE_ASPECT_RATIOS = new Set([
    '1:1',
    '2:3',
    '3:2',
    '3:4',
    '4:3',
    '5:4',
    '4:5',
    '9:16',
    '16:9',
    '21:9',
]);

export type ReplicateModelFamily =
    | 'nano-banana'
    | 'seedream45'
    | 'seedream5lite'
    | 'wan27image'
    | 'wan27imagepro'
    | 'unknown';

type PixelSize = { width: number; height: number };
type Seedream45Size = '2K' | '4K' | PixelSize;

export function parseModelId(model: string): { owner: string; name: string; version: string | null } {
    const [ownerName, version] = model.split(':');
    const parts = (ownerName ?? '').split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`Invalid Replicate model format: "${model}". Expected "owner/name" or "owner/name:version".`);
    }
    return { owner: parts[0], name: parts[1], version: version ?? null };
}

export function getModelFamily(model: string): ReplicateModelFamily {
    const normalized = model.trim().toLowerCase().split(':')[0] as string;
    if (['google/nano-banana', 'google/nano-banana-pro', 'google/nano-banana-2'].includes(normalized))
        return 'nano-banana';
    if (normalized === 'bytedance/seedream-4.5') return 'seedream45';
    if (normalized === 'bytedance/seedream-5-lite') return 'seedream5lite';
    if (normalized === 'wan-video/wan-2.7-image') return 'wan27image';
    if (normalized === 'wan-video/wan-2.7-image-pro') return 'wan27imagepro';
    return 'unknown';
}

function validateDocumentedAspectRatio(model: string, aspectRatio: string): void {
    if (aspectRatio === 'match_input_image' || DOCUMENTED_REPLICATE_ASPECT_RATIOS.has(aspectRatio)) return;
    throw new Error(
        `Replicate model ${model} does not support aspect ratio ${aspectRatio}. Supported values: ${Array.from(DOCUMENTED_REPLICATE_ASPECT_RATIOS).join(', ')}`,
    );
}

function getNanoBananaResolution(req: ImageRequest): '1K' | '2K' {
    if (req.width !== undefined && req.height !== undefined) {
        const longestEdge = Math.max(req.width, req.height);
        if (longestEdge <= 1024) return '1K';
        if (longestEdge <= 2048) return '2K';
        throw new Error('Replicate nano-banana only supports sizes that map to 1K or 2K output.');
    }
    return req.quality === 'normal' ? '1K' : '2K';
}

function resolveSeedream45Size(req: ImageRequest): Seedream45Size {
    if (req.width !== undefined && req.height !== undefined) {
        if (req.width < 1024 || req.width > 4096 || req.height < 1024 || req.height > 4096) {
            throw new Error('Replicate Seedream 4.5 custom --size must keep width and height between 1024 and 4096.');
        }
        return { width: req.width, height: req.height };
    }
    return req.quality === 'normal' ? '2K' : '4K';
}

function resolveSeedream5LiteSize(req: ImageRequest): '2K' | '3K' {
    return req.quality === 'normal' ? '2K' : '3K';
}

function resolveWanSizeFromAspectRatio(aspectRatio: string, maxDimension: number): string {
    const match = aspectRatio.trim().match(/^(\d+)\s*:\s*(\d+)$/);
    if (match === null) throw new Error(`Replicate Wan aspect ratio must be in W:H format, got ${aspectRatio}.`);
    const ratioWidth = Number.parseInt(match[1] as string, 10);
    const ratioHeight = Number.parseInt(match[2] as string, 10);
    if (!Number.isFinite(ratioWidth) || !Number.isFinite(ratioHeight) || ratioWidth <= 0 || ratioHeight <= 0) {
        throw new Error(`Replicate Wan aspect ratio must be in W:H format, got ${aspectRatio}.`);
    }
    const scale = Math.min(maxDimension / ratioWidth, maxDimension / ratioHeight);
    const width = Math.max(1, Math.floor(ratioWidth * scale));
    const height = Math.max(1, Math.floor(ratioHeight * scale));
    return `${width}*${height}`;
}

function resolveWanSize(family: 'wan27image' | 'wan27imagepro', req: ImageRequest): '1K' | '2K' | '4K' | string {
    const referenceMode = (req.referenceImages?.length ?? 0) > 0;
    const maxDimension = family === 'wan27imagepro' && !referenceMode ? 4096 : 2048;
    if (req.width !== undefined && req.height !== undefined) {
        const parsed = { width: req.width, height: req.height };
        if (
            req.width === undefined ||
            req.height === undefined ||
            parsed.width > maxDimension ||
            parsed.height > maxDimension
        ) {
            throw new Error(
                `Replicate ${family === 'wan27imagepro' ? 'Wan 2.7 Image Pro' : 'Wan 2.7 Image'} custom --size must keep width and height at or below ${maxDimension}px in the current mode.`,
            );
        }
        return `${parsed.width}*${parsed.height}`;
    }
    if (req.aspectRatio !== undefined) {
        return resolveWanSizeFromAspectRatio(req.aspectRatio, req.quality === 'normal' ? 1024 : 2048);
    }
    return req.quality === 'normal' ? '1K' : '2K';
}

export function buildInput(
    req: Pick<ImageRequest, 'model' | 'quality' | 'aspectRatio' | 'width' | 'height' | 'referenceImages'> & {
        prompt: string;
    },
): Record<string, unknown> {
    const family = getModelFamily(req.model);
    const referenceImages = req.referenceImages ?? [];

    if (family === 'nano-banana') {
        const input: Record<string, unknown> = {
            prompt: req.prompt,
            resolution: getNanoBananaResolution(req),
            output_format: 'png',
        };
        if (req.aspectRatio !== undefined) {
            validateDocumentedAspectRatio(req.model, req.aspectRatio);
            input.aspect_ratio = req.aspectRatio;
        } else if (referenceImages.length > 0) {
            input.aspect_ratio = 'match_input_image';
        }
        if (referenceImages.length > 0) input.image_input = referenceImages;
        return input;
    }

    if (family === 'seedream45' || family === 'seedream5lite') {
        const size = family === 'seedream45' ? resolveSeedream45Size(req) : resolveSeedream5LiteSize(req);
        const input: Record<string, unknown> = { prompt: req.prompt };
        if (family === 'seedream45' && typeof size === 'object') {
            input.size = 'custom';
            input.width = size.width;
            input.height = size.height;
        } else {
            input.size = size as string;
        }
        if (referenceImages.length > 0) input.image_input = referenceImages;
        if (req.aspectRatio !== undefined) {
            validateDocumentedAspectRatio(req.model, req.aspectRatio);
            input.aspect_ratio = req.aspectRatio;
        } else if (referenceImages.length > 0 && family === 'seedream45') {
            input.aspect_ratio = 'match_input_image';
        }
        return input;
    }

    if (family === 'wan27image' || family === 'wan27imagepro') {
        const input: Record<string, unknown> = { prompt: req.prompt, size: resolveWanSize(family, req) };
        if (referenceImages.length > 0) input.images = referenceImages;
        return input;
    }

    return { prompt: req.prompt };
}

export interface PredictionResponse {
    id?: string;
    status: string;
    output: unknown;
    error: string | null;
    urls?: { get?: string };
}

export function extractOutputUrl(prediction: PredictionResponse): string {
    const output = prediction.output;
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) {
        if (output.length !== 1) {
            throw new Error(
                `Replicate returned ${output.length} outputs, but kk image-gen currently supports saving exactly one image per request.`,
            );
        }
        const first = output[0];
        if (typeof first === 'string') return first;
    }
    if (output !== null && typeof output === 'object' && 'url' in output) {
        const url = (output as Record<string, unknown>).url;
        if (typeof url === 'string') return url;
    }
    throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`);
}

export const createReplicate: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const timeoutMs = options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    const readEnv = (key: string): string => env[key] ?? '';

    async function downloadImage(url: string): Promise<Uint8Array> {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) throw new Error(`Failed to download image from Replicate: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
    }

    async function pollPrediction(apiToken: string, getUrl: string): Promise<PredictionResponse> {
        const start = Date.now();
        while (Date.now() - start < MAX_POLL_MS) {
            const res = await fetchFn(getUrl, {
                headers: { authorization: `Bearer ${apiToken}` },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) throw new Error(`Replicate poll error (${res.status}): ${await res.text()}`);
            const prediction = (await res.json()) as PredictionResponse;
            if (prediction.status === 'succeeded') return prediction;
            if (prediction.status === 'failed' || prediction.status === 'canceled') {
                throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? 'unknown error'}`);
            }
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }
        throw new Error(`Replicate prediction timed out after ${MAX_POLL_MS / 1000}s`);
    }

    return {
        name: 'replicate',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('REPLICATE_API_TOKEN') !== '',
        supportsReferenceImages: () => true,
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiToken = readEnv('REPLICATE_API_TOKEN');
            if (apiToken === '') {
                throw new Error('REPLICATE_API_TOKEN is required. Get one at https://replicate.com/account/api-tokens');
            }
            const model = parseModelId(req.model);
            const refDataUrls: string[] = [];
            for (const refPath of req.referenceImages ?? []) {
                refDataUrls.push(await refToDataUri(refPath));
            }
            const input = buildInput({ ...req, referenceImages: refDataUrls });
            const baseUrl = (readEnv('REPLICATE_BASE_URL') || 'https://api.replicate.com').replace(/\/+$/g, '');
            const url =
                model.version !== null
                    ? `${baseUrl}/v1/predictions`
                    : `${baseUrl}/v1/models/${model.owner}/${model.name}/predictions`;
            const body: Record<string, unknown> = { input };
            if (model.version !== null) body.version = model.version;
            const headers: Record<string, string> = {
                authorization: `Bearer ${apiToken}`,
                'content-type': 'application/json',
                Prefer: `wait=${SYNC_WAIT_SECONDS}`,
            };
            let prediction = (await (
                await fetchFn(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeoutMs),
                })
            ).json()) as PredictionResponse;
            if (prediction.status !== 'succeeded') {
                if (prediction.urls?.get === undefined)
                    throw new Error('Replicate prediction did not return a poll URL');
                prediction = await pollPrediction(apiToken, prediction.urls.get);
            }
            const outputUrl = extractOutputUrl(prediction);
            return {
                bytes: await downloadImage(outputUrl),
                extension: extensionFromUrl(outputUrl),
                provider: 'replicate',
                model: req.model,
            };
        },
    };
};
