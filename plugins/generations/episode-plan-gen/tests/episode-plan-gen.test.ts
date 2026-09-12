import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Doc } from '@gobing-ai/kk-core';
import {
    type Category,
    classifyCategory,
    cleanBody,
    DEFAULT_FILTER_CONFIG,
    docsToContent,
    type FilterConfig,
    filterAnnotated,
    filterConfigFromEnv,
    main,
    normalizeUrl,
    planEpisode,
    planScore,
    processGeneratorIO,
    rejectedOutPath,
    scoreDimensions,
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
describe('classifyCategory (MECE v1)', () => {
    test('precedence 1 — tag hit wins over keyword signals; first matching tag wins', () => {
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['research-paper'] } }))).toBe('ai-research');
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['research'] } }))).toBe('ai-research');
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['tutorial'] } }))).toBe('ai-technical');
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['guide'] } }))).toBe('ai-technical');
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['ai-news'] } }))).toBe('ai-news');
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['war'] } }))).toBe('non-ai');
        // Tag beat: `tutorial` (technical) precedes `research` in the tag array.
        expect(classifyCategory(doc({ metadata: { source: 'rss', tags: ['tutorial', 'research'] } }))).toBe(
            'ai-technical',
        );
        // A tag beat outranks keyword noise in the title.
        expect(
            classifyCategory(
                doc({ title: 'GPT-6 launch odds', metadata: { source: 'rss', tags: ['military-conflict'] } }),
            ),
        ).toBe('non-ai');
    });

    test('precedence 2 — NON_AI_SOURCES skip the keyword scan', () => {
        expect(classifyCategory(doc({ title: 'GPT-6 launch odds', metadata: { source: 'polymarket' } }))).toBe(
            'non-ai',
        );
    });

    test('precedence 3 — keyword scan order: technical → news → industry, title + body head', () => {
        expect(classifyCategory(doc({ title: 'Inference benchmark results', metadata: { source: 'reddit' } }))).toBe(
            'ai-technical',
        );
        expect(
            classifyCategory(doc({ title: 'Announcing the new SDK architecture', metadata: { source: 'reddit' } })),
        ).toBe('ai-technical');
        expect(classifyCategory(doc({ title: 'Anthropic 发布 Claude 5', metadata: { source: 'aihot' } }))).toBe(
            'ai-news',
        );
        expect(classifyCategory(doc({ title: 'Sora 2 launches today', metadata: { source: 'reddit' } }))).toBe(
            'ai-news',
        );
        expect(
            classifyCategory(
                doc({
                    title: 'Anthropic raises at a $350B valuation',
                    body: '公司报道正文。',
                    metadata: { source: 'hackernews' },
                }),
            ),
        ).toBe('ai-industry');
        // Body signal within the first 200 chars when the title is silent.
        expect(
            classifyCategory(
                doc({
                    title: '无信号标题',
                    body: `但正文开头提到 API 网关。${'字'.repeat(210)}`,
                    metadata: { source: 'rss' },
                }),
            ),
        ).toBe('ai-technical');
        // Body signal beyond the first 200 chars is ignored.
        expect(
            classifyCategory(
                doc({ title: '无信号标题', body: `字${'字'.repeat(210)}API`, metadata: { source: 'rss' } }),
            ),
        ).toBe('non-ai');
    });

    test('default — no tag, no denylisted source, no keyword → non-ai', () => {
        expect(
            classifyCategory(doc({ title: '夏日 gardening 笔记', body: '种花与浇水。', metadata: { source: 'rss' } })),
        ).toBe('non-ai');
        expect(classifyCategory(doc({ title: '夏日 gardening 笔记', body: '种花与浇水。', metadata: {} }))).toBe(
            'non-ai',
        );
    });

    test('precedence collisions — tag beats source deny, news beats industry keyword, tags match case-insensitively', () => {
        // A mapped tag outranks the non-AI source deny (precedence 1 > 2).
        expect(classifyCategory(doc({ metadata: { source: 'polymarket', tags: ['ai-news'] } }))).toBe('ai-news');
        // A news keyword beats an industry keyword in the same title (scan order technical → news → industry).
        expect(
            classifyCategory(
                doc({
                    title: 'Claude maker raises $2B at a $350B valuation',
                    body: '公司动态。',
                    metadata: { source: 'reddit' },
                }),
            ),
        ).toBe('ai-news');
        // Industry only when no news keyword fired.
        expect(
            classifyCategory(
                doc({
                    title: 'Startup raises at a huge valuation',
                    body: '公司动态。',
                    metadata: { source: 'reddit' },
                }),
            ),
        ).toBe('ai-industry');
        // Tag lookup is case-insensitive, and a mapped tag still wins over keyword noise.
        expect(classifyCategory(doc({ title: '夏日笔记', metadata: { source: 'rss', tags: ['AI-News'] } }))).toBe(
            'ai-news',
        );
        expect(classifyCategory(doc({ title: 'GPT-6 launch odds', metadata: { source: 'rss', tags: ['War'] } }))).toBe(
            'non-ai',
        );
    });

    test('keyword boundary — Latin matches are whole-word with inflections, never bare prefixes', () => {
        // Short keywords must not prefix-over-match (review P3-1): `cli` ≠ "client"/"clicked", `ships` ≠ "shipshape".
        expect(
            classifyCategory(
                doc({
                    title: 'Client onboarding clicked into place',
                    body: '客户旅程笔记。',
                    metadata: { source: 'rss' },
                }),
            ),
        ).toBe('non-ai');
        expect(
            classifyCategory(
                doc({ title: 'Shipshape maritime chronicles', body: '航海日志。', metadata: { source: 'rss' } }),
            ),
        ).toBe('non-ai');
        // The standalone keywords still fire.
        expect(classifyCategory(doc({ title: 'A fresh CLI for the warehouse', metadata: { source: 'rss' } }))).toBe(
            'ai-technical',
        );
        expect(classifyCategory(doc({ title: 'Acme ships its first widget', metadata: { source: 'rss' } }))).toBe(
            'ai-news',
        );
        // Common inflections still count as the keyword (`launch`→launched, `fine-tun`→fine-tuning).
        expect(classifyCategory(doc({ title: 'The lab launched its new model', metadata: { source: 'rss' } }))).toBe(
            'ai-news',
        );
        expect(classifyCategory(doc({ title: 'Fine-tuning small models cheaply', metadata: { source: 'rss' } }))).toBe(
            'ai-technical',
        );
    });
});

describe('scoreDimensions (v1 rubric)', () => {
    test('quality: body length tiers + sourced bonus, capped at 5', () => {
        const bare = doc({ body: '短文', sourceUri: undefined });
        expect(scoreDimensions(bare, '2026-09-06').quality).toBe(1);
        const medium = doc({ body: 'x'.repeat(3000), sourceUri: undefined });
        expect(scoreDimensions(medium, '2026-09-06').quality).toBe(3);
        expect(scoreDimensions(doc({ body: 'x'.repeat(3000) }), '2026-09-06').quality).toBe(4); // +1 default sourceUri
        expect(scoreDimensions(doc({ body: 'x'.repeat(30000) }), '2026-09-06').quality).toBe(5); // capped
    });

    test('importance: source tier + relevance ≥ 0.8 bonus, capped at 5', () => {
        const importanceAt = (metadata: Record<string, unknown>) =>
            scoreDimensions(doc({ metadata }), '2026-09-06').importance;
        expect(importanceAt({ source: 'aihot' })).toBe(4);
        expect(importanceAt({ source: 'rss' })).toBe(3);
        expect(importanceAt({ source: 'hackernews' })).toBe(3);
        expect(importanceAt({ source: 'reddit' })).toBe(2);
        expect(importanceAt({ source: 'hackernews', relevance_score: 0.9 })).toBe(4);
        expect(importanceAt({ source: 'reddit', relevance_score: '0.85' })).toBe(3);
        expect(importanceAt({ source: 'aihot', relevance_score: 0.5 })).toBe(4);
        expect(importanceAt({ source: 'aihot', relevance_score: 0.99 })).toBe(5); // capped
    });

    test('urgency: same-day 5, ≤2d 4, ≤7d 3, older 1, undated 3', () => {
        const urgencyAt = (publishedAt: string) =>
            scoreDimensions(doc({ sourceUri: undefined, metadata: { source: 'aihot', publishedAt } }), '2026-09-06')
                .urgency;
        expect(urgencyAt('2026-09-06T10:00:00.000Z')).toBe(5);
        expect(urgencyAt('2026-09-04T00:00:00.000Z')).toBe(4);
        expect(urgencyAt('2026-08-30T00:00:00.000Z')).toBe(3);
        expect(urgencyAt('2020-06-19T00:00:00.000Z')).toBe(1);
        expect(scoreDimensions(doc({ metadata: { source: 'hackernews' } }), '2026-09-06').urgency).toBe(3);
    });

    test('impact: engagement magnitude tiers (>1000→5 … else 1)', () => {
        const impactAt = (engagement: Record<string, unknown>) =>
            scoreDimensions(doc({ metadata: { source: 'reddit', engagement } }), '2026-09-06').impact;
        expect(impactAt({ points: 2500 })).toBe(5);
        expect(impactAt({ comments: 500 })).toBe(4);
        expect(impactAt({ stars: 50 })).toBe(3);
        expect(impactAt({ likes: 2 })).toBe(2);
        expect(impactAt({ likes: 1 })).toBe(1);
        expect(impactAt({})).toBe(1);
    });

    test('scores are integers within 0–5 and deterministic per doc', () => {
        const samples = [doc(), doc({ body: 'x'.repeat(9000) }), doc({ metadata: { source: 'polymarket' } })];
        for (const sample of samples) {
            const first = scoreDimensions(sample, '2026-09-06');
            expect(scoreDimensions(sample, '2026-09-06')).toEqual(first);
            for (const value of Object.values(first)) {
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(5);
            }
        }
    });
});

describe('annotate wiring in planEpisode', () => {
    const blended = [
        doc({
            id: 'a',
            title: 'Anthropic 发布 Claude 5',
            body: '模型发布。',
            metadata: { source: 'aihot', publishedAt: '2026-09-06T08:00:00.000Z' },
        }),
        doc({
            id: 'b',
            title: 'KV cache optimization for long-context inference',
            sourceUri: 'https://arxiv.org/abs/kv-cache',
            metadata: { source: 'hackernews', relevance_score: 0.9, engagement: { points: 300 }, date: '2026-09-06' },
        }),
        doc({
            id: 'geo',
            title: 'U.S. strikes Iranian oil tankers',
            metadata: { source: 'rss', date: '2026-09-06', tags: ['geopolitics'] },
        }),
    ];
    const categories = new Set(['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai']);

    test('every surviving doc carries a category + integer 0–5 scores', () => {
        const plan = planEpisode(blended, { maxItems: 10, date: '2026-09-06' });
        expect(plan.length).toBeGreaterThan(0);
        for (const entry of plan) {
            expect(categories.has(entry.metadata?.category as string)).toBe(true);
            const scores = entry.metadata?.scores as Record<string, number>;
            expect(Object.keys(scores).sort()).toEqual(['impact', 'importance', 'quality', 'urgency']);
            for (const value of Object.values(scores)) {
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(5);
            }
        }
    });

    test('same input twice → byte-identical plan', () => {
        expect(JSON.stringify(planEpisode(blended, { maxItems: 10, date: '2026-09-06' }))).toBe(
            JSON.stringify(planEpisode(blended, { maxItems: 10, date: '2026-09-06' })),
        );
    });

    test('annotate drops nothing — gates still run after annotation', () => {
        const plan = planEpisode(blended, { maxItems: 10, date: '2026-09-06' });
        expect(plan.map((d) => d.id)).toEqual(['a', 'b']); // geopolitics tag gate still applies
    });

    test('plan items carry brief + publishAt (task 0118 show-notes inputs)', () => {
        const plan = planEpisode(blended, { maxItems: 10, date: '2026-09-06' });
        const item = plan.find((d) => d.id === 'a');
        expect(item).toBeDefined();
        // 1–2-sentence briefing derived from the cleaned body.
        expect(item?.metadata?.brief).toBe('模型发布。');
        // Best-effort publish timestamp rides as ISO from the source metadata.
        expect(item?.metadata?.publishAt).toBe('2026-09-06T08:00:00.000Z');
    });

    test('plan items without a parseable timestamp omit publishAt (show-notes renders --:--)', () => {
        const undated = planEpisode(
            [
                doc({
                    id: 'u',
                    title: 'KV cache optimization for long-context inference',
                    sourceUri: 'https://arxiv.org/abs/kv-cache',
                    metadata: { source: 'hackernews', relevance_score: 0.9, engagement: { points: 300 } },
                }),
            ],
            { maxItems: 10, date: '2026-09-06' },
        );
        expect(undated.length).toBeGreaterThan(0);
        for (const entry of undated) expect(entry.metadata?.publishAt).toBeUndefined();
    });

    test('gates and per-source cap still bind annotated docs (R4 — annotate drops nothing)', () => {
        const titles = [
            'Anthropic 发布 Claude 5',
            '谷歌 Gemini 3 上线',
            '微软开源 MarkItDown',
            'Meta 发布 Llama 5',
            'Mistral 融资扩张',
            'xAI Grok 5 首发',
        ];
        const fresh = titles.map((t, i) =>
            doc({
                id: `fresh${i}`,
                title: t,
                sourceUri: `https://x.com/${i}`,
                metadata: { source: 'aihot', publishedAt: '2026-09-06T08:00:00.000Z', tags: ['ai-news'] },
            }),
        );
        const stale = doc({
            id: 'stale',
            title: '古老的 AI 编年史',
            sourceUri: 'https://old.com/a',
            metadata: { source: 'aihot', publishedAt: '2020-06-19T00:00:00.000Z', tags: ['ai-news'] },
        });
        const plan = planEpisode([stale, ...fresh], { maxItems: 10, date: '2026-09-06' });
        // Freshness still drops the annotated stale doc; the cap still stops the six-doc flood at five.
        expect(plan.map((d) => d.id)).toEqual(['fresh0', 'fresh1', 'fresh2', 'fresh3', 'fresh4']);
        expect(plan.every((d) => d.metadata?.category === 'ai-news')).toBe(true);
    });
});

describe('annotate on the real r6 blended fixture (R3 determinism at scale)', () => {
    const fixturePath = join(import.meta.dir, 'fixtures', 'r6-blended.json');
    const categories = new Set(['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai']);

    test('r6 real blended set — gates drop 11 of 15, every survivor annotated MECE + integer 0–5 scores', async () => {
        const blended = (await Bun.file(fixturePath).json()) as Doc[];
        const plan = planEpisode(blended, { maxItems: 20, date: '2026-09-06' });
        // 10 stale aihot archives dropped by the freshness gate + 1 geopolitics rss item by the tag gate.
        expect(blended).toHaveLength(15);
        expect(plan).toHaveLength(4);
        expect(plan.some((d) => (d.metadata?.source as string) === 'aihot')).toBe(false);
        expect(plan.every((d) => !((d.metadata?.tags as string[] | undefined) ?? []).includes('geopolitics'))).toBe(
            true,
        );
        for (const entry of plan) {
            expect(categories.has(entry.metadata?.category as string)).toBe(true);
            const scores = entry.metadata?.scores as Record<string, number>;
            expect(Object.keys(scores).sort()).toEqual(['impact', 'importance', 'quality', 'urgency']);
            for (const value of Object.values(scores)) {
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(5);
            }
        }
        // Real-data precedence hits: the research-paper-tagged reddit doc and the GPT-6 headline.
        const reddit = plan.find((d) => (d.metadata?.source as string) === 'reddit');
        expect(reddit?.metadata?.category).toBe('ai-research');
        expect(plan.find((d) => String(d.title).includes('GPT-6'))?.metadata?.category).toBe('ai-news');
    });

    test('R3 — two runs over the real r6 fixture are byte-identical and do not mutate the input', async () => {
        const raw = await Bun.file(fixturePath).text();
        const runWith = (text: string) =>
            JSON.stringify(planEpisode(JSON.parse(text) as Doc[], { maxItems: 20, date: '2026-09-06' }));
        expect(runWith(raw)).toBe(runWith(raw)); // byte-identical across fresh parses
        // Annotate does not mutate the caller's docs (determinism is not mutation dependent).
        const input = JSON.parse(raw) as Doc[];
        const snapshot = JSON.stringify(input);
        planEpisode(input, { maxItems: 20, date: '2026-09-06' });
        expect(JSON.stringify(input)).toBe(snapshot);
    });
});

describe('filter mode (--mode filter, 0094)', () => {
    const atMins = { quality: 2, importance: 3, urgency: 2, impact: 1 }; // exactly at DEFAULT_FILTER_CONFIG minimums (0099 calibration)
    const defaultConfigShape: Record<string, unknown> = {
        categories: ['ai-news', 'ai-industry'],
        minQuality: 2,
        minImportance: 3,
        minUrgency: 2,
        minImpact: 1,
    };
    const annotated = (category: string, scores: Record<string, number>, extra: Partial<Doc> = {}): Doc =>
        doc({ ...extra, metadata: { source: 'aihot', ...(extra.metadata ?? {}), category, scores } });

    async function withQcEnv(overrides: Record<string, string | undefined>, fn: () => Promise<unknown>): Promise<void> {
        const names = ['QC_CATEGORIES', 'QC_MIN_QUALITY', 'QC_MIN_IMPORTANCE', 'QC_MIN_URGENCY', 'QC_MIN_IMPACT'];
        const prev = names.map((name) => [name, process.env[name]] as const);
        try {
            for (const [name] of prev) {
                const override = overrides[name];
                if (override === undefined) delete process.env[name];
                else process.env[name] = override;
            }
            await fn();
        } finally {
            for (const [name, value] of prev) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
        }
    }

    async function runMain(args: string[]): Promise<number> {
        const prev = process.argv;
        process.argv = ['bun', 'episode-plan-gen', ...args];
        try {
            return await main();
        } finally {
            process.argv = prev;
        }
    }

    test('DEFAULT_FILTER_CONFIG + filterConfigFromEnv defaults — categories ai-news,ai-industry; mins 2/3/2/1 (0099 calibration)', () => {
        expect(DEFAULT_FILTER_CONFIG as unknown as Record<string, unknown>).toEqual(defaultConfigShape);
        expect(filterConfigFromEnv({}) as unknown as Record<string, unknown>).toEqual(defaultConfigShape);
        expect(
            filterConfigFromEnv({ QC_CATEGORIES: '', QC_MIN_QUALITY: ' ' }) as unknown as Record<string, unknown>,
        ).toEqual(defaultConfigShape);
    });

    test('invalid QC env fails loud — out-of-range / non-integer / unknown category, no clamping', () => {
        expect(() => filterConfigFromEnv({ QC_MIN_QUALITY: '6' })).toThrow(/QC_MIN_QUALITY/);
        expect(() => filterConfigFromEnv({ QC_MIN_IMPACT: '-1' })).toThrow(/QC_MIN_IMPACT/);
        expect(() => filterConfigFromEnv({ QC_MIN_URGENCY: '2.5' })).toThrow(/QC_MIN_URGENCY/);
        expect(() => filterConfigFromEnv({ QC_CATEGORIES: 'ai-news,vibes' })).toThrow(/vibes/);
        expect(() => filterConfigFromEnv({ QC_CATEGORIES: 'ai-news,' })).toThrow(/QC_CATEGORIES/);
        // 0 and 5 are valid bounds.
        expect(filterConfigFromEnv({ QC_MIN_QUALITY: '0', QC_MIN_IMPACT: '5' })).toEqual({
            categories: ['ai-news', 'ai-industry'],
            minQuality: 0,
            minImportance: 3,
            minUrgency: 2,
            minImpact: 5,
        });
    });

    test('threshold boundary — score == min passes on every dimension (inclusive), min-1 fails with the exact reason', () => {
        const config = filterConfigFromEnv({});
        const atBoundary = filterAnnotated([annotated('ai-news', atMins)], config);
        expect(atBoundary.kept.map((d) => d.id)).toEqual(['d1']);
        expect(atBoundary.rejected).toHaveLength(0);

        for (const dim of ['quality', 'importance', 'urgency', 'impact'] as const) {
            const below = { ...atMins, [dim]: atMins[dim] - 1 };
            const result = filterAnnotated([annotated('ai-news', below, { id: `low-${dim}` })], config);
            expect(result.kept).toHaveLength(0);
            expect(result.rejected[0]?.reasons).toEqual([`${dim}:${atMins[dim] - 1}<${atMins[dim]}`]);
        }
    });

    test('category allowlist — QC_CATEGORIES=ai-news drops non-ai categories with reasons recorded', () => {
        const config = filterConfigFromEnv({ QC_CATEGORIES: 'ai-news' });
        const { kept, rejected } = filterAnnotated(
            [
                annotated('ai-news', atMins, { id: 'news' }),
                annotated('ai-industry', atMins, { id: 'industry' }),
                annotated('non-ai', atMins, { id: 'other' }),
            ],
            config,
        );
        expect(kept.map((d) => d.id)).toEqual(['news']);
        expect(rejected.map((r) => r.doc.id)).toEqual(['industry', 'other']);
        expect(rejected.map((r) => r.reasons)).toEqual([['category:not-in-allowlist'], ['category:not-in-allowlist']]);
    });

    test('reasons accumulate every failed check, in category → quality → importance → urgency → impact order', () => {
        const { rejected } = filterAnnotated(
            [annotated('ai-research', { quality: 1, importance: 1, urgency: 1, impact: 0 }, { id: 'bad' })],
            filterConfigFromEnv({}),
        );
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.doc.id).toBe('bad');
        expect(rejected[0]?.reasons).toEqual([
            'category:not-in-allowlist',
            'quality:1<2',
            'importance:1<3',
            'urgency:1<2',
            'impact:0<1',
        ]);
    });

    test('kept docs keep sourceUri and metadata.urls byte-identical — filter consumes, never mutates or recomputes', () => {
        const urls = ['https://a.example.com/1', 'https://b.example.com/2'];
        const input = annotated('ai-news', atMins, {
            id: 'keep-me',
            sourceUri: 'https://keep.example.com/post',
            metadata: { source: 'aihot', urls, planScore: 42.5 },
        });
        const snapshot = JSON.stringify(input);
        const { kept, rejected } = filterAnnotated([input], DEFAULT_FILTER_CONFIG);
        expect(rejected).toHaveLength(0);
        expect(kept).toHaveLength(1);
        expect(JSON.stringify(kept[0])).toBe(snapshot); // same reference, byte-identical serialization
        expect(kept[0]?.sourceUri).toBe('https://keep.example.com/post');
        expect(kept[0]?.metadata?.urls).toEqual(urls);
        expect(JSON.stringify(input)).toBe(snapshot); // input untouched
    });

    test('missing annotation fails loud naming the first offending doc id — never silently passed', () => {
        const unannotated = doc({ id: 'raw-1', metadata: { source: 'aihot' } });
        expect(() => filterAnnotated([unannotated], DEFAULT_FILTER_CONFIG)).toThrow(/raw-1/);
        const badScores = annotated('ai-news', { quality: 3, importance: 3, urgency: 2, impact: 9 }, { id: 'scorey' });
        expect(() => filterAnnotated([badScores], DEFAULT_FILTER_CONFIG)).toThrow(/scorey.*scores\.impact/);
        // First offender wins.
        expect(() =>
            filterAnnotated([unannotated, annotated('ai-news', atMins, { id: 'fine' })], DEFAULT_FILTER_CONFIG),
        ).toThrow(/raw-1/);
    });

    test('rejectedOutPath — <out>.json → <out>.rejected.json', () => {
        expect(rejectedOutPath('/run/2-plan/candidates.json')).toBe('/run/2-plan/candidates.rejected.json');
        expect(rejectedOutPath('/run/2-plan/candidates')).toBe('/run/2-plan/candidates.rejected.json');
    });

    test('processFilterIO — kept Content at --out; { rejected, config, total } audit at candidates.rejected.json', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-filter');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'annotated.json');
        const outPath = join(tmpDir, 'candidates.json');
        await Bun.write(
            inPath,
            JSON.stringify([
                annotated('ai-news', atMins, {
                    id: 'k1',
                    sourceUri: 'https://keep.example.com/a',
                    metadata: { source: 'aihot', urls: ['https://keep.example.com/a'] },
                }),
                annotated('non-ai', { quality: 1, importance: 2, urgency: 1, impact: 1 }, { id: 'd1' }),
            ]),
        );
        try {
            await withQcEnv({}, () => processGeneratorIO(inPath, outPath, 'filter'));
            const content = (await Bun.file(outPath).json()) as Content;
            const keptIds = (content.metadata?.docs as Doc[] | undefined)?.map((d) => d.id);
            expect(keptIds).toEqual(['k1']);
            expect(content.metadata?.doc_count).toBe(1);
            const audit = (await Bun.file(join(tmpDir, 'candidates.rejected.json')).json()) as {
                rejected: { doc: Doc; reasons: string[] }[];
                config: Record<string, unknown>;
                total: number;
            };
            expect(Object.keys(audit).sort()).toEqual(['config', 'rejected', 'total']);
            expect(audit.total).toBe(2);
            expect(audit.config).toEqual(defaultConfigShape);
            expect(audit.rejected).toHaveLength(1);
            expect(audit.rejected[0]?.doc.id).toBe('d1');
            expect(audit.rejected[0]?.reasons).toContain('category:not-in-allowlist');
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main --mode filter: zero survivors is exit 0 with metadata.docs: [] (never a failure)', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-filter-empty');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'annotated.json');
        const outPath = join(tmpDir, 'candidates.json');
        await Bun.write(
            inPath,
            JSON.stringify([annotated('non-ai', { quality: 1, importance: 1, urgency: 1, impact: 1 })]),
        );
        try {
            await withQcEnv({}, async () => {
                expect(await runMain(['--in', inPath, '--out', outPath, '--mode', 'filter'])).toBe(0);
            });
            const content = (await Bun.file(outPath).json()) as Content;
            expect(content.metadata?.docs).toEqual([]);
            expect(content.metadata?.doc_count).toBe(0);
            const audit = (await Bun.file(join(tmpDir, 'candidates.rejected.json')).json()) as {
                rejected: unknown[];
                total: number;
            };
            expect(audit.total).toBe(1);
            expect(audit.rejected).toHaveLength(1);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main --mode filter: missing annotation exits 1 and writes no artifacts', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-filter-annot');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'annotated.json');
        const outPath = join(tmpDir, 'candidates.json');
        await Bun.write(inPath, JSON.stringify([doc({ id: 'no-annotation', metadata: { source: 'aihot' } })]));
        try {
            let code = 0;
            await withQcEnv({}, async () => {
                code = await runMain(['--in', inPath, '--out', outPath, '--mode', 'filter']);
            });
            expect(code).toBe(1);
            expect(await Bun.file(outPath).exists()).toBe(false);
            expect(await Bun.file(join(tmpDir, 'candidates.rejected.json')).exists()).toBe(false);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main --mode filter: invalid QC env exits 1 (fail loud, no clamping, no artifacts)', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-filter-env');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'annotated.json');
        const outPath = join(tmpDir, 'candidates.json');
        await Bun.write(inPath, JSON.stringify([annotated('ai-news', atMins, { id: 'ok' })]));
        try {
            await withQcEnv({ QC_MIN_QUALITY: '9' }, async () => {
                expect(await runMain(['--in', inPath, '--out', outPath, '--mode', 'filter'])).toBe(1);
            });
            expect(await Bun.file(outPath).exists()).toBe(false);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('main rejects unknown --mode', async () => {
        expect(await runMain(['--in', 'x', '--out', 'y', '--mode', 'vibes'])).toBe(1);
    });

    test('mode precedence (0097 kk-seam): --mode flag > EPISODE_PLAN_MODE env > plan default; unknown env fails loud', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-mode-env');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'annotated.json');
        const outEnv = join(tmpDir, 'candidates-env.json');
        const outFlag = join(tmpDir, 'candidates-flag.json');
        const outPlain = join(tmpDir, 'candidates-plain.json');
        await Bun.write(inPath, JSON.stringify([annotated('ai-news', atMins, { id: 'ok' })]));
        const prevMode = process.env.EPISODE_PLAN_MODE;
        try {
            await withQcEnv({}, async () => {
                process.env.EPISODE_PLAN_MODE = 'filter';
                expect(await runMain(['--in', inPath, '--out', outEnv])).toBe(0);
                expect((await Bun.file(outEnv).json()).metadata.doc_count).toBe(1);

                process.env.EPISODE_PLAN_MODE = 'filter';
                expect(await runMain(['--in', inPath, '--out', outFlag, '--mode', 'plan'])).toBe(0);
                expect(await Bun.file(outFlag.replace(/\.json$/, '.rejected.json')).exists()).toBe(false);

                delete process.env.EPISODE_PLAN_MODE;
                expect(await runMain(['--in', inPath, '--out', outPlain])).toBe(0);
                expect((await Bun.file(outPlain).json()).metadata.doc_count).toBe(1);
                expect(await Bun.file(outPlain.replace(/\.json$/, '.rejected.json')).exists()).toBe(false);

                process.env.EPISODE_PLAN_MODE = 'vibes';
                expect(await runMain(['--in', inPath, '--out', join(tmpDir, 'nope.json')])).toBe(1);
                expect(await Bun.file(join(tmpDir, 'nope.json')).exists()).toBe(false);
            });
        } finally {
            if (prevMode === undefined) delete process.env.EPISODE_PLAN_MODE;
            else process.env.EPISODE_PLAN_MODE = prevMode;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('plan-mode regression — explicit --mode plan is byte-identical to the default run and writes no rejected artifact', async () => {
        const tmpDir = join(process.cwd(), '.tmp-test-episode-plan-regression');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'blended.json');
        const outDefault = join(tmpDir, 'default.json');
        const outExplicit = join(tmpDir, 'explicit.json');
        await Bun.write(
            inPath,
            JSON.stringify([
                doc({ id: 'd1' }),
                doc({ id: 'd2', title: '欧盟通过 AI 法案修正案', sourceUri: 'https://x.com/2' }),
                doc({ id: 'd3', title: '谷歌 Gemini 3 正式上线', sourceUri: 'https://x.com/3' }),
            ]),
        );
        try {
            await runMain(['--in', inPath, '--out', outDefault]);
            await runMain(['--in', inPath, '--out', outExplicit, '--mode', 'plan']);
            expect(await Bun.file(outDefault).text()).toBe(await Bun.file(outExplicit).text());
            expect(await Bun.file(join(tmpDir, 'default.rejected.json')).exists()).toBe(false);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('filter replay on the real r6 plan output (0094 verify)', () => {
    const fixturePath = join(import.meta.dir, 'fixtures', 'r6-blended.json');

    test('permissive thresholds reproduce the gated plan byte-for-byte (4 survivors, zero rejections)', async () => {
        const blended = (await Bun.file(fixturePath).json()) as Doc[];
        const plan = planEpisode(blended, { maxItems: 20, date: '2026-09-06' });
        const permissive: FilterConfig = {
            categories: ['ai-news', 'ai-technical', 'ai-research', 'ai-industry', 'non-ai'],
            minQuality: 0,
            minImportance: 0,
            minUrgency: 0,
            minImpact: 0,
        };
        const { kept, rejected } = filterAnnotated(plan, permissive);
        expect(rejected).toHaveLength(0);
        expect(kept).toHaveLength(4);
        expect(JSON.stringify(kept)).toBe(JSON.stringify(plan)); // filter consumes the annotated plan untouched
    });

    test('default QC config partitions the r6 plan — every rejection reason matches its annotation', async () => {
        const blended = (await Bun.file(fixturePath).json()) as Doc[];
        const plan = planEpisode(blended, { maxItems: 20, date: '2026-09-06' });
        const { kept, rejected } = filterAnnotated(plan, DEFAULT_FILTER_CONFIG);
        // 0099 calibration: the GPT-6 doc (3/3/5/1) clears impact 1 ≥ 1 and is admitted; the three
        // remaining survivors fail category (tech-news-2 also importance 2 < 3), with per-doc reasons.
        expect(kept.map((d) => d.id)).toEqual(['horizon:2026-09-06-ai-creator-2']);
        expect(rejected.map((r) => r.doc.id)).toEqual([
            'horizon:2026-09-06-ai-creator-1',
            'horizon:2026-09-06-tech-news-1',
            'horizon:2026-09-06-tech-news-2',
        ]);
        expect(rejected.map((r) => r.reasons)).toEqual([
            ['category:not-in-allowlist'],
            ['category:not-in-allowlist'],
            ['category:not-in-allowlist', 'importance:2<3'],
        ]);
        const minimums = {
            quality: DEFAULT_FILTER_CONFIG.minQuality,
            importance: DEFAULT_FILTER_CONFIG.minImportance,
            urgency: DEFAULT_FILTER_CONFIG.minUrgency,
            impact: DEFAULT_FILTER_CONFIG.minImpact,
        };
        for (const { doc: dropped, reasons } of rejected) {
            expect(reasons.length).toBeGreaterThan(0);
            const category = dropped.metadata?.category as string;
            if (!DEFAULT_FILTER_CONFIG.categories.includes(category as Category)) {
                expect(reasons).toContain('category:not-in-allowlist');
            }
            const scores = dropped.metadata?.scores as Record<'quality' | 'importance' | 'urgency' | 'impact', number>;
            for (const dim of ['quality', 'importance', 'urgency', 'impact'] as const) {
                if (scores[dim] < minimums[dim]) expect(reasons).toContain(`${dim}:${scores[dim]}<${minimums[dim]}`);
                else expect(reasons).not.toContain(`${dim}:${scores[dim]}<${minimums[dim]}`);
            }
        }
    });
});

describe('r7 dogfood recalibration replay (0099)', () => {
    // Verbatim docs from the 0098 dogfood evidence (20/20 live candidates rejected under the
    // shipped 3/3/2/2 config): .spur/run/daily-dogfood-20260906-r3/2-plan/candidates.rejected.json
    const fixturePath = join(import.meta.dir, 'fixtures', 'r7-rejected-excerpt.json');

    async function replay(): Promise<{ kept: Doc[]; rejected: Array<{ doc: Doc; reasons: string[] }> }> {
        const docs = (await Bun.file(fixturePath).json()) as Doc[];
        const plan = planEpisode(docs, { maxItems: 20, date: '2026-09-06' });
        return filterAnnotated(plan, DEFAULT_FILTER_CONFIG);
    }

    test('the flagship r7 item (quality 4, urgency 5, impact 1) is admitted — it died solely on impact:1<2 under 3/3/2/2', async () => {
        const { kept } = await replay();
        const alienMind = kept.find((d) => d.id === 'horizon:2026-09-07-tech-news-3');
        expect(alienMind).toBeDefined();
        // Scores are re-derived by the annotate pass on replay, not trusted from the fixture.
        expect(alienMind?.metadata?.scores).toEqual({ quality: 4, importance: 3, urgency: 5, impact: 1 });
    });

    test('taxonomy expansion — the OpenAI coding-agents item classifies INTO ai-news (fell to non-ai under the v1 tag map)', async () => {
        const { kept } = await replay();
        const codingAgents = kept.find((d) => d.id === 'horizon:2026-09-07-ai-creator-1');
        expect(codingAgents).toBeDefined();
        expect(codingAgents?.metadata?.category).toBe('ai-news');
    });

    test('junk audit — the yt-dlp HTTP-403 error post classifies non-ai (was absorbed into ai-industry via "policy")', async () => {
        const { kept, rejected } = await replay();
        expect(kept.map((d) => d.id)).not.toContain('last30days:74f557a9f362550e');
        const junk = rejected.find((r) => r.doc.id === 'last30days:74f557a9f362550e');
        expect(junk).toBeDefined();
        expect(junk?.doc.metadata?.category).toBe('non-ai');
        expect(junk?.reasons).toContain('category:not-in-allowlist');
    });
});
