import { describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import { PodcastPubTransport } from '../src/index';
import { MicrofeedClient } from '../src/microfeed-client';
import {
    buildSeoDescription,
    clauseFromTitle,
    codePointLength,
    dateFromFeedItem,
    durationMinutes,
    firstSentence,
    isoFromLosAngeles,
    isoFromRunDate,
    isValidItemSlug,
    keywordFromDocTitle,
    keywordsFromRefinedTitle,
    normalizeEpisodeTitle,
    type PodcastSeoConfig,
    planItemsFromMetadata,
    prepareEpisodeFields,
    readImageDimensions,
    renderSlug,
    resolveEpisodeDate,
    resolvePodcastSeoConfig,
    rewriteEpisodeHtml,
    roundDurationSeconds,
    SEO_DEFAULTS,
    sanitizeTitle,
    seasonAndEpisode,
    showNotesSummaryParagraph,
    summaryParagraphHtml,
    titlesFromContentHtml,
} from '../src/seo';
import { renderShowNotesHtml, renderShowNotesMarkdown } from '../src/show-notes';

const ENV_KEYS = [
    'MICROFEED_BASE_URL',
    'MICROFEED_API_KEY',
    'MICROFEED_TIMEOUT_MS',
    'PODCAST_PUB_SEO',
    'PODCAST_PUB_EPISODE_TITLE_MODE',
    'PODCAST_PUB_EPISODE_TITLE_PATTERN',
    'PODCAST_PUB_SERIES_NAME',
    'PODCAST_PUB_SHOW_NAME',
    'PODCAST_PUB_TITLE_MAX',
    'PODCAST_PUB_TITLE_MAX_KEYWORDS',
    'PODCAST_PUB_SEO_TITLE_SUFFIX',
    'PODCAST_PUB_SEO_TITLE_MAX',
    'PODCAST_PUB_SEO_DESCRIPTION_MIN',
    'PODCAST_PUB_SEO_DESCRIPTION_MAX',
    'PODCAST_PUB_SEO_DESCRIPTION_SOURCE',
    'PODCAST_PUB_SEO_DESCRIPTION_PATTERN',
    'PODCAST_PUB_SUMMARY_PARAGRAPH',
    'PODCAST_PUB_TIMELINE_INLINE_STYLE',
    'PODCAST_PUB_AUTO_EPISODE_NUMBER',
    'PODCAST_PUB_TITLE_SANITIZE',
    'PODCAST_PUB_LINK_FIELD',
    'PODCAST_PUB_SLUG',
    'PODCAST_PUB_SLUG_PATTERN',
    'PODCAST_PUB_SOCIAL_IMAGE',
    'PODCAST_PUB_SOCIAL_IMAGE_ALT_PATTERN',
    'PODCAST_PUB_ROUND_DURATION',
];

const LEGACY_ENV: Record<string, string> = {
    MICROFEED_BASE_URL: 'https://feed.example.com',
    MICROFEED_API_KEY: 'mf_test_key',
    PODCAST_PUB_EPISODE_TITLE_MODE: 'as-is',
    PODCAST_PUB_SEO: 'false',
    PODCAST_PUB_SUMMARY_PARAGRAPH: 'false',
    PODCAST_PUB_TIMELINE_INLINE_STYLE: 'before',
    PODCAST_PUB_AUTO_EPISODE_NUMBER: 'false',
    PODCAST_PUB_LINK_FIELD: 'url',
    PODCAST_PUB_SLUG: 'auto',
    PODCAST_PUB_ROUND_DURATION: 'false',
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved: Record<string, string | undefined> = {};
    for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
        if (env[key] === undefined) delete process.env[key];
        else process.env[key] = env[key];
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

interface CapturedRequest {
    url: string;
    method: string;
    headers: Headers;
    body: unknown;
}

function requestBody(request: CapturedRequest | undefined): Record<string, unknown> {
    const body = request?.body;
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function microfeedOf(request: CapturedRequest | undefined): Record<string, unknown> {
    const value = requestBody(request)._microfeed;
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function installFakeApi(
    routes: Array<{
        match: (req: { url: string; method: string }) => boolean;
        respond: (req: { url: string; method: string }) => Response;
    }>,
): { requests: CapturedRequest[]; restore: () => void } {
    const requests: CapturedRequest[] = [];
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
        const captured: CapturedRequest = {
            url: String(input),
            method: init?.method ?? 'GET',
            headers: new Headers(init?.headers),
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        };
        requests.push(captured);
        const route = routes.find((candidate) => candidate.match({ url: captured.url, method: captured.method }));
        if (!route) throw new Error(`fake API has no route for ${captured.method} ${captured.url}`);
        return route.respond({ url: captured.url, method: captured.method });
    }) as typeof fetch);
    return { requests, restore: () => spy.mockRestore() };
}

function episodeContent(metadata: Record<string, unknown> = {}): Content {
    return {
        title: 'Episode 1: Ground Up',
        body: '# Episode 1: Ground Up\n\nShow notes body.',
        format: 'markdown',
        metadata,
    };
}

function png(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes;
}

function jpeg(width: number, height: number, marker = 0xc0): Uint8Array {
    const bytes = new Uint8Array(19);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    bytes[2] = 0xff;
    bytes[3] = 0xe0;
    view.setUint16(4, 4);
    bytes[8] = 0xff;
    bytes[9] = marker;
    view.setUint16(10, 11);
    bytes[12] = 8;
    view.setUint16(13, height);
    view.setUint16(15, width);
    return bytes;
}

const BASE = { MICROFEED_BASE_URL: 'https://feed.example.com', MICROFEED_API_KEY: 'mf_test_key' };

function seoConfig(metadata?: Record<string, unknown>, env?: Record<string, string | undefined>): PodcastSeoConfig {
    const resolved = resolvePodcastSeoConfig(metadata, env);
    if ('error' in resolved) throw new Error(resolved.error);
    return resolved.config;
}

function seoConfigError(metadata?: Record<string, unknown>, env?: Record<string, string | undefined>): string {
    const resolved = resolvePodcastSeoConfig(metadata, env);
    if (!('error' in resolved)) throw new Error('expected a config error');
    return resolved.error;
}

describe('podcast-pub SEO config (R13)', () => {
    test('defaults, empty env, item overrides, and invalid values', () => {
        expect(resolvePodcastSeoConfig(undefined, {})).toEqual({ config: SEO_DEFAULTS });
        expect(seoConfig(undefined, { PODCAST_PUB_SEO: '' }).seo).toBe(true);
        const item = resolvePodcastSeoConfig(
            { podcast: { seo: false, titleMode: 'headline', linkField: 'url', timelineInlineStyle: 'before' } },
            { PODCAST_PUB_SEO: 'true', PODCAST_PUB_EPISODE_TITLE_MODE: 'as-is' },
        );
        expect(item).toMatchObject({
            config: { seo: false, titleMode: 'headline', linkField: 'url', timelineStyle: 'before' },
        });
        expect(seoConfig(undefined, { PODCAST_PUB_TIMELINE_INLINE_STYLE: 'true' }).timelineStyle).toBe('after');
        expect(seoConfig(undefined, { PODCAST_PUB_TIMELINE_INLINE_STYLE: 'false' }).timelineStyle).toBe('omit');
        expect(seoConfig(undefined, { PODCAST_PUB_SEO: '1' }).seo).toBe(true);
        expect(seoConfig(undefined, { PODCAST_PUB_ROUND_DURATION: '0' }).roundDuration).toBe(false);
        expect(seoConfigError(undefined, { PODCAST_PUB_EPISODE_TITLE_MODE: 'nope' })).toContain(
            'invalid PODCAST_PUB_EPISODE_TITLE_MODE "nope"',
        );
        expect(seoConfigError(undefined, { PODCAST_PUB_SEO: 'maybe' })).toContain('PODCAST_PUB_SEO');
        expect(seoConfigError(undefined, { PODCAST_PUB_TITLE_MAX: '0' })).toContain('PODCAST_PUB_TITLE_MAX');
        expect(
            seoConfigError(undefined, {
                PODCAST_PUB_SEO_DESCRIPTION_MIN: '200',
                PODCAST_PUB_SEO_DESCRIPTION_MAX: '100',
            }),
        ).toContain('PODCAST_PUB_SEO_DESCRIPTION_MIN');
        expect(
            seoConfigError(undefined, {
                PODCAST_PUB_SEO_TITLE_SUFFIX: 'x'.repeat(60),
                PODCAST_PUB_SEO_TITLE_MAX: '60',
            }),
        ).toContain('PODCAST_PUB_SEO_TITLE_SUFFIX');
        expect(seoConfigError({ podcast: { titleMode: 1 } })).toContain('metadata.podcast.titleMode');
    });
});

describe('podcast-pub titles, descriptions, and numbering (R1–R6, R11)', () => {
    test('sanitise, JSON-LD safety, and reject mode', () => {
        expect(sanitizeTitle('Claude "Mythos" \\ test', 'normalize')).toEqual({
            ok: true,
            value: 'Claude “Mythos” ＼ test',
        });
        expect(sanitizeTitle('a " lone', 'normalize')).toEqual({ ok: true, value: 'a ” lone' });
        expect(sanitizeTitle('a "b" c "d', 'normalize').ok && sanitizeTitle('a "b" c "d', 'normalize')).toMatchObject({
            value: 'a “b” c ”d',
        });
        const controls = sanitizeTitle(' \u0001a\u2028b\u2029<c> ', 'normalize');
        expect(controls).toEqual({ ok: true, value: 'ab〈c〉' });
        const rejected = sanitizeTitle('Claude "Mythos" \\ test', 'reject');
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) {
            expect(rejected.error).toContain('"');
            expect(rejected.error).toContain('\\');
        }
        const random = (seed: number) => {
            let state = seed;
            return () => {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                return state;
            };
        };
        const next = random(7);
        const alphabet = ['a', '汉', '"', '\\', '<', '>', '\n', '\u0007', ' '];
        for (let i = 0; i < 40; i++) {
            let raw = '';
            const length = (next() % 24) + 1;
            for (let n = 0; n < length; n++) raw += alphabet[next() % alphabet.length] ?? 'a';
            const cleaned = sanitizeTitle(raw, 'normalize');
            expect(cleaned.ok).toBe(true);
            if (cleaned.ok) expect(() => JSON.parse(`"${cleaned.value}"`)).not.toThrow();
        }
    });

    test('normalises legacy series names without splitting the series token', () => {
        for (const legacy of ['每日 AI 资讯', '每日AI资讯', 'AI 乱炖', 'AI乱炖']) {
            expect(normalizeEpisodeTitle(`${legacy} · 2026-10-21：甲`, '每日AI乱炖')).toBe(
                '每日AI乱炖 · 2026-10-21：甲',
            );
        }
        expect(normalizeEpisodeTitle('每日AI乱炖 · 2026-10-21：甲 · 2026-10-21', '每日AI乱炖')).toBe(
            '每日AI乱炖 · 2026-10-21：甲',
        );
        expect(normalizeEpisodeTitle('每日AI乱炖 · 2026-10-21：甲 · 2026-10-22', '每日AI乱炖')).toContain('2026-10-22');
        expect(normalizeEpisodeTitle('每日AI乱炖GPT4发布', '每日AI乱炖')).toBe('每日AI乱炖 GPT4 发布');
        expect(normalizeEpisodeTitle('  GPT4发布  ', '每日AI乱炖')).toBe('GPT4 发布');
    });

    test('keyword sources, length cap, and the SEO suffix that is never cut', () => {
        expect(
            keywordsFromRefinedTitle(
                '每日AI乱炖 · 2026-10-21：Meta 删掉训练条款、Muse 分享链接被计数、Gemini 私人智能上车',
            ),
        ).toEqual(['Meta 删掉训练条款', 'Muse 分享链接被计数', 'Gemini 私人智能上车']);
        expect(keywordsFromRefinedTitle('没有冒号')).toEqual([]);
        const cutKeyword = keywordFromDocTitle('艺术家在 OpenAI 开发者活动外展出，后半');
        expect(cutKeyword.startsWith('艺术家在 OpenAI')).toBe(true);
        expect(cutKeyword).not.toContain('后半');
        expect(codePointLength(cutKeyword)).toBe(15);
        expect(codePointLength(keywordFromDocTitle('一二三四五六七八九十一二三四五六七'))).toBe(15);
        expect(clauseFromTitle('甲「train」，乙')).toBe('甲train');
        expect(firstSentence('')).toBe('');
        expect(firstSentence('一句。二句')).toBe('一句。');
        expect(
            planItemsFromMetadata({ podcast: { planItems: [{ title: '甲', brief: '简' }, { title: '' }, 'nope'] } }),
        ).toEqual([{ title: '甲', brief: '简' }]);
        const refined = prepareEpisodeFields(
            { title: '每日AI乱炖 · 2026-10-22', durationSeconds: 1075.3 },
            {
                runDate: '20261022',
                podcast: {
                    titleMode: 'headline',
                    refinedTitle:
                        '每日AI乱炖 · 2026-10-22：Meta 删掉训练条款、Muse 分享链接被计数、Gemini 私人智能上车',
                },
            },
            { ...SEO_DEFAULTS, titleMode: 'headline' },
        );
        expect(refined.ok).toBe(true);
        if (refined.ok)
            expect(refined.fields.title).toBe('每日AI乱炖 · 2026-10-22：Meta 删掉训练条款、Muse 分享链接被计数');
        const explicit = prepareEpisodeFields(
            { title: 'ignored' },
            {
                runDate: '20261021',
                podcast: {
                    titleMode: 'headline',
                    titleKeywords: ['Meta 删掉训练条款', 'Gemini 私人智能上车', '第三条'],
                },
            },
            { ...SEO_DEFAULTS, titleMode: 'headline' },
        );
        expect(explicit.ok).toBe(true);
        if (explicit.ok) {
            expect(explicit.fields.title).toBe('每日AI乱炖 · 2026-10-21：Meta 删掉训练条款、Gemini 私人智能上车');
        }
        const long = prepareEpisodeFields(
            { title: 'as-is' },
            {
                runDate: '20261022',
                podcast: {
                    refinedTitle: '每日AI乱炖 · 2026-10-22：OpenAI 的旗舰模型、DeepSeek 的 Flash、四台 Mac Studio',
                },
            },
            { ...SEO_DEFAULTS, titleMode: 'headline', titleMax: 80, titleMaxKeywords: 3 },
        );
        expect(long.ok).toBe(true);
        if (long.ok) {
            const seoTitle = long.fields.seo?.title ?? '';
            expect(seoTitle.endsWith('｜咸话咸说')).toBe(true);
            expect(codePointLength(seoTitle)).toBeLessThanOrEqual(60);
            expect(seoTitle).not.toContain('四台');
            expect(long.fields.title).not.toContain('四台');
            expect(long.fields.title.endsWith('｜咸话咸说')).toBe(false);
        }
        const keptTitle = '甲'.repeat(70);
        const explicitTitle = prepareEpisodeFields(
            { title: 'ignored' },
            { runDate: '20261006', podcast: { title: keptTitle } },
            { ...SEO_DEFAULTS, titleMode: 'headline', titleMax: 80 },
        );
        expect(explicitTitle.ok).toBe(true);
        if (explicitTitle.ok) {
            expect(explicitTitle.fields.title).toBe(keptTitle);
            expect(explicitTitle.fields.seo?.title?.endsWith('｜咸话咸说')).toBe(true);
            expect(codePointLength(explicitTitle.fields.seo?.title ?? '')).toBeLessThanOrEqual(60);
        }
        const missing = prepareEpisodeFields(
            { title: '每日 AI 资讯 — 2026-09-25' },
            { runDate: '20260925', podcast: {} },
            { ...SEO_DEFAULTS, titleMode: 'headline' },
        );
        expect(missing.ok).toBe(true);
        if (missing.ok) {
            expect(missing.fields.title).toBe('每日AI乱炖 — 2026-09-25');
            expect(missing.fields.warnings.join('\n')).toContain('no keywords');
        }
        const asIs = prepareEpisodeFields(
            { title: '每日 AI 资讯 — 2026-09-25' },
            { runDate: '20260925' },
            SEO_DEFAULTS,
        );
        expect(asIs.ok).toBe(true);
        if (asIs.ok) expect(asIs.fields.title).toBe('每日 AI 资讯 — 2026-09-25');
        const cutOne = prepareEpisodeFields(
            { title: 'as-is' },
            { runDate: '20261021', podcast: { titleKeywords: ['超长的关键词，后面不要'] } },
            { ...SEO_DEFAULTS, titleMode: 'headline', titleMax: 28, titleMaxKeywords: 1 },
        );
        expect(cutOne.ok).toBe(true);
        if (cutOne.ok) {
            expect(cutOne.fields.title).not.toContain('后面不要');
            expect(cutOne.fields.title).toContain('超长的关键词');
        }
        const noDate = prepareEpisodeFields(
            { title: 'keep me' },
            { podcast: { titleKeywords: ['甲'] } },
            { ...SEO_DEFAULTS, titleMode: 'headline' },
        );
        expect(noDate.ok).toBe(true);
        if (noDate.ok) {
            expect(noDate.fields.title).toBe('keep me');
            expect(noDate.fields.warnings.join('\n')).toContain('episode date is unknown');
        }
        const itunesTitle = prepareEpisodeFields(
            { title: 'Ep', itunes: { title: 'Claude "Mythos"' } },
            { runDate: '20261021' },
            SEO_DEFAULTS,
        );
        expect(itunesTitle.ok).toBe(true);
        if (itunesTitle.ok) expect(itunesTitle.fields.itunes?.title).toBe('Claude “Mythos”');
        const itunesReject = prepareEpisodeFields(
            { title: 'Ep', itunes: { title: 'bad " quote' } },
            { runDate: '20261021' },
            { ...SEO_DEFAULTS, titleSanitize: 'reject' },
        );
        expect(itunesReject.ok).toBe(false);
        const longAlt = prepareEpisodeFields(
            { title: 'Ep' },
            { runDate: '20261021', podcast: { socialImage: 'https://cdn.example.com/x.png', titleKeywords: ['甲'] } },
            { ...SEO_DEFAULTS, socialImage: true, socialImageAltPattern: '封'.repeat(220) },
        );
        expect(longAlt.ok).toBe(true);
        if (longAlt.ok) expect(codePointLength(longAlt.fields.socialAlt ?? '')).toBeLessThanOrEqual(200);
    });

    test('description length, minutes, surfing source, and forbidden starts', () => {
        expect(durationMinutes(1075.3)).toBe(18);
        expect(durationMinutes(0)).toBeUndefined();
        expect(durationMinutes(undefined)).toBeUndefined();
        expect(roundDurationSeconds(1252.104792, true)).toBe(1252);
        expect(roundDurationSeconds(1234.5, true)).toBe(1235);
        expect(roundDurationSeconds(1234.5, false)).toBe(1234.5);
        expect(roundDurationSeconds(undefined, true)).toBeUndefined();
        const described = buildSeoDescription({
            config: SEO_DEFAULTS,
            date: '2026-10-21',
            minutes: 18,
            clauses: [
                'Meta 从商业服务条款删掉「train」一词',
                'Gemini Personal Intelligence 登陆 Android Auto',
                'Meta Muse 分享链接泄露个人与商业机密',
                'DeepSeek 开源推理引擎 DeepInfer',
                'REMORY',
            ],
            extraSentences: [],
        });
        expect(described.description).toBe(
            '咸话咸说·每日AI乱炖 2026-10-21（约 18 分钟）：Meta 从商业服务条款删掉「train」一词；Gemini Personal Intelligence 登陆 Android Auto；Meta Muse 分享链接泄露个人与商业机密；DeepSeek 开源推理引擎 DeepInfer。',
        );
        expect(codePointLength(described.description)).toBeGreaterThanOrEqual(120);
        expect(codePointLength(described.description)).toBeLessThanOrEqual(155);
        expect(described.short).toBe(false);
        const padded = prepareEpisodeFields(
            { title: 'Ep', durationSeconds: 60 },
            {
                runDate: '20261021',
                podcast: {
                    planItems: [
                        {
                            title: '短',
                            brief: '这是补齐用的第一句，里面有足够的字以便描述跨过一百二十个字的下限，继续写到这里应该就够了。后一句不要。',
                        },
                    ],
                },
            },
            SEO_DEFAULTS,
        );
        expect(padded.ok).toBe(true);
        if (padded.ok) {
            expect(padded.fields.seo?.description).toContain('这是补齐用的第一句');
            expect(padded.fields.seo?.description).not.toContain('后一句');
        }
        const surfing = prepareEpisodeFields(
            { title: 'Ep', durationSeconds: 600 },
            {
                runDate: '20261021',
                podcast: {
                    refinedDescription: '来自 Surfing 的描述，足够长。'.repeat(8),
                    descriptionSource: 'surfing',
                },
            },
            { ...SEO_DEFAULTS, descriptionSource: 'surfing' },
        );
        expect(surfing.ok).toBe(true);
        if (surfing.ok)
            expect(surfing.fields.seo?.description?.startsWith('咸话咸说·每日AI乱炖 2026-10-21（约 10 分钟）：')).toBe(
                true,
            );
        const next = (() => {
            let state = 99;
            return () => {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
                return state;
            };
        })();
        for (let i = 0; i < 30; i++) {
            const clauses = ['1. 开头', '# 标题', '- 列表', '0:00 时间', '普通条款'].slice(0, (next() % 5) + 1);
            const built = buildSeoDescription({
                config: SEO_DEFAULTS,
                date: '2026-10-21',
                minutes: (next() % 30) + 1,
                clauses,
                extraSentences: ['补充一句。'],
            });
            expect(built.description).not.toMatch(/^\s*(\d|#|[-*])/);
            expect(built.description).not.toMatch(/[<>\n]/);
            expect(codePointLength(built.description)).toBeLessThanOrEqual(SEO_DEFAULTS.descriptionMax);
        }
    });

    test('day-of-year numbers use the UTC calendar and explicit values win', () => {
        expect(isoFromRunDate('20260925')).toBe('2026-09-25');
        expect(isoFromRunDate('2026-02-31')).toBeUndefined();
        expect(isoFromRunDate('nope')).toBeUndefined();
        expect(isoFromLosAngeles(Number.NaN)).toBeUndefined();
        expect(isoFromLosAngeles(Date.parse('2026-10-22T06:30:00Z'))).toBe('2026-10-21');
        expect(seasonAndEpisode('nope')).toBeUndefined();
        expect(seasonAndEpisode('2026-02-31')).toBeUndefined();
        const cases: Array<[string, number]> = [
            ['20260925', 268],
            ['20260929', 272],
            ['20261021', 294],
            ['20261231', 365],
            ['20280229', 60],
        ];
        for (const [runDate, episode] of cases) {
            const prepared = prepareEpisodeFields({ title: 'Ep' }, { runDate }, SEO_DEFAULTS);
            expect(prepared.ok).toBe(true);
            if (prepared.ok) {
                expect(prepared.fields.itunes?.season).toBe(Number(runDate.slice(0, 4)));
                expect(prepared.fields.itunes?.episode).toBe(episode);
                expect(prepared.fields.itunes?.episodeType).toBeUndefined();
            }
        }
        const kept = prepareEpisodeFields(
            { title: 'Ep', itunes: { season: 2026, episode: 999, episodeType: 'full' } },
            { runDate: '20261021' },
            SEO_DEFAULTS,
        );
        expect(kept.ok).toBe(true);
        if (kept.ok) expect(kept.fields.itunes).toMatchObject({ season: 2026, episode: 999, episodeType: 'full' });
        const zero = prepareEpisodeFields(
            { title: 'Ep', itunes: { episode: 0 } },
            { runDate: '20261021' },
            SEO_DEFAULTS,
        );
        expect(zero.ok).toBe(false);
        if (!zero.ok) expect(zero.error).toContain('itunes.episode');
        const fractional = prepareEpisodeFields(
            { title: 'Ep', itunes: { season: 1.5 } },
            { runDate: '20261021' },
            SEO_DEFAULTS,
        );
        expect(fractional.ok).toBe(false);
        const off = prepareEpisodeFields(
            { title: 'Ep' },
            { runDate: '20261021' },
            { ...SEO_DEFAULTS, autoEpisodeNumber: false },
        );
        expect(off.ok).toBe(true);
        if (off.ok) expect(off.fields.itunes?.episode).toBeUndefined();
        expect(resolveEpisodeDate({ publishedAt: '2026-10-22T06:30:00Z' })).toBe('2026-10-21');
        expect(resolveEpisodeDate({ publishedAt: 'not-a-date' })).toBeUndefined();
        expect(
            dateFromFeedItem({
                title: '每日AI乱炖 · 2026-10-21',
                date_published_ms: Date.parse('2020-01-01T00:00:00Z'),
            }),
        ).toBe('2026-10-21');
        expect(dateFromFeedItem({ title: 'no date', date_published: '2026-10-22T06:30:00Z' })).toBe('2026-10-21');
        expect(dateFromFeedItem({ title: 'no date' })).toBeUndefined();
    });
});

describe('podcast-pub slug, link, social image, and legacy payload (R7–R9)', () => {
    test('slug rules fail before the network, and a 409 retries then publishes', async () => {
        expect(isValidItemSlug('daily-ai-2026-10-22')).toBe(true);
        expect(isValidItemSlug('daily-ai-2026-10-22-')).toBe(false);
        expect(isValidItemSlug('')).toBe(false);
        expect(renderSlug('daily-ai-{date}', undefined).warning).toContain('episode date is unknown');
        expect(renderSlug('Nope-{date}', '2026-10-22').error).toContain('PODCAST_PUB_SLUG_PATTERN');
        await withEnv(BASE, async () => {
            const api = installFakeApi([]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        runDate: '20261022',
                        podcast: { slugPattern: 'Nope-{date}' },
                    }),
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('PODCAST_PUB_SLUG_PATTERN');
                expect(api.requests.length).toBe(0);
            } finally {
                api.restore();
            }
        });
        await withEnv(BASE, async () => {
            let api: { requests: CapturedRequest[]; restore: () => void };
            api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => {
                        const body = api.requests.at(-1)?.body as { _microfeed?: { slug?: string } };
                        const slug = body._microfeed?.slug ?? '';
                        if (slug === 'daily-ai-2026-10-22') {
                            return new Response(JSON.stringify({ error: 'taken' }), {
                                status: 409,
                                statusText: 'Conflict',
                            });
                        }
                        return new Response(JSON.stringify({ id: 'SLUG1' }), { status: 201 });
                    },
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep.mp3', runDate: '20261022' }),
                });
                expect(result.ok).toBe(true);
                const creates = api.requests.filter((req) => req.method === 'POST');
                const slugs = creates.map((req) => (req.body as { _microfeed?: { slug?: string } })._microfeed?.slug);
                expect(slugs[0]).toBe('daily-ai-2026-10-22');
                expect(slugs[1]).toBe('daily-ai-2026-10-22-2');
                const keys = creates.map((req) => req.headers.get('Idempotency-Key'));
                expect(keys[0]).not.toBe(keys[1]);
            } finally {
                api.restore();
            }
        });
        await withEnv(BASE, async () => {
            let api: { requests: CapturedRequest[]; restore: () => void };
            api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => {
                        const body = api.requests.at(-1)?.body as { _microfeed?: { slug?: string } };
                        if (body._microfeed?.slug) {
                            return new Response(JSON.stringify({ error: 'taken' }), {
                                status: 409,
                                statusText: 'Conflict',
                            });
                        }
                        return new Response(JSON.stringify({ id: 'SLUG2' }), { status: 201 });
                    },
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep.mp3', runDate: '20261022' }),
                });
                expect(result.ok).toBe(true);
                expect(result.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('publishing without a custom slug')]),
                );
                const creates = api.requests.filter((req) => req.method === 'POST');
                expect(creates).toHaveLength(3);
                expect(microfeedOf(creates[2]).slug).toBeUndefined();
            } finally {
                api.restore();
            }
        });
    });

    test('two-phase create carries the slug and the publish update does not', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'podcast-seo-'));
        const audioPath = join(dir, 'episode.mp3');
        await writeFile(audioPath, new Uint8Array([1, 2, 3, 4]));
        await withEnv(BASE, async () => {
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'TWO1' }), { status: 201 }),
                },
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/presigned_urls'),
                    respond: () =>
                        new Response(
                            JSON.stringify({
                                presigned_url: 'https://feed.example.com/presign/TWO1',
                                media_url: 'https://media.example.com/a.mp3',
                            }),
                            { status: 201 },
                        ),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.includes('/presign/'),
                    respond: () => new Response(null, { status: 200 }),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.endsWith('/api/v1/items/TWO1'),
                    respond: () =>
                        new Response(JSON.stringify({ id: 'TWO1', url: 'https://feed.example.com/items/TWO1' }), {
                            status: 200,
                        }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioFile: audioPath, runDate: '20261022' }),
                });
                expect(result.ok).toBe(true);
                const create = api.requests[0]?.body as { _microfeed?: { slug?: string; seo?: unknown } };
                expect(create._microfeed?.slug).toBe('daily-ai-2026-10-22');
                expect(create._microfeed?.seo).toBeUndefined();
                const finalize = api.requests.at(-1)?.body as {
                    _microfeed?: { slug?: string; seo?: { title?: string } };
                };
                expect(finalize._microfeed?.slug).toBeUndefined();
                expect(finalize._microfeed?.seo?.title).toContain('｜咸话咸说');
            } finally {
                api.restore();
            }
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('link field none drops url; url mode warns', async () => {
        await withEnv(BASE, async () => {
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'URL1' }), { status: 201 }),
                },
            ]);
            try {
                const none = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        articleUrl: 'https://surfing.salty.vip/zh/posts/x',
                    }),
                });
                expect(none.ok).toBe(true);
                expect(requestBody(api.requests[0]).url).toBeUndefined();
                api.requests.length = 0;
                const linked = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        articleUrl: 'https://surfing.salty.vip/zh/posts/x',
                        podcast: { linkField: 'url' },
                    }),
                });
                expect(linked.ok).toBe(true);
                expect(requestBody(api.requests[0]).url).toBe('https://surfing.salty.vip/zh/posts/x');
                expect(linked.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('drops the episode from the podcast sitemap')]),
                );
            } finally {
                api.restore();
            }
        });
    });

    test('social image is off unless the flag and a 1200×630 image agree', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'podcast-social-'));
        const good = join(dir, 'good.png');
        const bad = join(dir, 'bad.png');
        const jpegPath = join(dir, 'good.jpg');
        await writeFile(good, png(1200, 630));
        await writeFile(bad, png(3000, 3000));
        await writeFile(jpegPath, jpeg(1200, 630, 0xc2));
        expect(readImageDimensions(png(1200, 630))).toEqual({ width: 1200, height: 630, mime: 'image/png' });
        expect(readImageDimensions(jpeg(1200, 630))).toEqual({ width: 1200, height: 630, mime: 'image/jpeg' });
        expect(readImageDimensions(jpeg(8, 8, 0xc2))?.mime).toBe('image/jpeg');
        expect(readImageDimensions(new Uint8Array([0x89, 0x50]))).toBeUndefined();
        expect(readImageDimensions(new Uint8Array([0xff, 0xd8, 0x00]))).toBeUndefined();
        const sof = jpeg(40, 50).slice(8);
        const restart = new Uint8Array(4 + sof.length);
        restart.set([0xff, 0xd8, 0xff, 0xd0], 0);
        restart.set(sof, 4);
        expect(readImageDimensions(restart)?.width).toBe(40);
        const withSoi = new Uint8Array(4 + jpeg(11, 22).length - 2);
        withSoi.set([0xff, 0xd8, 0xff, 0xd8], 0);
        withSoi.set(jpeg(11, 22).slice(2), 4);
        expect(readImageDimensions(withSoi)?.height).toBe(22);
        expect(readImageDimensions(png(1, 1).slice(0, 8))).toBeUndefined();
        await withEnv({ ...BASE, PODCAST_PUB_SOCIAL_IMAGE: 'true' }, async () => {
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'IMG1' }), { status: 201 }),
                },
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/presigned_urls'),
                    respond: () =>
                        new Response(
                            JSON.stringify({
                                presigned_url: 'https://feed.example.com/presign/img',
                                media_url: 'https://media.example.com/social.png',
                            }),
                            { status: 201 },
                        ),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.includes('/presign/'),
                    respond: () => new Response(null, { status: 200 }),
                },
                {
                    match: (req) => req.url === 'https://cdn.example.com/social.png',
                    respond: () => new Response(png(1200, 630)),
                },
                {
                    match: (req) => req.url === 'https://cdn.example.com/huge.png',
                    respond: () => new Response(png(3000, 3000)),
                },
                {
                    match: (req) => req.url === 'https://cdn.example.com/missing.png',
                    respond: () => new Response('nope', { status: 404, statusText: 'Not Found' }),
                },
            ]);
            try {
                const off = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: good, socialImageEnabled: false },
                    }),
                });
                expect(off.ok).toBe(true);
                const offSeo = microfeedOf(api.requests[0]).seo as { social_image?: unknown } | undefined;
                expect(offSeo?.social_image).toBeUndefined();
                api.requests.length = 0;
                const local = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        runDate: '20261022',
                        podcast: { socialImage: good, titleKeywords: ['甲', '乙'] },
                    }),
                });
                expect(local.ok).toBe(true);
                const created = api.requests.find((req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'));
                const social = (
                    microfeedOf(created).seo as
                        | { social_image?: { width: number; alt: string; url: string } }
                        | undefined
                )?.social_image;
                expect(social).toMatchObject({
                    width: 1200,
                    height: 630,
                    mime_type: 'image/png',
                    url: 'https://media.example.com/social.png',
                });
                expect(social?.alt).toContain('封面');
                api.requests.length = 0;
                const skipped = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: bad },
                    }),
                });
                expect(skipped.ok).toBe(true);
                expect(skipped.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('3000×3000')]),
                );
                api.requests.length = 0;
                const remote = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: 'https://cdn.example.com/social.png' },
                    }),
                });
                expect(remote.ok).toBe(true);
                const remoteBody = api.requests.find(
                    (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                );
                const remoteSeo = microfeedOf(remoteBody).seo as { social_image?: { url: string } } | undefined;
                expect(remoteSeo?.social_image?.url).toBe('https://cdn.example.com/social.png');
                api.requests.length = 0;
                const huge = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: 'https://cdn.example.com/huge.png' },
                    }),
                });
                expect(huge.ok).toBe(true);
                expect(huge.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('social image skipped')]),
                );
                const missing = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: 'https://cdn.example.com/missing.png' },
                    }),
                });
                expect(missing.ok).toBe(true);
                expect(missing.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('could not read')]),
                );
                const unread = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        podcast: { socialImage: join(dir, 'nope.png') },
                    }),
                });
                expect(unread.ok).toBe(true);
                expect(unread.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('unreadable')]),
                );
                const empty = prepareEpisodeFields(
                    { title: 'Ep' },
                    { podcast: { socialImage: '   ' } },
                    { ...SEO_DEFAULTS, socialImage: true },
                );
                expect(empty.ok).toBe(true);
                if (empty.ok) expect(empty.fields.warnings.join('\n')).toContain('socialImage is empty');
                const jpegPrepared = prepareEpisodeFields(
                    { title: 'Ep' },
                    { runDate: '20261022', podcast: { socialImage: jpegPath, titleKeywords: ['甲'] } },
                    { ...SEO_DEFAULTS, socialImage: true },
                );
                expect(jpegPrepared.ok).toBe(true);
                if (jpegPrepared.ok) expect(jpegPrepared.fields.socialMime).toBe('image/jpeg');
            } finally {
                api.restore();
            }
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('legacy flags reproduce the pre-D9 publish payload', async () => {
        await withEnv(LEGACY_ENV, async () => {
            const dir = await mkdtemp(join(tmpdir(), 'podcast-legacy-'));
            const audioPath = join(dir, 'episode.mp3');
            await writeFile(audioPath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items'),
                    respond: () => new Response(JSON.stringify({ id: 'LEG1' }), { status: 201 }),
                },
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/presigned_urls'),
                    respond: () =>
                        new Response(
                            JSON.stringify({
                                presigned_url: 'https://feed.example.com/presign/LEG1',
                                media_url: 'https://media.example.com/media/audio/LEG1.wav',
                            }),
                            { status: 201 },
                        ),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.includes('/presign/'),
                    respond: () => new Response(null, { status: 200 }),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.endsWith('/api/v1/items/LEG1'),
                    respond: () => new Response(JSON.stringify({ id: 'LEG1' }), { status: 200 }),
                },
            ]);
            try {
                const hosted = await new PodcastPubTransport().publish({
                    content: episodeContent({
                        audioUrl: 'https://cdn.example.com/ep.mp3',
                        durationSeconds: 1234.5,
                        articleUrl: 'https://surfdash.example.com/zh/posts/x',
                        coverImage: 'https://cdn.example.com/cover.png',
                        publishedAt: 1725475200000,
                    }),
                });
                expect(hosted.ok).toBe(true);
                expect(api.requests[0]?.body).toEqual({
                    title: 'Episode 1: Ground Up',
                    content_html: '<p>Show notes body.</p>',
                    status: 'published',
                    attachments: [
                        {
                            category: 'audio',
                            url: 'https://cdn.example.com/ep.mp3',
                            mime_type: 'audio/mpeg',
                            duration_in_seconds: 1234.5,
                        },
                    ],
                    image: 'https://cdn.example.com/cover.png',
                    date_published_ms: 1725475200000,
                    url: 'https://surfdash.example.com/zh/posts/x',
                    _microfeed: { 'itunes:episodeType': 'full' },
                });
                const drafted = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioFile: audioPath }),
                });
                expect(drafted.ok).toBe(true);
                expect(
                    api.requests.find(
                        (req) => req.method === 'POST' && req.url.endsWith('/api/v1/items') && req !== api.requests[0],
                    )?.body,
                ).toEqual({
                    title: 'Episode 1: Ground Up',
                    content_html: '<p>Show notes body.</p>',
                    status: 'unpublished',
                });
            } finally {
                api.restore();
                await rm(dir, { recursive: true, force: true });
            }
        });
    });

    test('reject sanitise and episode 0 fail before any request', async () => {
        await withEnv(BASE, async () => {
            const api = installFakeApi([]);
            try {
                const quoted = await new PodcastPubTransport().publish({
                    content: {
                        ...episodeContent({
                            audioUrl: 'https://cdn.example.com/ep.mp3',
                            podcast: { titleSanitize: 'reject' },
                        }),
                        title: 'Claude "Mythos"',
                    },
                });
                expect(quoted.ok).toBe(false);
                expect(quoted.error).toContain('"');
                const zero = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep.mp3', itunes: { episode: 0 } }),
                });
                expect(zero.ok).toBe(false);
                expect(zero.error).toContain('episode');
                expect(api.requests.length).toBe(0);
            } finally {
                api.restore();
            }
        });
        await withEnv(BASE, async () => {
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'POST' && req.url.endsWith('/items/validate'),
                    respond: () => new Response(JSON.stringify({ valid: true }), { status: 200 }),
                },
            ]);
            try {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent({ audioUrl: 'https://cdn.example.com/ep.mp3', runDate: '20261021' }),
                    options: { operation: 'validate' },
                });
                expect(result.ok).toBe(true);
                const body = api.requests[0]?.body as { _microfeed?: { seo?: { title: string }; slug?: string } };
                expect(body._microfeed?.seo?.title.endsWith('｜咸话咸说')).toBe(true);
                expect(body._microfeed?.slug).toBeUndefined();
            } finally {
                api.restore();
            }
        });
    });
});

describe('podcast-pub show notes summary and backfill (R4, R10)', () => {
    test('summary paragraph, moved style, and idempotent body rewrite', () => {
        const docs = [
            {
                id: 'a',
                title: 'Sora 2 发布',
                body: 'OpenAI 发布 Sora 应用。',
                sourceUri: 'https://example.com/a',
                mediaType: 'text/markdown',
                metadata: { brief: 'OpenAI 发布 Sora 应用。' },
            },
        ];
        const warnings: string[] = [];
        const markdown = renderShowNotesMarkdown(
            docs,
            {
                title: '每日 AI 要闻',
                runDate: '2026-09-06',
                briefMode: true,
                articlePostPath: '/srv/content/posts/articles/zh/20260906-ai-daily/index.md',
                summaryClauses: [
                    'OpenAI 发布 Sora 应用，带来新的视频模型，并且这句话要写得足够长以便描述跨过下限'.repeat(2),
                ],
                surfingTitle: '图文[版]',
            },
            warnings,
        );
        expect(markdown.startsWith('# 每日 AI 要闻\n\n')).toBe(true);
        expect(markdown.indexOf('完整图文版：')).toBeLessThan(markdown.indexOf('<!--kk:timeline-->'));
        expect(markdown).toContain('[图文版](');
        const html = renderShowNotesHtml(markdown);
        expect(html.startsWith('<p>')).toBe(true);
        expect(html.indexOf('<style>')).toBeGreaterThan(html.indexOf('</div>'));
        expect(html).toContain('href="https://surfing.salty.vip/zh/posts/20260906-ai-daily"');
        const injected = renderShowNotesHtml(
            '<!--kk:timeline-->\n<style>bad</style>\n<div class="kk-tl"></div>\n<!--/kk:timeline-->',
        );
        expect(injected).toContain('&lt;style');
        const summary = summaryParagraphHtml(
            '咸话咸说·每日AI乱炖 2026-10-21：甲。',
            '咸话咸说',
            'https://surfing.salty.vip/zh/posts/a?x=1&y=2',
            '本期<文章>',
        );
        expect(summary).toContain('&amp;');
        expect(summary).toContain('&lt;');
        expect(summaryParagraphHtml('没有前缀', '咸话咸说', undefined, 'x')).toBe('<p>没有前缀</p>');
        const paragraph = showNotesSummaryParagraph({
            config: { ...SEO_DEFAULTS, descriptionSource: 'surfing' },
            runDate: '2026-10-21',
            durationSeconds: 1075.3,
            plan: [{ title: '甲', brief: '简报。' }],
            refinedDescription: 'Surfing 描述正文',
            articleUrl: 'https://surfing.salty.vip/zh/posts/x',
            linkText: '文章',
        });
        expect(paragraph.description).toContain('（约 18 分钟）');
        expect(paragraph.description).toContain('Surfing 描述正文');
        expect(paragraph.markdown).toContain('完整图文版：[文章](');
        const style = '<style>.kk-tl{margin:1em 0}</style>';
        const original = `${style}\n<div class="kk-tl"><div class="kk-tl-row"><div class="kk-tl-title">1. 甲 来源</div></div></div>\n<h2>2. 不应使用</h2>`;
        expect(titlesFromContentHtml(original)).toEqual(['甲']);
        expect(titlesFromContentHtml('<h2>1. 乙 来源</h2><h2>丙，丁</h2>')).toEqual(['乙', '丙，丁']);
        const once = rewriteEpisodeHtml(original, summary, true);
        expect(rewriteEpisodeHtml(once, summary, true)).toBe(once);
        expect(once.startsWith('<p>')).toBe(true);
        expect(once.indexOf(style)).toBeGreaterThan(once.indexOf('</div>'));
        expect(rewriteEpisodeHtml('<p>已有完整图文版：正文</p>', '<p>新</p>', false)).toBe(
            '<p>新</p>\n<p>已有完整图文版：正文</p>',
        );
        expect(rewriteEpisodeHtml('<p>新</p>\n<p>已有完整图文版：正文</p>', '<p>新</p>', false)).toBe(
            '<p>新</p>\n<p>已有完整图文版：正文</p>',
        );
        expect(rewriteEpisodeHtml('没有时间轴', '<p>摘要 完整图文版：x</p>', true)).toContain('<p>摘要');
    });

    test('backfill dry-run, apply, idempotency, overrides, and slug conflicts stay offline', async () => {
        const clauses = {
            SbdKKA7vVDb: [
                'Meta 从商业服务条款删掉「train」一词',
                'Gemini Personal Intelligence 登陆 Android Auto',
                'Meta Muse 分享链接泄露个人与商业机密',
                'DeepSeek 开源推理引擎 DeepInfer',
                'REMORY',
            ],
            OeMM0VF7jkh: [
                '美国政府试点用 AI 审批老年人医疗服务',
                '新泽西数据中心燃气发电机被罚 110 万美元',
                'Google 发射 Suncatcher 轨道数据中心试验卫星',
                'Meta 推出 Muse Charm',
                '荷兰政府基于 NixOS 打造办公替代',
            ],
            JIh0jcjY1xC: [
                '艺术家在 OpenAI 开发者活动外展出《What Iceberg?》',
                'AMD 收购 World Labs',
                'OpenAI 澳洲政府服务器事件',
                'GPT-6.1 安全争议',
                'Anthropic 招股书警示灭绝风险',
                'OpenAI 发布 Dots',
            ],
        };
        const feed = [
            {
                id: 'SbdKKA7vVDb',
                title: '每日AI乱炖 · 2026-10-21',
                status: 'published',
                attachments: [{ duration_in_seconds: 1075.3 }],
                content_html: '<h2>1. Meta 从商业服务条款里删掉「train」一词</h2>',
                _microfeed: { 'itunes:season': 2026, 'itunes:episode': 294, slug: 'ai-2026-10-21-SbdKKA7vVDb' },
            },
            {
                id: 'OeMM0VF7jkh',
                title: '每日 AI 资讯 — 2026-09-25',
                status: 'published',
                attachments: [{ duration_in_seconds: 1020 }],
                content_html: '<h2>1. 美国政府试点用 AI 审批老年人医疗服务</h2>',
                _microfeed: {},
            },
            {
                id: 'JIh0jcjY1xC',
                title: 'AI 乱炖｜艺术家在 OpenAI 开发者活动外展出《What Iceberg?》抗议装置 · 2026-09-30',
                status: 'published',
                attachments: [{ duration_in_seconds: 1140 }],
                content_html:
                    '<style>.kk-tl{}</style><div class="kk-tl"><div class="kk-tl-title">1. 艺术家在 OpenAI 开发者活动外展出 来源</div></div>',
                _microfeed: { 'itunes:season': 2026, 'itunes:episode': 273 },
            },
            {
                id: 'E279',
                title: '主题特辑',
                date_published: '2026-08-01T20:00:00Z',
                content_html: '<h2>1. 主题</h2>',
                _microfeed: { 'itunes:season': 2026, 'itunes:episode': 279 },
            },
        ];
        const overrides = [
            {
                id: 'SbdKKA7vVDb',
                titleKeywords: ['Meta 删掉训练条款', 'Gemini 私人智能上车'],
                summaryClauses: clauses.SbdKKA7vVDb,
            },
            {
                id: 'OeMM0VF7jkh',
                titleKeywords: ['AI 审批医保试点', 'Google 轨道数据中心'],
                summaryClauses: clauses.OeMM0VF7jkh,
            },
            {
                id: 'JIh0jcjY1xC',
                titleKeywords: ['OpenAI 场外抗议装置', 'GPT-6.1 安全争议'],
                summaryClauses: clauses.JIh0jcjY1xC,
            },
            { id: 'E279', title: 'Claude "Mythos" 特辑' },
        ];
        const dir = await mkdtemp(join(tmpdir(), 'podcast-backfill-'));
        const out = join(dir, 'nested', 'plan.json');
        await withEnv({ ...BASE, PODCAST_PUB_SEO: 'false' }, async () => {
            let conflict = true;
            const api = installFakeApi([
                {
                    match: (req) => req.method === 'GET' && req.url.endsWith('/api/v1/feed'),
                    respond: () => new Response(JSON.stringify({ items: feed }), { status: 200 }),
                },
                {
                    match: (req) => req.method === 'PUT' && req.url.includes('/api/v1/items/'),
                    respond: () => {
                        const body = api.requests.at(-1)?.body as { _microfeed?: { slug?: string } };
                        const id =
                            new URL(api.requests.at(-1)?.url ?? 'https://feed.example.com/').pathname
                                .split('/')
                                .pop() ?? '';
                        if (conflict && body._microfeed?.slug === 'daily-ai-2026-10-21') {
                            conflict = false;
                            return new Response(JSON.stringify({ error: 'taken' }), {
                                status: 409,
                                statusText: 'Conflict',
                            });
                        }
                        const current = feed.find((item) => item.id === id);
                        if (current)
                            Object.assign(current, body, {
                                _microfeed: { ...(current._microfeed ?? {}), ...(body._microfeed ?? {}) },
                            });
                        return new Response(JSON.stringify({ id }), { status: 200 });
                    },
                },
            ]);
            const transport = new PodcastPubTransport();
            try {
                const dry = await transport.publish({
                    content: episodeContent(),
                    options: {
                        operation: 'backfill-seo',
                        out,
                        since: '2026-09-25',
                        until: '2026-10-21',
                        overrides,
                    },
                });
                expect(dry.ok).toBe(true);
                expect(dry.message).toContain('dry-run');
                expect(api.requests.filter((req) => req.method === 'PUT')).toHaveLength(0);
                const plan = JSON.parse(await readFile(out, 'utf-8')) as {
                    dryRun: boolean;
                    generatedAt?: string;
                    items: Array<{ id: string; patch: { title?: string; _microfeed?: Record<string, unknown> } }>;
                };
                expect(plan.dryRun).toBe(true);
                expect(plan.generatedAt).toBeUndefined();
                expect(plan.items.map((item) => item.id).sort()).toEqual(['JIh0jcjY1xC', 'OeMM0VF7jkh', 'SbdKKA7vVDb']);
                for (const item of plan.items) expect(item.patch.title).toBeUndefined();
                const sep = plan.items.find((item) => item.id === 'OeMM0VF7jkh');
                expect(sep?.patch._microfeed?.['itunes:season']).toBe(2026);
                expect(sep?.patch._microfeed?.['itunes:episode']).toBe(268);
                const kept = plan.items.find((item) => item.id === 'JIh0jcjY1xC');
                expect(kept?.patch._microfeed?.['itunes:episode']).toBeUndefined();
                const seo = (kept?.patch._microfeed?.seo ?? {}) as { description?: string };
                expect(seo.description?.startsWith('咸话咸说·每日AI乱炖 2026-09-30（约 19 分钟）：')).toBe(true);
                expect(codePointLength(seo.description ?? '')).toBeLessThanOrEqual(155);
                const filtered = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', ids: ['SbdKKA7vVDb'], retitle: true, overrides },
                });
                expect(filtered.ok).toBe(true);
                const only = (filtered.metadata?.items as Array<{ id: string; patch: { title?: string } }>) ?? [];
                expect(only).toHaveLength(1);
                expect(only[0]?.patch.title).toBe('每日AI乱炖 · 2026-10-21：Meta 删掉训练条款、Gemini 私人智能上车');
                const applied = await transport.publish({
                    content: episodeContent(),
                    options: {
                        operation: 'backfill-seo',
                        apply: true,
                        retitle: true,
                        rewriteBody: true,
                        applySlug: true,
                        overrides,
                        ids: ['SbdKKA7vVDb', 'OeMM0VF7jkh', 'JIh0jcjY1xC', 'E279'],
                    },
                });
                expect(applied.ok).toBe(true);
                const puts = api.requests.filter((req) => req.method === 'PUT');
                expect(puts.length).toBeGreaterThanOrEqual(4);
                const themed = puts
                    .map((req) => req.body as { title?: string })
                    .find((body) => body.title?.includes('Mythos'));
                expect(themed?.title).toBe('Claude “Mythos” 特辑');
                expect(JSON.stringify(puts)).not.toContain('date_published');
                const again = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: '1', retitle: 'true', rewriteBody: 'true', overrides },
                });
                expect(again.ok).toBe(true);
                expect(again.metadata?.applied).toBe(0);
                const bad = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', since: 'yesterday' },
                });
                expect(bad.ok).toBe(false);
                expect(bad.error).toContain('options.since');
                const badIds = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', ids: 'nope' },
                });
                expect(badIds.ok).toBe(false);
                const badOverride = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', overrides: [{ title: 'x' }] },
                });
                expect(badOverride.ok).toBe(false);
                const missingPlan = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'missing.json') },
                });
                expect(missingPlan.ok).toBe(false);
                await writeFile(join(dir, 'bad.json'), '{"items":[{"id":1}]}');
                const badPlan = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'bad.json') },
                });
                expect(badPlan.ok).toBe(false);
                await writeFile(
                    join(dir, 'reviewed.json'),
                    JSON.stringify({
                        items: [
                            {
                                id: 'OeMM0VF7jkh',
                                date: '2026-09-25',
                                patch: { _microfeed: { seo: { title: '已审' } } },
                                counts: {},
                                violations: [],
                                current: {},
                            },
                        ],
                    }),
                );
                const reviewed = await transport.publish({
                    content: episodeContent(),
                    options: {
                        operation: 'backfill-seo',
                        apply: true,
                        plan: join(dir, 'reviewed.json'),
                        ids: ['OeMM0VF7jkh'],
                    },
                });
                expect(reviewed.ok).toBe(true);
                expect(api.requests.at(-1)?.body).toEqual({ _microfeed: { seo: { title: '已审' } } });
            } finally {
                api.restore();
            }
            let slugTries = 0;
            const slugOnly = installFakeApi([
                {
                    match: (req) => req.method === 'PUT',
                    respond: () => {
                        slugTries += 1;
                        return new Response(JSON.stringify({ error: 'taken' }), {
                            status: 409,
                            statusText: 'Conflict',
                        });
                    },
                },
            ]);
            try {
                await writeFile(
                    join(dir, 'slug-only.json'),
                    JSON.stringify({
                        items: [
                            {
                                id: 'X',
                                patch: { _microfeed: { slug: 'daily-ai-2026-10-22' } },
                                counts: {},
                                violations: [],
                                current: {},
                            },
                        ],
                    }),
                );
                const skipped = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'slug-only.json') },
                });
                expect(skipped.ok).toBe(true);
                expect(slugTries).toBe(2);
                expect(skipped.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('no other fields changed')]),
                );
                await writeFile(
                    join(dir, 'slug-seo.json'),
                    JSON.stringify({
                        items: [
                            {
                                id: 'Y',
                                patch: {
                                    title: 'kept',
                                    _microfeed: { slug: 'daily-ai-2026-10-23', seo: { title: 't' } },
                                },
                                counts: {},
                                violations: [],
                                current: {},
                            },
                        ],
                    }),
                );
                slugTries = 0;
                const dropped = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'slug-seo.json') },
                });
                expect(dropped.ok).toBe(false);
            } finally {
                slugOnly.restore();
            }
            const broken = installFakeApi([
                {
                    match: (req) => req.method === 'PUT',
                    respond: () =>
                        new Response(JSON.stringify({ error: 'boom' }), { status: 500, statusText: 'Error' }),
                },
            ]);
            try {
                const failed = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'slug-seo.json') },
                });
                expect(failed.ok).toBe(false);
                expect(failed.error).toContain('HTTP 500');
            } finally {
                broken.restore();
            }
            const partial = installFakeApi([
                {
                    match: (req) => req.method === 'PUT',
                    respond: () => {
                        const body = partial.requests.at(-1)?.body as { _microfeed?: { slug?: string } };
                        if (body._microfeed?.slug) {
                            return new Response(JSON.stringify({ error: 'taken' }), {
                                status: 409,
                                statusText: 'Conflict',
                            });
                        }
                        return new Response(JSON.stringify({ id: 'Y' }), { status: 200 });
                    },
                },
            ]);
            try {
                const dropped = await transport.publish({
                    content: episodeContent(),
                    options: { operation: 'backfill-seo', apply: true, plan: join(dir, 'slug-seo.json') },
                });
                expect(dropped.ok).toBe(true);
                expect(partial.requests.at(-1)?.body).toEqual({
                    title: 'kept',
                    _microfeed: { seo: { title: 't' } },
                });
                expect(dropped.metadata?.warnings).toEqual(
                    expect.arrayContaining([expect.stringContaining('applied the patch without a slug')]),
                );
            } finally {
                partial.restore();
            }
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('listItems follows same-origin pages and stops at 20', async () => {
        const client = new MicrofeedClient('https://feed.example.com', 'mf_test_key', 1000);
        let pages = 0;
        const api = installFakeApi([
            {
                match: (req) => req.method === 'GET',
                respond: (req) => {
                    pages += 1;
                    const page = new URL(req.url).searchParams.get('page') ?? '1';
                    const next =
                        page === '1'
                            ? 'https://feed.example.com/api/v1/feed?page=2'
                            : page === '2'
                              ? 'https://evil.example/feed'
                              : '';
                    return new Response(JSON.stringify({ items: [{ id: `p${pages}` }], next_url: next }), {
                        status: 200,
                    });
                },
            },
        ]);
        try {
            const feed = await client.listItems();
            expect(feed.items?.map((item) => item.id)).toEqual(['p1', 'p2']);
            expect(api.requests).toHaveLength(2);
        } finally {
            api.restore();
        }
        let count = 0;
        const capped = installFakeApi([
            {
                match: (req) => req.method === 'GET',
                respond: () => {
                    count += 1;
                    return new Response(
                        JSON.stringify({
                            items: [{ id: String(count) }],
                            next_url: `https://feed.example.com/api/v1/feed?page=${count + 1}`,
                        }),
                        { status: 200 },
                    );
                },
            },
        ]);
        try {
            const feed = await client.listItems();
            expect(feed.items).toHaveLength(20);
            expect(capped.requests).toHaveLength(20);
        } finally {
            capped.restore();
        }
        const relative = installFakeApi([
            {
                match: () => true,
                respond: (req) =>
                    new Response(
                        JSON.stringify({
                            items: [{ id: req.url }],
                            next_url: req.url.endsWith('/api/v1/feed') ? '/api/v1/feed?page=2' : '',
                        }),
                        { status: 200 },
                    ),
            },
        ]);
        try {
            const feed = await client.listItems();
            expect(feed.items).toHaveLength(2);
        } finally {
            relative.restore();
        }
    });
});

describe('podcast-pub operation list', () => {
    test('an unknown operation names backfill-seo', async () => {
        await withEnv(BASE, async () => {
            const result = await new PodcastPubTransport().publish({
                content: episodeContent(),
                options: { operation: 'explode' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('backfill-seo');
        });
    });

    test('show-notes env timeline style and a short description warning are returned', async () => {
        await withEnv(
            {
                PODCAST_PUB_SUMMARY_PARAGRAPH: 'true',
                PODCAST_PUB_TIMELINE_INLINE_STYLE: 'omit',
                PODCAST_PUB_SEO_DESCRIPTION_MIN: '400',
                PODCAST_PUB_SEO_DESCRIPTION_MAX: '500',
            },
            async () => {
                const result = await new PodcastPubTransport().publish({
                    content: episodeContent(),
                    options: {
                        operation: 'show-notes',
                        docs: [],
                        title: 'T',
                        runDate: '2026-01-02',
                        briefMode: true,
                    },
                });
                expect(result.ok).toBe(true);
                expect(String(result.metadata?.markdown)).not.toContain('<style>');
                expect(result.metadata?.warnings).toEqual(
                    expect.arrayContaining([
                        expect.stringContaining('ARTICLE_POST_PATH is empty'),
                        expect.stringContaining('under the 400 minimum'),
                    ]),
                );
            },
        );
        await withEnv({ PODCAST_PUB_EPISODE_TITLE_MODE: 'sideways' }, async () => {
            const result = await new PodcastPubTransport().publish({
                content: episodeContent(),
                options: { operation: 'show-notes', docs: [], title: 'T', runDate: '2026-01-02' },
            });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('PODCAST_PUB_EPISODE_TITLE_MODE');
        });
    });
});
