import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type FetchLike, uploadCoverToMicrofeed } from '../src/media-upload';

const temps: string[] = [];

afterEach(() => {
    while (temps.length > 0) {
        const dir = temps.pop();
        if (dir) rmSync(dir, { recursive: true, force: true });
    }
});

describe('uploadCoverToMicrofeed', () => {
    test('requests presigned image upload URL, PUTs raw bytes, and returns remote media_url', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sd-upload-'));
        temps.push(dir);
        const filePath = join(dir, 'cover.png');
        const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        writeFileSync(filePath, pngBytes);

        const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
        const fetchMock: FetchLike = async (input, init) => {
            const url = typeof input === 'string' ? input : input.toString();
            const headers = (init?.headers ?? {}) as Record<string, string>;
            requests.push({ url, method: init?.method ?? 'GET', headers, body: init?.body });
            if (url.endsWith('/api/v1/media_files/presigned_urls')) {
                return new Response(
                    JSON.stringify({
                        presigned_url: 'https://r2.example/upload/item-abc.png?sig=1',
                        media_url: 'https://podcast-media.salty.vip/production/images/item-abc.png',
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } },
                );
            }
            return new Response('', { status: 200 });
        };

        const mediaUrl = await uploadCoverToMicrofeed(filePath, {
            baseUrl: 'https://podcast.salty.vip/',
            apiKey: 'mf-key-123',
            fetchImpl: fetchMock,
        });

        expect(mediaUrl).toBe('https://podcast-media.salty.vip/production/images/item-abc.png');
        expect(requests).toHaveLength(2);
        expect(requests[0]?.url).toBe('https://podcast.salty.vip/api/v1/media_files/presigned_urls');
        expect(requests[0]?.method).toBe('POST');
        expect(requests[0]?.headers.Authorization).toBe('Bearer mf-key-123');
        expect(requests[0]?.headers.Origin).toBe('https://podcast.salty.vip');
        expect(JSON.parse(String(requests[0]?.body))).toEqual({
            category: 'image',
            full_local_file_path: 'cover.png',
            size: pngBytes.byteLength,
            type: 'image/png',
        });
        expect(requests[1]?.url).toBe('https://r2.example/upload/item-abc.png?sig=1');
        expect(requests[1]?.method).toBe('PUT');
        expect(requests[1]?.headers['Content-Type']).toBe('image/png');
    });

    test('fails closed with an actionable error when credentials are missing or presign rejects', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'sd-upload-err-'));
        temps.push(dir);
        const filePath = join(dir, 'cover.webp');
        writeFileSync(filePath, 'webp');

        await expect(uploadCoverToMicrofeed(filePath, { baseUrl: '', apiKey: 'k' })).rejects.toThrow(
            'MICROFEED_BASE_URL',
        );

        await expect(
            uploadCoverToMicrofeed(filePath, { baseUrl: 'https://podcast.salty.vip', apiKey: '' }),
        ).rejects.toThrow('MICROFEED_API_KEY');

        await expect(
            uploadCoverToMicrofeed(filePath, {
                baseUrl: 'https://podcast.salty.vip',
                apiKey: 'k',
                fetchImpl: async () => new Response('unauthorized', { status: 401 }),
            }),
        ).rejects.toThrow('401');

        const jpgPath = join(dir, 'cover.jpg');
        const webpPath = join(dir, 'cover.webp');
        writeFileSync(jpgPath, 'jpg');
        writeFileSync(webpPath, 'webp');

        await expect(
            uploadCoverToMicrofeed(jpgPath, {
                baseUrl: 'https://podcast.salty.vip',
                apiKey: 'k',
                fetchImpl: async () =>
                    new Response(JSON.stringify({ presigned_url: 'https://r2/u', media_url: 'http://bad/x.jpg' }), {
                        status: 200,
                    }),
            }),
        ).rejects.toThrow('incomplete media_url');

        await expect(
            uploadCoverToMicrofeed(webpPath, {
                baseUrl: 'https://podcast.salty.vip',
                apiKey: 'k',
                fetchImpl: async (input) => {
                    const u = typeof input === 'string' ? input : input.toString();
                    if (u.includes('presigned_urls')) {
                        return new Response(
                            JSON.stringify({
                                presigned_url: 'https://r2.example/put',
                                media_url: 'https://podcast-media.salty.vip/production/images/x.webp',
                            }),
                            { status: 200 },
                        );
                    }
                    return {
                        ok: false,
                        status: 500,
                        text: async () => {
                            throw new Error('stream closed');
                        },
                    } as unknown as Response;
                },
            }),
        ).rejects.toThrow('PUT upload failed (500)');
    });
});
