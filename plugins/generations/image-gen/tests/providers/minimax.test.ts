import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildSubjectReference,
    extractImageFromResponse,
    parsePixelSize,
    requestBody,
} from '../../src/providers/minimax';
import type { ImageRequest } from '../../src/providers/types';
import { PROVIDERS } from '../../src/providers/types';

describe('minimax request building', () => {
    test('parses pixel sizes', () => {
        expect(parsePixelSize('1024x768')).toEqual({ width: 1024, height: 768 });
        expect(parsePixelSize('nope')).toBe(null);
    });

    test('aspect ratio and n constraints', () => {
        expect(requestBody('p', 'image-01', { aspectRatio: '16:9' })).toEqual({
            model: 'image-01',
            prompt: 'p',
            response_format: 'base64',
            aspect_ratio: '16:9',
        });
        expect(() => requestBody('p', 'image-01', { aspectRatio: '5:1' })).toThrow('aspect_ratio');
        expect(() => requestBody('p', 'image-01', { n: 10 })).toThrow('at most 9');
    });

    test('custom size only with image-01 and within bounds', () => {
        expect(() => requestBody('p', 'image-1.x', { width: 1024, height: 1024 })).toThrow('--model image-01');
        expect(() => requestBody('p', 'image-01', { width: 1020, height: 1024 })).toThrow('divisible by 8');
        expect(() => requestBody('p', 'image-01', { width: 512, height: 512 })).not.toThrow();
    });

    test('subject reference reads files and flags >10MB', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'minimax-test-'));
        const small = join(dir, 'ref.png');
        await writeFile(small, Buffer.alloc(10));
        const refs = await buildSubjectReference([small]);
        expect(refs?.[0]?.type).toBe('character');
        expect(refs?.[0]?.image_file.startsWith('data:image/png;base64')).toBe(true);

        const big = join(dir, 'big.png');
        await writeFile(big, Buffer.alloc(10 * 1024 * 1024 + 1));
        await expect(buildSubjectReference([big])).rejects.toThrow('10MB');

        const gif = join(dir, 'ref.gif');
        await writeFile(gif, Buffer.alloc(1));
        await expect(buildSubjectReference([gif])).rejects.toThrow('JPG, JPEG, or PNG');
    });

    test('extract prefers base64, falls back to url download', async () => {
        const b64 = Buffer.from('bytes').toString('base64');
        expect((await extractImageFromResponse({ data: { image_base64: [b64] } })).length).toBe(5);
        const bytes = await extractImageFromResponse(
            { data: { image_urls: ['https://example.invalid/a'] } },
            (async () => new Response('abcdef', { status: 200 })) as typeof fetch,
        );
        expect(bytes.length).toBe(6);
        await expect(
            extractImageFromResponse({ base_resp: { status_code: 1004, status_msg: 'bad key' } }),
        ).rejects.toThrow('bad key');
        await expect(extractImageFromResponse({ data: {} })).rejects.toThrow('No image data');
    });
});

describe('minimax exactSize — the 0182 capability predicate (R4)', () => {
    const provider = PROVIDERS.minimax.create({ env: { MINIMAX_API_KEY: 'k' } });

    test('image-01 reports exact size only inside 512..2048 per edge, divisible by 8', () => {
        // Every shipped canvas that passes the rule (Q&A blast radius: cover, free, xhs-card).
        expect(provider.exactSize?.('image-01', 1080, 1440)).toBe(true);
        expect(provider.exactSize?.('image-01', 1344, 576)).toBe(true);
        expect(provider.exactSize?.('image-01', 1024, 1024)).toBe(true);
        expect(provider.exactSize?.('image-01', 1152, 864)).toBe(true);
        expect(provider.exactSize?.('image-01', 512, 2048)).toBe(true);
        // Out of range or not divisible by 8 → no capability.
        expect(provider.exactSize?.('image-01', 504, 512)).toBe(false);
        expect(provider.exactSize?.('image-01', 2049, 2048)).toBe(false);
        expect(provider.exactSize?.('image-01', 1082, 1440)).toBe(false);
    });

    test('any other model keeps the default: no capability → aspect-only (R4)', () => {
        expect(provider.exactSize?.('image-01-live', 1080, 1440)).toBe(false);
    });

    test('an exact request posts width/height and no aspect_ratio (0182 R1/R5)', async () => {
        let body = '';
        const provider2 = PROVIDERS.minimax.create({
            env: { MINIMAX_API_KEY: 'k' },
            fetch: (async (_input: unknown, init?: RequestInit) => {
                body = String(init?.body);
                const b64 = Buffer.from('img').toString('base64');
                return new Response(JSON.stringify({ data: { image_base64: [b64] } }), { status: 200 });
            }) as typeof fetch,
        });
        await provider2.generate({ prompt: 'p', model: 'image-01', width: 1080, height: 1440 });
        const parsed = JSON.parse(body) as Record<string, unknown>;
        expect(parsed.width).toBe(1080);
        expect(parsed.height).toBe(1440);
        expect(parsed).not.toHaveProperty('aspect_ratio');
    });

    test('a non-image-01 model carries the aspect body, byte-for-byte as before 0182 (R2/R4)', async () => {
        let body = '';
        const provider2 = PROVIDERS.minimax.create({
            env: { MINIMAX_API_KEY: 'k' },
            fetch: (async (_input: unknown, init?: RequestInit) => {
                body = String(init?.body);
                const b64 = Buffer.from('img').toString('base64');
                return new Response(JSON.stringify({ data: { image_base64: [b64] } }), { status: 200 });
            }) as typeof fetch,
        });
        await provider2.generate({ prompt: 'p', model: 'image-01-live', aspectRatio: '3:4' });
        const parsed = JSON.parse(body) as Record<string, unknown>;
        expect(parsed.aspect_ratio).toBe('3:4');
        expect(parsed).not.toHaveProperty('width');
        expect(parsed).not.toHaveProperty('height');
    });
});

describe('minimax provider', () => {
    test('rejects unsupported subject reference extensions via validate', () => {
        const provider = PROVIDERS.minimax.create({ env: { MINIMAX_API_KEY: 'k' } });
        expect(() =>
            provider.validate({ prompt: 'p', model: 'image-01', referenceImages: ['/tmp/a.bmp'] } as ImageRequest),
        ).toThrow('JPG, JPEG, or PNG');
        expect(provider.defaultModel()).toBe('image-01');
    });

    test('generate posts to v1/image_generation and returns jpg', async () => {
        const b64 = Buffer.from('img').toString('base64');
        let captured = '';
        const provider = PROVIDERS.minimax.create({
            env: { MINIMAX_API_KEY: 'k' },
            fetch: (async (input, init) => {
                captured = String(input);
                const headers = (init as RequestInit | undefined)?.headers as Record<string, string> | undefined;
                expect(headers?.authorization).toBe('Bearer k');
                return new Response(JSON.stringify({ data: { image_base64: [b64] } }), { status: 200 });
            }) as typeof fetch,
        });
        const result = await provider.generate({ prompt: 'p', model: 'image-01' });
        expect(result.extension).toBe('jpg');
        expect(result.bytes.length).toBe(3);
        expect(captured).toBe('https://api.minimaxi.com/v1/image_generation');
    });

    test('api error surfaces', async () => {
        const provider = PROVIDERS.minimax.create({
            env: { MINIMAX_API_KEY: 'bad' },
            fetch: (async () => new Response('nope', { status: 401 })) as typeof fetch,
        });
        expect(await provider.generate({ prompt: 'p', model: 'image-01' }).catch((e: Error) => e.message)).toContain(
            '401',
        );
    });
});
