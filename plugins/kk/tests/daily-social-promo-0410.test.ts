import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSocialContent, dailyBundleVariants, weightedLength } from '../scripts/daily-stages';

let logSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };

beforeEach(() => {
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
});

const EPISODE_TITLE = '第261121期 · Meta 重新评估 2030 年净零目标';
const PODCAST_URL = '{{podcast_url}}';
const LIVE_URL = 'https://podcast.salty.vip/i/daily-ai-2026-11-21/';

describe('task 0410 — illustrated social promo assembly', () => {
    test('prepends frozen episode title, appends {{podcast_url}}, and preserves image attachment', () => {
        const platforms = [
            { platform: 'weibo', limit: { max: 2000 } },
            { platform: 'x', limit: { max: 280, weighted: true } },
            { platform: 'threads', limit: { max: 500 } },
            { platform: 'linkedin', limit: { max: 3000 } },
        ] as const;

        for (const entry of platforms) {
            const content = buildSocialContent('Meta 重估 2030 净零，Anthropic 绿鞋拉满至 935 亿美元。', {
                platform: entry.platform,
                limit: entry.limit,
                cardPath: '/tmp/card-01.png',
                coverPath: '/tmp/cover.png',
                episodeTitle: EPISODE_TITLE,
                listenUrl: PODCAST_URL,
            });
            const body = String(content.body);
            expect(content.title).toBe(EPISODE_TITLE);
            expect(body.startsWith(`${EPISODE_TITLE}\n\n`)).toBe(true);
            expect(body.endsWith(PODCAST_URL)).toBe(true);
            expect((content.metadata as Record<string, unknown>).coverImage).toBe('/tmp/card-01.png');
        }
    });

    test('reserves X header and t.co=23 link budget so substituted podcast URL never exceeds 280 weighted', () => {
        const longHook = '今天聊聊大模型基础设施与资本市场新动向：'.repeat(8);
        const content = buildSocialContent(longHook, {
            platform: 'x',
            limit: { max: 280, weighted: true },
            episodeTitle: EPISODE_TITLE,
            listenUrl: PODCAST_URL,
        });
        const body = String(content.body);
        expect(body.endsWith(`\n\n🎧 ${PODCAST_URL}`)).toBe(true);
        const meta = content.metadata as Record<string, unknown>;
        expect(meta.truncatedUnit).toBe('weighted');
        expect(typeof meta.truncatedFrom).toBe('number');
        const resolved = body.replace(PODCAST_URL, LIVE_URL);
        // With t.co shortening (URL weight 23), the composed tweet always stays inside 280 weighted units.
        const xMeasured = weightedLength(resolved.replace(LIVE_URL, 'x'.repeat(23)));
        expect(xMeasured).toBeLessThanOrEqual(280);
    });

    test('avoids duplicating title or listen URL if promo copy already contains them', () => {
        const alreadyFramed = `${EPISODE_TITLE}\n\n精简版钩子\n\n🎧 完整节目：${PODCAST_URL}`;
        const content = buildSocialContent(alreadyFramed, {
            platform: 'weibo',
            limit: { max: 2000 },
            episodeTitle: EPISODE_TITLE,
            listenUrl: PODCAST_URL,
        });
        expect(content.body).toBe(alreadyFramed);
    });

    test('dailyBundleVariants writes framed social_{weibo,x,threads,linkedin}.content.json with card image', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-daily-promo-0410-'));
        try {
            mkdirSync(join(dir, '22-article'), { recursive: true });
            mkdirSync(join(dir, '25-xhs', 'cards'), { recursive: true });
            mkdirSync(join(dir, '26-social'), { recursive: true });
            mkdirSync(join(dir, '31-publish'), { recursive: true });

            const stamp = '20261121';
            const cardPath = join(dir, '25-xhs', 'cards', 'card-01.png');
            writeFileSync(cardPath, 'png');
            writeFileSync(
                join(dir, '22-article', `${stamp}_06_article_content.json`),
                JSON.stringify({ title: EPISODE_TITLE, body: '正文内容', format: 'markdown', metadata: {} }),
            );
            writeFileSync(
                join(dir, '31-publish', `${stamp}_13_publish-prep_content.json`),
                JSON.stringify({
                    title: EPISODE_TITLE,
                    body: '口播',
                    format: 'text',
                    metadata: { audioFile: '/tmp/a.mp3' },
                }),
            );
            writeFileSync(
                join(dir, '25-xhs', 'content.json'),
                JSON.stringify({
                    title: '卡片合集',
                    body: '摘要',
                    format: 'text',
                    metadata: { images: [{ path: cardPath }] },
                }),
            );
            for (const platform of ['weibo', 'x', 'threads', 'linkedin']) {
                writeFileSync(join(dir, '26-social', `${platform}.md`), `${platform} 推广钩子`);
            }

            dailyBundleVariants([dir, stamp, '']);

            for (const platform of ['weibo', 'x', 'threads', 'linkedin']) {
                const variant = JSON.parse(
                    readFileSync(join(dir, '30-variants', `social_${platform}.content.json`), 'utf-8'),
                ) as { title: string; body: string; metadata: { coverImage?: string } };
                expect(variant.title).toBe(EPISODE_TITLE);
                expect(variant.body).toContain(EPISODE_TITLE);
                expect(variant.body).toContain(`${platform} 推广钩子`);
                expect(variant.body).toContain(PODCAST_URL);
                expect(variant.metadata.coverImage).toBe(cardPath);
            }
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
