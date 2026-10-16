import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { buildItcPublishPlan, type ItcPlanRequest } from '../src/itc-plan';
import { runItcStage } from '../src/itc-stage';

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-plan-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('buildItcPublishPlan (0298 / G21 R5)', () => {
    const fakePublisher: PluginRecord = {
        name: 'fake-custom-pub',
        kind: 'publish',
        entry: './src/index.ts',
        dir: '/tmp/fake-custom-pub',
        manifestPath: '/tmp/fake-custom-pub/plugin.json',
        origin: 'project',
        publishing: {
            defaultProfile: 'article',
            profiles: {
                article: {
                    format: 'custom-article',
                    locale: 'source',
                    limits: {
                        title: { max: 80, unit: 'unicode_code_points' },
                        body: { max: 10000, unit: 'unicode_code_points' },
                    },
                    requires: { cover: true },
                    modes: {
                        draft: { metadata: { status: 'draft', customMode: 'testing' } },
                        live: { metadata: { status: 'published', customMode: 'live' } },
                    },
                },
                imagesOnly: {
                    format: 'gallery',
                    locale: 'zh',
                    requires: { cover: true, orderedImages: true },
                    modes: {
                        draft: { metadata: { operation: 'gallery-draft' } },
                    },
                },
            },
        },
    };

    const qiitaPublisher: PluginRecord = {
        name: 'qiita-pub',
        kind: 'publish',
        entry: './src/index.ts',
        dir: '/tmp/qiita-pub',
        manifestPath: '/tmp/qiita-pub/plugin.json',
        origin: 'builtin',
        publishing: {
            defaultProfile: 'article',
            profiles: {
                article: {
                    format: 'article',
                    locale: 'ja',
                    modes: {
                        draft: { metadata: { private: true, published: false } },
                        live: { metadata: { private: false, published: true } },
                    },
                },
            },
        },
    };

    const wechatPublisher: PluginRecord = {
        name: 'wechatmp-pub',
        kind: 'publish',
        entry: './src/index.ts',
        dir: '/tmp/wechatmp-pub',
        manifestPath: '/tmp/wechatmp-pub/plugin.json',
        origin: 'builtin',
        publishing: {
            defaultProfile: 'article',
            profiles: {
                article: {
                    format: 'wechat-article',
                    locale: 'zh',
                    requires: { cover: true },
                    limits: { title: { max: 64, unit: 'unicode_code_points' } },
                    modes: {
                        draft: { metadata: { operation: '文章', publishStatus: 'draft' } },
                        live: { metadata: { operation: '文章', publishStatus: 'public' } },
                    },
                },
            },
        },
    };

    const xPublisher: PluginRecord = {
        name: 'x-pub',
        kind: 'publish',
        entry: './src/index.ts',
        dir: '/tmp/x-pub',
        manifestPath: '/tmp/x-pub/plugin.json',
        origin: 'builtin',
        publishing: {
            defaultProfile: 'post',
            profiles: {
                post: {
                    format: 'short-post',
                    locale: 'en',
                    limits: { body: { max: 280, unit: 'weighted' } },
                    modes: {
                        live: { metadata: { operation: 'post' } },
                    },
                },
            },
        },
    };

    const plugins = [fakePublisher, qiitaPublisher, wechatPublisher, xPublisher];

    it('resolves a manifest-only fake publisher and verifies complete mode bindings', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [{ plugin: 'fake-custom-pub' }],
            };

            const plan = await buildItcPublishPlan(req, plugins);
            expect(plan.live).toBe(false);
            expect(plan.variants['en-custom-article']).toBeDefined();
            expect(plan.variants['en-custom-article']?.switches).toEqual({
                status: 'draft',
                customMode: 'testing',
            });
            expect(plan.variants['en-custom-article']?.limits).toEqual({
                title: { max: 80, unit: 'unicode_code_points' },
                body: { max: 10000, unit: 'unicode_code_points' },
            });
            expect(plan.targets?.[0]?.metadata).toEqual({
                status: 'draft',
                customMode: 'testing',
            });
        });
    });

    it('resolves complete Qiita and WeChat MP bindings', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            // Draft mode
            const draftPlan = await buildItcPublishPlan(
                {
                    schemaVersion: 1,
                    workDir,
                    sourceLocale: 'en',
                    live: false,
                    targets: [{ plugin: 'qiita-pub' }, { plugin: 'wechatmp-pub' }],
                },
                plugins,
            );
            expect(draftPlan.variants['ja-article']?.switches).toEqual({
                private: true,
                published: false,
            });
            expect(draftPlan.variants['zh-wechat-article']?.switches).toEqual({
                operation: '文章',
                publishStatus: 'draft',
            });

            // Live mode
            const livePlan = await buildItcPublishPlan(
                {
                    schemaVersion: 1,
                    workDir,
                    sourceLocale: 'en',
                    live: true,
                    targets: [{ plugin: 'qiita-pub' }, { plugin: 'wechatmp-pub' }],
                },
                plugins,
            );
            expect(livePlan.variants['ja-article']?.switches).toEqual({
                private: false,
                published: true,
            });
            expect(livePlan.variants['zh-wechat-article']?.switches).toEqual({
                operation: '文章',
                publishStatus: 'public',
            });
        });
    });

    it('rejects targets requiring a cover image when cover is absent', async () => {
        await withTempDir(async (workDir) => {
            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [{ plugin: 'fake-custom-pub' }],
            };
            await expect(buildItcPublishPlan(req, plugins)).rejects.toThrow('needs a cover image');
        });
    });

    it('rejects targets requiring orderedImages when metadata.images is missing or empty', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [{ plugin: 'fake-custom-pub', profile: 'imagesOnly' }],
            };
            await expect(buildItcPublishPlan(req, plugins)).rejects.toThrow(
                'requires ordered metadata.images with real paths',
            );

            // With empty images array -> still throws
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            writeFileSync(
                join(workDir, '4-publish/content.json'),
                JSON.stringify({ title: 'T', body: 'B', metadata: { images: [] } }),
            );
            await expect(buildItcPublishPlan(req, plugins)).rejects.toThrow(
                'requires ordered metadata.images with real paths',
            );

            // With real image paths -> succeeds
            writeFileSync(
                join(workDir, '4-publish/content.json'),
                JSON.stringify({
                    title: 'T',
                    body: 'B',
                    metadata: { images: ['4-illustrations/card-1.png', '4-illustrations/card-2.png'] },
                }),
            );
            const plan = await buildItcPublishPlan(req, plugins);
            expect(plan.variants['zh-gallery']).toBeDefined();
        });
    });

    it('rejects unsupported modes (e.g. draft on live-only x-pub post)', async () => {
        await withTempDir(async (workDir) => {
            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [{ plugin: 'x-pub', profile: 'post' }],
            };
            await expect(buildItcPublishPlan(req, plugins)).rejects.toThrow('has no draft mode');

            const liveReq: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: true,
                targets: [{ plugin: 'fake-custom-pub', profile: 'imagesOnly' }],
            };
            await expect(buildItcPublishPlan(liveReq, plugins)).rejects.toThrow('refuses a live publish');
        });
    });

    it('rejects conflicting profiles for the same plugin and collapses exact duplicates', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            // Exact duplicates collapse cleanly
            const dupReq: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [
                    { plugin: 'fake-custom-pub', profile: 'article' },
                    { plugin: 'fake-custom-pub', profile: 'article' },
                ],
            };
            const plan = await buildItcPublishPlan(dupReq, plugins);
            expect(plan.fanout[0]?.targets).toEqual(['fake-custom-pub']);

            // Conflicting profiles throw
            const conflictReq: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [
                    { plugin: 'fake-custom-pub', profile: 'article' },
                    { plugin: 'fake-custom-pub', profile: 'imagesOnly' },
                ],
            };
            await expect(buildItcPublishPlan(conflictReq, plugins)).rejects.toThrow('conflicting profiles for plugin');
        });
    });

    it('rejects an unknown publish target', async () => {
        await withTempDir(async (workDir) => {
            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir,
                sourceLocale: 'en',
                live: false,
                targets: [{ plugin: 'nonexistent-pub' }],
            };
            await expect(buildItcPublishPlan(req, plugins)).rejects.toThrow('unsupported publish target');
        });
    });
});

describe('runItcStage (0298 / G21 R5)', () => {
    it('returns undefined for non-ITC stages so legacy stage runner takes over', async () => {
        expect(await runItcStage([])).toBeUndefined();
        expect(await runItcStage(['daily-script', '/tmp/work'])).toBeUndefined();
        expect(await runItcStage(['itc-materialize', '/tmp/work', 'false'])).toBeUndefined();
    });

    it('executes itc-publish-plan via --request JSON file', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            const reqFile = join(workDir, 'request.json');
            writeFileSync(
                reqFile,
                JSON.stringify({
                    schemaVersion: 1,
                    workDir,
                    sourceLocale: 'en',
                    live: false,
                    targets: [{ plugin: 'qiita-pub' }],
                }),
            );

            const code = await runItcStage(['itc-publish-plan', '--request', reqFile]);
            expect(code).toBe(0);

            const planPath = join(workDir, '4-publish/publish-plan.json');
            expect(existsSync(planPath)).toBe(true);
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
            expect(plan.schemaVersion).toBe(1);
            expect(plan.variants['ja-article']?.switches).toEqual({
                private: true,
                published: false,
            });
            expect(plan.targets).toBeDefined();
        });
    });

    it('executes itc-publish-plan via positional arguments', async () => {
        await withTempDir(async (workDir) => {
            mkdirSync(join(workDir, '4-illustrations'), { recursive: true });
            writeFileSync(join(workDir, '4-illustrations/cover.png'), 'cover');

            const code = await runItcStage(['itc-publish-plan', workDir, 'qiita-pub', 'en', 'false']);
            expect(code).toBe(0);

            const planPath = join(workDir, '4-publish/publish-plan.json');
            const plan = JSON.parse(readFileSync(planPath, 'utf-8'));
            expect(plan.variants['ja-article']?.switches).toEqual({
                private: true,
                published: false,
            });
        });
    });

    it('returns 1 on usage error or invalid request', async () => {
        expect(await runItcStage(['itc-publish-plan'])).toBe(1);
        expect(await runItcStage(['itc-publish-plan', '--request', '/nonexistent/request.json'])).toBe(1);
    });
});
