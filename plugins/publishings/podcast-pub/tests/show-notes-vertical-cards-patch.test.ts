import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { PodcastPubTransport } from '../src/index';
import { renderShowNotesHtml, TIMELINE_STYLE } from '../src/show-notes';
import {
    ARTICLE_PLACEHOLDER,
    CARDS_STYLE,
    planCards,
    renderBriefShowNotes,
    stripArticlePlaceholderHtml,
    upsertArticleLinkHtml,
} from '../src/show-notes-brief';

let restoreOutputTargets: (() => void) | undefined;
beforeEach(() => {
    restoreOutputTargets = setDefaultOutputTargets({ stderr: createBufferTarget() });
});
afterEach(() => {
    restoreOutputTargets?.();
    restoreOutputTargets = undefined;
});

const VALID_ENV = { MICROFEED_BASE_URL: 'https://feed.example.com', MICROFEED_API_KEY: 'mf_test_key' };

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const keys = ['MICROFEED_BASE_URL', 'MICROFEED_API_KEY', 'PODCAST_PUB_SEO'];
    const saved: Record<string, string | undefined> = {};
    for (const key of keys) {
        saved[key] = process.env[key];
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

interface CapturedRequest {
    url: string;
    method: string;
    body: unknown;
}

function installFakeApi(
    routes: Array<{
        match: (req: { url: string; method: string }) => boolean;
        respond: (req: { url: string; method: string; body: unknown }) => Response;
    }>,
): { requests: CapturedRequest[]; restore: () => void } {
    const requests: CapturedRequest[] = [];
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
        const parsedBody =
            typeof init?.body === 'string'
                ? (() => {
                      try {
                          return JSON.parse(init.body);
                      } catch {
                          return init.body;
                      }
                  })()
                : init?.body;
        const captured: CapturedRequest = {
            url: String(input),
            method: init?.method ?? 'GET',
            body: parsedBody,
        };
        requests.push(captured);
        const route = routes.find((r) => r.match({ url: captured.url, method: captured.method }));
        if (!route) throw new Error(`fake API has no route for ${captured.method} ${captured.url}`);
        return route.respond({ url: captured.url, method: captured.method, body: parsedBody });
    }) as typeof fetch);
    return { requests, restore: () => spy.mockRestore() };
}

function doc(over: Partial<Doc> = {}): Doc {
    return {
        id: 'x:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        title: 'Meta 评估 2030 净零目标',
        body: 'AI 数据中心用电推高排放增幅。第二句。',
        sourceUri: 'https://arstechnica.com/story',
        mediaType: 'text/markdown',
        metadata: { brief: 'AI 数据中心用电推高排放增幅。', sourceName: 'arstechnica.com' },
        ...over,
    } as Doc;
}

describe('vertical timeline layout & non-http source round-trip', () => {
    test('renderBriefShowNotes emits vertical axis TIMELINE_STYLE with theme tokens after .kk-tl', () => {
        const { markdown } = renderBriefShowNotes({
            docs: [doc(), doc({ id: 'y:b', title: '第二条' })],
            audioSegments: [
                { duration: 15, transcription: '开场' },
                { duration: 40, transcription: 'Meta 评估 2030 净零目标' },
                { duration: 30, transcription: '第二条' },
            ],
        });
        expect(markdown).toContain(TIMELINE_STYLE);
        expect(TIMELINE_STYLE).toContain('border-left:');
        expect(TIMELINE_STYLE).toContain('.kk-tl-body::before');
        expect(TIMELINE_STYLE).toContain('text-align:right');
        expect(TIMELINE_STYLE).toContain('--mf-accent');
        expect(TIMELINE_STYLE).toContain('--mf-border');
        expect(TIMELINE_STYLE).toContain('--mf-background');
        expect(markdown.indexOf('<style>')).toBeGreaterThan(markdown.indexOf('</div>'));

        const html = renderShowNotesHtml(markdown);
        expect(html).toContain(TIMELINE_STYLE);
        expect(html).not.toContain('&lt;style');
    });

    test('non-http sourceUri keeps <span class="kk-tl-src"> intact through renderShowNotesHtml', () => {
        const { markdown } = renderBriefShowNotes({
            docs: [doc({ sourceUri: 'javascript:alert(1)' })],
        });
        const html = renderShowNotesHtml(markdown);
        expect(html).toContain('<div class="kk-tl">');
        expect(html).toContain('<span class="kk-tl-src">来源：arstechnica.com</span>');
        expect(html).not.toContain('&lt;div class="kk-tl"&gt;');
        expect(html).not.toContain('javascript:');
    });
});

describe('article placeholder stripping & idempotent link patching', () => {
    test('stripArticlePlaceholderHtml drops 待文章发布回执 while keeping timeline and cards', () => {
        const { markdown } = renderBriefShowNotes({
            docs: [doc()],
            cards: {
                cards: [{ index: 1, copy: '卡片一', status: 'rendered', url: 'https://cdn.example/c1.png' }],
            },
        });
        const html = renderShowNotesHtml(markdown);
        expect(html).toContain(ARTICLE_PLACEHOLDER);
        const stripped = stripArticlePlaceholderHtml(html);
        expect(stripped).not.toContain('待文章发布回执');
        expect(stripped).toContain('<div class="kk-tl">');
        expect(stripped).toContain('<div class="kk-cards">');
    });

    test('upsertArticleLinkHtml replaces placeholder, inserts before cards when stripped, and is idempotent', () => {
        const url = 'https://surfing.salty.vip/zh/posts/20261121-meta-2030';
        const withPlaceholder = `<div class="kk-tl"></div>\n${TIMELINE_STYLE}\n${ARTICLE_PLACEHOLDER}\n${CARDS_STYLE}\n<div class="kk-cards"></div>`;
        const replaced = upsertArticleLinkHtml(withPlaceholder, url);
        expect(replaced.changed).toBe(true);
        expect(replaced.html).not.toContain('待文章发布回执');
        expect(replaced.html).toContain(`<a href="${url}"`);
        expect(replaced.html.indexOf('完整图文版')).toBeLessThan(replaced.html.indexOf('kk-cards'));

        const noPlaceholderWithCards = stripArticlePlaceholderHtml(withPlaceholder);
        const inserted = upsertArticleLinkHtml(noPlaceholderWithCards, url);
        expect(inserted.changed).toBe(true);
        expect(inserted.html).toContain(`<a href="${url}"`);
        expect(inserted.html.indexOf('完整图文版')).toBeLessThan(inserted.html.indexOf('kk-cards'));

        const second = upsertArticleLinkHtml(inserted.html, url);
        expect(second.changed).toBe(false);
        expect(second.html).toBe(inserted.html);

        const noCards = '<div class="kk-tl"></div>';
        const appended = upsertArticleLinkHtml(noCards, url);
        expect(appended.changed).toBe(true);
        expect(appended.html).toContain(`<a href="${url}"`);
    });
});

describe('card PNG upload in publishEpisode & fail-soft degradation', () => {
    test('planCards retains rendered imagePath and publishEpisode uploads cards to microfeed R2', async () => {
        const dir = join(process.cwd(), '.works/tmp/test-podcast-cards-r2');
        await mkdir(dir, { recursive: true });
        const mp3 = join(dir, 'ep.mp3');
        const c1 = join(dir, 'card-01.png');
        const c2 = join(dir, 'card-02.png');
        await writeFile(mp3, new Uint8Array([1, 2, 3, 4]));
        await writeFile(c1, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]));
        await writeFile(c2, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]));

        const cardsManifest = {
            cards: [
                { index: '01', copy: '第一张卡片', status: 'rendered', imagePath: c1 },
                { index: '02', copy: '第二张卡片失败', status: 'rendered', imagePath: c2 },
                { index: '03', copy: '第三张未渲染', status: 'pending', imagePath: join(dir, 'missing.png') },
            ],
        };
        const planned = planCards(cardsManifest);
        expect(planned.cards[0]?.imagePath).toBe(c1);

        const { markdown } = renderBriefShowNotes({
            docs: [doc()],
            cards: cardsManifest,
        });

        let putHtml = '';
        let imageUploads = 0;
        const api = installFakeApi([
            {
                match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/items'),
                respond: () => new Response(JSON.stringify({ id: 'ITEM_CARDS' }), { status: 201 }),
            },
            {
                match: (r) => r.method === 'POST' && r.url.endsWith('/api/v1/media_files/presigned_urls'),
                respond: ({ body }) => {
                    const req = body as { category?: string; full_local_file_path?: string };
                    if (req.category === 'image') {
                        imageUploads += 1;
                        if (String(req.full_local_file_path).includes('card-02')) {
                            return new Response(JSON.stringify({ error: 'upload rejected' }), { status: 500 });
                        }
                        return new Response(
                            JSON.stringify({
                                presigned_url: 'https://feed.example.com/presign/card-01',
                                media_url: 'https://podcast-media.example.test/cards/card-01.png',
                            }),
                            { status: 201 },
                        );
                    }
                    return new Response(
                        JSON.stringify({
                            presigned_url: 'https://feed.example.com/presign/audio',
                            media_url: 'https://podcast-media.example.test/audio/ep.mp3',
                        }),
                        { status: 201 },
                    );
                },
            },
            {
                match: (r) => r.method === 'PUT' && r.url.includes('/presign/'),
                respond: () => new Response(null, { status: 200 }),
            },
            {
                match: (r) => r.method === 'PUT' && r.url.endsWith('/api/v1/items/ITEM_CARDS'),
                respond: ({ body }) => {
                    putHtml = String((body as { content_html?: string }).content_html ?? '');
                    return new Response(
                        JSON.stringify({
                            id: 'ITEM_CARDS',
                            url: 'https://feed.example.com/i/test/',
                            status: 'published',
                        }),
                        { status: 200 },
                    );
                },
            },
        ]);

        try {
            const result = await withEnv({ ...VALID_ENV, PODCAST_PUB_SEO: 'false' }, async () =>
                new PodcastPubTransport().publish({
                    content: {
                        title: '第261121期 · 测试',
                        body: markdown,
                        format: 'markdown',
                        metadata: {
                            audioFile: mp3,
                            showNotes: markdown,
                            podcast: { cards: cardsManifest.cards },
                        },
                    },
                }),
            );
            expect(result.ok).toBe(true);
            expect(imageUploads).toBe(2);
            // Card 1 gets an <img> with hosted R2 URL; Card 2/3 degrade to caption-only; placeholder is stripped.
            expect(putHtml).toContain('<img src="https://podcast-media.example.test/cards/card-01.png"');
            expect(putHtml.match(/<img /g)?.length).toBe(1);
            expect(putHtml).toContain('第二张卡片失败');
            expect(putHtml).not.toContain('待文章发布回执');
            const warnings = (result.metadata?.warnings ?? []) as string[];
            expect(warnings.some((w) => w.includes('card 2'))).toBe(true);
        } finally {
            api.restore();
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('patch-article-link operation', () => {
    test('patches existing item content_html idempotently without wiping attachments/status', async () => {
        let currentHtml = `<div class="kk-tl"></div>\n${TIMELINE_STYLE}\n${CARDS_STYLE}\n<div class="kk-cards"></div>`;
        let putCount = 0;
        let lastPutBody: Record<string, unknown> | undefined;
        const api = installFakeApi([
            {
                match: (r) => r.method === 'GET' && r.url.endsWith('/api/v1/items/EP1'),
                respond: () =>
                    new Response(
                        JSON.stringify({
                            items: [{ id: 'EP1', url: 'https://feed.example.com/i/ep1/', content_html: currentHtml }],
                        }),
                        { status: 200 },
                    ),
            },
            {
                match: (r) => r.method === 'PUT' && r.url.endsWith('/api/v1/items/EP1'),
                respond: ({ body }) => {
                    putCount += 1;
                    lastPutBody = body as Record<string, unknown>;
                    currentHtml = String(lastPutBody.content_html ?? '');
                    return new Response(
                        JSON.stringify({
                            id: 'EP1',
                            url: 'https://feed.example.com/i/ep1/',
                            content_html: currentHtml,
                        }),
                        { status: 200 },
                    );
                },
            },
        ]);

        try {
            const payload = {
                title: 't',
                body: 'b',
                format: 'markdown' as const,
            };
            const first = await withEnv(VALID_ENV, () =>
                new PodcastPubTransport().publish({
                    content: payload,
                    options: {
                        operation: 'patch-article-link',
                        itemId: 'EP1',
                        postPath: '/srv/surfdash/content/posts/articles/zh/20261121-261121-meta-2030/index.md',
                    },
                }),
            );
            expect(first.ok).toBe(true);
            expect(putCount).toBe(1);
            expect(Object.keys(lastPutBody ?? {})).toEqual(['content_html']);
            expect(currentHtml).toContain('https://surfing.salty.vip/zh/posts/20261121-261121-meta-2030');
            expect(first.metadata?.changed).toBe(true);

            // Second call is a no-op (no PUT).
            const second = await withEnv(VALID_ENV, () =>
                new PodcastPubTransport().publish({
                    content: payload,
                    options: {
                        operation: 'patch-article-link',
                        itemId: 'EP1',
                        postPath: '/srv/surfdash/content/posts/articles/zh/20261121-261121-meta-2030/index.md',
                    },
                }),
            );
            expect(second.ok).toBe(true);
            expect(second.metadata?.changed).toBe(false);
            expect(putCount).toBe(1);

            // Fails loud when neither articleUrl nor postPath is provided.
            const invalid = await withEnv(VALID_ENV, () =>
                new PodcastPubTransport().publish({
                    content: payload,
                    options: { operation: 'patch-article-link', itemId: 'EP1' },
                }),
            );
            expect(invalid.ok).toBe(false);
            expect(invalid.error).toContain('articleUrl');
        } finally {
            api.restore();
        }
    });
});
