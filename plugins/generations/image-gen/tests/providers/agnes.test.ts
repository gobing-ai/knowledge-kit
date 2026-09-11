import { describe, expect, test } from 'bun:test';
import {
    buildRequestBody,
    extractImageFromResponse,
    parseAspectRatio,
    resolveSize,
    snapDim,
} from '../../src/providers/agnes';
import { PROVIDERS } from '../../src/providers/types';

describe('agnes size helpers', () => {
    test('parses aspect ratios', () => {
        expect(parseAspectRatio('16:9')).toEqual({ width: 16, height: 9 });
        expect(parseAspectRatio('bad')).toBe(null);
    });

    test('snaps dimensions to multiples of 32', () => {
        expect(snapDim(1025)).toBe(1024);
        expect(snapDim(31)).toBe(32);
    });

    test('resolves size from args', () => {
        expect(resolveSize({ width: 800, height: 600 })).toBe('800x600');
        expect(resolveSize({ aspectRatio: '1:1' })).toBe('1024x1024');
        expect(resolveSize({ aspectRatio: '2:1' })).toBe('2048x1024');
        expect(resolveSize({})).toBe('1024x1024');
    });

    test('request body carries prompt, size and refs', () => {
        expect(
            buildRequestBody('p', 'm', { width: 512, height: 512, referenceImages: ['data:image/png;base64,AA=='] }),
        ).toEqual({
            model: 'm',
            prompt: 'p',
            size: '512x512',
            image: ['data:image/png;base64,AA=='],
            extra_body: { response_format: 'url' },
        });
    });

    test('extract prefers b64, then downloads url', async () => {
        const b64 = Buffer.from('img!').toString('base64');
        expect((await extractImageFromResponse({ data: [{ b64_json: b64 }] })).length).toBe(4);
        const bytes = await extractImageFromResponse(
            { data: [{ url: 'https://example.invalid/a.png' }] },
            (async () => new Response('abc', { status: 200 })) as typeof fetch,
        );
        expect(bytes.length).toBe(3);
        await expect(extractImageFromResponse({ data: [{}] })).rejects.toThrow('No image');
    });
});

describe('agnes provider', () => {
    test('generate posts to /images/generations and resolves png extension', async () => {
        const b64 = Buffer.from('zz').toString('base64');
        let captured = '';
        const provider = PROVIDERS.agnes.create({
            env: { AGNES_API_KEY: 'k', AGNES_BASE_URL: 'https://apihub.agnes-ai.com/v1/' },
            fetch: (async (input) => {
                captured = String(input);
                return new Response(JSON.stringify({ data: [{ b64_json: b64 }] }), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'agnes-image-2.1-flash' });
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('agnes');
        expect(captured).toBe('https://apihub.agnes-ai.com/v1/images/generations');
    });

    test('url responses download and take the url extension', async () => {
        const provider = PROVIDERS.agnes.create({
            env: { AGNES_API_KEY: 'k' },
            fetch: (async (input) => {
                if (String(input).includes('images/generations')) {
                    return new Response(JSON.stringify({ data: [{ url: 'https://img.example/pic.jpg' }] }), {
                        status: 200,
                    });
                }
                return new Response('abc', { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'm' });
        expect(result.extension).toBe('jpg');
    });

    test('key required', async () => {
        const provider = PROVIDERS.agnes.create({ env: {} });
        expect(await provider.generate({ prompt: 'p', model: 'm' }).catch((e: Error) => e.message)).toContain(
            'AGNES_API_KEY',
        );
    });
});

describe('agnes provider — metadata and error paths', () => {
    test('provider metadata', () => {
        const withKey = PROVIDERS.agnes.create({ env: { AGNES_API_KEY: 'k' } });
        expect(withKey.isAvailable()).toBe(true);
        expect(withKey.defaultModel()).toBe('agnes-image-2.1-flash');
        expect(withKey.supportsReferenceImages()).toBe(true);
        expect(PROVIDERS.agnes.create({ env: {} }).isAvailable()).toBe(false);
    });

    test('non-ok API response fails loudly with status and body', async () => {
        const provider = PROVIDERS.agnes.create({
            env: { AGNES_API_KEY: 'k' },
            fetch: (async () => new Response('blocked', { status: 402 })) as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: 'm' }).catch((e: Error) => e.message)).toContain(
            'Agnes API error (402): blocked',
        );
    });

    test('url download failure mid-flow throws', async () => {
        const provider = PROVIDERS.agnes.create({
            env: { AGNES_API_KEY: 'k' },
            fetch: (async (input) =>
                String(input).includes('images/generations')
                    ? new Response(JSON.stringify({ data: [{ url: 'https://img.example/pic.jpg' }] }), { status: 200 })
                    : new Response('gone', { status: 404 })) as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: 'm' }).catch((e: Error) => e.message)).toContain(
            'Failed to download image from Agnes: 404',
        );
    });

    test('size helpers reject zero or malformed ratios by falling back to the default', () => {
        expect(parseAspectRatio('0:9')).toBe(null);
        expect(resolveSize({ aspectRatio: 'nope' })).toBe('1024x1024');
        expect(snapDim(1)).toBe(32);
        expect(resolveSize({ aspectRatio: '0.5:0.25' })).toBe('2048x1024');
    });
});
