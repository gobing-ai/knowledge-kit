import { describe, expect, test } from 'bun:test';
import {
    buildOpenAIGenerationsBody,
    extractImageFromResponse,
    getMimeType,
    getOpenAIAspectRatio,
    getOpenAIResolution,
    getOpenAISize,
    getOrientationFromAspectRatio,
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
