import { describe, expect, test } from 'bun:test';
import { buildWechatArticleContent, PLACEHOLDER_LINKS } from '../scripts/daily-stages';

/**
 * The daily builder's 公众号 metadata (0406 R3).
 *
 * Failure this pins: the row asked for 赞赏 unconditionally (`reward: true`), and on an account the
 * platform has not authorized for 赞赏 the plugin reported a capability warning that `flow.ts` turned
 * into `ok: false` — so every daily draft failed until the operator set
 * `WECHATMP_ALLOW_PARTIAL_ENRICH=1` by hand (2026-11-16, 11-18, 11-19). Measured 2026-11-20: the row
 * renders `无法开启赞赏，因为还没有赞赏账户授权给本公众号` with a 0×0 box, so no retry can enable it.
 *
 * The other metadata duties are not this change's: 原创, 合集, 创作来源 must keep being requested.
 */
describe('daily 公众号 metadata — 赞赏 is not requested for an unauthorized account', () => {
    const article = { title: '标题', body: '正文' };
    const base = { links: PLACEHOLDER_LINKS, publishStatus: 'draft' as const, collection: '每日AI乱炖' };

    test('the 文章 variant carries reward: false with the measured reason named in the source', () => {
        const content = buildWechatArticleContent(article, base);
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.reward).toBe(false);
    });

    test('the fields that are still requested stay requested', () => {
        const content = buildWechatArticleContent(article, base);
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.original).toBe(true);
        expect(wechatmp.collection).toBe('每日AI乱炖');
        expect(wechatmp.claimSource).toBe('内容由AI生成');
        expect(wechatmp.coverSource).toBe('library');
        expect(typeof wechatmp.author).toBe('string');
        expect((wechatmp.author as string).length).toBeGreaterThan(0);
    });

    test('an audio-first 播客 post carries the episode body and the same 赞赏 decision', () => {
        const content = buildWechatArticleContent(article, {
            ...base,
            publishStatus: 'public',
            audioPath: '/tmp/episode.mp3',
            audioTitle: '第 1 期',
        });
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.reward).toBe(false);
        expect(wechatmp.audioPath).toBe('/tmp/episode.mp3');
    });
});
