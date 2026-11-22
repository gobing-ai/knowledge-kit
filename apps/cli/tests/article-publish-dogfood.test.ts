import { afterAll, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { main } from '../src/main';
import { loadPublishPreset } from '../src/publish-core';
import { planPublishMatrix, validatePublishChannelTokens } from '../src/publish-matrix';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const created: string[] = [];

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: capture.read(), stderr: capture.readErr() };
    } finally {
        capture.restore();
    }
}

describe('article publish pipeline fixes (dogfood 2026-11-22)', () => {
    it('itc-main preset declares locale variants, operations, and browser transports', async () => {
        const { preset } = await loadPublishPreset('itc-main', {
            projectRoot: '/tmp/no-kk-project',
            packageRoot: REPO,
        });
        const byPlugin = new Map(preset.targets.map((t) => [t.plugin, t]));
        expect(byPlugin.get('surfdash-pub')).toMatchObject({ variant: 'article', tier: 0, required: true });
        expect(byPlugin.get('x-pub')).toMatchObject({
            operation: 'article',
            variant: 'zh-article',
            transport: 'browser',
        });
        expect(byPlugin.get('wechatmp-pub')).toMatchObject({
            operation: '文章',
            variant: 'zh-article',
            transport: 'browser',
        });
        expect(byPlugin.get('infoq-pub')).toMatchObject({ variant: 'zh-article', transport: 'browser' });
        expect(byPlugin.get('juejin-pub')).toMatchObject({ variant: 'zh-article', transport: 'browser' });
        expect(byPlugin.get('qiita-pub')).toMatchObject({ variant: 'ja-article' });
        expect(byPlugin.get('zenn-pub')).toMatchObject({ variant: 'ja-article' });
        expect(byPlugin.get('medium-pub')).toMatchObject({ variant: 'en-article' });
        expect(byPlugin.get('substack-pub')).toMatchObject({ variant: 'en-article', transport: 'browser' });
        expect(byPlugin.get('weibo-pub')).toMatchObject({
            operation: 'article',
            variant: 'zh-article',
            transport: 'browser',
        });
        expect(() =>
            validatePublishChannelTokens(preset, ['x-pub.article', 'wechatmp-pub.文章', 'weibo-pub.article']),
        ).not.toThrow();
    });

    it('clears a stale plan.<window>.json before failing on invalid --channels so kk-publish cannot silently reuse it', async () => {
        const root = tempDir('kk-stale-plan-');
        const workDir = join(root, 'run');
        const publishDir = join(workDir, '4-publish');
        mkdirSync(publishDir, { recursive: true });
        const stalePlan = join(publishDir, 'plan.after-generate.json');
        writeFileSync(stalePlan, '{"stale":true}\n');
        const config = join(root, 'config.yaml');
        writeFileSync(config, `works_dir: ${join(root, 'works')}\n`);

        const beforeConfig = process.env.KK_CONFIG;
        process.env.KK_CONFIG = config;
        try {
            const res = await runCli([
                'article',
                'publish-plan',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
                '--channels',
                'no-such-channel',
            ]);
            expect(res.code).toBe(2);
            expect(existsSync(stalePlan)).toBe(false);
        } finally {
            if (beforeConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = beforeConfig;
        }
    });

    it('sets native draft/live metadata fields for qiita-pub and zenn-pub and allows live article bundles without news safety', async () => {
        const workDir = tempDir('kk-article-matrix-');
        const publishDir = join(workDir, '4-publish');
        mkdirSync(publishDir, { recursive: true });
        const contentRaw = `${JSON.stringify({ title: 'A2UI 1.0', format: 'markdown', body: 'Body text.' })}\n`;
        writeFileSync(join(publishDir, 'content.ja-article.json'), contentRaw);
        const sha = createHash('sha256').update(contentRaw).digest('hex');
        const bundlePath = join(publishDir, 'bundle.json');
        writeFileSync(
            bundlePath,
            `${JSON.stringify(
                {
                    schemaVersion: 1,
                    runId: 'kk-content-a2ui',
                    runDate: '20261122',
                    contentType: 'itc',
                    title: 'A2UI 1.0',
                    variants: {
                        'ja-article': { path: 'content.ja-article.json', sha256: sha },
                    },
                },
                null,
                2,
            )}\n`,
        );

        const draftCode = await planPublishMatrix(
            [
                workDir,
                '--bundle',
                bundlePath,
                '--preset',
                'itc-main',
                '--window',
                'after-generate',
                '--channels',
                'qiita-pub,zenn-pub',
            ],
            { projectRoot: REPO },
        );
        expect(draftCode).toBe(0);
        const qiitaDraft = JSON.parse(readFileSync(join(publishDir, 'payloads/content.qiita-pub.json'), 'utf-8')) as {
            metadata: Record<string, unknown>;
        };
        const zennDraft = JSON.parse(readFileSync(join(publishDir, 'payloads/content.zenn-pub.json'), 'utf-8')) as {
            metadata: Record<string, unknown>;
        };
        expect(qiitaDraft.metadata.private).toBe(true);
        expect(qiitaDraft.metadata.published).toBe(false);
        expect(zennDraft.metadata.published).toBe(false);

        const liveCode = await planPublishMatrix(
            [
                workDir,
                '--bundle',
                bundlePath,
                '--preset',
                'itc-main',
                '--window',
                'after-generate',
                '--channels',
                'qiita-pub,zenn-pub',
                '--live-channels',
                'qiita-pub,zenn-pub',
            ],
            { projectRoot: REPO },
        );
        expect(liveCode).toBe(0);
        const qiitaLive = JSON.parse(readFileSync(join(publishDir, 'payloads/content.qiita-pub.json'), 'utf-8')) as {
            metadata: Record<string, unknown>;
        };
        const zennLive = JSON.parse(readFileSync(join(publishDir, 'payloads/content.zenn-pub.json'), 'utf-8')) as {
            metadata: Record<string, unknown>;
        };
        expect(qiitaLive.metadata.private).toBe(false);
        expect(qiitaLive.metadata.published).toBe(true);
        expect(zennLive.metadata.published).toBe(true);
    });

    it('seeds coverImage and --variant files via article new --from and freezes without AI authoring', async () => {
        const root = tempDir('kk-article-seed-');
        const works = join(root, 'works');
        const srcZh = join(root, 'zh.md');
        const srcEn = join(root, 'en.md');
        const srcJa = join(root, 'ja.md');
        const cover = join(root, 'cover.jpg');
        writeFileSync(srcZh, '# 中文标题\n\n中文正文。\n');
        writeFileSync(srcEn, '# English Title\n\nEnglish body.\n');
        writeFileSync(srcJa, '# 日本語タイトル\n\n日本語本文。\n');
        writeFileSync(cover, 'fake-jpg');

        const config = join(root, 'config.yaml');
        writeFileSync(config, `works_dir: ${works}\n`);
        const beforeConfig = process.env.KK_CONFIG;
        const beforeWorks = process.env.KK_WORKS_DIR;
        process.env.KK_CONFIG = config;
        process.env.KK_WORKS_DIR = works;
        try {
            const createdRun = await runCli([
                'article',
                'new',
                '--slug',
                'a2ui-seed',
                '--from',
                srcZh,
                '--locale',
                'zh',
                '--tags',
                'a2ui,ai',
                '--description',
                'A2UI summary',
                '--cover',
                cover,
                '--variant',
                `en-article=${srcEn}`,
                '--variant',
                `ja-article=${srcJa}`,
            ]);
            expect(createdRun.code).toBe(0);
            const workDir = (JSON.parse(createdRun.stdout) as { workDir: string }).workDir;

            const content = JSON.parse(readFileSync(join(workDir, '4-publish/content.json'), 'utf-8')) as {
                metadata: { coverImage?: string; tags?: string[] };
            };
            expect(content.metadata.coverImage).toBe(join(workDir, '4-illustrations/cover.jpg'));
            expect(content.metadata.tags).toEqual(['a2ui', 'ai']);
            expect(existsSync(join(workDir, '4-publish/content.en-article.json'))).toBe(true);
            expect(existsSync(join(workDir, '4-publish/content.ja-article.json'))).toBe(true);

            const frozen = await runCli([
                'article',
                'generate-bundle',
                '--work-dir',
                workDir,
                '--preset',
                'itc-main',
                '--stage',
                'freeze',
            ]);
            expect(frozen.code).toBe(0);
            const bundle = JSON.parse(readFileSync(join(workDir, '4-publish/bundle.json'), 'utf-8')) as {
                contentType: string;
                variants: Record<string, { path: string; sha256: string }>;
            };
            expect(bundle.contentType).toBe('itc');
            expect(Object.keys(bundle.variants).sort()).toEqual(['article', 'en-article', 'ja-article', 'zh-article']);

            const binDir = join(root, 'bin');
            mkdirSync(binDir, { recursive: true });
            const fakeSpur = join(binDir, 'spur');
            writeFileSync(fakeSpur, '#!/bin/sh\necho OK\nexit 0\n');
            chmodSync(fakeSpur, 0o755);
            const beforePath = process.env.PATH;
            process.env.PATH = `${binDir}:${beforePath ?? ''}`;
            try {
                const adaptDryRun = await runCli([
                    'article',
                    'generate',
                    '--slug',
                    'a2ui-seed',
                    '--adapt-only',
                    '--allow-dirty',
                    '--dry-run',
                ]);
                expect(adaptDryRun.code).toBe(0);
                const dryReceipt = JSON.parse(adaptDryRun.stdout) as { dryRun?: { vars?: Record<string, string> } };
                expect(dryReceipt.dryRun?.vars?.adapt_only).toBe('true');

                const missingDraft = await runCli([
                    'article',
                    'generate',
                    '--slug',
                    'no-such-draft',
                    '--adapt-only',
                    '--allow-dirty',
                    '--dry-run',
                ]);
                expect(missingDraft.code).toBe(5);
            } finally {
                if (beforePath === undefined) delete process.env.PATH;
                else process.env.PATH = beforePath;
            }

            const newsAdapt = await runCli(['news', 'generate', '--run-date', '20261122', '--adapt-only', '--dry-run']);
            expect(newsAdapt.code).toBe(2);
            expect(newsAdapt.stderr).toContain('--adapt-only is article-only');
        } finally {
            if (beforeConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = beforeConfig;
            if (beforeWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = beforeWorks;
        }
    });
});
