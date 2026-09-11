import { describe, expect, test } from 'bun:test';
import {
    buildRequestBody,
    extractImageFromResponse,
    getAspectRatio,
    getImageSize,
    isTextAndImageModel,
    validateAspectRatio,
} from '../../src/providers/openrouter';
import type { ImageRequest } from '../../src/providers/types';
import { PROVIDERS } from '../../src/providers/types';

describe('openrouter model gating', () => {
    test('text-and-image detection', () => {
        expect(isTextAndImageModel('google/gemini-3.1-flash-image')).toBe(true);
        expect(isTextAndImageModel('openai/gpt-image-1')).toBe(true);
        expect(isTextAndImageModel('google/gemini-2.0-flash')).toBe(false);
    });

    test('aspect ratio validation', () => {
        expect(() => validateAspectRatio('google/gemini-3.1-flash-image', '4:3', null)).not.toThrow();
        expect(() => validateAspectRatio('google/gemini-2.0-flash', '1:7', null)).toThrow('does not support');
        expect(() => validateAspectRatio('google/gemini-2.0-flash', null, '1024x1024')).not.toThrow();
        expect(() => validateAspectRatio('google/gemini-2.0-flash', '1:8', null)).toThrow();
        expect(getAspectRatio('1:1', '1024x1024', 'google/gemini-3.1-flash-image')).toBe('1:1');
    });

    test('image size from pixels or quality', () => {
        expect(getImageSize({ width: 1024, height: 1024, quality: undefined })).toBe('1K');
        expect(getImageSize({ width: undefined, height: undefined, quality: '2k' })).toBe('2K');
        expect(getImageSize({ width: undefined, height: undefined, quality: undefined })).toBe(null);
    });

    test('body carries image_config and modality', () => {
        const req: ImageRequest = {
            prompt: 'p',
            model: 'google/gemini-3.1-flash-image',
            quality: '2k',
            aspectRatio: '1:1',
        };
        const body = buildRequestBody('p', req.model, req, []);
        expect(body.modalities).toEqual(['image', 'text']);
        expect(body.image_config).toEqual({ image_size: '2K', aspect_ratio: '1:1' });
        expect(body.provider).toEqual({ require_parameters: true });

        const textOnlyReq: ImageRequest = { prompt: 'p', model: 'google/gemini-2.0-flash' };
        const textBody = buildRequestBody('p', textOnlyReq.model, textOnlyReq, []);
        expect(textBody.modalities).toEqual(['image']);
        expect(textBody.image_config).toBeUndefined();
    });
});

describe('openrouter response extraction', () => {
    test('pulls inline image from choices', async () => {
        const b64 = Buffer.from('abc').toString('base64');
        const result = await extractImageFromResponse({
            choices: [
                { message: { images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] } },
            ],
        });
        expect(result.length).toBe(3);
    });

    test('missing image surfaces finish_reason', async () => {
        await expect(extractImageFromResponse({ choices: [{ native_finish_reason: 'length' }] })).rejects.toThrow(
            'finish_reason=length',
        );
    });
});

describe('openrouter provider', () => {
    test('generate posts to the chat-completions endpoint', async () => {
        const b64 = Buffer.from('img').toString('base64');
        let capturedUrl = '';
        const provider = PROVIDERS.openrouter.create({
            env: { OPENROUTER_API_KEY: 'k' },
            fetch: (async (input) => {
                capturedUrl = String(input);
                return new Response(
                    JSON.stringify({
                        choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${b64}` } }] } }],
                    }),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                );
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'google/gemini-3.1-flash-image' });
        expect(result.extension).toBe('png');
        expect(result.provider).toBe('openrouter');
        expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    });

    test('key required', async () => {
        const provider = PROVIDERS.openrouter.create({ env: {} });
        expect(
            await provider.generate({ prompt: 'p', model: 'google/gemini-2.0-flash' }).catch((e: Error) => e.message),
        ).toContain('OPENROUTER_API_KEY');
    });
});
