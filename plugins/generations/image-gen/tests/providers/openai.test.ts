import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildOpenAIGenerationsBody,
    extractImageFromResponse,
    getMimeType,
    getOpenAIAspectRatio,
    getOpenAIResolution,
    getOpenAISize,
    getOrientationFromAspectRatio,
    inferAspectRatioFromSize,
    inferResolutionFromSize,
    validateGptImage2Size,
} from '../../src/providers/openai';
import { PROVIDERS } from '../../src/providers/types';

describe('openai size mapping', () => {
    test('gpt-image-2 maps aspect ratios and 2k quality to sizes', () => {
        expect(getOpenAISize('gpt-image-2', '1:1', 'normal')).toBe('1024x1024');
        expect(getOpenAISize('gpt-image-2', '1:1', '2k')).toBe('2048x2048');
        expect(getOpenAISize('gpt-image-2', '16:9', 'normal')).toBe('1088x608');
        expect(getOpenAISize('dall-e-3', '16:9', 'normal')).toBe('1792x1024');
    });

    test('ratio-metadata helpers infer resolution and orientation', () => {
        expect(getOpenAIAspectRatio({ aspectRatio: '16:9', size: undefined })).toBe('16:9');
        expect(getOpenAIAspectRatio({ aspectRatio: undefined, size: '1536x1024' })).toBe('3:2');
        expect(inferResolutionFromSize('1536x1024')).toBe('2K');
        expect(getOpenAIResolution({ size: '1024x1024', quality: 'normal' })).toBe('1K');
        expect(getOrientationFromAspectRatio('16:9')).toBe('landscape');
    });

    test('gpt-image-2 size constraints', () => {
        expect(() => validateGptImage2Size(4096, 4096)).toThrow('3840px');
        expect(() => validateGptImage2Size(1025, 1024)).toThrow('multiples of 16px');
        expect(() => validateGptImage2Size(3840, 1024)).toThrow('3:1');
        expect(() => validateGptImage2Size(16, 16)).toThrow('655,360');
        expect(() => validateGptImage2Size(1152, 896)).not.toThrow();
    });

    test('body builders handle native and ratio-metadata dialects', () => {
        expect(
            buildOpenAIGenerationsBody('p', 'gpt-image-2', {
                aspectRatio: '1:1',
                size: '1024x1024',
                quality: undefined,
                imageApiDialect: undefined,
            }),
        ).toEqual({
            model: 'gpt-image-2',
            prompt: 'p',
            size: '1024x1024',
            quality: 'medium',
        });
        const metadataBody = buildOpenAIGenerationsBody('p', 'gpt-image-2', {
            aspectRatio: '9:16',
            size: undefined,
            quality: '2k',
            imageApiDialect: 'ratio-metadata',
        }) as { size: string; metadata: Record<string, string> };
        expect(metadataBody.size).toBe('9:16');
        expect(metadataBody.metadata.orientation).toBe('portrait');
    });

    test('mime detection', () => {
        expect(getMimeType('a.jpg')).toBe('image/jpeg');
        expect(getMimeType('b.webp')).toBe('image/webp');
        expect(getMimeType('c.png')).toBe('image/png');
    });

    test('extract reads b64 first, then downloads url', async () => {
        const b64 = Buffer.from('hello').toString('base64');
        expect((await extractImageFromResponse({ data: [{ b64_json: b64 }] })).length).toBe(5);
        const downloaded = new Response(new Uint8Array([1, 2, 3]), { status: 200 });
        const bytes = await extractImageFromResponse({ data: [{ url: 'https://example.com/x.png' }] }, () =>
            Promise.resolve(downloaded),
        );
        expect(bytes.length).toBe(3);
        await expect(extractImageFromResponse({ data: [{}] })).rejects.toThrow('No image in response');
    });
});

describe('openai provider generate', () => {
    const provider = PROVIDERS.openai.create({
        env: { OPENAI_API_KEY: 'k' },
        fetch: (async () =>
            new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64') }] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as typeof fetch,
    });

    test('requires the key', async () => {
        const withoutKey = PROVIDERS.openai.create({
            env: {},
            fetch: (() => {
                throw new Error('no');
            }) as typeof fetch,
        });
        expect(
            await withoutKey.generate({ prompt: 'p', model: 'gpt-image-2' }).catch((e: Error) => e.message),
        ).toContain('OPENAI_API_KEY');
    });

    test('generates against the images endpoint', async () => {
        const result = await provider.generate({ prompt: 'p', model: 'gpt-image-2' });
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('openai');
        expect(result.bytes.length).toBe(3);
    });
});

describe('openai size mapping — remaining branches', () => {
    test('gpt-image-2 aspect-derived sizes hit the grow loop both directions', () => {
        const landscape = getOpenAISize('gpt-image-2', '16:9', 'normal');
        const [lw, lh] = landscape.split('x').map(Number) as [number, number];
        expect(lw % 16).toBe(0);
        expect(lh % 16).toBe(0);
        expect(lw / lh).toBeCloseTo(16 / 9, 1);
        expect(lw * lh).toBeGreaterThanOrEqual(655_360);
        const portrait = getOpenAISize('gpt-image-2', '9:16', 'normal');
        const [pw, ph] = portrait.split('x').map(Number) as [number, number];
        expect(ph).toBeGreaterThan(pw);
        expect(pw % 16).toBe(0);
        expect(getOpenAISize('gpt-image-2', '1:1', 'normal')).toBe('1024x1024');
    });

    test('dall-e and generic model size buckets', () => {
        expect(getOpenAISize('dall-e-2', '16:9', undefined)).toBe('1024x1024');
        expect(getOpenAISize('dall-e-3', null, undefined)).toBe('1024x1024');
        expect(getOpenAISize('gpt-image-2', 'nonsense', undefined)).toBe('1024x1024');
        expect(getOpenAISize('gpt-image-2', '1:1', undefined)).toBe('1024x1024');
        expect(getOpenAISize('other-model', '16:9', undefined)).toBe('1536x1024');
        expect(getOpenAISize('other-model', '9:16', undefined)).toBe('1024x1536');
        expect(getOpenAISize('other-model', null, undefined)).toBe('1024x1024');
        expect(getOpenAISize('other-model', 'nonsense', undefined)).toBe('1024x1024');
        expect(getOpenAISize('other-model', '1:1', undefined)).toBe('1024x1024');
    });

    test('inferAspectRatioFromSize and inferResolutionFromSize edge branches', () => {
        expect(inferAspectRatioFromSize(null)).toBe(null);
        expect(inferAspectRatioFromSize('bad')).toBe(null);
        expect(inferAspectRatioFromSize('0x100')).toBe(null);
        expect(inferAspectRatioFromSize('1920x1080')).toBe('16:9');
        expect(inferResolutionFromSize(null)).toBe(null);
        expect(inferResolutionFromSize('bad')).toBe(null);
        expect(inferResolutionFromSize('0x100')).toBe(null);
        expect(inferResolutionFromSize('4096x1024')).toBe('4K');
    });
});

describe('openai provider generate — remaining paths', () => {
    const okJson = (payload: unknown) =>
        new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });

    test('chat-completions fallback extracts a data URI image', async () => {
        const dataUri = `data:image/png;base64,${Buffer.from('chat').toString('base64')}`;
        const provider = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k', OPENAI_IMAGE_USE_CHAT: 'true' },
            fetch: (async (input, init) => {
                expect(String(input)).toBe('https://api.openai.com/v1/chat/completions');
                expect((init as RequestInit | undefined)?.headers).toMatchObject({ authorization: 'Bearer k' });
                return okJson({ choices: [{ message: { content: `prefix ${dataUri} suffix` } }] });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'gpt-image-2' });
        expect(result.bytes.length).toBe(4);
        expect(result.extension).toBe('png');
    });

    test('chat-completions fallback: HTTP error and missing image both fail loudly', async () => {
        const failing = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k', OPENAI_IMAGE_USE_CHAT: 'true' },
            fetch: (async () => new Response('boom', { status: 500 })) as typeof fetch,
        });
        await expect(failing.generate({ prompt: 'p', model: 'gpt-image-2' })).rejects.toThrow('OpenAI API error: boom');
        const noImage = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k', OPENAI_IMAGE_USE_CHAT: 'true' },
            fetch: (async () => okJson({ choices: [{ message: { content: 'no image here' } }] })) as typeof fetch,
        });
        await expect(noImage.generate({ prompt: 'p', model: 'gpt-image-2' })).rejects.toThrow(
            'No image found in chat completions response',
        );
    });

    test('reference images: dall-e rejection, gpt-image edits upload, and edits error', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'openai-test-'));
        const ref = join(dir, 'ref.png');
        await writeFile(ref, Buffer.from('refbytes'));
        const provider = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k' },
            fetch: (async (input) => {
                expect(String(input)).toBe('https://api.openai.com/v1/images/edits');
                return okJson({ data: [{ b64_json: Buffer.from('edited').toString('base64') }] });
            }) as typeof fetch,
        });
        await expect(provider.generate({ prompt: 'p', model: 'dall-e-3', referenceImages: [ref] })).rejects.toThrow(
            'Reference images with OpenAI require GPT Image models',
        );
        const result = await provider.generate({ prompt: 'p', model: 'gpt-image-2', referenceImages: [ref] });
        expect(result.bytes.length).toBe(6);
        const failing = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k' },
            fetch: (async () => new Response('nope', { status: 400 })) as typeof fetch,
        });
        await expect(failing.generate({ prompt: 'p', model: 'gpt-image-2', referenceImages: [ref] })).rejects.toThrow(
            'OpenAI edits API error: nope',
        );
    });

    test('generations: explicit size, quality field, url-download fallback, and HTTP error', async () => {
        let body = '';
        const provider = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k', OPENAI_BASE_URL: 'https://example.com/v1' },
            fetch: (async (input, init) => {
                const url = String(input);
                if (url === 'https://example.com/v1/images/generations') {
                    body = String((init as RequestInit | undefined)?.body);
                    return okJson({ data: [{ url: 'https://img.example/x.png' }] });
                }
                expect(url).toBe('https://img.example/x.png');
                return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'gpt-image-2', width: 1024, height: 1024 });
        const parsed = JSON.parse(body) as { size: string; quality: string };
        expect(parsed).toEqual({ model: 'gpt-image-2', prompt: 'p', size: '1024x1024', quality: 'medium' });
        expect(result.bytes.length).toBe(3); // url-download fallback fetched the url
        const failing = PROVIDERS.openai.create({
            env: { OPENAI_API_KEY: 'k' },
            fetch: (async () => new Response('denied', { status: 403 })) as typeof fetch,
        });
        await expect(failing.generate({ prompt: 'p', model: 'gpt-image-2' })).rejects.toThrow(
            'OpenAI API error: denied',
        );
    });

    test('validate: non-gpt refs and gpt-image-2 size constraints', () => {
        const provider = PROVIDERS.openai.create({ env: { OPENAI_API_KEY: 'k' } });
        expect(() => provider.validate({ prompt: 'p', model: 'dall-e-3', referenceImages: ['/tmp/a.png'] })).toThrow(
            'require GPT Image models',
        );
        expect(() => provider.validate({ prompt: 'p', model: 'gpt-image-2', width: 4096, height: 4096 })).toThrow(
            '3840px',
        );
        expect(() => provider.validate({ prompt: 'p', model: 'gpt-image-2' })).not.toThrow();
        expect(provider.supportsReferenceImages('gpt-image-2')).toBe(true);
        expect(provider.supportsReferenceImages('dall-e-3')).toBe(false);
        expect(provider.isAvailable()).toBe(true);
        expect(PROVIDERS.openai.create({ env: {} }).isAvailable()).toBe(false);
    });
});
