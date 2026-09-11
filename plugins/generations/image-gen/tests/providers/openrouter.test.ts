import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildContent,
    buildRequestBody,
    extractImageFromResponse,
    getAspectRatio,
    getImageSize,
    isTextAndImageModel,
    validateAspectRatio,
} from '../../src/providers/openrouter';
import { refToDataUri } from '../../src/providers/refs';
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

describe('openrouter remaining branches (0116 coverage follow-up)', () => {
    test('image size thresholds incl. 4K and malformed sizes', () => {
        expect(getImageSize({ width: 4096, height: 4096, quality: undefined })).toBe('4K');
        expect(getImageSize({ width: 2048, height: 2048, quality: undefined })).toBe('2K');
        expect(getImageSize({ width: 0, height: 100, quality: undefined })).toBe(null);
        expect(getImageSize({ width: undefined, height: 100, quality: undefined })).toBe(null);
    });

    test('aspect inference from pixels: reduced ratio, unsupported, invalid size', () => {
        // 1920x1080 reduces to 16:9, which gemini-3.1-flash supports.
        expect(getAspectRatio(null, '1920x1080', 'google/gemini-3.1-flash-image')).toBe('16:9');
        // 1920x1080 reduces to 16:9; a non-gemini-3.1 model keeps the common set — 16:9 is common too.
        expect(getAspectRatio(null, '999x1000', 'google/gemini-2.0-flash')).toBe(null);
        expect(getAspectRatio(null, 'garbage', 'google/gemini-2.0-flash')).toBe(null);
        expect(getAspectRatio(null, '0x100', 'google/gemini-2.0-flash')).toBe(null);
    });

    test('validateAspectRatio names the offending size when ratio is inferred', () => {
        expect(() => validateAspectRatio('google/gemini-2.0-flash', null, '999x1000')).toThrow(
            'size 999x1000 (aspect ratio 999:1000)',
        );
    });

    test('buildContent wraps reference images into multimodal parts', () => {
        const content = buildContent('p', ['data:image/png;base64,AAA']);
        expect(content).toEqual([
            { type: 'text', text: 'p' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ]);
        expect(buildContent('p', [])).toBe('p');
    });

    test('extraction order: images array, then content parts, then string content', async () => {
        const b64 = Buffer.from('xyz').toString('base64');
        const dataUrl = `data:image/jpeg;base64,${b64}`;
        // content array with a text part holding a data URL, and a mixed array where the text part
        // holds no URL and the image comes from a later part (covers the fall-through loop body)
        expect(
            new TextDecoder().decode(
                await extractImageFromResponse({
                    choices: [{ message: { content: [{ type: 'text', text: dataUrl }] } }],
                }),
            ),
        ).toBe('xyz');
        expect(
            new TextDecoder().decode(
                await extractImageFromResponse({
                    choices: [
                        {
                            message: {
                                content: [
                                    { type: 'text', text: 'no url here' },
                                    { type: 'image_url', image_url: { url: dataUrl } },
                                ],
                            },
                        },
                    ],
                }),
            ),
        ).toBe('xyz');
        // string content holding a data URL, and string content that is NOT a data URL (falls through)
        expect(
            new TextDecoder().decode(await extractImageFromResponse({ choices: [{ message: { content: dataUrl } }] })),
        ).toBe('xyz');
        await expect(
            extractImageFromResponse({
                choices: [{ native_finish_reason: 'length', message: { content: 'plain prose' } }],
            }),
        ).rejects.toThrow('finish_reason=length');
        // image_url as plain string form
        expect(
            new TextDecoder().decode(
                await extractImageFromResponse({ choices: [{ message: { images: [{ image_url: dataUrl }] } }] }),
            ),
        ).toBe('xyz');
        // imageUrl (camelCase) object form with null url falls through to finish_reason
        await expect(
            extractImageFromResponse({
                choices: [{ finish_reason: 'stop', message: { images: [{ imageUrl: { url: null } }] } }],
            }),
        ).rejects.toThrow('finish_reason=stop');
        // finish_reason fallback chain: native_finish_reason || finish_reason || 'unknown'
        await expect(extractImageFromResponse({})).rejects.toThrow('finish_reason=unknown');
    });

    test('http(s) image URLs are downloaded; non-ok download throws', async () => {
        const fetched: string[] = [];
        const okFetch = (async (input: RequestInfo | URL) => {
            fetched.push(String(input));
            return new Response('dl', { status: 200 });
        }) as typeof fetch;
        expect(
            new TextDecoder().decode(
                await extractImageFromResponse(
                    { choices: [{ message: { images: [{ image_url: 'https://x.example/a.png' }] } }] },
                    okFetch,
                ),
            ),
        ).toBe('dl');
        const failFetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
        await expect(
            extractImageFromResponse(
                { choices: [{ message: { images: [{ image_url: 'https://x.example/a.png' }] } }] },
                failFetch,
            ),
        ).rejects.toThrow('Failed to download OpenRouter image: 403');
        // bare base64 (no data: prefix, no http) decodes directly
        const raw = Buffer.from('rawb64').toString('base64');
        expect(
            new TextDecoder().decode(
                await extractImageFromResponse({ choices: [{ message: { images: [{ image_url: raw }] } }] }),
            ),
        ).toBe('rawb64');
    });

    test('generate sends referer/title headers, custom base URL, ref data-uris, and error body on !ok', async () => {
        const tmp = await mkdtemp(join(tmpdir(), 'or-test-'));
        const ref = join(tmp, 'ref.png');
        await writeFile(ref, Buffer.from('ref-bytes'));
        let capturedUrl = '';
        let capturedHeaders: Record<string, string> = {};
        let capturedBody = '';
        const provider = PROVIDERS.openrouter.create({
            env: {
                OPENROUTER_API_KEY: 'k',
                OPENROUTER_HTTP_REFERER: 'https://app.example',
                OPENROUTER_TITLE: 'kk test',
                OPENROUTER_BASE_URL: 'https://proxy.example/api/v1/',
            },
            fetch: (async (input, init) => {
                capturedUrl = String(input);
                capturedHeaders = init?.headers as Record<string, string>;
                capturedBody = String(init?.body);
                return new Response('unauthorized', { status: 401 });
            }) as typeof fetch,
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'google/gemini-2.0-flash', referenceImages: [ref] })
            .catch((e: Error) => e.message);
        expect(message).toContain('OpenRouter API error (401)');
        expect(message).toContain('unauthorized');
        expect(capturedUrl).toBe('https://proxy.example/api/v1/chat/completions');
        expect(capturedHeaders.authorization).toBe('Bearer k');
        expect(capturedHeaders['HTTP-Referer']).toBe('https://app.example');
        expect(capturedHeaders['X-OpenRouter-Title']).toBe('kk test');
        expect(capturedHeaders['X-Title']).toBe('kk test');
        const dataUri = await refToDataUri(ref);
        expect(capturedBody).toContain(dataUri.slice(0, 40));
    });

    test('unsupported aspect ratio on the elected model throws before spend', async () => {
        const provider = PROVIDERS.openrouter.create({
            env: { OPENROUTER_API_KEY: 'k' },
            fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
        });
        const message = await provider
            .generate({ prompt: 'p', model: 'google/gemini-2.0-flash', aspectRatio: '1:8' })
            .catch((e: Error) => e.message);
        expect(message).toContain('does not support aspect ratio 1:8');
    });
});
