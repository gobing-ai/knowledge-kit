import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import {
    docsToContent,
    excludedIdsFromNote,
    main,
    processGeneratorIO,
    renderDailyArticle,
    stripScaffold,
} from '../src/index';

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

describe('daily-article-gen scaffold strip (0138 R4b)', () => {
    // Fixture lines are the 2026-09-16 run's translated item 5 — the item that leaked both the
    // doubled 「可做角度」 label and the 「为什么现在值得注意」 heading into published copy.
    const scaffolded = [
        'Google 发布了两款语音到语音模型 Gemini 3.8 Live 与 Gemini 3.8 Live Extended Thinking。',
        '**「为什么现在值得注意」** 这是 Google 在实时语音到语音方向的一次模型更新。',
        '**「可做角度」** 可做角度：从 Simon Willison 这个零依赖、单 HTML 文件的浏览器实现切入。',
    ].join('\n');

    test('drops label headings and collapses inline label prefixes to their prose', () => {
        const out = stripScaffold(scaffolded);
        expect(out).not.toContain('可做角度');
        expect(out).not.toContain('为什么现在值得注意');
        expect(out).toContain('这是 Google 在实时语音到语音方向的一次模型更新。');
        expect(out).toContain('从 Simon Willison 这个零依赖、单 HTML 文件的浏览器实现切入。');
    });

    test('collapses the doubled 「可做角度」 label to prose', () => {
        expect(stripScaffold('**「可做角度」** 可做角度：从浏览器实现切入。')).toBe('从浏览器实现切入。');
    });

    test('drops a standalone scaffold heading in any shape', () => {
        expect(stripScaffold('第一段。\n### 背景\n第二段。')).toBe('第一段。\n第二段。');
        expect(stripScaffold('第一段。\n**「社区讨论」**\n第二段。')).toBe('第一段。\n第二段。');
    });

    test('removes hedging sentences and keeps the factual ones on the same line', () => {
        expect(stripScaffold('Google 发布了 Gemini 3.8 Live。原始博客未能获取，读者宜另行核实具体版本号。')).toBe(
            'Google 发布了 Gemini 3.8 Live。',
        );
        expect(stripScaffold('读者宜另行核实')).toBe('');
    });

    test('a clean body passes through byte-identical', () => {
        const clean = 'OpenAI 发布 Sora 应用，集成 Sora 2 模型。\n\n  模型支持文生视频。';
        expect(stripScaffold(clean)).toBe(clean);
    });

    test('renderDailyArticle applies the strip to every item body', () => {
        const md = renderDailyArticle([doc({ body: scaffolded })], '2026-09-16');
        expect(md).not.toContain('可做角度');
        expect(md).not.toContain('为什么现在值得注意');
        expect(md).toContain('从 Simon Willison 这个零依赖');
    });
});

describe('daily-article-gen', () => {
    test('renders each item with an clickable source link and published date', () => {
        const md = renderDailyArticle([doc()], '2026-09-04');
        expect(md).toContain('# 每日AI乱炖 · 2026-09-04');
        expect(md).toContain('这里是由Robin为你带来的咸话咸说之每日AI乱炖');
        expect(md).toContain('## 1. Sora 2 发布');
        expect(md).toContain('[来源：Sam Altman：Blog（RSS）](https://blog.samaltman.com/sora-2)');
        expect(md).toContain('2026-09-04');
        expect(md).toContain('本期共 1 条内容，均附可点击来源链接');
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
        expect(content.title).toBe('每日AI乱炖 · 2026-09-04');
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

    test('docsToContent strips an agent-written leading H1 from the body override (0189 R4)', () => {
        const content: Content = docsToContent([doc()], '2026-09-29', '# 我自己的标题\n\n正文第一段。');
        expect(content.body.startsWith('# 每日AI乱炖 · 2026-09-29')).toBe(true);
        expect(content.body).not.toContain('我自己的标题');
        expect(content.body).toContain('正文第一段。');
    });

    test('docsToContent keeps a leading H2 section heading — only an H1 is a title (0189 R4)', () => {
        const content: Content = docsToContent([doc()], '2026-09-29', '## 第一节\n\n正文第一段。');
        expect(content.body).toContain('## 第一节');
    });

    test('docsToContent does not append an AI-production closer on either path', () => {
        for (const content of [
            docsToContent([doc()], '2026-09-29'),
            docsToContent([doc()], '2026-09-29', '正文第一段。'),
        ]) {
            expect(content.body).not.toContain('文字由 AI 辅助整理');
            expect(content.body).not.toContain('AI 合成配音');
        }
    });

    test('excludedIdsFromNote parses boundary-note ids; article Content never cites excluded docs (judge 2026-10-02)', async () => {
        const note = '> 注：2 条条目因选题边界未写入：b039f703ebf7885f（政治争议）、3615960163537c76（监管议题）';
        expect([...excludedIdsFromNote(note)]).toEqual(['b039f703ebf7885f', '3615960163537c76']);
        expect(excludedIdsFromNote('无注记正文').size).toBe(0);
        expect(excludedIdsFromNote(undefined).size).toBe(0);
        expect([...excludedIdsFromNote('> 注：1 条条目因选题边界未写入：last30days:8eafcda5f3574372（版权）')]).toEqual(
            ['last30days:8eafcda5f3574372', '8eafcda5f3574372'],
        );
        const tmpDir = join(process.cwd(), '.tmp-test-daily-article-excluded');
        await mkdir(tmpDir, { recursive: true });
        const bodyPath = join(tmpDir, 'body.md');
        const inPath = join(tmpDir, 'docs.json');
        const outPath = join(tmpDir, 'content.json');
        await Bun.write(bodyPath, `正文。\n\n${note}\n`);
        await Bun.write(
            inPath,
            JSON.stringify([doc({ id: '4954f1a6cbc0fc44' }), doc({ id: 'b039f703ebf7885f', title: 'RFK' })]),
        );
        try {
            process.env.ARTICLE_DATE = '20260904';
            process.env.ARTICLE_BODY_FILE = bodyPath;
            const content = await processGeneratorIO(inPath, outPath);
            expect(content.metadata?.doc_count).toBe(1);
            expect(content.references?.map((r) => r.cite)).toEqual(['4954f1a6cbc0fc44']);
            expect(content.title).toBe('每日AI乱炖 · 2026-09-04');
            expect(content.body).not.toContain('RFK');
            // The note is bookkeeping, not copy: it must not reach a customer-visible body (operator
            // report 2026-10-10), and the ids it named move to metadata for the show-notes filter.
            expect(content.body).not.toContain('选题边界');
            expect(content.body).not.toContain('b039f703ebf7885f');
            expect(content.body).toContain('正文。');
            expect(content.metadata?.excludedIds).toEqual(['b039f703ebf7885f', '3615960163537c76']);
        } finally {
            delete process.env.ARTICLE_DATE;
            delete process.env.ARTICLE_BODY_FILE;
            await rm(tmpDir, { recursive: true, force: true });
        }
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
