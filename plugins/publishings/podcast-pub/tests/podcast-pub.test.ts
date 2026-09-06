import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import { getPublishTransport, main, PodcastPubTransport, processPublishIO } from '../src/index';
import { mapContentToEpisode, resolveAudioMimeType } from '../src/map';
import { resolveTimeoutMs } from '../src/microfeed-client';

/** A recorded fake-API request. */
interface CapturedRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
}

/** Scripted fake-API response for one matched request. */
interface ScriptedResponse {
    match: (req: { url: string; method: string }) => boolean;
    respond: (req: { url: string; method: string }) => Response;
}

/**
 * Installs a fake fetch that records requests and answers from a scripted
 * routing table. Fully offline — no socket is ever opened.
 */
function installFakeApi(routes: ScriptedResponse[]): { requests: CapturedRequest[]; restore: () => void } {
    const requests: CapturedRequest[] = [];
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
        const captured: CapturedRequest = {
            url: String(input),
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        };
        requests.push(captured);
        const route = routes.find((r) => r.match({ url: captured.url, method: captured.method }));
        if (!route) throw new Error(`fake API has no route for ${captured.method} ${captured.url}`);
        return route.respond({ url: captured.url, method: captured.method });
    }) as typeof fetch);
    return { requests, restore: () => spy.mockRestore() };
}

const VALID_ENV = { MICROFEED_BASE_URL: 'https://feed.example.com', MICROFEED_API_KEY: 'mf_test_key' };

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved: Record<string, string | undefined> = {};
    for (const key of ['MICROFEED_BASE_URL', 'MICROFEED_API_KEY', 'MICROFEED_TIMEOUT_MS']) {
        saved[key] = process.env[key];
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

function episodeContent(metadata: Record<string, unknown> = {}): Content {
    return {
        title: 'Episode 1: Ground Up',
        body: '# Episode 1: Ground Up\n\nShow notes body.',
        format: 'markdown',
        metadata,
    };
}

/** Creates a throwaway local audio file for the two-phase publish test. */
async function makeAudioFile(dir: string, name = 'episode.wav'): Promise<string> {
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    return path;
}

/** Standard two-phase fake-API routing table (happy path, audioFile variant). */
function twoPhaseRoutes(itemId: string): ScriptedResponse[] {
    return [
        {
            match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'),
            respond: () => new Response(JSON.stringify({ id: itemId }), { status: 201 }),
        },
        {
            match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/media_files/presigned_urls'),
            respond: () =>
                new Response(
                    JSON.stringify({
                        presigned_url: `https://feed.example.com/presign/${itemId}`,
                        media_url: `https://media.example.com/media/audio/${itemId}.wav`,
                    }),
                    { status: 201 },
                ),
        },
        {
            match: (r) => r.method === 'PUT' && r.url.includes('/presign/'),
            respond: () => new Response(null, { status: 200 }),
        },
        {
            match: (r) => r.method === 'PUT' && r.url.endsWith(`/api/v1/items/${itemId}`),
            respond: () =>
                new Response(
                    JSON.stringify({
                        id: itemId,
                        url: `https://feed.example.com/items/ep-1-ground-up-${itemId}`,
                        status: 'published',
                    }),
                    { status: 200 },
                ),
        },
    ];
}

/** Two-phase routes with a local cover: presign #1 = audio, #2 = image (sequence-keyed). */
function twoPhaseRoutesWithCover(itemId: string): ScriptedResponse[] {
    let presignCount = 0;
    return [
        {
            match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'),
            respond: () => new Response(JSON.stringify({ id: itemId }), { status: 201 }),
        },
        {
            match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/media_files/presigned_urls'),
            respond: () => {
                presignCount += 1;
                const isImage = presignCount === 2;
                return new Response(
                    JSON.stringify(
                        isImage
                            ? {
                                  presigned_url: `https://feed.example.com/presign/${itemId}-img`,
                                  media_url: `https://media.example.com/media/images/${itemId}.png`,
                              }
                            : {
                                  presigned_url: `https://feed.example.com/presign/${itemId}`,
                                  media_url: `https://media.example.com/media/audio/${itemId}.wav`,
                              },
                    ),
                    { status: 201 },
                );
            },
        },
        {
            match: (r) => r.method === 'PUT' && r.url.includes('/presign/'),
            respond: () => new Response(null, { status: 200 }),
        },
        {
            match: (r) => r.method === 'PUT' && r.url.endsWith(`/api/v1/items/${itemId}`),
            respond: () =>
                new Response(
                    JSON.stringify({
                        id: itemId,
                        url: `https://feed.example.com/items/ep-1-ground-up-${itemId}`,
                        status: 'published',
                    }),
                    { status: 200 },
                ),
        },
    ];
}

describe('podcast-pub mapping', () => {
    test('mapContentToEpisode renders the body to sanitized HTML and drops the duplicate title heading', () => {
        const episode = mapContentToEpisode({
            body: '# Heading Title\n\nNotes with [a link](https://example.com/a).',
            format: 'markdown',
            metadata: { audioUrl: 'https://cdn.example.com/ep1.mp3' },
        } as Content);
        expect(episode.title).toBe('Heading Title');
        expect(episode.contentHtml).toBe(
            '<p>Notes with <a href="https://example.com/a" target="_blank" rel="noopener">a link</a>.</p>',
        );
        expect(episode.status).toBe('published');
        expect(episode.audio).toEqual({ kind: 'url', url: 'https://cdn.example.com/ep1.mp3', mimeType: 'audio/mpeg' });
    });

    test('mapContentToEpisode prefers content.title, carries status and duration', () => {
        const episode = mapContentToEpisode({
            title: 'Explicit Title',
            body: 'Body without a heading.',
            format: 'markdown',
            metadata: { audioFile: '/tmp/ep.wav', status: 'unpublished', durationSeconds: 1262.5 },
        } as Content);
        expect(episode.title).toBe('Explicit Title');
        expect(episode.status).toBe('unpublished');
        expect(episode.durationSeconds).toBe(1262.5);
        expect(episode.audio).toEqual({ kind: 'file', path: '/tmp/ep.wav', mimeType: 'audio/wav' });
    });

    test('mapContentToEpisode rejects a missing title, missing/ambiguous audio, and a bad duration', () => {
        expect(() => mapContentToEpisode({ body: 'No heading.', format: 'markdown' } as Content)).toThrow(
            /title is required/,
        );
        expect(() => mapContentToEpisode({ body: '# T', format: 'markdown' } as Content)).toThrow(
            /audio reference is required/,
        );
        expect(() =>
            mapContentToEpisode({
                body: '# T',
                format: 'markdown',
                metadata: { audioFile: '/a.wav', audioUrl: 'https://x/a.wav' },
            } as Content),
        ).toThrow(/not both/);
        expect(() =>
            mapContentToEpisode({
                body: '# T',
                format: 'markdown',
                metadata: { audioUrl: 'https://x/a.mp3', durationSeconds: -1 },
            } as Content),
        ).toThrow(/durationSeconds/);
    });

    test('resolveAudioMimeType honors metadata.mimeType and falls back per extension', () => {
        expect(resolveAudioMimeType('/a/ep.wav', 'audio/x-custom')).toBe('audio/x-custom');
        expect(resolveAudioMimeType('/a/ep.wav')).toBe('audio/wav');
        expect(resolveAudioMimeType('/a/ep.mp3')).toBe('audio/mpeg');
        expect(resolveAudioMimeType('/a/ep.m4a')).toBe('audio/mp4');
        expect(resolveAudioMimeType('/a/ep.unknown')).toBe('application/octet-stream');
    });

    test('mapContentToEpisode resolves showNotes HTML, image, date, link, and itunes passthrough', () => {
        const episode = mapContentToEpisode({
            title: 'Ep 42',
            body: '# Ep 42\n\nFull article body that is too long for show notes.',
            format: 'markdown',
            metadata: {
                audioUrl: 'https://cdn.example.com/ep42.mp3',
                showNotes: '## 短摘要\n\n一句话总结。',
                coverImage: 'https://surfdash.example.com/assets/cover.png',
                publishedAt: '2026-09-04T08:00:00Z',
                articleUrl: 'https://surfdash.example.com/zh/posts/20260904-ep',
                itunes: { episodeType: 'full', season: 3, episode: 42, explicit: false },
            },
        } as Content);
        expect(episode.contentHtml).toBe('<h2>短摘要</h2>\n<p>一句话总结。</p>');
        expect(episode.imageUrl).toBe('https://surfdash.example.com/assets/cover.png');
        expect(episode.datePublishedMs).toBe(Date.parse('2026-09-04T08:00:00Z'));
        expect(episode.link).toBe('https://surfdash.example.com/zh/posts/20260904-ep');
        expect(episode.itunes).toEqual({ episodeType: 'full', season: 3, episode: 42, explicit: false });
    });

    test('mapContentToEpisode renders markdown showNotes to HTML and passes html-format bodies through', () => {
        const shown = mapContentToEpisode({
            title: 'Ep 42',
            body: '# Ep 42\n\nFull article body.',
            format: 'markdown',
            metadata: {
                audioUrl: 'https://cdn.example.com/ep42.mp3',
                showNotes: '## 短摘要\n\n一句话 **要点** 与 [来源](https://example.com/s)。',
            },
        } as Content);
        expect(shown.contentHtml).toBe(
            '<h2>短摘要</h2>\n<p>一句话 <strong>要点</strong> 与 <a href="https://example.com/s" target="_blank" rel="noopener">来源</a>。</p>',
        );

        const passthrough = mapContentToEpisode({
            title: 'Ep 42',
            body: '<p>Pre-sanitized by the caller.</p>',
            format: 'html',
            metadata: { audioUrl: 'https://cdn.example.com/ep42.mp3' },
        } as Content);
        expect(passthrough.contentHtml).toBe('<p>Pre-sanitized by the caller.</p>');
    });

    test('mapContentToEpisode routes a local cover path to imagePath and rejects a bad episodeType/publishedAt', () => {
        const base = { title: 'Ep', body: 'b', format: 'markdown' } as Content;
        const local = mapContentToEpisode({
            ...base,
            metadata: { audioUrl: 'https://x/a.mp3', coverImage: '/tmp/cover.png' },
        });
        expect(local.imageUrl).toBeUndefined();
        expect(local.imagePath).toBe('/tmp/cover.png');
        expect(() =>
            mapContentToEpisode({
                ...base,
                metadata: { audioUrl: 'https://x/a.mp3', itunes: { episodeType: 'bogus' } },
            }),
        ).toThrow(/episodeType/);
        expect(() =>
            mapContentToEpisode({ ...base, metadata: { audioUrl: 'https://x/a.mp3', publishedAt: 'not-a-date' } }),
        ).toThrow(/publishedAt/);
    });

    test('publishEpisode carries episode extras into the item payload (hosted-audio branch)', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'it-extras' }), { status: 201 }),
                },
            ]);
            try {
                const transport = new PodcastPubTransport();
                const result = await transport.publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        showNotes: 'Summary.',
                        coverImage: 'https://cdn.example.com/cover.png',
                        publishedAt: 1725475200000,
                        articleUrl: 'https://surfdash.example.com/zh/posts/x',
                    }),
                });
                expect(result.ok).toBe(true);
                const body = api.requests[0]?.body as Record<string, unknown>;
                expect(body.image).toBe('https://cdn.example.com/cover.png');
                expect(body.date_published_ms).toBe(1725475200000);
                expect(body.url).toBe('https://surfdash.example.com/zh/posts/x');
                expect(body._microfeed).toEqual({ 'itunes:episodeType': 'full' });
            } finally {
                api.restore();
            }
        });
    });
});

describe('podcast-pub publish (R1/R3)', () => {
    test('two-phase publish: draft → presign(item_id) → PUT bytes → attach + publish', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const audioPath = await makeAudioFile(join(process.cwd(), '.tmp-test-podcast'));
            const api = installFakeApi(twoPhaseRoutes('ITEM01'));
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioFile: audioPath }),
                });

                expect(result.ok).toBe(true);
                expect(result.target).toBe('podcast-pub');
                expect(result.id).toBe('ITEM01');
                expect(result.url).toBe('https://feed.example.com/items/ep-1-ground-up-ITEM01');

                const [create, presign, bytes, finalize] = api.requests;
                expect(create?.method).toBe('POST');
                expect(create?.url).toBe('https://feed.example.com/api/v1/items');
                expect(create?.headers.get('Authorization')).toBe('Bearer mf_test_key');
                expect(create?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
                expect(create?.body).toEqual({
                    title: 'Episode 1: Ground Up',
                    content_html: '<p>Show notes body.</p>',
                    status: 'unpublished',
                });

                expect(presign?.url).toBe('https://feed.example.com/api/v1/media_files/presigned_urls');
                expect(presign?.body).toEqual({
                    category: 'audio',
                    full_local_file_path: audioPath,
                    item_id: 'ITEM01',
                    size: 8,
                    type: 'audio/wav',
                });

                expect(bytes?.method).toBe('PUT');
                expect(bytes?.url).toBe('https://feed.example.com/presign/ITEM01');
                const bytesBody = api.requests[2]?.body;
                expect(bytesBody).toBeInstanceOf(Uint8Array);
                expect((bytesBody as Uint8Array).byteLength).toBe(8);

                expect(finalize?.method).toBe('PUT');
                expect(finalize?.url).toBe('https://feed.example.com/api/v1/items/ITEM01');
                expect(finalize?.body).toEqual({
                    title: 'Episode 1: Ground Up',
                    content_html: '<p>Show notes body.</p>',
                    status: 'published',
                    attachments: [
                        {
                            category: 'audio',
                            url: 'https://media.example.com/media/audio/ITEM01.wav',
                            mime_type: 'audio/wav',
                            size_in_bytes: 8,
                        },
                    ],
                    _microfeed: { 'itunes:episodeType': 'full' },
                });
            } finally {
                api.restore();
                await rm(join(process.cwd(), '.tmp-test-podcast'), { recursive: true, force: true });
            }
        });
    });

    test('local cover uploads via presigned image flow and lands in the final item image field', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const dir = join(process.cwd(), '.tmp-test-podcast-cover');
            const audioPath = await makeAudioFile(dir);
            const coverPath = await makeAudioFile(dir, 'cover.png');
            const api = installFakeApi(twoPhaseRoutesWithCover('ITEM02'));
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioFile: audioPath, coverImage: coverPath }),
                });

                expect(result.ok).toBe(true);
                expect(result.id).toBe('ITEM02');

                // create → audio presign → audio PUT → image presign → image PUT → finalize
                const presigns = api.requests.filter((r) => r.url.endsWith('/media_files/presigned_urls'));
                expect(presigns.length).toBe(2);
                expect(presigns[0]?.body).toEqual({
                    category: 'audio',
                    full_local_file_path: audioPath,
                    item_id: 'ITEM02',
                    size: 8,
                    type: 'audio/wav',
                });
                expect(presigns[1]?.body).toEqual({
                    category: 'image',
                    full_local_file_path: coverPath,
                    size: 8,
                    type: 'image/png',
                });

                const finalize = api.requests[api.requests.length - 1];
                expect(finalize?.method).toBe('PUT');
                const finalizeBody = finalize?.body as Record<string, unknown>;
                expect(finalizeBody.image).toBe('https://media.example.com/media/images/ITEM02.png');
            } finally {
                api.restore();
                await rm(dir, { recursive: true, force: true });
            }
        });
    });

    test('hosted audioUrl publishes in a single create call with the attachment inline', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'HOSTED1' }), { status: 201 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep1.mp3',
                        durationSeconds: 600,
                    }),
                });

                expect(result.ok).toBe(true);
                expect(result.id).toBe('HOSTED1');
                expect(result.url).toBe('https://feed.example.com/items/HOSTED1');
                expect(api.requests[0]?.body).toEqual({
                    title: 'Episode 1: Ground Up',
                    content_html: '<p>Show notes body.</p>',
                    status: 'published',
                    attachments: [
                        {
                            category: 'audio',
                            url: 'https://cdn.example.com/ep1.mp3',
                            mime_type: 'audio/mpeg',
                            duration_in_seconds: 600,
                        },
                    ],
                    _microfeed: { 'itunes:episodeType': 'full' },
                });
            } finally {
                api.restore();
            }
        });
    });
});

describe('podcast-pub management operations (R2/R3)', () => {
    test('list returns the feed items as Result JSON', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'GET' && r.url.endsWith('/api/v1/feed'),
                    respond: () =>
                        new Response(
                            JSON.stringify({
                                version: 'https://jsonfeed.org/version/1.1',
                                items: [{ id: 'A' }, { id: 'B' }],
                            }),
                            { status: 200 },
                        ),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'list' },
                });
                expect(result.ok).toBe(true);
                expect(result.message).toContain('Listed 2');
                const listed = result.metadata?.items;
                expect(listed).toBeInstanceOf(Array);
                expect((listed as unknown[]).length).toBe(2);
            } finally {
                api.restore();
            }
        });
    });

    test('get returns the item and requires options.itemId', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'GET' && r.url.endsWith('/api/v1/items/ITEM01'),
                    respond: () =>
                        new Response(
                            JSON.stringify({
                                version: '1.1',
                                items: [{ id: 'ITEM01', url: 'https://feed.example.com/items/x' }],
                            }),
                            { status: 200 },
                        ),
                },
            ]);
            try {
                const missing = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'get' },
                });
                expect(missing.ok).toBe(false);
                expect(missing.error).toContain('options.itemId is required');

                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'get', itemId: 'ITEM01' },
                });
                expect(result.ok).toBe(true);
                expect(result.id).toBe('ITEM01');
                const item = result.metadata?.item;
                expect((item as { id: string }).id).toBe('ITEM01');
                expect(api.requests.at(-1)?.url).toBe('https://feed.example.com/api/v1/items/ITEM01');
            } finally {
                api.restore();
            }
        });
    });

    test('update PUTs options.item and returns the updated item', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'PUT' && r.url.endsWith('/api/v1/items/ITEM01'),
                    respond: () => new Response(JSON.stringify({ id: 'ITEM01', title: 'Renamed' }), { status: 200 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'update', itemId: 'ITEM01', item: { title: 'Renamed' } },
                });
                expect(result.ok).toBe(true);
                expect(result.message).toContain('Updated');
                expect(api.requests[0]?.body).toEqual({ title: 'Renamed' });

                const noItem = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'update', itemId: 'ITEM01' },
                });
                expect(noItem.ok).toBe(false);
                expect(noItem.error).toContain('options.item');
            } finally {
                api.restore();
            }
        });
    });

    test('delete DELETEs the item with a JSON Content-Type (Astro 7 checkOrigin) and reports success', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'DELETE' && r.url.endsWith('/api/v1/items/ITEM01'),
                    respond: () => new Response(JSON.stringify({}), { status: 200 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'delete', itemId: 'ITEM01' },
                });
                expect(result.ok).toBe(true);
                expect(result.message).toContain('Deleted');
                expect(api.requests[0]?.method).toBe('DELETE');
                expect(api.requests[0]?.headers.get('Content-Type')).toBe('application/json');
            } finally {
                api.restore();
            }
        });
    });

    test('validate posts the mapped item input and reports server acceptance', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items/validate'),
                    respond: () => new Response(JSON.stringify({ valid: true }), { status: 200 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep1.mp3' }),
                    options: { operation: 'validate' },
                });
                expect(result.ok).toBe(true);
                expect(result.message).toContain('validate');
                expect(api.requests[0]?.body).toMatchObject({ title: 'Episode 1: Ground Up', status: 'published' });
            } finally {
                api.restore();
            }
        });
    });

    test('validate surfaces the server rejection as an error Result (R4)', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: () => true,
                    respond: () => new Response(JSON.stringify({ error: 'Invalid item.' }), { status: 400 }),
                },
            ]);
            try {
                const invalid = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'validate', item: { bogus: true } },
                });
                expect(invalid.ok).toBe(false);
                expect(invalid.error).toContain('HTTP 400');
                expect(invalid.error).toContain('Invalid item.');
            } finally {
                api.restore();
            }
        });
    });

    test('an unknown operation fails loud without network', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            let fetchCalled = false;
            const spy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
                fetchCalled = true;
                return new Response('{}', { status: 200 });
            }) as unknown as typeof fetch);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: { operation: 'nuke' },
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('invalid options.operation');
                expect(fetchCalled).toBe(false);
            } finally {
                spy.mockRestore();
            }
        });
    });
});

describe('podcast-pub failure paths (R4/R5)', () => {
    test('an API auth error yields ok:false with a diagnostic and no swallowed error', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                {
                    match: () => true,
                    respond: () => new Response(JSON.stringify({ error: 'Invalid API key.' }), { status: 401 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep1.mp3' }),
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('HTTP 401');
                expect(result.error).toContain('Invalid API key.');
            } finally {
                api.restore();
            }
        });
    });

    test('a network failure yields ok:false with the transport diagnostic', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const spy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
                throw new Error('network down');
            }) as unknown as typeof fetch);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep1.mp3' }),
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('network down');
            } finally {
                spy.mockRestore();
            }
        });
    });

    test('missing credentials fail before any network call', async () => {
        await withEnv({}, async () => {
            const spy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
                throw new Error('fetch must not be called without credentials');
            }) as unknown as typeof fetch);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep1.mp3' }),
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('MICROFEED_BASE_URL');
            } finally {
                spy.mockRestore();
            }
        });
    });

    test('invalid Content is rejected before any network call (R5)', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const spy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
                throw new Error('fetch must not be called for invalid Content');
            }) as unknown as typeof fetch);
            try {
                const noAudio = await new PodcastPubTransport().publish({ content: episodeContent() });
                expect(noAudio.ok).toBe(false);
                expect(noAudio.error).toContain('audio reference is required');

                const noTitle = await new PodcastPubTransport().publish({
                    content: { body: 'No heading.', format: 'markdown' } as Content,
                });
                expect(noTitle.ok).toBe(false);
                expect(noTitle.error).toContain('title is required');
            } finally {
                spy.mockRestore();
            }
        });
    });

    test('resolveTimeoutMs falls back to the 300000 default on missing or bogus values', () => {
        expect(resolveTimeoutMs(undefined)).toBe(300000);
        expect(resolveTimeoutMs('0')).toBe(300000);
        expect(resolveTimeoutMs('nope')).toBe(300000);
        expect(resolveTimeoutMs('5000')).toBe(5000);
    });
});

describe('podcast-pub process IO + CLI (R3/R4/R5)', () => {
    test('processPublishIO runs offline via FakeFileCliTransport and passes input options through', async () => {
        const transport = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-podcast-io');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');

        await writeFile(inPath, JSON.stringify({ ...episodeContent(), options: { operation: 'list' } }), 'utf-8');

        await processPublishIO(inPath, outPath, transport);

        const logs = transport.getCallLogs();
        expect(logs.length).toBe(1);
        expect(logs[0]?.payload.options).toEqual({ operation: 'list' });

        const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(result.ok).toBe(true);
        expect(result.target).toBe('fake-file-cli');

        await rm(tmpDir, { recursive: true, force: true });
    });

    test('processPublishIO writes an error Result and rejects on publish failure', async () => {
        await withEnv({ ...VALID_ENV }, async () => {
            const api = installFakeApi([
                { match: () => true, respond: () => new Response(JSON.stringify({ error: 'nope' }), { status: 500 }) },
            ]);
            const tmpDir = join(process.cwd(), '.tmp-test-podcast-fail');
            await mkdir(tmpDir, { recursive: true });
            const inPath = join(tmpDir, 'in.json');
            const outPath = join(tmpDir, 'out.json');
            await writeFile(
                inPath,
                JSON.stringify(episodeContent({ audioUrl: 'https://cdn.example.com/ep1.mp3' })),
                'utf-8',
            );

            try {
                expect(processPublishIO(inPath, outPath, new PodcastPubTransport())).rejects.toThrow('HTTP 500');
                const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
                expect(result.ok).toBe(false);
                expect(result.error).toContain('HTTP 500');
            } finally {
                api.restore();
                await rm(tmpDir, { recursive: true, force: true });
            }
        });
    });

    test('processPublishIO writes an error Result on invalid input JSON (R5)', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-podcast-validate');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'No Body' }), 'utf-8');

        try {
            expect(processPublishIO(inPath, outPath, new FakeFileCliTransport())).rejects.toThrow(
                'Invalid Content input',
            );
            const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(result.ok).toBe(false);
            expect(result.error).toContain('Invalid Content input');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main CLI: missing args → 1 with stderr, fake transport → 0, API failure → 1 with stderr', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restoreTargets = setDefaultOutputTargets({ stderr: errTarget });
        try {
            process.argv = ['bun', 'index.ts'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restoreTargets();
            process.argv = origArgv;
        }

        const tmpDir = join(process.cwd(), '.tmp-test-podcast-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(episodeContent()), 'utf-8');

        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
            expect(await main()).toBe(0);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }

        const failDir = join(process.cwd(), '.tmp-test-podcast-main-fail');
        await mkdir(failDir, { recursive: true });
        const failIn = join(failDir, 'in.json');
        const failOut = join(failDir, 'out.json');
        await writeFile(failIn, JSON.stringify({ title: 'No audio' }), 'utf-8');

        const restoreTargets2 = setDefaultOutputTargets({ stderr: errTarget });
        try {
            process.argv = ['bun', 'index.ts', '--in', failIn, '--out', failOut];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('podcast-pub failed');
            expect(ResultSchema.parse(JSON.parse(await readFile(failOut, 'utf-8'))).ok).toBe(false);
        } finally {
            restoreTargets2();
            process.argv = origArgv;
            await rm(failDir, { recursive: true, force: true });
        }
    });

    test('discoverable and invocable via runInvoke with podcast-pub plugin discovery', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-podcast-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(episodeContent()), 'utf-8');

        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'podcast-pub',
                inPath,
                outPath,
                pluginsRoot: join(process.cwd(), 'plugins'),
            });
            const result = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(code).toBe(0);
            expect(result.ok).toBe(true);
            expect(result.target).toBe('fake-file-cli');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('getPublishTransport resolves PodcastPubTransport by default and the harness fake when configured', () => {
        expect(getPublishTransport()).toBeInstanceOf(PodcastPubTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });
});
