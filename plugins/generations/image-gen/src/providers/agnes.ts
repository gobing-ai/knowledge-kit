import { Buffer } from 'node:buffer';
import { refToDataUri } from './refs';
import { extensionFromUrl } from './seedream';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Agnes adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/agnes.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes `ImageRequest.width/height`.
 */

const DEFAULT_MODEL = 'agnes-image-2.1-flash';
const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1';
const DEFAULT_SIZE = '1024x1024';

interface AgnesResponse {
    created?: number;
    data: Array<{ url?: string; b64_json?: string }>;
}

export function parseAspectRatio(ar: string): { width: number; height: number } | null {
    const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match === null) return null;
    const w = Number.parseFloat(match[1] as string);
    const h = Number.parseFloat(match[2] as string);
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h };
}

export function snapDim(n: number): number {
    return Math.max(32, Math.round(n / 32) * 32);
}

type SizeArgs = Pick<ImageRequest, 'aspectRatio' | 'width' | 'height'>;

export function resolveSize(args: SizeArgs): string {
    if (args.width !== undefined && args.height !== undefined) return `${args.width}x${args.height}`;
    if (args.aspectRatio !== undefined) {
        const parsed = parseAspectRatio(args.aspectRatio);
        if (parsed !== null) {
            if (parsed.width === 1 && parsed.height === 1) return '1024x1024';
            const maxEdge = 2048;
            const scale = Math.max(1, Math.floor(maxEdge / Math.max(parsed.width, parsed.height)));
            return `${snapDim(parsed.width * scale)}x${snapDim(parsed.height * scale)}`;
        }
    }
    return DEFAULT_SIZE;
}

export function buildRequestBody(
    prompt: string,
    model: string,
    args: SizeArgs & { referenceImages: string[] },
): Record<string, unknown> {
    const body: Record<string, unknown> = { model, prompt, size: resolveSize(args) };
    if (args.referenceImages.length > 0) body.image = args.referenceImages;
    body.extra_body = { response_format: 'url' };
    return body;
}

export async function extractImageFromResponse(
    result: AgnesResponse,
    fetchFn: typeof fetch = fetch,
): Promise<Uint8Array> {
    const img = result.data[0];
    if (img?.b64_json !== undefined && img.b64_json !== '') {
        return Uint8Array.from(Buffer.from(img.b64_json, 'base64'));
    }
    if (img?.url !== undefined) {
        const imgRes = await fetchFn(img.url);
        if (!imgRes.ok) throw new Error(`Failed to download image from Agnes: ${imgRes.status}`);
        return new Uint8Array(await imgRes.arrayBuffer());
    }
    throw new Error('No image in Agnes response');
}

export const createAgnes: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'agnes',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('AGNES_API_KEY') !== '',
        supportsReferenceImages: () => true,
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = readEnv('AGNES_API_KEY');
            if (apiKey === '') throw new Error('AGNES_API_KEY is required. Get one from https://apihub.agnes-ai.com.');
            const referenceImages = await Promise.all((req.referenceImages ?? []).map(refToDataUri));
            const body = buildRequestBody(req.prompt, req.model, { ...req, referenceImages });
            const base = (readEnv('AGNES_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
            const res = await fetchFn(`${base}/images/generations`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`Agnes API error (${res.status}): ${await res.text()}`);
            const result = (await res.json()) as AgnesResponse;
            const bytes = await extractImageFromResponse(result, fetchFn);
            const url = result.data[0]?.url;
            return {
                bytes,
                extension: url === undefined || url.startsWith('data:') ? 'png' : extensionFromUrl(url),
                provider: 'agnes',
                model: req.model,
            };
        },
    };
};
