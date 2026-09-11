import { describe, expect, test } from 'bun:test';
import { buildInput, extractOutputUrl, getModelFamily, parseModelId } from '../../src/providers/replicate';
import { PROVIDERS } from '../../src/providers/types';

describe('replicate model parsing', () => {
    test('owner/name and owner/name:version', () => {
        expect(parseModelId('google/nano-banana-2')).toEqual({ owner: 'google', name: 'nano-banana-2', version: null });
        expect(parseModelId('a/b:v123')).toEqual({ owner: 'a', name: 'b', version: 'v123' });
        expect(() => parseModelId('not-a-model')).toThrow('owner/name');
    });

    test('family detection', () => {
        expect(getModelFamily('google/nano-banana')).toBe('nano-banana');
        expect(getModelFamily('bytedance/seedream-4.5')).toBe('seedream45');
        expect(getModelFamily('bytedance/seedream-5-lite')).toBe('seedream5lite');
        expect(getModelFamily('wan-video/wan-2.7-image-pro')).toBe('wan27imagepro');
        expect(getModelFamily('a/other')).toBe('unknown');
    });
});

describe('replicate input builders', () => {
    test('nano-banana maps quality to resolution and refs', () => {
        const input = buildInput({
            prompt: 'p',
            model: 'google/nano-banana-2',
            quality: '2k',
            aspectRatio: '16:9',
            width: undefined,
            height: undefined,
            referenceImages: ['data:image/png;base64,AA=='],
        });
        expect(input.resolution).toBe('2K');
        expect(input.aspect_ratio).toBe('16:9');
        expect(input.image_input).toEqual(['data:image/png;base64,AA==']);
        expect(input.output_format).toBe('png');
    });

    test('nano-banana default resolution and match_input_image with refs', () => {
        const input = buildInput({
            prompt: 'p',
            model: 'google/nano-banana-2',
            quality: 'normal',
            aspectRatio: undefined,
            width: undefined,
            height: undefined,
            referenceImages: ['u'],
        });
        expect(input.resolution).toBe('1K');
        expect(input.aspect_ratio).toBe('match_input_image');
    });

    test('seedream45 respects pixel bounds', () => {
        const ok = buildInput({
            prompt: 'p',
            model: 'bytedance/seedream-4.5',
            quality: '2k',
            aspectRatio: undefined,
            width: 2048,
            height: 2048,
            referenceImages: [],
        });
        expect(ok.size).toBe('custom');
        expect(ok.width).toBe(2048);
        expect(() =>
            buildInput({
                prompt: 'p',
                model: 'bytedance/seedream-4.5',
                quality: undefined,
                aspectRatio: undefined,
                width: 512,
                height: 512,
                referenceImages: [],
            }),
        ).toThrow('between 1024 and 4096');
    });

    test('wan27 pro t2i caps at 4096, ref mode at 2048', () => {
        const t2i = buildInput({
            prompt: 'p',
            model: 'wan-video/wan-2.7-image-pro',
            quality: '2k',
            aspectRatio: undefined,
            width: 4096,
            height: 2048,
            referenceImages: [],
        });
        expect(t2i.size).toBe('4096*2048');
        expect(() =>
            buildInput({
                prompt: 'p',
                model: 'wan-video/wan-2.7-image-pro',
                quality: undefined,
                aspectRatio: undefined,
                width: 4096,
                height: 2048,
                referenceImages: ['u'],
            }),
        ).toThrow('at or below 2048px');
        const aspectInput = buildInput({
            prompt: 'p',
            model: 'wan-video/wan-2.7-image',
            quality: '2k',
            aspectRatio: '1:2',
            width: undefined,
            height: undefined,
            referenceImages: [],
        });
        expect(aspectInput.size).toBe('1024*2048');
    });

    test('unknown families get a minimal body', () => {
        expect(
            buildInput({
                prompt: 'p',
                model: 'a/other',
                quality: undefined,
                aspectRatio: undefined,
                width: undefined,
                height: undefined,
                referenceImages: [],
            }),
        ).toEqual({
            prompt: 'p',
        });
    });
});

describe('replicate output extraction', () => {
    test('string and single-item-array outputs', () => {
        expect(extractOutputUrl({ status: 'succeeded', output: 'https://x/y.png', error: null })).toBe(
            'https://x/y.png',
        );
        expect(extractOutputUrl({ status: 'succeeded', output: ['https://x/y.png'], error: null })).toBe(
            'https://x/y.png',
        );
        expect(() => extractOutputUrl({ status: 'succeeded', output: ['a', 'b'], error: null })).toThrow('exactly one');
        expect(() => extractOutputUrl({ status: 'succeeded', output: null, error: null })).toThrow('Unexpected');
    });
});

describe('replicate provider', () => {
    function jsonRes(payload: unknown): Response {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    test('generate: sync Prefer-wait succeeds without polling', async () => {
        let captured = '';
        let prefer = '';
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async (input, init) => {
                if (String(input).includes('/v1/models/')) {
                    captured = String(input);
                    const hdrs = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
                    prefer = String(hdrs?.Prefer);
                    return jsonRes({ status: 'succeeded', output: 'https://img.example/out.jpeg', error: null });
                }
                return new Response('bin', { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'google/nano-banana-2', quality: 'normal' });
        expect(result.extension).toBe('jpg');
        expect(captured).toBe('https://api.replicate.com/v1/models/google/nano-banana-2/predictions');
        expect(prefer).toBe('wait=60');
    });

    test('generate: failed prediction surfaces error', async () => {
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async (input) => {
                if (String(input).includes('poll')) {
                    return jsonRes({ status: 'failed', output: null, error: 'boom' });
                }
                return jsonRes({ status: 'starting', output: null, error: null, urls: { get: 'https://poll' } });
            }) as typeof fetch,
        });
        expect(
            await provider.generate({ prompt: 'p', model: 'google/nano-banana-2' }).catch((e: Error) => e.message),
        ).toContain('failed: boom');
    });

    test('token required', async () => {
        const provider = PROVIDERS.replicate.create({ env: {} });
        expect(
            await provider.generate({ prompt: 'p', model: 'google/nano-banana-2' }).catch((e: Error) => e.message),
        ).toContain('REPLICATE_API_TOKEN');
    });
});
