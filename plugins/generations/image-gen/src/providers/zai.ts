import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Z.AI GLM-image adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/zai.ts
 * (MIT © 2026 Jim Liu). Text-to-image only; `CliArgs.size` becomes width/height.
 */

type ZaiModelFamily = 'glm' | 'legacy';

const GLM_MAX_PIXELS = 2 ** 22;
const LEGACY_MAX_PIXELS = 2 ** 21;
const GLM_SIZE_STEP = 32;
const LEGACY_SIZE_STEP = 16;

const GLM_RECOMMENDED_SIZES: Record<string, string> = {
    '1:1': '1280x1280',
    '3:2': '1568x1056',
    '2:3': '1056x1568',
    '4:3': '1472x1088',
    '3:4': '1088x1472',
    '16:9': '1728x960',
    '9:16': '960x1728',
};

const LEGACY_RECOMMENDED_SIZES: Record<string, string> = {
    '1:1': '1024x1024',
    '9:16': '768x1344',
    '3:4': '864x1152',
    '16:9': '1344x768',
    '4:3': '1152x864',
    '2:1': '1440x720',
    '1:2': '720x1440',
};

export function buildZaiUrl(base: string): string {
    const cleaned = base.replace(/\/+$/g, '');
    if (cleaned.endsWith('/images/generations')) return cleaned;
    if (cleaned.endsWith('/api/paas/v4') || cleaned.endsWith('/v4')) return `${cleaned}/images/generations`;
    return `${cleaned}/api/paas/v4/images/generations`;
}

export function getModelFamily(model: string): ZaiModelFamily {
    return model.trim().toLowerCase() === 'glm-image' ? 'glm' : 'legacy';
}

export function parseAspectRatio(ar: string): { width: number; height: number } | null {
    const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match === null) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

export function parseSize(size: string): { width: number; height: number } | null {
    const match = size.trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    if (match === null) return null;
    const width = Number.parseInt(match[1] as string, 10);
    const height = Number.parseInt(match[2] as string, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

function roundToStep(value: number, step: number): number {
    return Math.max(step, Math.round(value / step) * step);
}

const DEFAULT_MODEL = 'glm-image';

function getRatioValue(ar: string): number | null {
    const parsed = parseAspectRatio(ar);
    return parsed === null ? null : parsed.width / parsed.height;
}

function findClosestRatioKey(ar: string, candidates: string[]): string | null {
    const targetRatio = getRatioValue(ar);
    if (targetRatio === null) return null;
    let bestKey: string | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const candidateRatio = getRatioValue(candidate);
        if (candidateRatio === null) continue;
        const diff = Math.abs(candidateRatio - targetRatio);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestKey = candidate;
        }
    }
    return bestDiff <= 0.05 ? bestKey : null;
}

function fitToPixelBudget(
    width: number,
    height: number,
    targetPixels: number,
    maxPixels: number,
    step: number,
): { width: number; height: number } {
    let nextWidth = width;
    let nextHeight = height;
    const pixels = nextWidth * nextHeight;
    const scaleTo = pixels > maxPixels ? maxPixels : targetPixels;
    const scale = Math.sqrt(scaleTo / pixels);
    nextWidth *= scale;
    nextHeight *= scale;

    let roundedWidth = roundToStep(nextWidth, step);
    let roundedHeight = roundToStep(nextHeight, step);
    let roundedPixels = roundedWidth * roundedHeight;
    while (roundedPixels > maxPixels && (roundedWidth > step || roundedHeight > step)) {
        if (roundedWidth >= roundedHeight && roundedWidth > step) {
            roundedWidth -= step;
        } else if (roundedHeight > step) {
            roundedHeight -= step;
        } else {
            break;
        }
        roundedPixels = roundedWidth * roundedHeight;
    }
    return { width: roundedWidth, height: roundedHeight };
}

export function resolveSizeForModel(
    model: string,
    args: { size: string | undefined; aspectRatio: string | undefined; quality: 'normal' | '2k' | undefined },
): string {
    const family = getModelFamily(model);
    if (args.size !== undefined) {
        const parsed = parseSize(args.size);
        if (parsed === null) throw new Error('Z.AI --size must be in WxH format, for example 1280x1280.');
        const widthStep = family === 'glm' ? GLM_SIZE_STEP : LEGACY_SIZE_STEP;
        const minEdge = family === 'glm' ? 1024 : 512;
        const maxPixels = family === 'glm' ? GLM_MAX_PIXELS : LEGACY_MAX_PIXELS;
        if (parsed.width < minEdge || parsed.width > 2048 || parsed.height < minEdge || parsed.height > 2048) {
            throw new Error(
                family === 'glm'
                    ? 'GLM-image custom size requires width and height between 1024 and 2048.'
                    : 'Z.AI legacy image models require width and height between 512 and 2048.',
            );
        }
        if (parsed.width % widthStep !== 0 || parsed.height % widthStep !== 0) {
            throw new Error(
                family === 'glm'
                    ? 'GLM-image custom size requires width and height divisible by 32.'
                    : 'Z.AI legacy image models require width and height divisible by 16.',
            );
        }
        if (parsed.width * parsed.height > maxPixels) {
            throw new Error(
                family === 'glm'
                    ? 'GLM-image custom size must not exceed 2^22 total pixels.'
                    : 'Z.AI legacy image size must not exceed 2^21 total pixels.',
            );
        }
        return `${parsed.width}x${parsed.height}`;
    }

    const recommended = family === 'glm' ? GLM_RECOMMENDED_SIZES : LEGACY_RECOMMENDED_SIZES;
    const defaultSize = family === 'glm' ? '1280x1280' : '1024x1024';
    if (args.aspectRatio === undefined) return defaultSize;

    const recommendedRatio = findClosestRatioKey(args.aspectRatio, Object.keys(recommended));
    if (recommendedRatio !== null) {
        return recommended[recommendedRatio] as string;
    }
    const parsedRatio = parseAspectRatio(args.aspectRatio);
    if (parsedRatio === null) return defaultSize;

    const targetPixels = args.quality === 'normal' ? 1024 * 1024 : 1536 * 1536;
    const maxPixels = family === 'glm' ? GLM_MAX_PIXELS : LEGACY_MAX_PIXELS;
    const step = family === 'glm' ? GLM_SIZE_STEP : LEGACY_SIZE_STEP;
    const fit = fitToPixelBudget(parsedRatio.width, parsedRatio.height, targetPixels, maxPixels, step);
    return `${fit.width}x${fit.height}`;
}

interface ZaiResponse {
    data?: Array<{ url?: string }>;
}

export const createZai: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'zai',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => (readEnv('ZAI_API_KEY') || readEnv('BIGMODEL_API_KEY')) !== '',
        supportsReferenceImages: () => false,
        validate(req: ImageRequest): void {
            if ((req.referenceImages?.length ?? 0) > 0) {
                throw new Error(
                    'Z.AI GLM-image currently supports text-to-image only in kk image-gen. Remove --ref or choose another provider.',
                );
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const refs = req.referenceImages ?? [];
            if (refs.length > 0) {
                throw new Error(
                    'Z.AI GLM-image currently supports text-to-image only in kk image-gen. Remove --ref or choose another provider.',
                );
            }
            const apiKey = readEnv('ZAI_API_KEY') || readEnv('BIGMODEL_API_KEY');
            if (apiKey === '') throw new Error('ZAI_API_KEY is required. Get one from https://docs.z.ai/.');

            const size = resolveSizeForModel(req.model, {
                size: req.width !== undefined && req.height !== undefined ? `${req.width}x${req.height}` : undefined,
                aspectRatio: req.aspectRatio,
                quality: req.quality,
            });
            const base = readEnv('ZAI_BASE_URL') || readEnv('BIGMODEL_BASE_URL') || 'https://api.z.ai/api/paas/v4';
            const response = await fetchFn(buildZaiUrl(base), {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: req.model,
                    prompt: req.prompt,
                    quality: req.quality === 'normal' ? 'standard' : 'hd',
                    size,
                }),
            });
            if (!response.ok) throw new Error(`Z.AI API error (${response.status}): ${await response.text()}`);
            const url = ((await response.json()) as ZaiResponse).data?.[0]?.url;
            if (url === undefined) throw new Error('No image URL in Z.AI response');
            const imageResponse = await fetchFn(url);
            if (!imageResponse.ok) throw new Error(`Failed to download image from Z.AI: ${imageResponse.status}`);
            return {
                bytes: new Uint8Array(await imageResponse.arrayBuffer()),
                extension: 'png',
                provider: 'zai',
                model: req.model,
            };
        },
    };
};
