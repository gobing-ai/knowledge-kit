import { Buffer } from 'node:buffer';
import { echoError } from '@gobing-ai/ts-utils';
import { refToDataUri } from './refs';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * DashScope adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/dashscope.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes width/height; reference images
 * are local-path or http(s)-URL strings per the wan2.7 multimodal content array.
 */

type DashScopeModelFamily = 'qwen2' | 'qwenFixed' | 'wan27' | 'legacy';

const DEFAULT_MODEL = 'qwen-image-2.0-pro';
const MIN_QWEN_2_TOTAL_PIXELS = 512 * 512;
const MAX_QWEN_2_TOTAL_PIXELS = 2048 * 2048;
const SIZE_STEP = 16;
const QWEN_NEGATIVE_PROMPT =
    '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感，构图混乱，文字模糊，扭曲';

const QWEN_2_TARGET_PIXELS = { normal: 1024 * 1024, '2k': 1536 * 1536 } as const;
const MIN_WAN27_TOTAL_PIXELS = 768 * 768;
const MAX_WAN27_PRO_T2I_PIXELS = 4096 * 4096;
const MAX_WAN27_GENERAL_PIXELS = 2048 * 2048;
const WAN27_MAX_REFERENCE_IMAGES = 9;
const WAN27_TARGET_PIXELS = { normal: 1024 * 1024, '2k': 2048 * 2048 } as const;

const QWEN_2_RECOMMENDED: Record<string, Record<'normal' | '2k', string>> = {
    '1:1': { normal: '1024*1024', '2k': '1536*1536' },
    '2:3': { normal: '768*1152', '2k': '1024*1536' },
    '3:2': { normal: '1152*768', '2k': '1536*1024' },
    '3:4': { normal: '960*1280', '2k': '1080*1440' },
    '4:3': { normal: '1280*960', '2k': '1440*1080' },
    '9:16': { normal: '720*1280', '2k': '1080*1920' },
    '16:9': { normal: '1280*720', '2k': '1920*1080' },
    '21:9': { normal: '1344*576', '2k': '2048*872' },
};

const QWEN_FIXED_SIZES_BY_RATIO: Record<string, string> = {
    '16:9': '1664*928',
    '4:3': '1472*1104',
    '1:1': '1328*1328',
    '3:4': '1104*1472',
    '9:16': '928*1664',
};

const QWEN_FIXED_SPEC_DEFAULT = QWEN_FIXED_SIZES_BY_RATIO['16:9'] as string;

const LEGACY_STANDARD_SIZES: Array<[number, number]> = [
    [1024, 1024],
    [1280, 720],
    [720, 1280],
    [1024, 768],
    [768, 1024],
    [1536, 1024],
    [1024, 1536],
    [1536, 864],
    [864, 1536],
];

const LEGACY_STANDARD_SIZES_2K: Array<[number, number]> = [
    [1536, 1536],
    [2048, 1152],
    [1152, 2048],
    [1536, 1024],
    [1024, 1536],
    [1536, 864],
    [864, 1536],
    [2048, 2048],
];

interface DashScopeModelSpec {
    family: DashScopeModelFamily;
    defaultSize: string;
}

const MODEL_SPEC_ALIASES: Record<string, DashScopeModelSpec> = {
    'qwen-image-2.0-pro': { family: 'qwen2', defaultSize: '1024*1024' },
    'qwen-image-2.0-pro-2026-03-03': { family: 'qwen2', defaultSize: '1024*1024' },
    'qwen-image-2.0': { family: 'qwen2', defaultSize: '1024*1024' },
    'qwen-image-2.0-2026-03-03': { family: 'qwen2', defaultSize: '1024*1024' },
    'qwen-image-max': { family: 'qwenFixed', defaultSize: QWEN_FIXED_SPEC_DEFAULT },
    'qwen-image-max-2025-12-30': { family: 'qwenFixed', defaultSize: QWEN_FIXED_SPEC_DEFAULT },
    'qwen-image-plus': { family: 'qwenFixed', defaultSize: QWEN_FIXED_SPEC_DEFAULT },
    'qwen-image-plus-2026-01-09': { family: 'qwenFixed', defaultSize: QWEN_FIXED_SPEC_DEFAULT },
    'qwen-image': { family: 'qwenFixed', defaultSize: QWEN_FIXED_SPEC_DEFAULT },
    'wan2.7-image-pro': { family: 'wan27', defaultSize: '2048*2048' },
    'wan2.7-image': { family: 'wan27', defaultSize: '2048*2048' },
};

export function getModelSpec(model: string): DashScopeModelSpec {
    return MODEL_SPEC_ALIASES[model.trim().toLowerCase()] ?? { family: 'legacy', defaultSize: '1536*1536' };
}

export function getModelFamily(model: string): DashScopeModelFamily {
    return getModelSpec(model).family;
}

export function resolveSizeForModel(
    model: string,
    args: { size?: string; aspectRatio?: string; quality?: 'normal' | '2k'; referenceImages?: string[] },
): string {
    const spec = getModelSpec(model);
    const referenceCount = args.referenceImages?.length ?? 0;
    const quality = args.quality === 'normal' ? 'normal' : '2k';

    if (spec.family === 'wan27') {
        const maxPixels =
            isWan27ProModel(model) && referenceCount === 0 ? MAX_WAN27_PRO_T2I_PIXELS : MAX_WAN27_GENERAL_PIXELS;
        if (args.size !== undefined) return validateWan27Size(args.size, maxPixels, model);
        return getWan27SizeFromAspectRatio(args.aspectRatio, quality, maxPixels);
    }

    if (args.size !== undefined) {
        if (spec.family === 'qwen2') return validateQwen2Size(args.size);
        if (spec.family === 'qwenFixed') return validateQwenFixedSize(args.size);
        validateSizeFormat(args.size);
        return normalizeSize(args.size);
    }

    if (spec.family === 'qwen2') return getQwen2SizeFromAspectRatio(args.aspectRatio, quality);
    if (spec.family === 'qwenFixed') return getQwenFixedSizeFromAspectRatio(args.aspectRatio, quality);
    return getSizeFromAspectRatio(args.aspectRatio, quality);
}

export function getSizeFromAspectRatio(ar: string | undefined, quality: 'normal' | '2k'): string {
    const sizes = quality === '2k' ? LEGACY_STANDARD_SIZES_2K : LEGACY_STANDARD_SIZES;
    const defaultSize = quality === '2k' ? '1536*1536' : '1024*1024';
    const parsed = ar === undefined ? null : parseAspectRatio(ar);
    if (parsed === null) return defaultSize;
    const targetRatio = parsed.width / parsed.height;
    let best = defaultSize;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const [width, height] of sizes) {
        const diff = Math.abs(width / height - targetRatio);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = `${width}*${height}`;
        }
    }
    return best;
}

export function getQwen2SizeFromAspectRatio(ar: string | undefined, quality: 'normal' | '2k'): string {
    if (ar === undefined) {
        return QWEN_2_RECOMMENDED['1:1']?.[quality] as string;
    }
    const recommendedRatio = findKnownRatioKey(ar, Object.keys(QWEN_2_RECOMMENDED));
    if (recommendedRatio !== null) {
        return QWEN_2_RECOMMENDED[recommendedRatio]?.[quality] as string;
    }
    const parsed = parseAspectRatio(ar);
    if (parsed === null) {
        return QWEN_2_RECOMMENDED['1:1']?.[quality] as string;
    }
    const targetRatio = parsed.width / parsed.height;

    const targetPixels = QWEN_2_TARGET_PIXELS[quality];
    const rawWidth = Math.sqrt(targetPixels * targetRatio);
    const rawHeight = Math.sqrt(targetPixels / targetRatio);
    const fitted = fitToPixelBudget(rawWidth, rawHeight, MIN_QWEN_2_TOTAL_PIXELS, MAX_QWEN_2_TOTAL_PIXELS);
    return `${fitted.width}*${fitted.height}`;
}

function findKnownRatioKey(ar: string, candidates: string[], tolerance = 0.02): string | null {
    const parsed = parseAspectRatio(ar);
    if (parsed === null) return null;
    const targetRatio = parsed.width / parsed.height;
    let bestKey: string | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const candidateParsed = parseAspectRatio(candidate);
        if (candidateParsed === null) continue;
        const diff = Math.abs(candidateParsed.width / candidateParsed.height - targetRatio);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestKey = candidate;
        }
    }
    return bestDiff <= tolerance ? bestKey : null;
}

export function fitToPixelBudget(
    width: number,
    height: number,
    minPixels: number,
    maxPixels: number,
): { width: number; height: number } {
    let nextWidth = width;
    let nextHeight = height;
    let pixels = nextWidth * nextHeight;

    if (pixels > maxPixels) {
        const scale = Math.sqrt(maxPixels / pixels);
        nextWidth *= scale;
        nextHeight *= scale;
    } else if (pixels < minPixels) {
        const scale = Math.sqrt(minPixels / pixels);
        nextWidth *= scale;
        nextHeight *= scale;
    }

    let roundedWidth = roundToStep(nextWidth);
    let roundedHeight = roundToStep(nextHeight);
    pixels = roundedWidth * roundedHeight;
    while (pixels > maxPixels && (roundedWidth > SIZE_STEP || roundedHeight > SIZE_STEP)) {
        if (roundedWidth >= roundedHeight && roundedWidth > SIZE_STEP) {
            roundedWidth -= SIZE_STEP;
        } else if (roundedHeight > SIZE_STEP) {
            roundedHeight -= SIZE_STEP;
        } else {
            break;
        }
        pixels = roundedWidth * roundedHeight;
    }
    while (pixels < minPixels) {
        if (roundedWidth <= roundedHeight) {
            roundedWidth += SIZE_STEP;
        } else {
            roundedHeight += SIZE_STEP;
        }
        pixels = roundedWidth * roundedHeight;
    }
    return { width: roundedWidth, height: roundedHeight };
}

function roundToStep(value: number): number {
    return Math.max(SIZE_STEP, Math.round(value / SIZE_STEP) * SIZE_STEP);
}

function floorToStep(value: number): number {
    return Math.max(SIZE_STEP, Math.floor(value / SIZE_STEP) * SIZE_STEP);
}

export function getWan27SizeFromAspectRatio(
    ar: string | undefined,
    quality: 'normal' | '2k',
    maxPixels: number,
): string {
    const targetPixels = Math.min(WAN27_TARGET_PIXELS[quality], maxPixels);
    if (ar === undefined) {
        const side = roundToStep(Math.sqrt(targetPixels));
        return `${side}*${side}`;
    }
    const parsed = parseAspectRatio(ar);
    if (parsed === null) {
        const side = roundToStep(Math.sqrt(targetPixels));
        return `${side}*${side}`;
    }
    const ratio = parsed.width / parsed.height;
    if (ratio < 1 / 8 || ratio > 8) {
        throw new Error(`DashScope wan2.7 image models support aspect ratios in [1:8, 8:1]. Received "${ar}".`);
    }
    const rawWidth = Math.sqrt(targetPixels * ratio);
    const rawHeight = Math.sqrt(targetPixels / ratio);
    const fitted = fitToPixelBudget(rawWidth, rawHeight, MIN_WAN27_TOTAL_PIXELS, maxPixels);
    const bounded = clampWan27DerivedSizeToRatioBounds(fitted);
    return `${bounded.width}*${bounded.height}`;
}

function clampWan27DerivedSizeToRatioBounds(size: { width: number; height: number }): {
    width: number;
    height: number;
} {
    let { width, height } = size;
    const ratio = width / height;
    if (ratio > 8) {
        width = floorToStep(height * 8);
    } else if (ratio < 1 / 8) {
        height = floorToStep(width * 8);
    }
    return { width, height };
}

function isWan27ProModel(model: string): boolean {
    return model.trim().toLowerCase() === 'wan2.7-image-pro';
}

export function normalizeSize(size: string): string {
    return size.replace('x', '*');
}

export function parseAspectRatio(ar: string): { width: number; height: number } | null {
    const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match === null) return null;
    const w = Number.parseFloat(match[1] as string);
    const h = Number.parseFloat(match[2] as string);
    if (w <= 0 || h <= 0) return null;
    return { width: w, height: h };
}

export function parseSize(size: string): { width: number; height: number } | null {
    const match = normalizeSize(size).match(/^(\d+)\*(\d+)$/);
    if (match === null) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { width, height };
}

function validateSizeFormat(size: string): { width: number; height: number } {
    const parsed = parseSize(size);
    if (parsed === null) {
        throw new Error(`Invalid DashScope size "${size}". Expected <width>x<height> or <width>*<height>.`);
    }
    return parsed;
}

function validateQwen2Size(size: string): string {
    const normalized = normalizeSize(size);
    const parsed = validateSizeFormat(normalized);
    const totalPixels = parsed.width * parsed.height;
    if (totalPixels < MIN_QWEN_2_TOTAL_PIXELS || totalPixels > MAX_QWEN_2_TOTAL_PIXELS) {
        throw new Error(
            `DashScope qwen-image-2.0* models require total pixels between ${MIN_QWEN_2_TOTAL_PIXELS} ` +
                `and ${MAX_QWEN_2_TOTAL_PIXELS}. Received ${normalized} (${totalPixels} pixels).`,
        );
    }
    return normalized;
}

function validateQwenFixedSize(size: string): string {
    const normalized = normalizeSize(size);
    validateSizeFormat(normalized);
    if (!Object.values(QWEN_FIXED_SIZES_BY_RATIO).includes(normalized)) {
        throw new Error(
            `DashScope qwen-image-max/plus/image models support only these sizes: ` +
                `${Object.values(QWEN_FIXED_SIZES_BY_RATIO).join(', ')}. Received ${normalized}.`,
        );
    }
    return normalized;
}

function validateWan27Size(size: string, maxPixels: number, model: string): string {
    const normalized = normalizeSize(size);
    const parsed = validateSizeFormat(normalized);
    const totalPixels = parsed.width * parsed.height;
    if (totalPixels < MIN_WAN27_TOTAL_PIXELS || totalPixels > maxPixels) {
        throw new Error(
            `DashScope ${model} requires total pixels between 768*768 and ` +
                `${maxPixels === MAX_WAN27_PRO_T2I_PIXELS ? '4096*4096' : '2048*2048'} for the current request. ` +
                `Received ${normalized} (${totalPixels} pixels).`,
        );
    }
    const ratio = parsed.width / parsed.height;
    if (ratio < 1 / 8 || ratio > 8) {
        throw new Error(
            `DashScope wan2.7 image models support aspect ratios in [1:8, 8:1]. Received ${normalized} (ratio ${ratio.toFixed(3)}).`,
        );
    }
    return normalized;
}

function getQwenFixedSizeFromAspectRatio(ar: string | undefined, quality: 'normal' | '2k'): string {
    if (quality === 'normal') {
        // ponytail: upstream warns on stderr; kk runs quiet — the fixed-size behaviour is unchanged.
        echoError(
            'DashScope qwen-image-max/plus/image models use fixed output sizes; quality does not change the resolution.',
        );
    }
    if (ar === undefined) return QWEN_FIXED_SPEC_DEFAULT;
    const ratioKey = findKnownRatioKey(ar, Object.keys(QWEN_FIXED_SIZES_BY_RATIO));
    if (ratioKey === null) {
        throw new Error(
            `DashScope model supports only fixed ratios ${Object.keys(QWEN_FIXED_SIZES_BY_RATIO).join(', ')}. ` +
                `For custom ratios like "${ar}", use --model qwen-image-2.0-pro.`,
        );
    }
    return QWEN_FIXED_SIZES_BY_RATIO[ratioKey] as string;
}

function buildParameters(family: DashScopeModelFamily, size: string): Record<string, unknown> {
    if (family === 'wan27') {
        return { size, n: 1, watermark: false };
    }
    const parameters: Record<string, unknown> = { prompt_extend: false, size };
    if (family === 'qwen2' || family === 'qwenFixed') {
        parameters.watermark = false;
        parameters.negative_prompt = QWEN_NEGATIVE_PROMPT;
    }
    return parameters;
}

interface DashScopeResponse {
    output?: {
        result_image?: string;
        choices?: Array<{ message?: { content?: Array<{ image?: string }> } }>;
    };
}

async function extractImageFromResponse(result: DashScopeResponse, fetchFn: typeof fetch): Promise<Uint8Array> {
    let imageData: string | null = null;
    if (result.output?.result_image !== undefined) {
        imageData = result.output.result_image;
    } else if (result.output?.choices?.[0]?.message?.content !== undefined) {
        for (const item of result.output.choices[0].message.content) {
            if (item.image !== undefined) {
                imageData = item.image;
                break;
            }
        }
    }
    if (imageData === null) throw new Error('No image in response');
    if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
        const imgRes = await fetchFn(imageData);
        if (!imgRes.ok) throw new Error('Failed to download image');
        return new Uint8Array(await imgRes.arrayBuffer());
    }
    return Uint8Array.from(Buffer.from(imageData, 'base64'));
}

export const createDashscope: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';
    const supportsRef = (model: string): boolean => model.includes('wan2.7');

    return {
        name: 'dashscope',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('DASHSCOPE_API_KEY') !== '',
        supportsReferenceImages: supportsRef,
        validate(req: ImageRequest): void {
            const spec = getModelSpec(req.model);
            if ((req.referenceImages?.length ?? 0) > 0 && spec.family !== 'wan27') {
                throw new Error(
                    'Reference images are not supported with this DashScope model. Use a wan2.7 image model (--model wan2.7-image-pro or wan2.7-image), or switch to --provider google with a Gemini multimodal model.',
                );
            }
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = readEnv('DASHSCOPE_API_KEY');
            if (apiKey === '') throw new Error('DASHSCOPE_API_KEY is required');
            const spec = getModelSpec(req.model);
            const refs = req.referenceImages ?? [];
            if (refs.length > 0 && spec.family !== 'wan27') {
                throw new Error(
                    'Reference images are not supported with this DashScope model. Use a wan2.7 image model (--model wan2.7-image-pro or wan2.7-image), or switch to --provider google with a Gemini multimodal model.',
                );
            }
            if (refs.length > WAN27_MAX_REFERENCE_IMAGES) {
                throw new Error(
                    `DashScope wan2.7 image models accept at most ${WAN27_MAX_REFERENCE_IMAGES} reference images. Received ${refs.length}.`,
                );
            }
            if (spec.family === 'wan27' && (req.n ?? 1) !== 1) {
                throw new Error(
                    'DashScope wan2.7 image models in kk image-gen support exactly one output image per request (extra images would be billed but discarded). Remove --n or use --n 1.',
                );
            }

            const size = resolveSizeForModel(req.model, {
                ...(req.width !== undefined && req.height !== undefined ? { size: `${req.width}x${req.height}` } : {}),
                aspectRatio: req.aspectRatio,
                quality: req.quality,
                referenceImages: refs,
            });
            const base = (readEnv('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com').replace(/\/+$/g, '');
            const url = `${base}/api/v1/services/aigc/multimodal-generation/generation`;

            const content: Array<Record<string, unknown>> = [];
            if (spec.family === 'wan27' && refs.length > 0) {
                for (const refPath of refs) {
                    content.push({ image: await refToDataUri(refPath) });
                }
            }
            content.push({ text: req.prompt });

            const body = {
                model: req.model,
                input: { messages: [{ role: 'user', content }] },
                parameters: buildParameters(spec.family, size),
            };
            const res = await fetchFn(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
            });
            if (!res.ok) throw new Error(`DashScope API error (${res.status}): ${await res.text()}`);
            const bytes = await extractImageFromResponse((await res.json()) as DashScopeResponse, fetchFn);
            return { bytes, extension: 'png', provider: 'dashscope', model: req.model };
        },
    };
};
