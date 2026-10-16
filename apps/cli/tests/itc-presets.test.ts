import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginRecord } from '@gobing-ai/kk-core';
import { buildItcPublishPlan, type ItcPlanRequest, resolveItcTargets } from '../src/itc-plan';

async function withTempDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
    const tempDir = mkdtempSync(join(tmpdir(), 'kk-itc-presets-test-'));
    try {
        await fn(tempDir);
    } finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}

describe('resolveItcTargets & Presets (0300 / G21 R6)', () => {
    it('resolves the seeded package presets (technical-article and chinese-article)', () => {
        const tech = resolveItcTargets({ explicitPreset: 'technical-article' });
        expect(tech.origin).toBe('explicit-preset');
        expect(tech.presetName).toBe('technical-article');
        expect(tech.presetDigest).toBeDefined();
        expect(tech.targets).toEqual([
            { plugin: 'zenn-pub', profile: 'article' },
            { plugin: 'qiita-pub', profile: 'article' },
        ]);

        const cn = resolveItcTargets({ explicitPreset: 'chinese-article' });
        expect(cn.origin).toBe('explicit-preset');
        expect(cn.presetName).toBe('chinese-article');
        expect(cn.presetDigest).toBeDefined();
        expect(cn.targets).toEqual([
            { plugin: 'juejin-pub', profile: 'article' },
            { plugin: 'infoq-pub', profile: 'article' },
        ]);
    });

    it('applies strict selection precedence: targets > explicitPreset > workflowConfigPreset > topicProfile > none', async () => {
        await withTempDir(async (dir) => {
            const projectRoot = dir;
            const projectPresetsDir = join(projectRoot, '.kk/publish-presets');
            mkdirSync(projectPresetsDir, { recursive: true });

            // Create custom project preset
            writeFileSync(
                join(projectPresetsDir, 'custom-preset.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    name: 'custom-preset',
                    targets: [{ plugin: 'medium-pub', profile: 'article' }],
                }),
            );

            // Create topic profile with publishPreset
            const topicProfilePath = join(projectRoot, 'my-topic.yaml');
            writeFileSync(
                topicProfilePath,
                'topic: my-topic\nwhere:\n  kk-item-category: { in: [ai-news] }\npublishPreset: custom-preset\n',
            );

            // 1. Explicit targets overrides everything
            const res1 = resolveItcTargets({
                explicitTargets: 'emdash-pub:article',
                explicitPreset: 'technical-article',
                workflowConfigPreset: 'chinese-article',
                topicProfile: 'my-topic',
                topicProfilePath,
                projectRoot,
            });
            expect(res1.origin).toBe('explicit-targets');
            expect(res1.targets).toEqual([{ plugin: 'emdash-pub', profile: 'article' }]);

            // 2. Explicit preset overrides workflow config preset and topic profile
            const res2 = resolveItcTargets({
                explicitPreset: 'technical-article',
                workflowConfigPreset: 'chinese-article',
                topicProfile: 'my-topic',
                topicProfilePath,
                projectRoot,
            });
            expect(res2.origin).toBe('explicit-preset');
            expect(res2.presetName).toBe('technical-article');
            expect(res2.targets).toEqual([
                { plugin: 'zenn-pub', profile: 'article' },
                { plugin: 'qiita-pub', profile: 'article' },
            ]);

            // 3. Workflow config preset overrides topic profile
            const res3 = resolveItcTargets({
                workflowConfigPreset: 'chinese-article',
                topicProfile: 'my-topic',
                topicProfilePath,
                projectRoot,
            });
            expect(res3.origin).toBe('workflow-config');
            expect(res3.presetName).toBe('chinese-article');

            // 4. Topic profile publishPreset used when higher tiers are absent
            const res4 = resolveItcTargets({
                topicProfile: 'my-topic',
                topicProfilePath,
                projectRoot,
            });
            expect(res4.origin).toBe('topic-profile');
            expect(res4.presetName).toBe('custom-preset');
            expect(res4.targets).toEqual([{ plugin: 'medium-pub', profile: 'article' }]);

            // 5. None when no input given
            const res5 = resolveItcTargets({});
            expect(res5.origin).toBe('none');
            expect(res5.targets).toEqual([]);
        });
    });

    it('distinguishes absent from empty inputs and fails loud on higher-priority empty targets', () => {
        expect(() => resolveItcTargets({ explicitTargets: '' })).toThrow('explicit targets input is empty');
        expect(() => resolveItcTargets({ explicitTargets: '   ' })).toThrow('explicit targets input is empty');
        expect(() => resolveItcTargets({ explicitTargets: [] })).toThrow('explicit targets input is empty');

        expect(() => resolveItcTargets({ explicitPreset: '' })).toThrow('explicit publish preset input is empty');
        expect(() => resolveItcTargets({ workflowConfigPreset: '' })).toThrow(
            'workflow config publish preset input is empty',
        );
    });

    it('collapses identical duplicate selectors and rejects conflicting profiles for one plugin', () => {
        const collapsed = resolveItcTargets({
            explicitTargets: 'zenn-pub:article,zenn-pub:article,qiita-pub',
        });
        expect(collapsed.targets).toEqual([{ plugin: 'zenn-pub', profile: 'article' }, { plugin: 'qiita-pub' }]);

        expect(() =>
            resolveItcTargets({
                explicitTargets: 'weibo-pub:article,weibo-pub:post',
            }),
        ).toThrow('conflicting profiles for plugin weibo-pub');
    });

    it('fails on a malformed project override without falling through to package copy', async () => {
        await withTempDir(async (dir) => {
            const projectRoot = dir;
            const projectPresetsDir = join(projectRoot, '.kk/publish-presets');
            mkdirSync(projectPresetsDir, { recursive: true });

            // Write malformed technical-article.json in project
            writeFileSync(join(projectPresetsDir, 'technical-article.json'), '{ "bad": true }');

            expect(() =>
                resolveItcTargets({
                    explicitPreset: 'technical-article',
                    projectRoot,
                }),
            ).toThrow(/malformed publish preset/);
        });
    });

    it('rejects path traversal in preset slug', () => {
        expect(() => resolveItcTargets({ explicitPreset: '../malicious' })).toThrow(/invalid publish preset slug/);
        expect(() => resolveItcTargets({ explicitPreset: 'nested/preset' })).toThrow(/invalid publish preset slug/);
    });

    it('stamps origin, presetName, and presetDigest onto the frozen publication plan', async () => {
        await withTempDir(async (dir) => {
            const resolved = resolveItcTargets({ explicitPreset: 'technical-article' });

            const fakeQiita: PluginRecord = {
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
                            modes: { draft: { metadata: { published: false } } },
                        },
                    },
                },
            };
            const fakeZenn: PluginRecord = {
                name: 'zenn-pub',
                kind: 'publish',
                entry: './src/index.ts',
                dir: '/tmp/zenn-pub',
                manifestPath: '/tmp/zenn-pub/plugin.json',
                origin: 'builtin',
                publishing: {
                    defaultProfile: 'article',
                    profiles: {
                        article: {
                            format: 'article',
                            locale: 'ja',
                            modes: { draft: { metadata: { published: false } } },
                        },
                    },
                },
            };

            const req: ItcPlanRequest = {
                schemaVersion: 1,
                workDir: dir,
                sourceLocale: 'en',
                live: false,
                targets: resolved.targets,
                origin: resolved.origin,
                presetName: resolved.presetName,
                presetDigest: resolved.presetDigest,
            };

            const plan = buildItcPublishPlan(req, [fakeQiita, fakeZenn]);
            expect(plan.origin).toBe('explicit-preset');
            expect(plan.presetName).toBe('technical-article');
            expect(plan.presetDigest).toBe(resolved.presetDigest);
            expect(plan.targets).toHaveLength(2);
        });
    });
});
