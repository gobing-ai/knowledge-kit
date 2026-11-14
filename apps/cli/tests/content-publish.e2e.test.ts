import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/main';
import { applyChannelModes, BundleSchema, PublishPlanRowSchema } from '../src/publish-matrix';
import { captureOutput } from './capture';

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const captured = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: captured.read(), stderr: captured.readErr() };
    } finally {
        captured.restore();
    }
}

describe('content publish verbs (0364)', () => {
    it('applies the specific channel switch before the plugin-wide switch and records the source', () => {
        const preset = {
            schemaVersion: 1 as const,
            name: 'fixture',
            targets: [
                { plugin: 'xhs-pub', variant: 'article', mode: 'live' as const },
                { plugin: 'wechatmp-pub', variant: 'article', mode: 'live' as const },
            ],
        };

        const applied = applyChannelModes(preset, { 'xhs-pub': 'off', 'wechatmp-pub/article': 'draft' }, ['xhs-pub']);

        expect(applied.targets).toEqual([
            expect.objectContaining({ plugin: 'xhs-pub', mode: 'live', modeSource: 'flag' }),
            expect.objectContaining({ plugin: 'wechatmp-pub', mode: 'draft', modeSource: 'config' }),
        ]);
    });

    it('rejects a switchboard key that is absent from the selected preset', () => {
        expect(() =>
            applyChannelModes(
                { schemaVersion: 1, name: 'fixture', targets: [{ plugin: 'xhs-pub' }] },
                { 'nope-pub': 'off' },
                [],
            ),
        ).toThrow("channel 'nope-pub' is not listed in preset 'fixture'");
    });

    it('parses an article bundle without an episode and carries the additive row fields', () => {
        const bundle = BundleSchema.parse({
            runId: 'article-run',
            runDate: '2026-11-13',
            contentType: 'itc',
            title: 'An article',
            variants: { article: { path: 'article.json', sha256: 'a' } },
        });
        expect(bundle.episode).toBeUndefined();
        expect(bundle.contentType).toBe('itc');
        expect(
            PublishPlanRowSchema.parse({
                id: 'browser-pub',
                plugin: 'browser-pub',
                variant: 'article',
                tier: 0,
                window: 'after-generate',
                mode: 'draft',
                required: true,
                approval: 'none',
                status: 'planned',
                payloadPath: '4-publish/payloads/content.json',
                payloadDigest: 'd',
                transport: 'browser',
                metadata: { locale: 'en' },
            }),
        ).toMatchObject({ transport: 'browser', metadata: { locale: 'en' } });
    });

    it('keeps a bad positional publish invocation from writing a plan', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-publish-usage-'));
        try {
            const workDir = join(root, 'work');
            mkdirSync(workDir, { recursive: true });
            const result = await runCli(['news', 'publish-plan', 'positional', '--work-dir', workDir]);
            expect(result.code).toBe(2);
            expect(existsSync(join(workDir, '4-publish'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('runs the named publish-plan surface with the switchboard and browser transport fields', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-publish-plan-'));
        const priorCwd = process.cwd();
        const priorConfig = process.env.KK_CONFIG;
        try {
            process.chdir(root);
            const workDir = join(root, 'work');
            const presetDir = join(root, '.kk', 'publish-presets');
            mkdirSync(join(workDir, 'variants'), { recursive: true });
            mkdirSync(presetDir, { recursive: true });
            const article = `${JSON.stringify({ title: 'Article', format: 'markdown', body: 'Body', metadata: {} })}\n`;
            writeFileSync(join(workDir, 'variants', 'article.json'), article);
            writeFileSync(
                join(workDir, 'bundle.json'),
                `${JSON.stringify({
                    schemaVersion: 1,
                    runId: 'article-run',
                    runDate: '2026-11-13',
                    contentType: 'itc',
                    title: 'Article',
                    variants: {
                        article: {
                            path: 'variants/article.json',
                            sha256: createHash('sha256').update(article).digest('hex'),
                        },
                    },
                })}\n`,
            );
            writeFileSync(
                join(presetDir, 'fixture.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    name: 'fixture',
                    targets: [
                        {
                            plugin: 'browser-pub',
                            variant: 'article',
                            transport: 'browser',
                            metadata: { locale: 'en' },
                            mode: 'draft',
                        },
                    ],
                }),
            );
            const config = join(root, 'config.yaml');
            writeFileSync(config, 'content_types:\n  itc:\n    channels:\n      browser-pub/article: draft\n');
            process.env.KK_CONFIG = config;

            const result = await runCli([
                'article',
                'publish-plan',
                '--work-dir',
                workDir,
                '--preset',
                'fixture',
                '--dummy',
            ]);
            expect(result.code).toBe(0);
            const plan = JSON.parse(readFileSync(join(workDir, '4-publish', 'plan.after-generate.json'), 'utf8')) as {
                rows: Array<Record<string, unknown>>;
            };
            expect(plan.rows[0]).toMatchObject({
                mode: 'dummy',
                transport: 'browser',
                metadata: { locale: 'en' },
                modeSource: 'flag',
            });

            const missingWorkDir = await runCli(['article', 'publish-check', '--preset', 'fixture']);
            expect(missingWorkDir.code).toBe(2);

            const unknownChannel = await runCli([
                'article',
                'publish-plan',
                '--work-dir',
                workDir,
                '--preset',
                'fixture',
                '--channels',
                'missing-pub',
            ]);
            expect(unknownChannel.code).toBe(2);
            expect(unknownChannel.stderr).toContain("channel 'missing-pub' is not listed");

            const priorNow = Date.now;
            Date.now = () => Date.parse('2026-11-13T02:00:00.000Z');
            try {
                const peak = await runCli([
                    'article',
                    'publish-plan',
                    '--work-dir',
                    workDir,
                    '--preset',
                    'fixture',
                    '--window',
                    'cn-peak',
                    '--dummy',
                ]);
                expect(peak.code).toBe(0);
                expect(peak.stdout).toContain('"wait"');
            } finally {
                Date.now = priorNow;
            }
            writeFileSync(config, 'content_types:\n  itc:\n    channels:\n      browser-pub: off\n');
            const disabled = await runCli([
                'article',
                'publish-plan',
                '--work-dir',
                workDir,
                '--preset',
                'fixture',
                '--dummy',
            ]);
            expect(disabled.code).toBe(0);
            const disabledPlan = JSON.parse(
                readFileSync(join(workDir, '4-publish', 'plan.after-generate.json'), 'utf8'),
            );
            expect(disabledPlan.rows).toHaveLength(0);
            expect(disabledPlan.excluded).toContainEqual(expect.objectContaining({ reason: 'mode off (config)' }));
        } finally {
            process.chdir(priorCwd);
            if (priorConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = priorConfig;
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('runs check, send, settle, report, and the RSS-gated window through named flags', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-publish-lifecycle-'));
        const priorCwd = process.cwd();
        const priorConfig = process.env.KK_CONFIG;
        const priorSpurBin = process.env.KK_SPUR_BIN;
        try {
            process.chdir(root);
            const workDir = join(root, 'work');
            const presetDir = join(root, '.kk', 'publish-presets');
            mkdirSync(join(workDir, 'variants'), { recursive: true });
            mkdirSync(presetDir, { recursive: true });
            const article = `${JSON.stringify({ title: 'Article', format: 'markdown', body: 'Body', metadata: {} })}\n`;
            writeFileSync(join(workDir, 'variants', 'article.json'), article);
            writeFileSync(
                join(workDir, 'bundle.json'),
                `${JSON.stringify({
                    schemaVersion: 1,
                    runId: 'news-run',
                    runDate: '2026-11-13',
                    contentType: 'news',
                    title: 'News',
                    episode: { title: 'News episode', guid: 'episode-1' },
                    variants: {
                        article: {
                            path: 'variants/article.json',
                            sha256: createHash('sha256').update(article).digest('hex'),
                        },
                    },
                })}\n`,
            );
            writeFileSync(
                join(presetDir, 'fixture.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    name: 'fixture',
                    targets: [
                        {
                            plugin: 'surfdash-pub',
                            operation: 'post',
                            variant: 'article',
                            tier: 0,
                            mode: 'dummy',
                        },
                    ],
                }),
            );
            const config = join(root, 'config.yaml');
            writeFileSync(config, 'content_types:\n  news:\n    channels:\n      surfdash-pub: dummy\n');
            process.env.KK_CONFIG = config;

            const plan = await runCli([
                'news',
                'publish-plan',
                '--work-dir',
                workDir,
                '--preset',
                'fixture',
                '--channels',
                'surfdash-pub',
                '--run-date',
                '2026-11-13',
                '--dummy',
            ]);
            expect(plan.code).toBe(0);

            const check = await runCli([
                'news',
                'publish-check',
                '--work-dir',
                workDir,
                '--all-windows',
                '--preset',
                'fixture',
            ]);
            expect(check.code).toBe(0);
            expect(existsSync(join(workDir, '4-publish', 'check.preflight.json'))).toBe(true);

            mkdirSync(join(workDir, '4-publish', 'receipts'), { recursive: true });
            writeFileSync(join(workDir, '4-publish', 'receipts', 'malformed.json'), '{not-json');
            const send = await runCli([
                'news',
                'publish-send',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
                '--retry',
                '--tier',
                '0',
            ]);
            expect(send.code).toBe(0);
            expect(send.stdout).toContain('"sent":0');

            const settle = await runCli([
                'news',
                'publish-settle',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
                '--topic',
                'news',
                '--db',
                join(root, 'kk.db'),
            ]);
            expect(settle.code).toBe(0);
            expect(JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf8')).runs).toEqual(['news-run']);

            rmSync(join(workDir, 'bundle.json'));
            const missingBundleSettle = await runCli([
                'news',
                'publish-settle',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
            ]);
            expect(missingBundleSettle.code).toBe(1);
            expect(missingBundleSettle.stderr).toContain('bundle.json not found');

            process.env.KK_SPUR_BIN = join(root, 'missing-spur');
            const report = await runCli([
                'news',
                'publish-report',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
            ]);
            expect(report.code).toBe(0);
            expect(report.stderr).toContain('ledger sync warning');
            const reportPath = join(workDir, '5-report', 'publish-after-generate.md');
            expect(existsSync(reportPath)).toBe(true);
            expect(readFileSync(reportPath, 'utf8')).toContain('| surfdash-pub.post |');

            writeFileSync(join(workDir, '4-publish', 'outcome.after-generate.json'), '{not-json');
            const malformedReport = await runCli([
                'news',
                'publish-report',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
            ]);
            expect(malformedReport.code).toBe(0);
            expect(readFileSync(reportPath, 'utf8')).toContain('# Publish report — after-generate —');
            expect(readFileSync(reportPath, 'utf8')).not.toContain('| surfdash-pub.post |');

            writeFileSync(
                join(workDir, '4-publish', 'outcome.after-generate.json'),
                JSON.stringify({
                    runDate: '2026-11-13',
                    rows: [],
                    excluded: [{ id: 'closed-target', plugin: 'surfdash-pub', reason: 'mode off' }],
                }),
            );
            const excludedReport = await runCli([
                'news',
                'publish-report',
                '--work-dir',
                workDir,
                '--window',
                'after-generate',
            ]);
            expect(excludedReport.code).toBe(0);
            expect(readFileSync(reportPath, 'utf8')).toContain('- excluded: closed-target (surfdash-pub) — mode off');
        } finally {
            process.chdir(priorCwd);
            if (priorConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = priorConfig;
            if (priorSpurBin === undefined) delete process.env.KK_SPUR_BIN;
            else process.env.KK_SPUR_BIN = priorSpurBin;
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('returns stable usage codes for malformed config, missing writer skills, and missing presets', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-publish-errors-'));
        const priorCwd = process.cwd();
        const priorConfig = process.env.KK_CONFIG;
        try {
            process.chdir(root);
            const workDir = join(root, 'work');
            mkdirSync(workDir, { recursive: true });
            const config = join(root, 'config.yaml');
            process.env.KK_CONFIG = config;

            writeFileSync(config, 'content_types: [\n');
            const malformedConfig = await runCli(['news', 'publish-report', '--work-dir', workDir]);
            expect(malformedConfig.code).toBe(2);
            expect(malformedConfig.stderr).toContain('cannot read config');

            writeFileSync(config, 'content_types:\n  news:\n    writer_skill: invalid\n    publish_preset: missing\n');
            const invalidType = await runCli(['news', 'publish-report', '--work-dir', workDir]);
            expect(invalidType.code).toBe(2);
            expect(invalidType.stderr).toContain('Invalid');

            writeFileSync(
                config,
                'content_types:\n  news:\n    writer_skill: kk:no-such-skill\n    publish_preset: missing\n',
            );
            const missingSkill = await runCli(['news', 'publish-report', '--work-dir', workDir]);
            expect(missingSkill.code).toBe(5);
            expect(missingSkill.stderr).toContain('SKILL.md');

            writeFileSync(config, 'content_types:\n  news:\n    publish_preset: missing\n');
            const missingPreset = await runCli(['news', 'publish-report', '--work-dir', workDir]);
            expect(missingPreset.code).toBe(1);
            expect(missingPreset.stderr).toContain("publish preset 'missing' not found");
        } finally {
            process.chdir(priorCwd);
            if (priorConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = priorConfig;
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('records an RSS miss for an empty bundle-less day without authorizing a send', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-content-publish-empty-'));
        const priorCwd = process.cwd();
        const priorConfig = process.env.KK_CONFIG;
        try {
            process.chdir(root);
            const workDir = join(root, 'work');
            const presetDir = join(root, '.kk', 'publish-presets');
            mkdirSync(join(workDir, '4-publish'), { recursive: true });
            mkdirSync(presetDir, { recursive: true });
            writeFileSync(
                join(presetDir, 'fixture.json'),
                JSON.stringify({
                    schemaVersion: 1,
                    name: 'fixture',
                    targets: [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', mode: 'dummy' }],
                }),
            );
            const config = join(root, 'config.yaml');
            writeFileSync(config, 'content_types:\n  news:\n    publish_preset: fixture\n');
            process.env.KK_CONFIG = config;
            const result = await runCli([
                'news',
                'publish-plan',
                '--work-dir',
                workDir,
                '--preset',
                'fixture',
                '--window',
                'overseas-rss',
                '--run-date',
                '2026-11-13',
            ]);
            expect(result.code).toBe(1);
            const gate = JSON.parse(readFileSync(join(workDir, '4-publish', 'rss-gate.json'), 'utf8')) as {
                schemaVersion: number;
                date: string;
                feedUrl: string;
                hit: boolean;
                reason: string;
                detail: string;
            };
            expect(gate).toEqual({
                schemaVersion: 1,
                date: '2026-11-13',
                feedUrl: 'https://podcast.salty.vip/rss/',
                hit: false,
                reason: 'missing',
                detail: expect.stringContaining('bundle.json is absent'),
            });
        } finally {
            process.chdir(priorCwd);
            if (priorConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = priorConfig;
            rmSync(root, { recursive: true, force: true });
        }
    });
});
