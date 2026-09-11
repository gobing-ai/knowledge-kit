import * as crypto from 'node:crypto';
import type { ImageProvider, ImageRequest, ImageResult, ProviderFactory, ProviderOptions } from './types';

/**
 * Volcengine Jimeng adapter (0115 R1) — port of
 * vendors/baoyu-skills/skills/baoyu-image-gen/scripts/providers/jimeng.ts
 * (MIT © 2026 Jim Liu). Text-to-image only; signed submit + poll (HMAC-SHA256,
 * https://www.volcengine.com/docs/85621/1817045).
 */

const DEFAULT_MODEL = 'jimeng_t2i_v40';

type JimengSizePreset = 'normal' | '2k' | '4k';

const SIZE_PRESETS: Record<JimengSizePreset, Record<string, string>> = {
    normal: {
        '1:1': '1024x1024',
        '4:3': '1360x1020',
        '16:9': '1536x864',
        '3:2': '1440x960',
        '21:9': '1920x824',
    },
    '2k': {
        '1:1': '2048x2048',
        '4:3': '2304x1728',
        '16:9': '2560x1440',
        '3:2': '2496x1664',
        '21:9': '3024x1296',
    },
    '4k': {
        '1:1': '4096x4096',
        '4:3': '4694x3520',
        '16:9': '5404x3040',
        '3:2': '4992x3328',
        '21:9': '6198x2656',
    },
};

export function generateSignature(
    method: string,
    query: Record<string, string>,
    headers: Record<string, string>,
    body: string,
    accessKey: string,
    secretKey: string,
    region: string,
    service: string,
    canonicalUri: string,
): string {
    const sortedQuery = Object.entries(query)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
    const sortedHeaders = Object.entries(headers)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}\n`)
        .join('');
    const signedHeaders = Object.keys(headers)
        .sort()
        .map((k) => k.toLowerCase())
        .join(';');
    const hashedPayload = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    const canonicalRequest = [method, canonicalUri, sortedQuery, sortedHeaders, signedHeaders, hashedPayload].join(
        '\n',
    );
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex');

    const algorithm = 'HMAC-SHA256';
    const timestamp = headers['X-Date'] ?? headers['x-date'];
    if (timestamp === undefined) throw new Error('Jimeng signature generation requires an X-Date header.');
    const dateStamp = timestamp.slice(0, 8);
    const credentialScope = `${dateStamp}/${region}/${service}/request`;
    const stringToSign = [algorithm, timestamp, credentialScope, hashedCanonicalRequest].join('\n');

    const kDate = crypto.createHmac('sha256', secretKey).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    return `${algorithm} Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function resolveEndpoint(
    baseUrl: string,
    query: Record<string, string>,
): { url: string; host: string; canonicalUri: string } {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new Error(`Invalid JIMENG_BASE_URL: ${baseUrl}`);
    }
    parsed.search = '';
    for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
        parsed.searchParams.set(key, value);
    }
    return { url: parsed.toString(), host: parsed.host, canonicalUri: parsed.pathname || '/' };
}

function getClosestPresetSize(ar: string | undefined, qualityLevel: JimengSizePreset): string {
    const presets = SIZE_PRESETS[qualityLevel];
    const defaultSize = presets['1:1'] as string;
    if (ar === undefined) return defaultSize;
    const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (match === null) return defaultSize;
    const targetRatio = Number(match[1]) / Number(match[2]);
    let bestMatch = defaultSize;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const [ratio, size] of Object.entries(presets)) {
        const [w, h] = ratio.split(':').map(Number) as [number, number];
        const diff = Math.abs(w / h - targetRatio);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = size;
        }
    }
    return bestMatch;
}

/** Explicit pixels win; else the quality-level preset closest to the aspect ratio. */
export function getImageSize(
    ar: string | undefined,
    quality: 'normal' | '2k' | undefined,
    width?: number,
    height?: number,
): string {
    if (width !== undefined && height !== undefined) return `${width}x${height}`;
    const qualityLevel: JimengSizePreset = quality === 'normal' ? 'normal' : '2k';
    return getClosestPresetSize(ar, qualityLevel);
}

function timestampHeader(): string {
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
}

interface JimengTaskResponse {
    code?: number;
    message?: string;
    data?: { task_id?: string; status?: string; image_urls?: string[]; binary_data_base64?: string[] };
}

export const createJimeng: ProviderFactory = (options?: ProviderOptions): ImageProvider => {
    const fetchFn = options?.fetch ?? fetch;
    const env = options?.env ?? process.env;
    const readEnv = (key: string): string => env[key] ?? '';

    async function signedPost(
        query: Record<string, string>,
        body: string,
        accessKey: string,
        secretKey: string,
        region: string,
    ): Promise<Response> {
        const base = readEnv('JIMENG_BASE_URL') || 'https://visual.volcengineapi.com';
        const endpoint = resolveEndpoint(base, query);
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            'X-Date': timestampHeader(),
            Host: endpoint.host,
        };
        const authorization = generateSignature(
            'POST',
            query,
            headers,
            body,
            accessKey,
            secretKey,
            region,
            'cv',
            endpoint.canonicalUri,
        );
        return fetchFn(endpoint.url, { method: 'POST', headers: { ...headers, authorization }, body });
    }

    async function submitTask(
        req: ImageRequest,
        size: string,
        accessKey: string,
        secretKey: string,
        region: string,
    ): Promise<string> {
        const query = { Action: 'CVSync2AsyncSubmitTask', Version: '2022-08-31' };
        const [width, height] = size.split('x').map(Number) as [number, number];
        const body = JSON.stringify({ req_key: req.model, prompt: req.prompt, width, height });
        const res = await signedPost(query, body, accessKey, secretKey, region);
        if (!res.ok) throw new Error(`Jimeng API submit error (${res.status}): ${await res.text()}`);
        const result = (await res.json()) as JimengTaskResponse;
        if (result.code !== 10_000 || result.data?.task_id === undefined) {
            throw new Error(`Failed to submit task: ${result.message ?? 'Unknown error'}`);
        }
        return result.data.task_id;
    }

    async function pollForResult(
        taskId: string,
        req: ImageRequest,
        accessKey: string,
        secretKey: string,
        region: string,
    ): Promise<Uint8Array> {
        const maxAttempts = 60;
        const pollIntervalMs = 2000;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const query = { Action: 'CVSync2AsyncGetResult', Version: '2022-08-31' };
            const body = JSON.stringify({ req_key: req.model, task_id: taskId });
            const res = await signedPost(query, body, accessKey, secretKey, region);
            if (!res.ok) throw new Error(`Jimeng API poll error (${res.status}): ${await res.text()}`);
            const result = (await res.json()) as JimengTaskResponse;
            if (result.code === 10_000 && result.data !== undefined) {
                const { status, image_urls, binary_data_base64 } = result.data;
                if (binary_data_base64 !== undefined && binary_data_base64.length > 0) {
                    return new Uint8Array(Buffer.from(binary_data_base64[0] as string, 'base64'));
                }
                if (status === 'done' && image_urls !== undefined && image_urls.length > 0) {
                    const url = image_urls[0] as string;
                    const imgRes = await fetchFn(url);
                    if (!imgRes.ok) throw new Error(`Failed to download image from ${url}`);
                    return new Uint8Array(await imgRes.arrayBuffer());
                }
                if (status === 'in_queue' || status === 'generating') {
                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                    continue;
                }
                if (status === 'fail') throw new Error(`Jimeng task failed: ${result.message ?? 'Generation failed'}`);
            }
            throw new Error(`Unexpected response during polling: ${result.message ?? 'Unknown error'}`);
        }
        throw new Error('Task timeout: image generation took too long');
    }

    async function generate(req: ImageRequest): Promise<ImageResult> {
        if ((req.referenceImages?.length ?? 0) > 0) {
            throw new Error(
                'Jimeng does not support reference images. Use --provider google, openai, openrouter, or replicate.',
            );
        }
        const accessKey = readEnv('JIMENG_ACCESS_KEY_ID');
        const secretKey = readEnv('JIMENG_SECRET_ACCESS_KEY');
        if (accessKey === '' || secretKey === '') {
            throw new Error(
                'JIMENG_ACCESS_KEY_ID and JIMENG_SECRET_ACCESS_KEY are required. Get your credentials from https://console.volcengine.com/iam/keymanage',
            );
        }
        const region = readEnv('JIMENG_REGION') || 'cn-north-1';
        const size = getImageSize(req.aspectRatio, req.quality, req.width, req.height);
        const taskId = await submitTask(req, size, accessKey, secretKey, region);
        const bytes = await pollForResult(taskId, req, accessKey, secretKey, region);
        return { bytes, extension: 'png', provider: 'jimeng', model: req.model };
    }

    return {
        name: 'jimeng',
        defaultModel: () => DEFAULT_MODEL,
        isAvailable: () => readEnv('JIMENG_ACCESS_KEY_ID') !== '' && readEnv('JIMENG_SECRET_ACCESS_KEY') !== '',
        supportsReferenceImages: () => true,
        generate,
    };
};
