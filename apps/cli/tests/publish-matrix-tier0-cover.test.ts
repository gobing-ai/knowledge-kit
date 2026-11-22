import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planPublishMatrix, sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function setupTier0WorkDir(modes: { podcast: 'live' | 'dummy'; surfdash: 'live' | 'dummy' }) {
    const root = mkdtempSync(join(tmpdir(), 'kk-tier0-cover-'));
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const articleBody = JSON.stringify(
        {
            title: '每日AI乱炖 · 2026-11-21',
            body: '# 每日AI乱炖\n\n正文。\n',
            format: 'markdown',
            metadata: {
                runDate: '20261121',
                coverImage: '/tmp/local-cover.png',
                tags: ['ai-news', 'sub-category:ai-daily'],
                surfdash: {
                    locales: {
                        en: { title: 'Daily AI Stew · 2026-11-21', body: '# Daily AI Stew\n\nEnglish.\n' },
                        ja: { title: 'デイリーAIシチュー · 2026-11-21', body: '# デイリーAIシチュー\n\n日本語。\n' },
                    },
                },
            },
        },
        null,
        2,
    );
    const episodeBody = JSON.stringify(
        {
            title: '第261121期 · Meta',
            body: '播客正文。',
            format: 'markdown',
            metadata: { runDate: '20261121', coverImage: '/tmp/local-cover.png' },
        },
        null,
        2,
    );
    writeFileSync(join(workDir, 'variants', 'article.json'), articleBody);
    writeFileSync(join(workDir, 'variants', 'episode.json'), episodeBody);

    const bundle = {
        schemaVersion: 1,
        runId: 'gen-run-tier0',
        runDate: '2026-11-21',
        runs: [],
        episode: { title: '第261121期 · Meta' },
        variants: {
            article: { path: 'variants/article.json', sha256: sha256(articleBody) },
            episode: { path: 'variants/episode.json', sha256: sha256(episodeBody) },
        },
        safety: {
            status: 'pass',
            digest: sha256('article\nepisode'),
            variants: {
                article: sha256(articleBody),
                episode: sha256(episodeBody),
            },
        },
    };
    writeFileSync(
        join(root, '.kk', 'publish-presets', 'tier0-test.json'),
        JSON.stringify({
            schemaVersion: 1,
            name: 'tier0-test',
            targets: [
                {
                    plugin: 'podcast-pub',
                    operation: 'episode',
                    variant: 'episode',
                    tier: 0,
                    window: 'after-generate',
                    mode: modes.podcast,
                    required: true,
                },
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    window: 'after-generate',
                    mode: modes.surfdash,
                    required: true,
                },
            ],
        }),
    );
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
    return { root, workDir, bundlePath };
}

function flagArg(argv: readonly string[], name: string): string {
    const idx = argv.indexOf(name);
    return idx >= 0 && idx + 1 < argv.length ? (argv[idx + 1] ?? '') : '';
}

describe('publish-matrix Tier 0 podcast-pub cover & URL threading', () => {
    it('injects real podcast-pub imageUrl and url into surfdash-pub payload in Tier 0', async () => {
        const fx = setupTier0WorkDir({ podcast: 'live', surfdash: 'live' });
        const out = captureOutput();
        try {
            const planned = await planPublishMatrix(
                [fx.workDir, '--window', 'after-generate', '--preset', 'tier0-test', '--bundle', fx.bundlePath],
                { projectRoot: fx.root },
            );
            expect(planned).toBe(0);

            const seenPayloads: Array<{ plugin: string; payload: Record<string, unknown> }> = [];
            const sent = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                dispatch: async (argv) => {
                    const plugin = flagArg(argv, '--target');
                    const payloadPath = flagArg(argv, '--content');
                    const aggPath = flagArg(argv, '--out');
                    const parsed = JSON.parse(readFileSync(payloadPath, 'utf-8')) as Record<string, unknown>;
                    seenPayloads.push({ plugin, payload: parsed });
                    if (plugin === 'podcast-pub') {
                        writeFileSync(
                            aggPath,
                            JSON.stringify({
                                ok: true,
                                summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                                targets: [
                                    {
                                        target: 'podcast-pub',
                                        ok: true,
                                        status: 'published',
                                        url: 'https://podcast.salty.vip/i/daily-ai-2026-11-21/',
                                        metadata: {
                                            imageUrl:
                                                'https://podcast-media.salty.vip/production/images/item-8811650ef5638a6d01cbe6881d8ead7c.png',
                                        },
                                    },
                                ],
                            }),
                        );
                        return 0;
                    }
                    writeFileSync(
                        aggPath,
                        JSON.stringify({
                            ok: true,
                            summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                            targets: [
                                {
                                    target: 'surfdash-pub',
                                    ok: true,
                                    status: 'published',
                                    url: 'https://surfing.example/p',
                                },
                            ],
                        }),
                    );
                    return 0;
                },
            });
            expect(sent).toBe(0);
            const sd = seenPayloads.find((p) => p.plugin === 'surfdash-pub');
            expect(sd).toBeDefined();
            const meta = (sd?.payload.metadata ?? {}) as Record<string, unknown>;
            expect(meta.coverImage).toBe(
                'https://podcast-media.salty.vip/production/images/item-8811650ef5638a6d01cbe6881d8ead7c.png',
            );
            expect(meta.podcastUrl).toBe('https://podcast.salty.vip/i/daily-ai-2026-11-21/');
            expect(
                existsSync(join(fx.workDir, '4-publish', 'payloads', 'content.surfdash-pub.post.resolved.json')),
            ).toBe(true);

            // Replaying the same window skips cleanly without re-dispatching or reconciliation drift.
            let replayCalls = 0;
            const replay = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                dispatch: async () => {
                    replayCalls += 1;
                    return 0;
                },
            });
            expect(replay).toBe(0);
            expect(replayCalls).toBe(0);
        } finally {
            out.restore();
            rmSync(fx.root, { recursive: true, force: true });
        }
    });

    it('does not inject from dummy podcast-pub receipts and keeps original local coverImage fallback', async () => {
        const fx = setupTier0WorkDir({ podcast: 'dummy', surfdash: 'live' });
        const out = captureOutput();
        try {
            expect(
                await planPublishMatrix(
                    [fx.workDir, '--window', 'after-generate', '--preset', 'tier0-test', '--bundle', fx.bundlePath],
                    { projectRoot: fx.root },
                ),
            ).toBe(0);

            let sdMeta: Record<string, unknown> = {};
            expect(
                await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    dispatch: async (argv) => {
                        const plugin = flagArg(argv, '--target');
                        const payloadPath = flagArg(argv, '--content');
                        const aggPath = flagArg(argv, '--out');
                        const parsed = JSON.parse(readFileSync(payloadPath, 'utf-8')) as Record<string, unknown>;
                        sdMeta = (parsed.metadata ?? {}) as Record<string, unknown>;
                        writeFileSync(
                            aggPath,
                            JSON.stringify({
                                ok: true,
                                summary: { total: 1, succeeded: 1, failed: 0, skipped: 0 },
                                targets: [
                                    { target: plugin, ok: true, status: 'published', url: 'https://surfing.example/p' },
                                ],
                            }),
                        );
                        return 0;
                    },
                }),
            ).toBe(0);
            expect(sdMeta.coverImage).toBe('/tmp/local-cover.png');
            expect(sdMeta.podcastUrl).toBeUndefined();
        } finally {
            out.restore();
            rmSync(fx.root, { recursive: true, force: true });
        }
    });
});
