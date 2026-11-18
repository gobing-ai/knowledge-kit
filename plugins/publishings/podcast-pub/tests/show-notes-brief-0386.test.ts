/** 0386 R1 / AC R7 — brief notes: measured timeline, sources, receipt-gated article link, cards. */
import { describe, expect, test } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { renderShowNotesHtml } from '../src/show-notes';
import {
    applyArticleReceipt,
    CARDS_STYLE,
    planCards,
    renderBriefShowNotes,
    renderCardsRegion,
} from '../src/show-notes-brief';

function doc(over: Partial<Doc> = {}): Doc {
    return {
        id: 'x:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        title: 'Sora 2 发布',
        body: 'OpenAI 发布 Sora 应用，集成 Sora 2 模型。这是第二句。第三句。',
        sourceUri: 'https://blog.samaltman.com/sora-2',
        mediaType: 'text/markdown',
        metadata: { brief: 'OpenAI 发布 Sora 应用，集成 Sora 2 模型。', sourceName: 'Sam Altman' },
        ...over,
    } as Doc;
}

const SEGMENTS = [
    { duration: 10, transcription: '大家好，欢迎收听。今天聊 Sora 2 发布 与 充裕的智能。' },
    { duration: 20, transcription: '先看第一条。Sora 2 发布。' },
    { duration: 30, transcription: '接着看充裕的智能。' },
];
const DOCS = [
    doc(),
    doc({
        id: 'y:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        title: '充裕的智能',
        body: 'Anthropic 谈充裕的智能。第二句。',
        sourceUri: 'https://www.anthropic.com/news/abundant',
        metadata: { brief: 'Anthropic 谈充裕的智能。' },
    }),
];

describe('0386 renderBriefShowNotes — brief bullets, sources, measured timeline', () => {
    test('renders bullets + citation + real audio offsets, no invented article link', () => {
        const { markdown, diagnostics } = renderBriefShowNotes({ docs: DOCS, audioSegments: SEGMENTS });
        expect(diagnostics).toEqual([]);
        // Real offsets from the measured segments, not a proportional guess.
        expect(markdown).toContain('<div class="kk-tl-t">0:10</div>');
        expect(markdown).toContain('<div class="kk-tl-t">0:30</div>');
        // Brief bullet + source citation (0394 provenance: metadata.sourceName then the URL host).
        expect(markdown).toContain('<p class="kk-tl-brief">OpenAI 发布 Sora 应用，集成 Sora 2 模型。</p>');
        expect(markdown).toContain('来源：Sam Altman</a>');
        // The URL host is the fallback label and loses its `www.` prefix (0394 convention).
        expect(markdown).toContain('来源：anthropic.com</a>');
        // AC R7: no article link before a real receipt — the placeholder is plain text.
        expect(markdown).toContain('<p class="kk-tl-more">完整图文版：待文章发布回执</p>');
        expect(markdown).not.toContain('surfing.salty.vip');
        expect(markdown).not.toContain('href="https://surfing.salty.vip');
    });

    test('missing measurement shows no timestamp rather than a fabricated one', () => {
        const { markdown } = renderBriefShowNotes({
            docs: [doc()],
            audioSegments: [{ duration: 0, transcription: '无关' }],
        });
        expect(markdown).toContain('<div class="kk-tl-t">0:00</div>');
        const noAudio = renderBriefShowNotes({ docs: [doc()] }).markdown;
        // No segments at all: proportional over a zero total ⇒ still a real 0:00, never invented seconds.
        expect(noAudio).toContain('<div class="kk-tl-t">0:00</div>');
        const one = renderBriefShowNotes({ docs: [doc()], audioSegments: [{ duration: 12 }] }).markdown;
        expect(one).toContain('<div class="kk-tl-t">0:00</div>');
    });

    test('a non-http sourceUri degrades to plain text, never a live javascript: href', () => {
        const { markdown } = renderBriefShowNotes({ docs: [doc({ sourceUri: 'javascript:alert(1)' })] });
        expect(markdown).toContain('<span class="kk-tl-src">来源：Sam Altman</span>');
        expect(markdown).not.toContain('href="javascript:');
    });

    test('an empty doc list renders no timeline block at all (never an empty shell)', () => {
        const { markdown } = renderBriefShowNotes({ docs: [], title: '第261119期 · 测试' });
        expect(markdown).toBe('# 第261119期 · 测试\n');
    });

    test('the rendered dialect is what renderShowNotesHtml accepts (headings dropped, HTML escaped)', () => {
        const { markdown } = renderBriefShowNotes({
            docs: [doc({ title: 'Sora 2 <b>发布</b>', body: '正文第一句。第二句。' })],
            audioSegments: SEGMENTS,
        });
        const html = renderShowNotesHtml(markdown);
        expect(html).toContain('<div class="kk-tl">');
        expect(html).toContain('Sora 2 &lt;b&gt;发布&lt;/b&gt;');
        expect(html).not.toContain('<b>');
    });
});

describe('0386 applyArticleReceipt — link appears only with a real receipt', () => {
    const rendered = renderBriefShowNotes({ docs: DOCS, audioSegments: SEGMENTS }).markdown;

    test('no receipt, absent receipt and failed receipt all leave the notes link-free', () => {
        expect(applyArticleReceipt(rendered, undefined).enriched).toBe(false);
        expect(applyArticleReceipt(rendered, null).markdown).toBe(rendered);
        const failed = { targets: [{ target: 'surfdash-pub', ok: false, metadata: { postPath: null } }] };
        const out = applyArticleReceipt(rendered, failed);
        expect(out.enriched).toBe(false);
        expect(out.markdown).toBe(rendered);
        expect(out.markdown).toContain('待文章发布回执');
        expect(out.markdown).not.toContain('本期完整文章</a>');
    });

    test('a successful receipt enriches the placeholder with the real post URL', () => {
        const receipt = {
            targets: [
                { target: 'wechatmp-pub', ok: true, metadata: {} },
                {
                    target: 'surfdash-pub',
                    ok: true,
                    metadata: { postPath: '/srv/surfdash/content/posts/articles/zh/20261119-ai-daily/index.md' },
                },
            ],
        };
        const out = applyArticleReceipt(rendered, receipt);
        expect(out.enriched).toBe(true);
        expect(out.markdown).toContain(
            '<p class="kk-tl-more">完整图文版：<a href="https://surfing.salty.vip/zh/posts/20261119-ai-daily" target="_blank" rel="noopener">本期完整文章</a></p>',
        );
        expect(out.markdown).not.toContain('待文章发布回执');
        // `en` is served at the site root (surfdash locale prefix convention).
        const en = applyArticleReceipt(rendered, {
            postPath: '/srv/surfdash/content/posts/articles/en/20261119-ai-daily/index.md',
        });
        expect(en.markdown).toContain('href="https://surfing.salty.vip/posts/20261119-ai-daily"');
        // A custom base URL and a trailing slash never double up.
        const custom = applyArticleReceipt(rendered, receipt, 'https://example.test/');
        expect(custom.markdown).toContain('href="https://example.test/zh/posts/20261119-ai-daily"');
        // Enrichment target must exist: notes rendered without the placeholder are left alone.
        expect(applyArticleReceipt('nothing to enrich', receipt).enriched).toBe(false);
    });
});

describe('0386 cards — ordered region, plain-text degradation, separate diagnostics', () => {
    const cardsRaw = {
        cards: [
            { index: 1, role: 'content', copy: '第一条卡片文案', sourcePoint: 'Sora 2 发布', status: 'rendered' },
            {
                index: 2,
                role: 'content',
                copy: '第二条卡片文案',
                status: 'rendered',
                url: 'https://cdn.example.test/card-02.png',
            },
            {
                index: 3,
                role: 'content',
                copy: '第三条卡片文案',
                status: 'rendered',
                uploadStatus: 'failed',
                uploadError: '413 too large',
            },
            { index: 4, role: 'closing', status: 'pending' },
        ],
    };

    test('cards keep the published order and every card keeps readable alt text', () => {
        const { cards, diagnostics } = planCards(cardsRaw);
        expect(cards.map((c) => c.index)).toEqual([1, 2, 3, 4]);
        expect(cards[0]?.alt).toBe('第一条卡片文案');
        expect(cards[3]?.alt).toBe('本期卡片 4');
        expect(diagnostics).toEqual([
            { index: 3, reason: 'upload-failed', detail: '413 too large' },
            { index: 4, reason: 'asset-missing', detail: 'card status is "pending"' },
        ]);
    });

    test('renderCardsRegion: hosted URL ⇒ responsive figure with img; no asset ⇒ caption only', () => {
        const { cards } = planCards(cardsRaw);
        const region = renderCardsRegion(cards);
        expect(region.startsWith('<!--kk:cards-->')).toBe(true);
        expect(region.endsWith('<!--/kk:cards-->')).toBe(true);
        expect(region).toContain(CARDS_STYLE);
        expect(region).toContain(
            '<img src="https://cdn.example.test/card-02.png" alt="第二条卡片文案" loading="lazy">',
        );
        // Card 1/3/4 have no hosted URL: plain text, and the failed upload never becomes an img.
        expect(region.match(/<img /g)?.length).toBe(1);
        expect(region).toContain('<span class="kk-card-n">1</span>第一条卡片文案');
        expect(region).toContain('<span class="kk-card-n">4</span>本期卡片 4');
        expect(renderCardsRegion([])).toBe('');
    });

    test('cards missing entirely: notes stay readable and RSS-safe, diagnostics empty', () => {
        const { markdown, diagnostics } = renderBriefShowNotes({ docs: DOCS, audioSegments: SEGMENTS });
        expect(diagnostics).toEqual([]);
        expect(markdown).not.toContain('kk:cards');
        expect(markdown).not.toContain('<img');
        const html = renderShowNotesHtml(markdown);
        expect(html).toContain('<div class="kk-tl">');
        expect(html).toContain('完整图文版：待文章发布回执');
    });

    test('malformed manifests never throw: an unknown shape yields no cards at all', () => {
        expect(planCards(undefined)).toEqual({ cards: [], diagnostics: [] });
        expect(planCards('not-json')).toEqual({ cards: [], diagnostics: [] });
        expect(planCards({ cards: 'nope' })).toEqual({ cards: [], diagnostics: [] });
        const mixed = planCards([null, { copy: '只有文案' }]);
        expect(mixed.diagnostics).toEqual([
            { index: 1, reason: 'malformed', detail: 'card entry is not an object' },
            { index: 2, reason: 'asset-missing', detail: 'card status is "unknown"' },
        ]);
        expect(mixed.cards).toEqual([{ index: 2, alt: '只有文案', imageUrl: '', text: '只有文案' }]);
    });

    test('the card block survives renderShowNotesHtml; injected markup inside it is escaped', () => {
        const { markdown } = renderBriefShowNotes({ docs: DOCS, cards: cardsRaw });
        const html = renderShowNotesHtml(markdown);
        expect(html).toContain('<div class="kk-cards">');
        expect(html).toContain('<figure class="kk-card">');
        expect(html).toContain(CARDS_STYLE.trim().slice(0, 20));
        // A hand-written card marker carrying hostile markup is escaped line by line, not passed.
        const hostile = renderShowNotesHtml('<!--kk:cards-->\n<script>alert(1)</script>\n<!--/kk:cards-->');
        expect(hostile).not.toContain('<script>');
        expect(hostile).toContain('&lt;script&gt;');
        // An unclosed card marker must not leak raw HTML either.
        const unclosed = renderShowNotesHtml('<!--kk:cards-->\n<img src=x onerror=y>');
        expect(unclosed).not.toContain('<img');
        expect(unclosed).toContain('&lt;img');
    });
});
