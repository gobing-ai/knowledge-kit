import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
    fitToPixelBudget,
    getModelFamily,
    getSizeFromAspectRatio,
    getWan27SizeFromAspectRatio,
    normalizeSize,
    parseAspectRatio,
    parseSize,
    resolveSizeForModel,
} from '../../src/providers/dashscope';
import { PROVIDERS } from '../../src/providers/types';

describe('dashscope size logic', () => {
    test('model family detection', () => {
        expect(getModelFamily('qwen-image-2.0-pro')).toBe('qwen2');
        expect(getModelFamily('qwen-image-max')).toBe('qwenFixed');
        expect(getModelFamily('wan2.7-image-pro')).toBe('wan27');
        expect(getModelFamily('wan2.7-image')).toBe('wan27');
        expect(getModelFamily('unknown-model')).toBe('legacy');
    });

    test('legacy size tables pick the closest ratio', () => {
        expect(getSizeFromAspectRatio('16:9', 'normal')).toBe('1280*720');
        expect(getSizeFromAspectRatio(undefined, '2k')).toBe('1536*1536');
        expect(getSizeFromAspectRatio('1:1', '2k')).toBe('1536*1536');
    });

    test('qwenFixed only accepts its fixed size table', () => {
        expect(resolveSizeForModel('qwen-image-max', { size: undefined, aspectRatio: '1:1', quality: 'normal' })).toBe(
            '1328*1328',
        );
        expect(() =>
            resolveSizeForModel('qwen-image-max', { size: '1600x900', aspectRatio: undefined, quality: undefined }),
        ).toThrow('only these sizes');
        expect(() =>
            resolveSizeForModel('qwen-image-max', { size: undefined, aspectRatio: '7:1', quality: 'normal' }),
        ).toThrow('custom ratios');
    });

    test('wants a wan27 pro text-to-image max of 4096', () => {
        expect(getWan27SizeFromAspectRatio('16:9', '2k', 4096 * 4096)).toBe('2736*1536');
        expect(() => getWan27SizeFromAspectRatio('9:1', '2k', 4096 * 4096)).toThrow('ratios in [1:8, 8:1]');
    });

    test('fitToPixelBudget clamps to bounds on a 16px lattice', () => {
        const fitted = fitToPixelBudget(100, 100, 512 * 512, 2048 * 2048);
        expect(fitted.width % 16).toBe(0);
        expect(fitted.height % 16).toBe(0);
    });

    test('normalize and parse sizes', () => {
        expect(normalizeSize('1024x768')).toBe('1024*768');
        expect(parseSize('1024*768')).toEqual({ width: 1024, height: 768 });
        expect(parseSize('nope')).toBe(null);
    });
});

describe('dashscope provider', () => {
    test('rejects refs with non-wan27 models', async () => {
        const provider = PROVIDERS.dashscope.create({ env: { DASHSCOPE_API_KEY: 'k' } });
        expect(() =>
            provider.validate({ prompt: 'p', model: 'qwen-image-2.0-pro', referenceImages: ['/tmp/a.png'] }),
        ).toThrow('wan2.7');
    });

    test('rejects >9 refs and n>1 with wan27 models', async () => {
        const provider = PROVIDERS.dashscope.create({ env: { DASHSCOPE_API_KEY: 'k' } });
        const generateRefs = Array.from({ length: 10 }, (_, i) => `/tmp/${i}.png`);
        expect(
            await provider
                .generate({ prompt: 'p', model: 'wan2.7-image-pro', referenceImages: generateRefs })
                .catch((e: Error) => e.message),
        ).toContain('at most 9');
        expect(
            await provider.generate({ prompt: 'p', model: 'wan2.7-image-pro', n: 2 }).catch((e: Error) => e.message),
        ).toContain('exactly one output image');
    });

    test('generate posts multimodal generation for qwen models and downloads the image', async () => {
        let body = '';
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k' },
            fetch: (async (_input, init) => {
                if (init?.body !== undefined) body = String(init.body);
                return new Response(JSON.stringify({ output: { result_image: 'data:image/png;base64,AA==' } }), {
                    status: 200,
                });
            }) as typeof fetch,
        });
        const result = await provider.generate({
            prompt: 'p',
            model: 'qwen-image-2.0-pro',
            aspectRatio: '1:1',
            quality: '2k',
        });
        expect(result.extension).toBe('png');
        expect(body).toContain('"model":"qwen-image-2.0-pro"');
        expect(body).toContain('watermark');
    });

    test('wan27 ref request embeds data-uri images', async () => {
        let body = '';
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k' },
            fetch: (async (_input, init) => {
                if (init?.body !== undefined) body = String(init.body);
                return new Response(JSON.stringify({ output: { result_image: 'data:image/png;base64,AA==' } }), {
                    status: 200,
                });
            }) as typeof fetch,
        });
        const refPath = `${await mkdtemp(join(tmpdir(), 'ds-test-'))}${sep}x.png`;
        await writeFile(refPath, Buffer.from('x'));
        const result = await provider.generate({ prompt: 'p', model: 'wan2.7-image-pro', referenceImages: [refPath] });
        expect(result.extension).toBe('png');
        expect(body).toContain('data:image/png;base64');
    });

    test('key required', async () => {
        const provider = PROVIDERS.dashscope.create({ env: {} });
        expect(
            await provider.generate({ prompt: 'p', model: 'qwen-image-2.0-pro' }).catch((e: Error) => e.message),
        ).toContain('DASHSCOPE_API_KEY');
    });
});

describe('dashscope size logic — branch completion', () => {
    test('legacy models accept explicit sizes and normalize x to *', () => {
        expect(resolveSizeForModel('unknown-model', { size: '1024x768' })).toBe('1024*768');
        expect(() => resolveSizeForModel('unknown-model', { size: 'abc' })).toThrow('Invalid DashScope size');
    });

    test('qwen2 aspect-ratio branches: default, known ratio, unparsable, custom fitted', () => {
        expect(resolveSizeForModel('qwen-image-2.0-pro', { aspectRatio: undefined, quality: 'normal' })).toBe(
            '1024*1024',
        );
        expect(resolveSizeForModel('qwen-image-2.0-pro', { aspectRatio: '16:9', quality: '2k' })).toBe('1920*1080');
        expect(resolveSizeForModel('qwen-image-2.0-pro', { aspectRatio: 'abc', quality: 'normal' })).toBe('1024*1024');
        const fitted = resolveSizeForModel('qwen-image-2.0-pro', { aspectRatio: '5:3', quality: 'normal' });
        const [w, h] = fitted.split('*').map(Number);
        expect(w % 16).toBe(0);
        expect(h % 16).toBe(0);
        expect(w / h).toBeGreaterThan(1.6);
        expect(w / h).toBeLessThan(1.7);
    });

    test('qwen2 explicit sizes validate the pixel budget', () => {
        expect(resolveSizeForModel('qwen-image-2.0-pro', { size: '1024x768' })).toBe('1024*768');
        expect(() => resolveSizeForModel('qwen-image-2.0-pro', { size: '100x100' })).toThrow('total pixels between');
        expect(() => resolveSizeForModel('qwen-image-2.0-pro', { size: '4096x4096' })).toThrow('total pixels between');
    });

    test('qwenFixed explicit sizes accept only the fixed table', () => {
        expect(resolveSizeForModel('qwen-image-max', { size: '1328x1328' })).toBe('1328*1328');
    });

    test('fitToPixelBudget scales down and walks the 16px lattice back under max', () => {
        const fitted = fitToPixelBudget(1000, 1050, 512 * 512, 1024 * 1024);
        expect(fitted.width * fitted.height).toBeLessThanOrEqual(1024 * 1024);
        expect(fitted.width % 16).toBe(0);
        expect(fitted.height % 16).toBe(0);
    });

    test('fitToPixelBudget scales up and walks the lattice back above min', () => {
        const fitted = fitToPixelBudget(30, 20, 512 * 512, 2048 * 2048);
        expect(fitted.width * fitted.height).toBeGreaterThanOrEqual(512 * 512);
        expect(fitted.width % 16).toBe(0);
        expect(fitted.height % 16).toBe(0);
    });

    test('fitToPixelBudget walks width up when the rounded result is portrait and under min', () => {
        const fitted = fitToPixelBudget(20, 30, 512 * 512, 2048 * 2048);
        expect(fitted).toEqual({ width: 432, height: 624 });
    });

    test('fitToPixelBudget walks width down when rounding lands above a non-lattice max', () => {
        const fitted = fitToPixelBudget(2048, 2048, 512 * 512, 3_999_000);
        expect(fitted).toEqual({ width: 1984, height: 2000 });
    });

    test('fitToPixelBudget walks height down when the width is already at the floor', () => {
        const fitted = fitToPixelBudget(16, 20000, 512 * 512, 300_000);
        expect(fitted.width).toBe(16);
        expect(fitted.height % 16).toBe(0);
        expect(fitted.width * fitted.height).toBeLessThanOrEqual(300_000);
    });

    test('wan27 derived sizes are clamped back into [1:8, 8:1]', () => {
        const wide = getWan27SizeFromAspectRatio('8:1', '2k', 4096 * 4096);
        const [ww, wh] = wide.split('*').map(Number);
        expect(ww / wh).toBeLessThanOrEqual(8);
        const tall = getWan27SizeFromAspectRatio('1:8', '2k', 4096 * 4096);
        const [tw, th] = tall.split('*').map(Number);
        expect(tw / th).toBeGreaterThanOrEqual(1 / 8);
    });

    test('wan27 unparsable aspect ratio falls back to the target square', () => {
        expect(getWan27SizeFromAspectRatio('abc', '2k', 4096 * 4096)).toBe('2048*2048');
        expect(getWan27SizeFromAspectRatio(undefined, 'normal', 4096 * 4096)).toBe('1024*1024');
    });

    test('wan27 explicit sizes validate pixel budget and ratio bounds', () => {
        expect(resolveSizeForModel('wan2.7-image-pro', { size: '1024x1024' })).toBe('1024*1024');
        expect(() => resolveSizeForModel('wan2.7-image-pro', { size: '100x100' })).toThrow('768*768');
        expect(() => resolveSizeForModel('wan2.7-image-pro', { size: '5000x5000' })).toThrow('4096*4096');
        expect(() => resolveSizeForModel('wan2.7-image', { size: '3000x3000' })).toThrow('2048*2048');
        expect(() => resolveSizeForModel('wan2.7-image', { size: '9000x100' })).toThrow('ratios in [1:8, 8:1]');
    });

    test('aspect-ratio and size parsers reject degenerate input', () => {
        expect(parseAspectRatio('abc')).toBe(null);
        expect(parseAspectRatio('0:5')).toBe(null);
        expect(parseSize('0*5')).toBe(null);
        expect(parseSize('1024x0')).toBe(null);
    });
});

describe('dashscope generate — response and error branches', () => {
    const okFetch = (payload: unknown, imageResponse?: Response) =>
        (async (input: RequestInfo | URL) => {
            if (imageResponse !== undefined && String(input).startsWith('https://img.example')) return imageResponse;
            if (typeof payload === 'string') return new Response(payload, { status: 500 });
            return new Response(JSON.stringify(payload), { status: 200 });
        }) as typeof fetch;

    test('generate rejects reference images on non-wan27 models', async () => {
        const provider = PROVIDERS.dashscope.create({ env: { DASHSCOPE_API_KEY: 'k' } });
        expect(
            await provider
                .generate({ prompt: 'p', model: 'qwen-image-2.0-pro', referenceImages: ['/tmp/a.png'] })
                .catch((e: Error) => e.message),
        ).toContain('Reference images are not supported');
    });

    test('qwenFixed generate warns that quality is ignored and posts the fixed size', async () => {
        const { setDefaultOutputTargets } = await import('@gobing-ai/ts-utils');
        let warned = '';
        const rollback = setDefaultOutputTargets({
            stderr: {
                write: (chunk: string) => {
                    warned += chunk;
                    return chunk.length;
                },
            },
        });
        let body = '';
        try {
            const provider = PROVIDERS.dashscope.create({
                env: { DASHSCOPE_API_KEY: 'k' },
                fetch: (async (_input, init) => {
                    body = String(init?.body);
                    return new Response(JSON.stringify({ output: { result_image: 'AA==' } }), { status: 200 });
                }) as typeof fetch,
            });
            const result = await provider.generate({
                prompt: 'p',
                model: 'qwen-image-max',
                aspectRatio: '4:3',
                quality: 'normal',
            });
            expect(result.extension).toBe('png');
            expect(body).toContain('1472*1104');
        } finally {
            rollback();
        }
        expect(warned).toContain('fixed output sizes');
    });

    test('extract falls back to choices content images and downloads http results', async () => {
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k' },
            fetch: (async (input: RequestInfo | URL) => {
                if (String(input).startsWith('https://img.example')) {
                    return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
                }
                return new Response(
                    JSON.stringify({
                        output: { choices: [{ message: { content: [{ image: 'https://img.example/x.png' }] } }] },
                    }),
                    { status: 200 },
                );
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'qwen-image-2.0-pro' });
        expect([...result.bytes]).toEqual([9, 9, 9]);
    });

    test('failed http download and image-less payloads are loud', async () => {
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k' },
            fetch: okFetch(
                { output: { result_image: 'https://img.example/x.png' } },
                new Response('nope', { status: 404 }),
            ),
        });
        expect(
            await provider.generate({ prompt: 'p', model: 'qwen-image-2.0-pro' }).catch((e: Error) => e.message),
        ).toContain('Failed to download image');
        const empty = PROVIDERS.dashscope.create({ env: { DASHSCOPE_API_KEY: 'k' }, fetch: okFetch({ output: {} }) });
        expect(
            await empty.generate({ prompt: 'p', model: 'qwen-image-2.0-pro' }).catch((e: Error) => e.message),
        ).toContain('No image in response');
    });

    test('base-url override strips trailing slashes and API errors carry the status', async () => {
        let capturedUrl = '';
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k', DASHSCOPE_BASE_URL: 'https://ds.example///' },
            fetch: (async (input) => {
                capturedUrl = String(input);
                return new Response('quota', { status: 429 });
            }) as typeof fetch,
        });
        expect(
            await provider.generate({ prompt: 'p', model: 'qwen-image-2.0-pro' }).catch((e: Error) => e.message),
        ).toContain('DashScope API error (429)');
        expect(capturedUrl).toBe('https://ds.example/api/v1/services/aigc/multimodal-generation/generation');
    });

    test('wan27 generate posts n=1 without prompt_extend; qwen2 posts negative prompt', async () => {
        const bodies: string[] = [];
        const provider = PROVIDERS.dashscope.create({
            env: { DASHSCOPE_API_KEY: 'k' },
            fetch: (async (_input, init) => {
                bodies.push(String(init?.body ?? ''));
                return new Response(JSON.stringify({ output: { result_image: 'AA==' } }), { status: 200 });
            }) as typeof fetch,
        });
        await provider.generate({ prompt: 'p', model: 'wan2.7-image-pro' });
        const wan = JSON.parse(bodies[0]) as { parameters: Record<string, unknown> };
        expect(wan.parameters).toEqual({ size: '2048*2048', n: 1, watermark: false });
        await provider.generate({ prompt: 'p', model: 'qwen-image-2.0-pro', quality: '2k' });
        const qwen = JSON.parse(bodies[1]) as { parameters: Record<string, unknown> };
        expect(qwen.parameters.prompt_extend).toBe(false);
        expect(typeof qwen.parameters.negative_prompt).toBe('string');
        expect(qwen.parameters.watermark).toBe(false);
    });

    test('supportsReferenceImages follows the wan2.7 family only', () => {
        const provider = PROVIDERS.dashscope.create({ env: {} });
        expect(provider.supportsReferenceImages('wan2.7-image')).toBe(true);
        expect(provider.supportsReferenceImages('qwen-image-2.0-pro')).toBe(false);
        expect(provider.defaultModel()).toBe('qwen-image-2.0-pro');
    });
});
