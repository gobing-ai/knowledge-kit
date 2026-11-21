import { describe, expect, test } from 'bun:test';
import { buildWechatArticleContent, PLACEHOLDER_LINKS } from '../scripts/daily-stages';

/**
 * The daily builder's 公众号 metadata — the 赞赏 request (0406 R3, reversed 2026-11-20).
 *
 * Failure history this pins: the row asked for 赞赏 unconditionally, and on an account the platform
 * has not authorized for 赞赏 the plugin reported a capability refusal that `flow.ts` turned into
 * `ok: false` — so every daily draft failed until the operator set
 * `WECHATMP_ALLOW_PARTIAL_ENRICH=1` by hand (2026-11-16, 11-18, 11-19).
 *
 * 0406 R3 answered by dropping the request (`reward: false`). The operator reversed that on
 * 2026-11-20 (commit ca24a947: "赞赏 ON"): the tolerance now lives in config
 * (`~/.config/kk/config.yaml` → `WECHATMP_ALLOW_PARTIAL_ENRICH: "1"`), so a refusal warns once and
 * keeps the healthy draft, and the request follows the operator again. Flipping `reward` without
 * that tolerance reinstates the 11-16 failure — the coupling is the thing to keep.
 *
 * The other metadata duties are not this change's: 原创, 合集, 创作来源 must keep being requested.
 */
describe('daily 公众号 metadata — 赞赏 is requested, with the refusal tolerated', () => {
    const article = { title: '标题', body: '正文' };
    const base = { links: PLACEHOLDER_LINKS, publishStatus: 'draft' as const, collection: '每日AI乱炖' };

    test('the 文章 variant requests 赞赏, matching the 2026-11-20 operator decision', () => {
        const content = buildWechatArticleContent(article, base);
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.reward).toBe(true);
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
        expect(wechatmp.reward).toBe(true);
        expect(wechatmp.audioPath).toBe('/tmp/episode.mp3');
    });
});
