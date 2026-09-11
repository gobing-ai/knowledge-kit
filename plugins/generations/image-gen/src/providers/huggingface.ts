import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * HuggingFace Inference adapter (0116 R1) — port of wt-image-generate's
 * `HuggingFaceBackend.generate()` (scripts/image_generator.py:142). POST JSON
 * {inputs, parameters:{width,height,num_inference_steps}} to
 * https://api-inference.huggingface.co/models/<model>; HTTP 200 returns raw image
 * bytes, 503 means the model is still cold-loading (loud error, wt parity).
 * Text-to-image only — wt's backend has no image-to-image path.
 */

const DEFAULT_MODEL = 'stabilityai/stable-diffusion-xl-base-1.0';
const BASE_URL = 'https://api-inference.huggingface.co/models';

export const buildPayload = (
    req: Pick<ImageRequest, 'prompt' | 'width' | 'height' | 'quality'>,
): Record<string, unknown> => ({
    inputs: req.prompt,
    parameters: {
        width: req.width ?? 1024,
        height: req.height ?? 1024,
        num_inference_steps: req.quality === 'normal' ? 30 : 50,
    },
});

export const createHuggingface: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    return {
        name: 'huggingface',
        defaultModel: () => readEnv('HUGGINGFACE_MODEL') || DEFAULT_MODEL,
        isAvailable: () => readEnv('HUGGINGFACE_API_TOKEN') !== '',
        supportsReferenceImages: () => false,

        async generate(req: ImageRequest): Promise<ImageResult> {
            const token = readEnv('HUGGINGFACE_API_TOKEN');
            if (token === '') {
                throw new Error('HUGGINGFACE_API_TOKEN is required. Get one at https://huggingface.co/settings/tokens');
            }
            const model = req.model.startsWith('hf:') ? req.model.slice(3) : req.model;
            const res = await fetchFn(`${BASE_URL}/${model}`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify(buildPayload(req)),
            });
            if (!res.ok) {
                const text = (await res.text()).slice(0, 200);
                if (res.status === 503) throw new Error(`HuggingFace model loading (HTTP 503): ${text}`);
                throw new Error(`HuggingFace HTTP ${res.status}: ${text}`);
            }
            const bytes = new Uint8Array(await res.arrayBuffer());
            const ct = res.headers.get('content-type') ?? '';
            const extension = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png';
            return { bytes, extension, provider: 'huggingface', model };
        },
    };
};
