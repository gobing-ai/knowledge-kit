import { Buffer } from 'node:buffer';
import { readBytes } from '../bytes';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Seedream adapter (0107 R2) — the first wire-speaking 0103 adapter.
 * Wire prior art: vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/seedream.ts
 * (MIT © 2026 Jim Liu). POST `{base}/images/generations`, Bearer ARK_API_KEY.
 */

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128';
const REF_MODEL_FRAGMENTS = ['doubao-seedream-5-0', 'doubao-seedream-4-5-', 'doubao-seedream-4-0-'];

interface SeedreamResponse {
    data?: Array<{ url?: string; b64_json?: string; error?: { code?: string; message?: string } }>;
    error?: { code?: string; message?: string };
}

/** ARK `size`: explicit pixels win; the aspect ratio rides verbatim (seedream 4.x accepts '21:9'); else 2K. */
export function mapSize(req: ImageRequest): string {
    if (req.width !== undefined && req.height !== undefined) {
        return `${req.width}x${req.height}`;
    }
    if (req.aspectRatio !== undefined) {
        return req.aspectRatio;
    }
    return '2K';
}

function extensionFromUrl(url: string): string {
    // data.b64_json path carries no extension — default png; URL paths end ?sig=… so take the last clean segment.
    const match = /(?:png|jpe?g|webp)/i.exec(url.split('?')[0] ?? '');
    return match === null ? 'jpg' : match[0].toLowerCase().replace(/^jpeg$/, 'jpg');
}

export const createSeedream: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';
    const supportsRef = (model: string): boolean => REF_MODEL_FRAGMENTS.some((fragment) => model.includes(fragment));

    return {
        name: 'seedream',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('ARK_API_KEY') !== '',
        supportsReferenceImages: supportsRef,
        validate(req: ImageRequest): void {
            if (req.referenceImages !== undefined && req.referenceImages.length > 0 && !supportsRef(req.model)) {
                throw new Error(
                    `seedream model '${req.model}' does not accept reference images; use a doubao-seedream 4.x+ model`,
                );
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = readEnv('ARK_API_KEY');
            if (apiKey === '') {
                throw new Error("Provider 'seedream' requires ARK_API_KEY");
            }
            const base = readEnv('SEEDREAM_BASE_URL') || DEFAULT_BASE_URL;
            const body: Record<string, unknown> = {
                model: req.model,
                prompt: req.prompt,
                size: mapSize(req),
                response_format: 'url',
                watermark: false,
            };
            if (req.referenceImages !== undefined && req.referenceImages.length > 0) {
                // Local paths cannot ride the wire: lift each to a base64 data URI.
                const lifted = await Promise.all(
                    req.referenceImages.map(async (path) => {
                        const bytes = await readBytes(path);
                        return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
                    }),
                );
                body.image = lifted.length === 1 ? lifted[0] : lifted;
                body.response_format = 'b64_json';
            }
            const resp = await fetchFn(`${base}/images/generations`, {
                method: 'POST',
                headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const text = await resp.text();
            if (!resp.ok) {
                throw new Error(`seedream HTTP ${resp.status}: ${text.slice(0, 200)}`);
            }
            let parsed: SeedreamResponse;
            try {
                parsed = JSON.parse(text) as SeedreamResponse;
            } catch {
                throw new Error(`seedream returned non-JSON: ${text.slice(0, 120)}`);
            }
            const image = parsed.data?.[0];
            if (parsed.error !== undefined) {
                throw new Error(`seedream error ${parsed.error.code ?? ''}: ${parsed.error.message ?? ''}`);
            }
            if (image === undefined) {
                throw new Error('seedream returned no image data');
            }
            if (image.b64_json !== undefined) {
                return {
                    bytes: Uint8Array.from(Buffer.from(image.b64_json, 'base64')),
                    extension: 'png',
                    provider: 'seedream',
                    model: req.model,
                };
            }
            if (image.url !== undefined) {
                const r = await fetchFn(image.url);
                if (!r.ok) {
                    throw new Error(`seedream fetch URL HTTP ${r.status}`);
                }
                return {
                    bytes: new Uint8Array(await r.arrayBuffer()),
                    extension: extensionFromUrl(image.url),
                    provider: 'seedream',
                    model: req.model,
                };
            }
            throw new Error(
                image.error === undefined
                    ? 'seedream returned neither url nor b64_json'
                    : `seedream image error ${image.error.code ?? ''}: ${image.error.message ?? ''}`,
            );
        },
    };
};
