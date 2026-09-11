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
