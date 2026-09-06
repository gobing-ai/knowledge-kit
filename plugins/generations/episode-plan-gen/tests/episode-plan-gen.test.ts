import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import {
    cleanBody,
    docsToContent,
    main,
    normalizeUrl,
    planEpisode,
    planScore,
    processGeneratorIO,
    titleSimilarity,
} from '../src/index';

function doc(overrides: Partial<Doc> = {}): Doc {
    return {
        id: 'd1',
        title: 'Sora 2 发布',
        body: 'OpenAI 发布 Sora 应用，集成 Sora 2 模型。',
        sourceUri: 'https://blog.samaltman.com/sora-2',
        mediaType: 'text/markdown',
        metadata: { source: 'aihot', sourceName: 'Sam Altman Blog', publishedAt: '2026-09-04T17:13:47.000Z' },
        ...overrides,
    };
}

describe('episode-plan-gen', () => {
    test('normalizeUrl drops query, fragment, trailing slash, and www/amp prefixes', () => {
        expect(normalizeUrl('https://www.example.com/a/?utm=1#x')).toBe('https://example.com/a');
        expect(normalizeUrl('https://amp.example.com/a/')).toBe('https://example.com/a');
        expect(normalizeUrl('not-a-url')).toBeNull();
        expect(normalizeUrl(undefined)).toBeNull();
    });

    test('cleanBody strips star ratings and markdown heading-link copies', () => {
        const body = '### [Some Title](https://x.com/y) ⭐️ 8.0/10\n由 Syd…\n\n\n\nnext para';
        const cleaned = cleanBody(body);
        expect(cleaned).not.toContain('⭐️');
        expect(cleaned).not.toContain('### [Some Title]');
        expect(cleaned).toContain('由 Syd…');
        expect(cleaned).not.toMatch(/\n{3,}/);
    });

    test('titleSimilarity: identical titles ~1, unrelated ~0', () => {
        expect(titleSimilarity('OpenAI releases Sora 2 app', 'OpenAI releases Sora 2 app')).toBe(1);
        expect(titleSimilarity('Local LLM quantization guide', 'EU passes AI act amendment')).toBeLessThan(0.2);
    });

    test('aihot source weight outranks equal-evidence lower sources', () => {
        const aihot = planScore(doc());
        const hn = planScore(
            doc({ metadata: { source: 'hackernews', relevance_score: 0.5, engagement: { points: 300 } } }),
        );
        expect(aihot).toBeGreaterThan(hn);
    });

    test('planScore normalizes last30days 0..1 relevance and horizon 0..10 score', () => {
        const last30 = planScore(doc({ metadata: { source: 'hackernews', relevance_score: '0.7666' } }));
        const horizon = planScore(doc({ metadata: { source: 'rss', score: 7 } }));
        expect(last30).toBeGreaterThan(10);
        expect(horizon).toBeGreaterThan(12);
    });

    test('URL dedup keeps the higher-scoring doc and records mergedFrom', () => {
        const weak = doc({ id: 'w', metadata: { source: 'reddit', score: 3 } });
        const strong = doc({
            id: 's',
            title: 'Sora 2 application launch',
            sourceUri: 'https://blog.samaltman.com/sora-2?utm=x',
            metadata: { source: 'aihot' },
        });
        const plan = planEpisode([weak, strong], { maxItems: 10 });
        expect(plan).toHaveLength(1);
        expect(plan[0]?.id).toBe('s');
        const merged = plan[0]?.metadata?.mergedFrom as { id?: string }[];
        expect(merged?.length).toBe(1);
    });

    test('title-bigram dedup merges similar stories across different URLs', () => {
        const a = doc({
            id: 'a',
            title: 'OpenAI launches Sora 2 video app',
            metadata: { source: 'hackernews', relevance_score: 0.8 },
        });
        const b = doc({
            id: 'b',
            title: 'OpenAI launches Sora 2 video app for creators',
            sourceUri: 'https://techcrunch.com/sora-2',
            metadata: { source: 'rss' },
        });
        const plan = planEpisode([a, b], { maxItems: 10 });
        expect(plan).toHaveLength(1);
        expect(plan[0]?.id).toBe('a');
    });

    test('freshness gate drops items published before the 7-day window', () => {
        const plan = planEpisode(
            [
                doc({ metadata: { source: 'aihot', publishedAt: '2020-06-19T17:39:12.000Z' } }),
                doc({ id: 'fresh', sourceUri: 'https://x.com/1', metadata: { source: 'hackernews' } }),
            ],
            { maxItems: 5, date: '2026-09-06' },
        );
        expect(plan.map((d) => d.id)).toEqual(['fresh']);
    });

    test('freshness gate keeps aihot items dated inside the window and passes dated last30days items', () => {
        const plan = planEpisode(
            [
                doc({
                    id: 'recent',
                    sourceUri: 'https://x.com/1',
                    metadata: { source: 'aihot', publishedAt: '2026-09-04T00:00:00.000Z' },
                }),
                doc({
                    id: 'dated',
                    title: 'Hacker News 上的独立 AI 项目盘点',
                    sourceUri: 'https://x.com/2',
                    metadata: { source: 'hackernews', date: '2026-09-06' },
                }),
            ],
            { maxItems: 5, date: '2026-09-06' },
        );
        expect(plan.map((d) => d.id).sort()).toEqual(['dated', 'recent']);
    });

    test('non-news tag gate drops geopolitics items (horizon finance-news)', () => {
        const plan = planEpisode(
            [
                doc({
                    id: 'geo',
                    title: 'U.S. strikes Iranian oil tankers',
                    sourceUri: 'https://news.google.com/x',
                    metadata: { source: 'rss', date: '2026-09-06', tags: ['geopolitics', 'oil-markets'] },
                }),
                doc({
                    id: 'ai',
                    sourceUri: 'https://x.com/1',
                    metadata: { source: 'rss', date: '2026-09-06', tags: ['GPT-6'] },
                }),
            ],
            { maxItems: 5, date: '2026-09-06' },
        );
        expect(plan.map((d) => d.id)).toEqual(['ai']);
    });

    test('per-source cap limits one feed to 5 slots', () => {
        const docs = [1, 2, 3, 4, 5, 6, 7].map((n) =>
            doc({
                id: `flood${n}`,
                title: [
                    'Sora 应用发布',
                    'GPT-6 Astra 上线',
                    'Rust vtables 图解',
                    'Claude 5 发布',
                    'Llama 5 开源',
                    'Gemini 3 上线',
                    'Mistral 融资',
                ][n - 1],
                sourceUri: `https://flood.example.com/${n}`,
                metadata: { source: 'aihot', publishedAt: '2026-09-05T00:00:00.000Z' },
            }),
        );
        const plan = planEpisode(docs, { maxItems: 10, date: '2026-09-06' });
        expect(plan).toHaveLength(5);
    });
    test('maxItems truncates and preserves score order', () => {
        const docs = [1, 2, 3, 4, 5].map((n) =>
            doc({
                id: `d${n}`,
                title: [
                    'Anthropic 发布 Claude 5',
                    '欧盟通过 AI 法案修正案',
                    '谷歌 Gemini 3 上线',
                    '微软开源 MarkItDown',
                    'Meta 发布 Llama 5',
                ][n - 1],
                sourceUri: `https://x.com/${n}`,
                metadata: { source: 'hackernews', relevance_score: n / 10 },
            }),
        );
        const plan = planEpisode(docs, { maxItems: 3 });
        expect(plan).toHaveLength(3);
        expect(plan[0]?.id).toBe('d5');
    });

    test('flags English-titled items with needsTranslation', () => {
        const plan = planEpisode(
            [
                doc({
                    title: 'Corporate America is getting hooked on open-source AI',
                    metadata: { source: 'hackernews' },
                }),
            ],
            { maxItems: 5 },
        );
        expect(plan[0]?.metadata?.needsTranslation).toBe(true);
        expect(doc().metadata?.needsTranslation).toBeUndefined();
    });

    test('docsToContent embeds planned docs in metadata.docs and renders the plan body', async () => {
        const content: Content = docsToContent([doc()], '2026-09-05');
        expect(content.title).toBe('每日 AI 播客选稿计划 — 2026-09-05');
        const docsOut = content.metadata?.docs as Doc[] | undefined;
        expect(docsOut?.length).toBe(1);
        expect(docsOut?.[0]?.metadata?.planScore).toBeDefined();
        expect(content.body).toContain('## 1. Sora 2 发布');
        expect(content.body).toContain('本期共 1 条');
    });

    test('processGeneratorIO reads Doc[] and writes plan Content with env max items', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'blended.json');
        const outPath = join(tmpDir, 'content.json');
        await Bun.write(
            inPath,
            JSON.stringify(
                [1, 2, 3].map((n) =>
                    doc({
                        id: `d${n}`,
                        title: ['Anthropic 发布 Claude 5', '欧盟通过 AI 法案修正案', '谷歌 Gemini 3 正式上线'][n - 1],
                        sourceUri: `https://x.com/${n}`,
                    }),
                ),
            ),
        );
        const prev = process.env.EPISODE_PLAN_MAX_ITEMS;
        process.env.EPISODE_PLAN_MAX_ITEMS = '2';
        try {
            await processGeneratorIO(inPath, outPath);
            const out = (await Bun.file(outPath).json()) as Content;
            expect((out.metadata?.docs as Doc[] | undefined)?.length).toBe(2);
        } finally {
            if (prev === undefined) delete process.env.EPISODE_PLAN_MAX_ITEMS;
            else process.env.EPISODE_PLAN_MAX_ITEMS = prev;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main rejects missing arguments', async () => {
        expect(await main()).toBe(1);
    });
});
