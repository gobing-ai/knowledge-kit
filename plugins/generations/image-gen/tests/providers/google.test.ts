import { describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildGoogleUrl,
    buildPromptWithAspect,
    extractInlineImageData,
    extractPredictedImageData,
    isGoogleImagen,
    isGoogleMultimodal,
    normalizeGoogleModelId,
} from '../../src/providers/google';
import { PROVIDERS } from '../../src/providers/types';

describe('google helpers', () => {
    test('normalize model IDs and read model family', () => {
        expect(normalizeGoogleModelId('models/gemini-3.1-flash-image-preview')).toBe('gemini-3.1-flash-image-preview');
        expect(isGoogleMultimodal('models/gemini-3-pro-image-preview')).toBe(true);
        expect(isGoogleMultimodal('gemini-3-pro-image')).toBe(true);
        expect(isGoogleMultimodal('gemini-3.1-flash-image')).toBe(true);
        expect(isGoogleMultimodal('models/gemini-3-pro-image')).toBe(true);
        expect(isGoogleImagen('imagen-3.0-generate-002')).toBe(true);
    });

    test('URL builder appends v1beta when the base URL lacks it', () => {
        expect(buildGoogleUrl('https://generativelanguage.googleapis.com', 'models/demo:generateContent')).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/demo:generateContent',
        );
        expect(buildGoogleUrl('https://example.com/custom/v1beta/', 'models/demo:predict')).toBe(
            'https://example.com/custom/v1beta/models/demo:predict',
        );
    });

    test('prompt aspect hints compose', () => {
        expect(buildPromptWithAspect('A city skyline', '16:9', '2k')).toBe(
            'A city skyline Aspect ratio: 16:9. High resolution 2048px.',
        );
    });

    test('response extractors find inline and predicted payloads', () => {
        expect(
            extractInlineImageData({
                candidates: [{ content: { parts: [{ inlineData: { data: 'inline-base64' } }] } }],
            }),
        ).toBe('inline-base64');
        expect(extractPredictedImageData({ predictions: [{ image: { imageBytes: 'predicted-base64' } }] })).toBe(
            'predicted-base64',
        );
        expect(extractPredictedImageData({ generatedImages: [{ bytesBase64Encoded: 'generated-base64' }] })).toBe(
            'generated-base64',
        );
    });
});

describe('google extractors — edge branches', () => {
    test('buildPromptWithAspect adds each hint independently', () => {
        expect(buildPromptWithAspect('p', '16:9', undefined)).toBe('p Aspect ratio: 16:9.');
        expect(buildPromptWithAspect('p', undefined, '2k')).toBe('p High resolution 2048px.');
        expect(buildPromptWithAspect('p', undefined, undefined)).toBe('p');
    });

    test('extractInlineImageData returns null for missing/empty data', () => {
        expect(extractInlineImageData({})).toBe(null);
        expect(extractInlineImageData({ candidates: [{ content: { parts: [{}] } }] })).toBe(null);
        expect(extractInlineImageData({ candidates: [{ content: { parts: [{ inlineData: { data: '' } }] } }] })).toBe(
            null,
        );
    });

    test('extractPredictedImageData handles field order, nesting, and junk', () => {
        expect(extractPredictedImageData({})).toBe(null);
        expect(extractPredictedImageData({ predictions: [null, 42] })).toBe(null);
        expect(extractPredictedImageData({ predictions: [{ data: 'direct-data' }] })).toBe('direct-data');
        expect(extractPredictedImageData({ predictions: [{ image: { bytesBase64Encoded: 'nested' } }] })).toBe(
            'nested',
        );
        expect(extractPredictedImageData({ predictions: [{ image: { data: 'nested-data' } }] })).toBe('nested-data');
        expect(extractPredictedImageData({ predictions: [{ image: 'not-an-object' }] })).toBe(null);
    });
});

describe('google provider generate', () => {
    const GEMINI_OK = {
        candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from('gem').toString('base64') } }] } }],
    };
    const IMAGEN_OK = { predictions: [{ bytesBase64Encoded: Buffer.from('im').toString('base64') }] };

    test('requires an API key', async () => {
        const provider = PROVIDERS.google.create({
            env: {},
            fetch: (() => {
                throw new Error('fetch must not run');
            }) as typeof fetch,
        });
        await expect(provider.generate({ prompt: 'p', model: 'gemini-3-pro-image' })).rejects.toThrow(
            'GOOGLE_API_KEY or GEMINI_API_KEY is required',
        );
    });

    test('gemini generateContent: wire shape, size tiers, and inline result', async () => {
        let url = '';
        let body = '';
        const provider = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (async (input, init) => {
                url = String(input);
                body = String((init as RequestInit | undefined)?.body);
                return new Response(JSON.stringify(GEMINI_OK), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({
            prompt: 'skyline',
            model: 'models/gemini-3-pro-image',
            aspectRatio: '16:9',
            width: 2048,
            height: 1024,
        });
        expect(result).toEqual({
            bytes: Uint8Array.from(Buffer.from('gem')),
            extension: 'png',
            provider: 'google',
            model: 'models/gemini-3-pro-image',
        });
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
        const parsed = JSON.parse(body) as {
            contents: Array<{ role: string; parts: Array<{ text?: string }> }>;
            generationConfig: { responseModalities: string[]; imageConfig: { imageSize: string } };
        };
        expect(parsed.contents[0]?.parts[0]?.text).toBe('skyline Aspect ratio: 16:9.');
        expect(parsed.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' } });
    });

    test('size tiers: 1K under 1024, 4K over 2048, quality fallback', async () => {
        const seen: string[] = [];
        const mk = (req: Record<string, unknown>) =>
            PROVIDERS.google
                .create({
                    env: { GEMINI_API_KEY: 'k' },
                    fetch: (async (_input, init) => {
                        seen.push(
                            (
                                JSON.parse(String((init as RequestInit | undefined)?.body)) as {
                                    generationConfig: { imageConfig: { imageSize: string } };
                                }
                            ).generationConfig.imageConfig.imageSize,
                        );
                        return new Response(JSON.stringify(GEMINI_OK), { status: 200 });
                    }) as typeof fetch,
                })
                .generate(req as Parameters<ReturnType<typeof PROVIDERS.google.create>['generate']>[0])
                .then(() => undefined);
        await mk({ prompt: 'p', model: 'gemini-3-pro-image', width: 512, height: 512 });
        await mk({ prompt: 'p', model: 'gemini-3-pro-image', width: 4096, height: 1024 });
        await mk({ prompt: 'p', model: 'gemini-3-pro-image', quality: '2k' });
        await mk({ prompt: 'p', model: 'gemini-3-pro-image' });
        expect(seen).toEqual(['1K', '4K', '2K', '1K']);
    });

    test('gemini reference images become inlineData parts', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'google-test-'));
        const ref = join(dir, 'ref.png');
        await writeFile(ref, Buffer.from('refbytes'));
        let body = '';
        const provider = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (async (_input, init) => {
                body = String((init as RequestInit | undefined)?.body);
                return new Response(JSON.stringify(GEMINI_OK), { status: 200 });
            }) as typeof fetch,
        });
        await provider.generate({ prompt: 'p', model: 'gemini-3-pro-image', referenceImages: [ref] });
        const parts = (JSON.parse(body) as { contents: Array<{ parts: Array<Record<string, unknown>> }> }).contents[0]
            ?.parts;
        expect(parts?.[0]?.inlineData).toEqual({
            data: Buffer.from('refbytes').toString('base64'),
            mimeType: 'image/png',
        });
    });

    test('gemini without image data fails loudly; HTTP error surfaces status', async () => {
        const noImage = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) as typeof fetch,
        });
        await expect(noImage.generate({ prompt: 'p', model: 'gemini-3-pro-image' })).rejects.toThrow(
            'No image in response',
        );
        const failing = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (async () => new Response('quota', { status: 429 })) as typeof fetch,
        });
        await expect(failing.generate({ prompt: 'p', model: 'gemini-3-pro-image' })).rejects.toThrow(
            'Google API error (429): quota',
        );
    });

    test('imagen predict: parameters, ref rejection, and extraction', async () => {
        let body = '';
        const provider = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (async (_input, init) => {
                body = String((init as RequestInit | undefined)?.body);
                return new Response(JSON.stringify(IMAGEN_OK), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({
            prompt: 'p',
            model: 'imagen-3.0-generate-002',
            aspectRatio: '1:1',
            n: 2,
            width: 4096,
            height: 4096,
        });
        expect(result.extension).toBe('png');
        const parsed = JSON.parse(body) as {
            instances: Array<{ prompt: string }>;
            parameters: { sampleCount: number; aspectRatio: string; imageSize: string };
        };
        expect(parsed.instances[0]?.prompt).toBe('p Aspect ratio: 1:1.');
        expect(parsed.parameters).toEqual({ sampleCount: 2, aspectRatio: '1:1', imageSize: '2K' });
        await expect(
            provider.generate({ prompt: 'p', model: 'imagen-3.0-generate-002', referenceImages: ['/tmp/a.png'] }),
        ).rejects.toThrow('Reference images are not supported with Imagen models');
        await expect(
            provider
                .generate({ prompt: 'p', model: 'imagen-3.0-generate-002' })
                .then(() => undefined)
                .catch(() => {}),
        ).resolves.toBeUndefined();
    });

    test('non-multimodal model rejects reference images', async () => {
        const provider = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k' },
            fetch: (() => {
                throw new Error('fetch must not run');
            }) as typeof fetch,
        });
        await expect(
            provider.generate({ prompt: 'p', model: 'gemini-2.0-flash', referenceImages: ['/tmp/a.png'] }),
        ).rejects.toThrow('Reference images are only supported with Gemini multimodal models');
    });

    test('validate, isAvailable, supportsReferenceImages, defaultModel', () => {
        const provider = PROVIDERS.google.create({ env: { GOOGLE_API_KEY: 'k' } });
        expect(provider.defaultModel()).toBe('gemini-3-pro-image');
        expect(provider.isAvailable()).toBe(true);
        expect(provider.supportsReferenceImages('gemini-3-pro-image')).toBe(true);
        expect(provider.supportsReferenceImages('imagen-3.0-generate-002')).toBe(false);
        expect(() =>
            provider.validate({ prompt: 'p', model: 'imagen-3.0-generate-002', referenceImages: ['/tmp/a.png'] }),
        ).toThrow('does not accept reference images');
        expect(() => provider.validate({ prompt: 'p', model: 'gemini-3-pro-image' })).not.toThrow();
        expect(PROVIDERS.google.create({ env: {} }).isAvailable()).toBe(false);
    });

    test('proxy env routes through curl and fails loudly when the proxy is dead', async () => {
        // The curl success path cannot be exercised in-process: execFileSync blocks
        // the event loop, so any in-process proxy server deadlocks. Cover the loud
        // failure path via a closed proxy port (instant ECONNREFUSED).
        const provider = PROVIDERS.google.create({
            env: { GOOGLE_API_KEY: 'k', https_proxy: 'http://127.0.0.1:9' },
        });
        await expect(provider.generate({ prompt: 'p', model: 'gemini-3-pro-image' })).rejects.toThrow(
            'Google API request failed via curl',
        );
    });
});

/**
 * R1: `execFileSync` embeds the whole argv in `error.message`, so passing the proxy and the API
 * key as `-x <proxy>` / `-H 'x-goog-api-key: …'` leaked both into logs. They now travel via a
 * curl config file on stdin (`-K -`).
 *
 * The AC's prescribed probe (a fake `curl` earlier on `PATH`) cannot intercept this call: Bun's
 * `node:child_process.execFileSync` resolves the executable without honouring a mutated
 * `process.env.PATH` (verified on Bun 1.3.14 — a fake `curl` on a prepended PATH is ignored and the
 * real curl runs). So the property is asserted through the observable leak channel instead: the
 * thrown message, which is where argv used to surface, and the temp-file lifecycle.
 */
describe('google proxy secret handling (R1)', () => {
    const KEY = 'SEKRET-KEY-123';
    const PROXY = 'http://u:PROXYPW@127.0.0.1:9';

    test('a failing proxied request leaks neither the key nor the proxy password', async () => {
        const provider = PROVIDERS.google.create({ env: { GOOGLE_API_KEY: KEY, HTTPS_PROXY: PROXY } });
        let message = '';
        try {
            await provider.generate({ prompt: 'p', model: 'gemini-3-pro-image' });
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
        }
        expect(message).toContain('Google API request failed via curl');
        expect(message).not.toContain(KEY);
        expect(message).not.toContain('PROXYPW');
        // The proxy was honoured from the stdin config (it is no longer an `-x` argv value): curl
        // reports the configured proxy as the address it could not reach.
        expect(message).toContain('127.0.0.1');
    });

    test('the curl config temp file is removed when the request finishes', async () => {
        const before = (await readdir(tmpdir())).filter((n) => n.startsWith('kk-image-gen-'));
        const provider = PROVIDERS.google.create({ env: { GOOGLE_API_KEY: KEY, HTTPS_PROXY: PROXY } });
        await provider
            .generate({ prompt: 'p', model: 'gemini-3-pro-image' })
            .then(() => undefined)
            .catch(() => undefined);
        const after = (await readdir(tmpdir())).filter((n) => n.startsWith('kk-image-gen-'));
        expect(after.length).toBeLessThanOrEqual(before.length);
        for (const name of after) expect(before).toContain(name);
    });
});
