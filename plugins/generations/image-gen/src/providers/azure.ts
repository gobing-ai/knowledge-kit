import { extname } from 'node:path';
import { readBytes } from '../bytes';
import { extractImageFromResponse, getOpenAISize, type OpenAIImageResponse } from './openai';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Azure OpenAI adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/azure.ts
 * (MIT © 2026 Jim Liu). `CliArgs.size` becomes `ImageRequest.width/height`.
 */

const DEFAULT_AZURE_API_VERSION = '2025-04-01-preview';
const AZURE_EDIT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

interface AzureEndpoint {
    resourceBaseURL: string;
    deployment: string | null;
}

export function parseAzureBaseURL(url: string): AzureEndpoint {
    const parsed = new URL(url);
    const trimmedPath = parsed.pathname.replace(/\/+$/, '');
    const deploymentMatch = trimmedPath.match(/^(.*?)(?:\/openai)?\/deployments\/([^/]+)$/);
    if (deploymentMatch !== null) {
        parsed.pathname = `${deploymentMatch[1] ?? ''}/openai`;
        return {
            resourceBaseURL: parsed.toString().replace(/\/+$/, ''),
            deployment: decodeURIComponent(deploymentMatch[2] as string),
        };
    }
    parsed.pathname = trimmedPath.endsWith('/openai') ? trimmedPath : `${trimmedPath}/openai`;
    return { resourceBaseURL: parsed.toString().replace(/\/+$/, ''), deployment: null };
}

function azureEndpoint(env: Record<string, string | undefined>): AzureEndpoint {
    const url = env.AZURE_OPENAI_BASE_URL ?? '';
    const parsed = parseAzureBaseURL(url);
    if (url === '') {
        throw new Error(
            'AZURE_OPENAI_BASE_URL is required. Set it to your Azure resource or deployment endpoint, e.g.: https://your-resource.openai.azure.com or https://your-resource.openai.azure.com/openai/deployments/your-deployment',
        );
    }
    return parsed;
}

function getApiKey(env: Record<string, string | undefined>): string {
    const key = env.AZURE_OPENAI_API_KEY ?? '';
    if (key === '') {
        throw new Error(
            'AZURE_OPENAI_API_KEY is required. Get it from Azure Portal → your OpenAI resource → Keys and Endpoint.',
        );
    }
    return key;
}

function buildURL(
    endpoint: AzureEndpoint,
    deployment: string,
    pathSuffix: string,
    env: Record<string, string | undefined>,
): string {
    const apiVersion = env.AZURE_API_VERSION ?? DEFAULT_AZURE_API_VERSION;
    return `${endpoint.resourceBaseURL}/deployments/${encodeURIComponent(deployment)}${pathSuffix}?api-version=${apiVersion}`;
}

function getAzureQuality(quality: 'normal' | '2k' | undefined): 'medium' | 'high' {
    return quality === '2k' ? 'high' : 'medium';
}

/** Azure reference images must be PNG or JPG/JPEG before the API call is spent. */
export function validateReferenceImages(referenceImages: readonly string[]): void {
    for (const refPath of referenceImages) {
        if (!AZURE_EDIT_IMAGE_EXTENSIONS.has(extname(refPath).toLowerCase())) {
            throw new Error(`Azure OpenAI reference images must be PNG or JPG/JPEG. Unsupported file: ${refPath}`);
        }
    }
}

export const createAzure: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    // Azure's own env-precedence for a default model: explicit deployment, then the base URL,
    // then the frozen 'gpt-image-2' (matches the baoyu getDefaultModel chain; spec facts unchanged).
    function defaultModel(): string {
        const explicit = env.AZURE_OPENAI_DEPLOYMENT?.trim();
        if (explicit !== undefined && explicit !== '') return explicit;
        const baseURL = env.AZURE_OPENAI_BASE_URL;
        if (baseURL !== undefined) {
            try {
                const { deployment } = parseAzureBaseURL(baseURL);
                if (deployment !== null) return deployment;
            } catch {
                // A malformed base URL surfaces later through the required-env check.
            }
        }
        return 'gpt-image-2';
    }

    const supportsRef = (): boolean => true;

    return {
        name: 'azure',
        defaultModel,
        isAvailable: () => (env.AZURE_OPENAI_API_KEY ?? '') !== '',
        supportsReferenceImages: supportsRef,
        validate(req: ImageRequest): void {
            validateReferenceImages(req.referenceImages ?? []);
        },
        async generate(req: ImageRequest): Promise<ImageResult> {
            const apiKey = getApiKey(env);
            const endpoint = azureEndpoint(env);
            const deployment = req.model.trim();
            if (deployment === '') {
                throw new Error(
                    'Azure deployment name is required. Use --model <deployment>, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_IMAGE_MODEL, or embed the deployment in AZURE_OPENAI_BASE_URL.',
                );
            }
            const size =
                (req.width !== undefined && req.height !== undefined ? `${req.width}x${req.height}` : undefined) ??
                getOpenAISize(req.model, req.aspectRatio ?? null, req.quality);
            const refs = req.referenceImages ?? [];
            const bytes = await (async (): Promise<Uint8Array> => {
                if (refs.length > 0) {
                    const form = new FormData();
                    form.append('prompt', req.prompt);
                    form.append('size', size);
                    form.append('n', '1');
                    form.append('quality', getAzureQuality(req.quality));
                    for (const refPath of refs) {
                        const fileBytes = await readBytes(refPath);
                        const filename = refPath.split('/').pop() ?? refPath;
                        const mimeType = extname(filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
                        form.append('image[]', new Blob([fileBytes], { type: mimeType }), filename);
                    }
                    const res = await fetchFn(buildURL(endpoint, deployment, '/images/edits', env), {
                        method: 'POST',
                        headers: { 'api-key': apiKey },
                        body: form,
                    });
                    if (!res.ok) throw new Error(`Azure OpenAI edits API error: ${await res.text()}`);
                    return extractImageFromResponse((await res.json()) as OpenAIImageResponse, fetchFn);
                }
                const res = await fetchFn(buildURL(endpoint, deployment, '/images/generations', env), {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'api-key': apiKey },
                    body: JSON.stringify({ prompt: req.prompt, size, n: 1, quality: getAzureQuality(req.quality) }),
                });
                if (!res.ok) throw new Error(`Azure OpenAI API error: ${await res.text()}`);
                return extractImageFromResponse((await res.json()) as OpenAIImageResponse, fetchFn);
            })();
            return { bytes, extension: 'png', provider: 'azure', model: req.model };
        },
    };
};
