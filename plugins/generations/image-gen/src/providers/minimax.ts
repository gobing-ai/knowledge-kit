import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { echoError } from '@gobing-ai/ts-utils';
import { readBytes } from '../bytes';
import { classifyProviderError } from './errors';
import { mimeForPath } from './refs';
import { PROVIDER_REQUEST_TIMEOUT_MS } from './timeouts';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * MiniMax adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/minimax.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes `ImageRequest.width/height`.
 */

const DEFAULT_MODEL = 'image-01';
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9']);

interface MinimaxSubjectReference {
    type: 'character';
    image_file: string;
}

interface MinimaxRequestBody {
    model: string;
    prompt: string;
    response_format: 'base64';
    aspect_ratio?: string;
    width?: number;
    height?: number;
    n?: number;
    subject_reference?: MinimaxSubjectReference[];
}

interface MinimaxResponse {
    data?: {
        image_urls?: string[];
        image_base64?: string[];
    };
    base_resp?: {
        status_code?: number;
        status_msg?: string;
    };
}

function responseError(result: MinimaxResponse): Error | null {
    const code = result?.base_resp?.status_code;
    return code !== undefined && code !== 0
        ? new Error(`MiniMax API error (status_code=${code}): ${result.base_resp?.status_msg ?? 'unknown error'}`)
        : null;
}

export function parsePixelSize(size: string): { width: number; height: number } | null {
    const match = size.trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    if (match === null) return null;
    const width = Number.parseInt(match[1] as string, 10);
    const height = Number.parseInt(match[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

/** 0182 R4: image-01 accepts an exact canvas of 512..2048 per edge, divisible by 8. */
function isAcceptablePixelSize(width: number, height: number): boolean {
    return width >= 512 && width <= 2048 && height >= 512 && height <= 2048 && width % 8 === 0 && height % 8 === 0;
}

/** Throwing twin of {@link isAcceptablePixelSize} for the request-body path; messages are frozen (tests pin them). */
function validatePixelSize(width: number, height: number): void {
    if (!isAcceptablePixelSize(width, height)) {
        if (width < 512 || width > 2048 || height < 512 || height > 2048) {
            throw new Error('MiniMax custom size must keep width and height between 512 and 2048.');
        }
        throw new Error('MiniMax custom size requires width and height divisible by 8.');
    }
}

export function requestBody(
    prompt: string,
    model: string,
    req: Pick<ImageRequest, 'aspectRatio' | 'width' | 'height' | 'n' | 'referenceImages'>,
): MinimaxRequestBody {
    if ((req.n ?? 1) > 9) throw new Error('MiniMax supports at most 9 images per request.');
    if (req.aspectRatio !== undefined && !SUPPORTED_ASPECT_RATIOS.has(req.aspectRatio)) {
        throw new Error(`MiniMax aspect_ratio must be one of: ${Array.from(SUPPORTED_ASPECT_RATIOS).join(', ')}.`);
    }
    if (req.width !== undefined && req.height !== undefined && req.aspectRatio === undefined) {
        if (model !== 'image-01') {
            throw new Error(
                'MiniMax custom --size is only supported with model image-01. Use --model image-01 or pass --ar instead.',
            );
        }
        validatePixelSize(req.width, req.height);
    }
    if (req.referenceImages !== undefined && req.referenceImages.length > 0) {
        for (const refPath of req.referenceImages) {
            const ext = refPath.toLowerCase();
            if (!ext.includes('.jpg') && !ext.includes('.jpeg') && !ext.includes('.png')) {
                throw new Error(`MiniMax subject_reference only supports JPG, JPEG, or PNG files: ${refPath}`);
            }
        }
    }
    const body: MinimaxRequestBody = { model, prompt, response_format: 'base64' };
    if (req.aspectRatio !== undefined) {
        body.aspect_ratio = req.aspectRatio;
    } else if (req.width !== undefined && req.height !== undefined) {
        body.width = req.width;
        body.height = req.height;
    }
    if ((req.n ?? 1) > 1) body.n = req.n;
    return body;
}

export async function buildSubjectReference(referenceImages: string[]): Promise<MinimaxSubjectReference[] | undefined> {
    if (referenceImages.length === 0) return undefined;
    const subjectReference: MinimaxSubjectReference[] = [];
    for (const refPath of referenceImages) {
        const ext = refPath.toLowerCase();
        if (!ext.includes('.jpg') && !ext.includes('.jpeg') && !ext.includes('.png')) {
            throw new Error(`MiniMax subject_reference only supports JPG, JPEG, or PNG files: ${refPath}`);
        }
        const bytes = Buffer.from(await readBytes(refPath));
        if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
            throw new Error(`MiniMax subject_reference images must be smaller than 10MB: ${refPath}`);
        }
        subjectReference.push({
            type: 'character',
            image_file: `data:${mimeForPath(refPath)};base64,${bytes.toString('base64')}`,
        });
    }
    return subjectReference;
}

export async function extractImageFromResponse(
    result: MinimaxResponse,
    fetchFn: typeof fetch = fetch,
    timeoutMs: number = PROVIDER_REQUEST_TIMEOUT_MS,
): Promise<Uint8Array> {
    const error = responseError(result);
    if (error !== null) throw error;
    const base64Image = result.data?.image_base64?.[0];
    if (base64Image !== undefined) return Uint8Array.from(Buffer.from(base64Image, 'base64'));
    const url = result.data?.image_urls?.[0];
    if (url !== undefined) {
        const response = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error(`Failed to download image from MiniMax: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error('No image data in MiniMax response');
}

export const createMinimax: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const timeoutMs = options?.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'minimax',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('MINIMAX_API_KEY') !== '',
        supportsReferenceImages: () => true,
        exactSize: (model: string, width: number, height: number): boolean =>
            model === 'image-01' && isAcceptablePixelSize(width, height),
        validate(req: ImageRequest): void {
            requestBody(req.prompt, req.model, req);
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = readEnv('MINIMAX_API_KEY');
            if (apiKey === '')
                throw new Error('MINIMAX_API_KEY is required. Get one from https://platform.minimaxi.com/');
            const body = requestBody(req.prompt, req.model, req);
            const subjectReference = await buildSubjectReference(req.referenceImages ?? []);
            if (subjectReference !== undefined) body.subject_reference = subjectReference;

            const base = (readEnv('MINIMAX_BASE_URL') || 'https://api.minimaxi.com').replace(/\/+$/g, '');
            const url = base.endsWith('/v1') ? `${base}/image_generation` : `${base}/v1/image_generation`;
            // One deadline covers all attempts and backoff. Retry only explicit failed responses:
            // transport errors leave generation outcome ambiguous and must not silently rebill it.
            const signal = AbortSignal.timeout(timeoutMs);
            let result: MinimaxResponse;
            for (let attempt = 1; ; attempt += 1) {
                signal.throwIfAborted();
                const response = await fetchFn(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify(body),
                    signal,
                });
                let error: Error | null;
                if (response.ok) {
                    result = (await response.json()) as MinimaxResponse;
                    error = responseError(result);
                    if (error === null) break;
                } else {
                    const detail = await response.text();
                    let businessError: Error | null = null;
                    try {
                        businessError = responseError(JSON.parse(detail) as MinimaxResponse);
                    } catch {
                        // A non-JSON gateway response still carries its HTTP failure class.
                    }
                    // Business codes own policy/auth semantics even on a generic HTTP 5xx.
                    error = businessError ?? new Error(`MiniMax API error (${response.status}): ${detail}`);
                }
                if (attempt >= 3 || classifyProviderError(error) !== 'transient') throw error;
                const delayMs = attempt * 1000;
                echoError(`WARN image-gen: ${error.message}; retrying MiniMax (${attempt + 1}/3) after ${delayMs}ms`);
                await delay(delayMs, undefined, { signal });
            }
            // Download errors are outside the POST retry loop: the image already exists.
            const bytes = await extractImageFromResponse(result, fetchFn, timeoutMs);
            return { bytes, extension: 'jpg', provider: 'minimax', model: req.model };
        },
    };
};
