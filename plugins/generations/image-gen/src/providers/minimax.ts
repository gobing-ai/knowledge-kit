import { Buffer } from 'node:buffer';
import { readBytes } from '../bytes';
import { mimeForPath } from './refs';
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

export function parsePixelSize(size: string): { width: number; height: number } | null {
    const match = size.trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    if (match === null) return null;
    const width = Number.parseInt(match[1] as string, 10);
    const height = Number.parseInt(match[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

function validatePixelSize(width: number, height: number): void {
    if (width < 512 || width > 2048 || height < 512 || height > 2048) {
        throw new Error('MiniMax custom size must keep width and height between 512 and 2048.');
    }
    if (width % 8 !== 0 || height % 8 !== 0) {
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
): Promise<Uint8Array> {
    const baseResp = result.base_resp;
    if (baseResp?.status_code !== undefined && baseResp.status_code !== 0) {
        throw new Error(baseResp.status_msg ?? `MiniMax API returned status_code=${baseResp.status_code}`);
    }
    const base64Image = result.data?.image_base64?.[0];
    if (base64Image !== undefined) return Uint8Array.from(Buffer.from(base64Image, 'base64'));
    const url = result.data?.image_urls?.[0];
    if (url !== undefined) {
        const response = await fetchFn(url);
        if (!response.ok) throw new Error(`Failed to download image from MiniMax: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error('No image data in MiniMax response');
}

export const createMinimax: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'minimax',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('MINIMAX_API_KEY') !== '',
        supportsReferenceImages: () => true,
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
            const response = await fetchFn(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                throw new Error(`MiniMax API error (${response.status}): ${await response.text()}`);
            }
            const bytes = await extractImageFromResponse((await response.json()) as MinimaxResponse, fetchFn);
            return { bytes, extension: 'jpg', provider: 'minimax', model: req.model };
        },
    };
};
