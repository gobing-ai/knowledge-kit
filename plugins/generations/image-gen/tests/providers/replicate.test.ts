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

describe('replicate input builders — error and boundary branches', () => {
    test('nano-banana resolution from pixel size, with out-of-range rejection', () => {
        expect(
            buildInput({ prompt: 'p', model: 'google/nano-banana-2', width: 512, height: 896, referenceImages: [] })
                .resolution,
        ).toBe('1K');
        expect(
            buildInput({ prompt: 'p', model: 'google/nano-banana-2', width: 1025, height: 1536, referenceImages: [] })
                .resolution,
        ).toBe('2K');
        expect(() =>
            buildInput({ prompt: 'p', model: 'google/nano-banana-2', width: 2049, height: 2049, referenceImages: [] }),
        ).toThrow('1K or 2K');
    });

    test('seedream45 accepts custom within bounds and rejects per-axis overflow', () => {
        const input = buildInput({
            prompt: 'p',
            model: 'bytedance/seedream-4.5',
            width: 1024,
            height: 4096,
            referenceImages: [],
        });
        expect(input.size).toBe('custom');
        expect(buildInput({ prompt: 'p', model: 'bytedance/seedream-4.5', referenceImages: [] }).size).toBe('4K');
        expect(() =>
            buildInput({
                prompt: 'p',
                model: 'bytedance/seedream-4.5',
                width: 1024,
                height: 4097,
                referenceImages: [],
            }),
        ).toThrow('between 1024 and 4096');
    });

    test('seedream5lite maps quality to 2K/3K and validates aspect ratios', () => {
        expect(
            buildInput({ prompt: 'p', model: 'bytedance/seedream-5-lite', quality: 'normal', referenceImages: [] })
                .size,
        ).toBe('2K');
        expect(
            buildInput({ prompt: 'p', model: 'bytedance/seedream-5-lite', aspectRatio: '4:5', referenceImages: [] })
                .aspect_ratio,
        ).toBe('4:5');
        expect(() =>
            buildInput({ prompt: 'p', model: 'bytedance/seedream-5-lite', aspectRatio: '7:5', referenceImages: [] }),
        ).toThrow('does not support aspect ratio 7:5');
    });

    test('wan aspect ratio must be positive W:H', () => {
        expect(() =>
            buildInput({ prompt: 'p', model: 'wan-video/wan-2.7-image', aspectRatio: 'wide', referenceImages: [] }),
        ).toThrow('W:H format, got wide');
        expect(() =>
            buildInput({ prompt: 'p', model: 'wan-video/wan-2.7-image', aspectRatio: '0:9', referenceImages: [] }),
        ).toThrow('W:H format, got 0:9');
    });

    test('wan27 (non-pro) custom size capped at 2048 and defaults from quality', () => {
        expect(() =>
            buildInput({
                prompt: 'p',
                model: 'wan-video/wan-2.7-image',
                width: 2049,
                height: 1024,
                referenceImages: [],
            }),
        ).toThrow('Wan 2.7 Image custom --size');
        expect(
            buildInput({ prompt: 'p', model: 'wan-video/wan-2.7-image', quality: 'normal', referenceImages: [] }).size,
        ).toBe('1K');
        expect(buildInput({ prompt: 'p', model: 'wan-video/wan-2.7-image', referenceImages: ['u'] }).images).toEqual([
            'u',
        ]);
    });
});

describe('replicate output extraction — object forms', () => {
    test('object output with url passes through; malformed shapes throw', () => {
        expect(extractOutputUrl({ status: 'succeeded', output: { url: 'https://x/y.png' }, error: null })).toBe(
            'https://x/y.png',
        );
        expect(() => extractOutputUrl({ status: 'succeeded', output: { url: 42 }, error: null })).toThrow('Unexpected');
        expect(() => extractOutputUrl({ status: 'succeeded', output: [{ nope: 1 }], error: null })).toThrow(
            'Unexpected',
        );
    });
});

describe('replicate provider — version pinning, polling and download errors', () => {
    function jsonRes(payload: unknown): Response {
        return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    test('version-pinned model posts to /v1/predictions with version and honors base-url override', async () => {
        let url = '';
        let version: string | undefined;
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't', REPLICATE_BASE_URL: 'https://relay.example//v1//' },
            // biome-ignore: testing boundary — mocked fetch knows the two request shapes
            fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
                const href = String(input);
                const payload = JSON.parse(String(init?.body ?? '{}')) as { version?: string };
                if (href.includes('/v1/predictions')) {
                    url = href;
                    version = payload.version;
                    return jsonRes({ status: 'succeeded', output: 'https://img.example/out.png', error: null });
                }
                return new Response('bin', { status: 200 });
            }) as unknown as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'a/b:v1' });
        expect(result.extension).toBe('png');
        expect(url).toBe('https://relay.example//v1/v1/predictions');
        expect(version).toBe('v1');
        expect(version?.length).toBeGreaterThan(0);
    });

    test('download failure after succeeded prediction fails loudly', async () => {
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            // biome-ignore: testing boundary — mocked fetch knows the two request shapes
            fetch: (async (input: RequestInfo | URL) =>
                String(input).includes('/v1/models/')
                    ? jsonRes({ status: 'succeeded', output: 'https://img.example/out.png', error: null })
                    : new Response('denied', { status: 404 })) as unknown as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: 'a/b' }).catch((e: Error) => e.message)).toContain(
            'Failed to download image from Replicate: 404',
        );
    });

    test('poll success resolves bytes; canceled surfaces reason', async () => {
        let pollAuth = '';
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            // biome-ignore: testing boundary — mocked fetch knows the two request shapes
            fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
                if (String(input) === 'https://poll') {
                    pollAuth = String(((init?.headers ?? {}) as Record<string, string>).authorization);
                    return jsonRes({ status: 'succeeded', output: 'https://img.example/out.png', error: null });
                }
                return jsonRes({ status: 'starting', output: null, error: null, urls: { get: 'https://poll' } });
            }) as unknown as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'a/b' });
        expect(result.extension).toBe('png');
        expect(pollAuth).toBe('Bearer t');
    });

    test('starting prediction polls again and succeeds after the 2s interval', async () => {
        let polls = 0;
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async (input: RequestInfo | URL) => {
                if (String(input) === 'https://poll') {
                    polls += 1;
                    if (polls === 1) return jsonRes({ status: 'starting', output: null, error: null });
                    return jsonRes({ status: 'succeeded', output: 'https://img.example/out.png', error: null });
                }
                return jsonRes({ status: 'starting', output: null, error: null, urls: { get: 'https://poll' } });
            }) as unknown as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'a/b' });
        expect(polls).toBe(2);
        expect(result.extension).toBe('png');
    });

    test('poll non-ok and canceled predictions throw with detail', async () => {
        const pollErr = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async (input: RequestInfo | URL) =>
                String(input) === 'https://poll'
                    ? new Response('rate limited', { status: 429 })
                    : jsonRes({
                          status: 'starting',
                          output: null,
                          error: null,
                          urls: { get: 'https://poll' },
                      })) as unknown as typeof fetch,
        });
        expect(await pollErr.generate({ prompt: 'p', model: 'a/b' }).catch((e: Error) => e.message)).toContain(
            'Replicate poll error (429)',
        );

        const canceled = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async (input: RequestInfo | URL) =>
                String(input) === 'https://poll'
                    ? jsonRes({ status: 'canceled', output: null, error: null })
                    : jsonRes({
                          status: 'starting',
                          output: null,
                          error: null,
                          urls: { get: 'https://poll' },
                      })) as unknown as typeof fetch,
        });
        expect(await canceled.generate({ prompt: 'p', model: 'a/b' }).catch((e: Error) => e.message)).toContain(
            'prediction canceled',
        );
    });

    test('starting prediction without a poll URL fails loudly', async () => {
        const provider = PROVIDERS.replicate.create({
            env: { REPLICATE_API_TOKEN: 't' },
            fetch: (async () => jsonRes({ status: 'starting', output: null, error: null })) as unknown as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: 'a/b' }).catch((e: Error) => e.message)).toContain(
            'did not return a poll URL',
        );
    });

    test('availability follows REPLICATE_API_TOKEN', () => {
        expect(PROVIDERS.replicate.create({ env: { REPLICATE_API_TOKEN: 't' } }).isAvailable()).toBe(true);
        expect(PROVIDERS.replicate.create({ env: {} }).isAvailable()).toBe(false);
        expect(PROVIDERS.replicate.create({}).defaultModel()).toBe('google/nano-banana-2');
    });
});

describe('replicate input builders — seedream45 refs', () => {
    test('seedream45 with refs and no aspect falls back to match_input_image', () => {
        expect(buildInput({ prompt: 'p', model: 'bytedance/seedream-4.5', referenceImages: ['u'] }).aspect_ratio).toBe(
            'match_input_image',
        );
    });
});
