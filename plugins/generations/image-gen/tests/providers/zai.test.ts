import { describe, expect, test } from 'bun:test';
import { PROVIDERS } from '../../src/providers/types';
import { createZai, getModelFamily, resolveSizeForModel } from '../../src/providers/zai';

describe('zai size resolution', () => {
    test('glm family detection and aspect-table sizes', () => {
        expect(getModelFamily('glm-image')).toBe('glm');
        expect(getModelFamily('legacy-model')).toBe('legacy');
    });

    test('glm maps aspect ratios and quality to budget sizes', () => {
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: '1:1', quality: 'normal' })).toBe(
            '1280x1280',
        );
        const wide = resolveSizeForModel('glm-image', { size: undefined, aspectRatio: '16:9', quality: '2k' });
        expect(wide).toMatch(/^\d+x\d+$/);
    });

    test('explicit size wins', () => {
        expect(resolveSizeForModel('glm-image', { size: '2048x1024', aspectRatio: undefined, quality: 'normal' })).toBe(
            '2048x1024',
        );
    });
});

describe('zai provider', () => {
    test('rejects reference images', () => {
        const provider = PROVIDERS.zai.create({ env: { ZAI_API_KEY: 'k' } });
        expect(() => provider.validate({ prompt: 'p', model: 'glm-image', referenceImages: ['/tmp/a.png'] })).toThrow(
            'text-to-image only',
        );
    });

    test('isAvailable via either key', () => {
        expect(PROVIDERS.zai.create({ env: {} }).isAvailable()).toBe(false);
        expect(PROVIDERS.zai.create({ env: { BIGMODEL_API_KEY: 'k' } }).isAvailable()).toBe(true);
    });

    test('generate fetches URL then downloads', async () => {
        const calls: string[] = [];
        const provider = PROVIDERS.zai.create({
            env: { ZAI_API_KEY: 'k' },
            fetch: (async (input: URL | RequestInfo) => {
                const url = String(input);
                calls.push(url);
                if (url.includes('images/generations')) {
                    return new Response(JSON.stringify({ data: [{ url: 'https://img.example/a.png' }] }), {
                        status: 200,
                    });
                }
                return new Response('bin', { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'glm-image', aspectRatio: '1:1', quality: '2k' });
        expect(result.extension).toBe('png');
        expect(result.bytes.length).toBe(3);
        expect(calls[0]).toBe('https://api.z.ai/api/paas/v4/images/generations');
    });

    test('key required', async () => {
        const provider = PROVIDERS.zai.create({ env: {} });
        expect(await provider.generate({ prompt: 'p', model: 'glm-image' }).catch((e: Error) => e.message)).toContain(
            'ZAI_API_KEY',
        );
    });
});

describe('generate', () => {
    const make = (env: Record<string, string>, fetchFn?: FetchType) =>
        createZai({
            env,
            fetch:
                fetchFn ??
                (() => {
                    throw new Error('no fetch');
                }),
        });

    test('is unavailable and validates input without keys', async () => {
        const provider = createZai({ env: {} });
        expect(provider.isAvailable()).toBe(false);
        await expect(provider.generate({ model: 'glm-image', prompt: 'p' } as never)).rejects.toThrow(
            'ZAI_API_KEY is required',
        );

        const withKey = make({ ZAI_API_KEY: 'k' }, () => {
            throw new Error('no fetch');
        });
        expect(withKey.isAvailable()).toBe(true);
        expect(withKey.supportsReferenceImages('glm-image')).toBe(false);
        expect(() => withKey.validate({ prompt: 'p', referenceImages: ['/a.png'] } as never)).toThrow(
            'Z.AI GLM-image currently supports text-to-image only',
        );
        expect(() => withKey.validate({ prompt: 'p' } as never)).not.toThrow();
    });

    test('posts standard-quality request and downloads the returned URL', async () => {
        const bodies: unknown[] = [];
        const capture = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);
            if (init?.body !== undefined) bodies.push(JSON.parse(String(init.body)));
            if (url.includes('img.example')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
            return new Response(JSON.stringify({ data: [{ url: 'https://img.example/final.png' }] }), { status: 200 });
        };
        const provider = createZai({
            env: { BIGMODEL_API_KEY: 'bigkey', BIGMODEL_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4' },
            fetch: capture,
        });
        const result = await provider.generate({
            model: 'glm-image',
            prompt: 'sky',
            quality: 'normal',
            aspectRatio: '3:2',
        } as never);
        expect(result).toEqual({
            bytes: new Uint8Array([1, 2, 3]),
            extension: 'png',
            provider: 'zai',
            model: 'glm-image',
        });
        expect(bodies[0]).toEqual({ model: 'glm-image', prompt: 'sky', quality: 'standard', size: '1568x1056' });
    });

    test('surfaces API errors, missing URLs, and download failures', async () => {
        const failing = async (): Promise<Response> => new Response('boom', { status: 500 });
        await expect(
            make({ ZAI_API_KEY: 'k' }, failing).generate({ model: 'glm-image', prompt: 'p' } as never),
        ).rejects.toThrow('Z.AI API error (500): boom');

        const noImage = async (): Promise<Response> => new Response(JSON.stringify({ data: [] }), { status: 200 });
        await expect(
            make({ ZAI_API_KEY: 'k' }, noImage).generate({ model: 'glm-image', prompt: 'p' } as never),
        ).rejects.toThrow('No image URL in Z.AI response');

        let calls = 0;
        const badDownload = async (_input: RequestInfo | URL): Promise<Response> => {
            if (++calls === 1) {
                return new Response(JSON.stringify({ data: [{ url: 'https://img.example/x.png' }] }), { status: 200 });
            }
            return new Response(null, { status: 404 });
        };
        await expect(
            make({ ZAI_API_KEY: 'k' }, badDownload).generate({ model: 'glm-image', prompt: 'p' } as never),
        ).rejects.toThrow('Failed to download image from Z.AI: 404');
    });
});

describe('resolveSizeForModel branches', () => {
    test('size syntax', () => {
        // x / X / * separators are accepted; negatives are rejected
        expect(
            resolveSizeForModel('glm-image', { size: '2048x2048', aspectRatio: undefined, quality: undefined }),
        ).toBe('2048x2048');
        expect(() =>
            resolveSizeForModel('glm-image', { size: '3-4', aspectRatio: undefined, quality: undefined }),
        ).toThrow('Z.AI --size must be in WxH format');
        expect(() =>
            resolveSizeForModel('legacy-model', { size: '300x300', aspectRatio: undefined, quality: undefined }),
        ).toThrow('between 512 and 2048');
        expect(() =>
            resolveSizeForModel('glm-image', { size: '300x300', aspectRatio: undefined, quality: undefined }),
        ).toThrow('between 1024 and 2048');
        expect(() =>
            resolveSizeForModel('glm-image', { size: '1026x1024', aspectRatio: undefined, quality: undefined }),
        ).toThrow('divisible by 32');
        expect(() =>
            resolveSizeForModel('legacy-model', { size: '524x512', aspectRatio: undefined, quality: undefined }),
        ).toThrow('divisible by 16');
        expect(resolveSizeForModel('glm-image', { size: '2048x2048', aspectRatio: undefined, quality: '2k' })).toBe(
            '2048x2048',
        );
    });

    test('default and fallback tables route by family and quality', () => {
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: undefined, quality: undefined })).toBe(
            '1280x1280',
        );
        expect(resolveSizeForModel('legacy-model', { size: undefined, aspectRatio: undefined, quality: '2k' })).toBe(
            '1024x1024',
        );
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: '5:7', quality: '2k' })).toBe(
            '1088x1472',
        );
        expect(resolveSizeForModel('legacy-model', { size: undefined, aspectRatio: '1:1', quality: '2k' })).toBe(
            '1024x1024',
        );
        // non-numeric aspect ratio falls back to the square default
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: 'wide', quality: 'normal' })).toBe(
            '1280x1280',
        );
    });

    test('fitToPixelBudget downscales oversized ratios to the budget', () => {
        expect(resolveSizeForModel('legacy-model', { size: undefined, aspectRatio: '16:1', quality: '2k' })).toBe(
            '5456x384',
        );
    });
});

describe('zai edge branches', () => {
    test('legacy wider-uncovered paths still hold', () => {
        // legacy exact pixels exactly at budget, 2k recommended table hit for glm (via findClosestRatioKey)
        expect(resolveSizeForModel('legacy-model', { size: undefined, aspectRatio: '5:4', quality: '2k' })).toBe(
            '1520x1376',
        );
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: '1:1', quality: '2k' })).toBe(
            '1280x1280',
        );
    });
});

describe('zai remaining branches', () => {
    test('legacy size validation branches', async () => {
        const provider = createZai({ env: { ZAI_API_KEY: 'k' }, fetch: () => new Response(null, { status: 200 }) });
        expect(() => provider.validate({ prompt: 'p' } as never)).not.toThrow();
        expect(() => provider.validate({ prompt: 'p', referenceImages: ['/x.jpg'] } as never)).toThrow(
            'Z.AI GLM-image currently supports text-to-image only',
        );
        expect(() =>
            resolveSizeForModel('legacy-model', { size: '300x300', aspectRatio: undefined, quality: undefined }),
        ).toThrow('between 512 and 2048');
        // legacy divisible and pixel-budget errors
        expect(() =>
            resolveSizeForModel('legacy-model', { size: '522x512', aspectRatio: undefined, quality: undefined }),
        ).toThrow('divisible by 16');
        expect(() =>
            resolveSizeForModel('legacy-model', { size: '1760x1760', aspectRatio: undefined, quality: undefined }),
        ).toThrow('2^21 total pixels');
    });

    test('decode odd loop shapes for fitToPixelBudget', () => {
        expect(resolveSizeForModel('glm-image', { size: undefined, aspectRatio: '1:14', quality: '2k' })).toBe(
            '416x5760',
        );
    });
});
