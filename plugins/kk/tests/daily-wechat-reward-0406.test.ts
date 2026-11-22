import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildWechatArticleContent,
    dailyBundleVariants,
    dailyPublishPrep,
    PLACEHOLDER_LINKS,
} from '../scripts/daily-stages';

let stageLog: { mockRestore(): void };
let stageError: { mockRestore(): void };
beforeEach(() => {
    stageLog = spyOn(console, 'log').mockImplementation(() => {});
    stageError = spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    stageLog.mockRestore();
    stageError.mockRestore();
});

/**
 * The daily builder's 公众号 metadata — 赞赏 off, clean top-of-body 今日要点 & digest (2026-11-21).
 *
 * Failure history:
 * - Leaving `reward: true` while the 咸话咸说 account lacks 赞赏 authorization forced operators to set
 *   `WECHATMP_ALLOW_PARTIAL_ENRICH=1`, which masked real audio/original/link failures. Turning
 *   `reward: false` removes the known refusal so real enrichment failures stay fatal.
 * - `article@wechatmp-pub` previously carried a leading `# <title>` heading (rendering a duplicate H1
 *   and leaking `# ` into `digest`) and lacked the opening `## 今日要点` section.
 * - `dailyPublishPrep` previously dropped `durationSeconds` from `metadata` (leaving only top-level
 *   `options.durationSec`), and `dailyBundleVariants` dropped `podcast.planItems` & `podcast.cards`.
 */
describe('daily 公众号 metadata — reward off, 今日要点, stripped H1, clean digest', () => {
    const article = {
        title: '第261121期 · Meta 重新评估 2030 年净零目标',
        body: [
            '# 第261121期 · Meta 重新评估 2030 年净零目标',
            '',
            '这里是由Robin为你带来的咸话咸说之每日AI乱炖。',
            '',
            '## Meta 称正重新评估 2030 年净零目标',
            '',
            'AI 数据中心的用电增长，已经顶到了它的环保承诺上。第二句背景。',
            '',
            '## Anthropic IPO 总募资升至 935 亿美元',
            '',
            '承销商全额行使超额配售权，总募资额达到 935 亿美元。',
        ].join('\n'),
    };
    const base = { links: PLACEHOLDER_LINKS, publishStatus: 'draft' as const, collection: '每日AI资讯' };

    test('the 文章 variant sets reward: true while keeping 原创, 合集, 创作来源, coverSource', () => {
        const content = buildWechatArticleContent(article, base);
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.reward).toBe(true);
        expect(wechatmp.original).toBe(true);
        expect(wechatmp.collection).toBe('每日AI资讯');
        expect(wechatmp.claimSource).toBe('内容由AI生成');
        expect(wechatmp.coverSource).toBe('library');
        expect(typeof wechatmp.author).toBe('string');
        expect((wechatmp.author as string).length).toBeGreaterThan(0);
    });

    test('strips duplicate leading H1, merges short 今日要点 into intro, and sets clean digest', () => {
        const content = buildWechatArticleContent(article, {
            ...base,
            keyPoints: [
                { label: 'Meta 净零目标', text: 'AI 数据中心用电激增，公司重新评估 2030 年净零目标。' },
                { label: 'Anthropic IPO', text: '承销商全额行使绿鞋，IPO 总募资升至 935 亿美元。' },
            ],
        });
        const body = String(content.body ?? '');
        expect(body.startsWith('# 第261121期')).toBe(false);
        expect(body).toContain(
            '这里是由Robin为你带来的咸话咸说之每日AI乱炖。今日要点如下：\n- Meta 净零目标\n- Anthropic IPO\n\n下面请听详细内容。',
        );
        expect(body).not.toContain('## 今日要点');
        const metadata = content.metadata as Record<string, unknown>;
        expect(typeof metadata.digest).toBe('string');
        expect(String(metadata.digest).startsWith('#')).toBe(false);
        expect(Array.from(String(metadata.digest)).length).toBeLessThanOrEqual(120);
        expect(String(metadata.digest).length).toBeGreaterThan(10);
    });

    test('an audio-first 播客 post keeps appendOutro: false semantics and reward: true', () => {
        const content = buildWechatArticleContent(article, {
            ...base,
            appendOutro: false,
            publishStatus: 'public',
            audioPath: '/tmp/episode.mp3',
            audioTitle: '第 1 期',
        });
        const wechatmp = (content.metadata as Record<string, unknown>).wechatmp as Record<string, unknown>;
        expect(wechatmp.reward).toBe(true);
        expect(wechatmp.audioPath).toBe('/tmp/episode.mp3');
        expect(String(content.body ?? '')).not.toContain('欲听往期节目');
        expect(String(content.body ?? '')).not.toContain('今日要点');
    });

    test('dailyPublishPrep and dailyBundleVariants wire durationSeconds, planItems, cards, and 今日要点', () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-daily-bundle-'));
        try {
            const runDate = '20261121';
            for (const sub of [
                '21-plan',
                '22-article',
                '23-cover',
                '24-script',
                '25-xhs/cards',
                '30-audio',
                '31-publish',
            ]) {
                mkdirSync(join(root, sub), { recursive: true });
            }
            const mp3 = join(root, '30-audio', 'ep.mp3');
            const cover = join(root, '23-cover', `${runDate}_07_cover_cover.png`);
            const card1 = join(root, '25-xhs', 'cards', 'card-01.png');
            // Minimal silent MP3 generated via ffmpeg so dailyPublishPrep's stampId3Tags runs cleanly.
            const ff = Bun.spawnSync([
                'ffmpeg',
                '-y',
                '-hide_banner',
                '-loglevel',
                'error',
                '-f',
                'lavfi',
                '-i',
                'anullsrc=r=24000:cl=mono',
                '-t',
                '0.1',
                '-q:a',
                '9',
                mp3,
            ]);
            expect(ff.exitCode).toBe(0);
            writeFileSync(cover, 'png');
            writeFileSync(card1, 'png');

            const planDocs = [
                {
                    id: 'id-1',
                    title: 'Meta 重新评估 2030 年净零目标',
                    body: 'AI 数据中心推高排放增幅。第二句。',
                    metadata: { brief: 'AI 数据中心用电增速超出预期，公司重新评估 2030 年净零目标。' },
                },
                {
                    id: 'id-2',
                    title: 'Anthropic 绿鞋全额行使，募资 935 亿美元',
                    body: '承销商多买 1.47 亿股。',
                    metadata: { brief: '承销商全额行使超额配售权，IPO 总募资达到 935 亿美元。' },
                },
            ];
            writeFileSync(join(root, '21-plan', `${runDate}_03_plan_plan.json`), JSON.stringify(planDocs));
            const articleObj = {
                ...article,
                format: 'markdown',
                metadata: { generator: 'kk:daily-article', doc_count: 2 },
            };
            const articlePath = join(root, '22-article', `${runDate}_06_article_content.json`);
            const scriptPath = join(root, '24-script', `${runDate}_08_script_voicescript.yaml`);
            writeFileSync(articlePath, JSON.stringify(articleObj));
            writeFileSync(scriptPath, 'version: 1\nlines: []\n');
            const digest = createHash('sha256')
                .update(readFileSync(articlePath))
                .update('\0')
                .update(readFileSync(scriptPath))
                .update('\0')
                .digest('hex');
            writeFileSync(
                join(root, '24-script', `${runDate}_09_safety-judge_stamp.json`),
                JSON.stringify({ status: 'pass', digest, excludedPlatforms: [] }),
            );
            writeFileSync(
                join(root, '30-audio', `${runDate}_11_generate_content.json`),
                JSON.stringify({
                    title: article.title,
                    body: 'audio',
                    format: 'markdown',
                    metadata: { mp3Path: mp3, duration: 958.96 },
                }),
            );
            writeFileSync(join(root, '31-publish', `${runDate}_15_show-notes_show-notes.md`), '# Notes\n\nBody\n');
            writeFileSync(
                join(root, '25-xhs', 'cards.json'),
                JSON.stringify({
                    cards: [{ index: '01', copy: '净零与账本', status: 'rendered', imagePath: card1 }],
                }),
            );
            dailyPublishPrep([root, runDate, 'Robin', '每日AI乱炖']);
            dailyBundleVariants([root, runDate]);
            const ep = JSON.parse(
                readFileSync(join(root, '30-variants', 'episode@podcast-pub.content.json'), 'utf-8'),
            ) as { metadata?: { durationSeconds?: number; podcast?: { planItems?: unknown[]; cards?: unknown[] } } };
            expect(ep.metadata?.durationSeconds).toBe(958.96);
            expect((ep.metadata?.podcast?.planItems ?? []).length).toBe(2);
            expect((ep.metadata?.podcast?.cards ?? []).length).toBe(1);

            const wx = JSON.parse(
                readFileSync(join(root, '30-variants', 'article@wechatmp-pub.content.json'), 'utf-8'),
            ) as { body?: string; metadata?: { digest?: string; wechatmp?: Record<string, unknown> } };
            expect(wx.body).toContain('今日要点如下：');
            expect(wx.body?.startsWith('# ')).toBe(false);
            expect(wx.metadata?.wechatmp?.reward).toBe(true);
            expect(String(wx.metadata?.digest ?? '').startsWith('#')).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
