import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import { docsToContent, main, processGeneratorIO, renderDailyArticle } from '../src/index';

function doc(overrides: Partial<Doc> = {}): Doc {
    return {
        id: 'd1',
        title: 'Sora 2 发布',
        body: 'OpenAI 发布 Sora 应用，集成 Sora 2 模型。',
        sourceUri: 'https://blog.samaltman.com/sora-2',
        mediaType: 'text/markdown',
        metadata: { sourceName: 'Sam Altman：Blog（RSS）', publishedAt: '2026-09-04T17:13:47.000Z' },
        ...overrides,
    };
}

describe('daily-article-gen', () => {
    test('renders each item with an clickable source link and published date', () => {
        const md = renderDailyArticle([doc()], '2026-09-04');
        expect(md).toContain('# 每日 AI 资讯 — 2026-09-04');
        expect(md).toContain('## 1. Sora 2 发布');
        expect(md).toContain('[来源：Sam Altman：Blog（RSS）](https://blog.samaltman.com/sora-2)');
        expect(md).toContain('2026-09-04');
        expect(md).toContain('本期共 1 条新闻');
    });

    test('falls back to hostname labels and numbered headings when metadata is sparse', () => {
        const md = renderDailyArticle(
            [doc({ title: undefined, sourceUri: 'https://www.example.com/x', metadata: undefined })],
            '2026-09-04',
        );
        expect(md).toContain('## 1. 新闻 1');
        expect(md).toContain('[来源：example.com](https://www.example.com/x)');
    });

    test('falls back to 来源 label when sourceUri is not a parseable URL', () => {
        const md = renderDailyArticle([doc({ sourceUri: 'not-a-url', metadata: undefined })], '2026-09-04');
        expect(md).toContain('[来源：来源](not-a-url)');
    });

    test('items without a sourceUri still render without a link line', () => {
        const md = renderDailyArticle([doc({ sourceUri: undefined, metadata: undefined })], '2026-09-04');
        expect(md).toContain('## 1. Sora 2 发布');
        expect(md).not.toContain('[来源');
    });

    test('docsToContent carries references and generator metadata', () => {
        const content: Content = docsToContent([doc()], '2026-09-04');
        expect(content.title).toBe('每日 AI 资讯 — 2026-09-04');
        expect(content.references).toEqual([
            { url: 'https://blog.samaltman.com/sora-2', title: 'Sora 2 发布', cite: 'd1' },
        ]);
        expect(content.metadata).toEqual({
            generator: 'kk:daily-article',
            date: '2026-09-04',
            doc_count: 1,
            tags: ['ai-news'],
        });
    });

    test('metadata.tags leads with ai-news even when no item carries tags', () => {
        const content: Content = docsToContent([doc()], '2026-09-04');
        expect(content.metadata?.tags).toEqual(['ai-news']);
    });

    test('metadata.tags merges existing item tags after ai-news without duplicates', () => {
        const content: Content = docsToContent(
            [doc({ metadata: { tags: ['openai', 'ai-news'] } }), doc({ metadata: { tags: ['video'] } })],
            '2026-09-04',
        );
        expect(content.metadata?.tags).toEqual(['ai-news', 'openai', 'video']);
    });

    test('metadata.tags ignores non-string tag entries instead of clobbering them in', () => {
        const content: Content = docsToContent(
            [doc({ metadata: { tags: ['keep', 'me', 42, null, 'x'] } })],
            '2026-09-04',
        );
        expect(content.metadata?.tags).toEqual(['ai-news', 'keep', 'me', 'x']);
    });

    test('processGeneratorIO reads Doc[] and writes article Content (ARTICLE_DATE=YYYYMMDD)', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-daily-article');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'docs.json');
        const outPath = join(tmpDir, 'content.json');
        await Bun.write(inPath, JSON.stringify([doc()]));
        try {
            process.env.ARTICLE_DATE = '20260904';
            const content = await processGeneratorIO(inPath, outPath);
            expect(content.metadata?.date).toBe('2026-09-04');
            const written = JSON.parse(await Bun.file(outPath).text());
            expect(written.metadata.generator).toBe('kk:daily-article');
        } finally {
            delete process.env.ARTICLE_DATE;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main requires --in/--out and returns 1', async () => {
        expect(await main()).toBe(1);
    });

    test('main writes content and returns 0 on happy path', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-daily-article-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'docs.json');
        const outPath = join(tmpDir, 'out', 'content.json');
        await Bun.write(inPath, JSON.stringify([doc()]));
        try {
            process.argv = ['bun', 'daily-article-gen', '--in', inPath, '--out', outPath];
            expect(await main()).toBe(0);
            expect(JSON.parse(await Bun.file(outPath).text()).metadata.generator).toBe('kk:daily-article');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});
