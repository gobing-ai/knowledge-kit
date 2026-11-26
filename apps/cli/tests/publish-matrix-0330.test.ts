import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PublishPresetSchema, resolveItcTargets } from '../src/itc-plan';
import { planPublishMatrix, sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

// Task 0330 failure matrix, written before the fixes (AGENTS testing rule).
//  1. source metadata public but the row requests draft (surfdash reads `published`)
//  2. contradictory inherited mode keys (publishStatus/published/status) removed from payloads
//  3. podcast draft rows map to metadata.status 'unpublished'; live to 'published'
//  4. preset `options` carrying a mode key (publishStatus/published/status) is refused
//  5. preset `options` carrying skip_review/auto_publish is refused
//  6. a global --dummy plan never dispatches a transport and writes dummy receipts
//  7. dummy + --live-channels is still refused (regression, 0321)
//  8. an explicit live launch under a fake transport sends with mode live
//  9. the shipped migration preset keeps draftless short-post rows dummy (R4)
// 10. the itc plan path is unaffected (R5)

interface Fixture {
    root: string;
    workDir: string;
    bundlePath: string;
}

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function contentJson(body: string, extra: Record<string, unknown> = {}): string {
    return `${JSON.stringify({ title: '标题', format: 'markdown', body, metadata: extra }, null, 2)}\n`;
}

function makeFixture(
    targets: Array<Record<string, unknown>>,
    variants: Record<string, string> = {
        article: contentJson('正文 {{article_url}}', { published: true, publishStatus: 'public', status: 'published' }),
        episode: contentJson('播客 {{podcast_url}}', { published: true, publishStatus: 'public', status: 'published' }),
    },
    presetName = 'daily-ai-voice',
): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0330-'));
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const variantEntries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, text] of Object.entries(variants)) {
        const path = join(workDir, 'variants', `${name}.json`);
        writeFileSync(path, text);
        variantEntries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }

    const bundle = {
        schemaVersion: 1,
        runId: 'gen-run-1',
        runDate: '2026-10-22',
        runs: [],
        episode: { title: '每日AI乱炖 · 2026-10-22' },
        variants: variantEntries,
        // 0331: live launches require reviewed-variant evidence; these tests exercise mode mapping,
        // so the fixture attaches evidence matching the frozen bytes by default.
        safety: {
            status: 'pass',
            digest: '0'.repeat(64),
            excludedPlatforms: [],
            variants: Object.fromEntries(Object.entries(variantEntries).map(([name, entry]) => [name, entry.sha256])),
        },
    };
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

    writeFileSync(
        join(root, '.kk', 'publish-presets', `${presetName}.json`),
        `${JSON.stringify({ schemaVersion: 1, name: presetName, targets }, null, 2)}\n`,
    );

    return { root, workDir, bundlePath };
}

function planArgs(fixture: Fixture, extra: string[] = []): string[] {
    return [
        fixture.workDir,
        '--bundle',
        fixture.bundlePath,
        '--preset',
        'daily-ai-voice',
        '--window',
        'after-generate',
        ...extra,
    ];
}

async function withCleanup(fn: (fixture: Fixture) => Promise<void>, fixture: Fixture): Promise<void> {
    try {
        await fn(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

interface PayloadMetadata {
    metadata: Record<string, unknown>;
}

function payloadFor(fx: Fixture, payloadPath: string): PayloadMetadata {
    return JSON.parse(readFileSync(join(fx.workDir, payloadPath), 'utf-8')) as PayloadMetadata;
}

describe('publish-matrix payload mode boundaries (0330 R1, R3)', () => {
    it('maps a draft surfdash row to published:false even when the source variant claims published', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const plan = JSON.parse(readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8')) as {
                rows: Array<{ id: string; payloadPath: string; mode: string }>;
            };
            const row = plan.rows[0];
            if (row === undefined) throw new Error('no rows');
            const payload = payloadFor(fx, row.payloadPath);
            expect(row.mode).toBe('draft');
            expect(payload.metadata.published).toBe(false);
            expect(payload.metadata.publishStatus).toBe('draft');
        }, fixture);
    });

    it('removes contradictory inherited mode keys and maps podcast rows to metadata.status', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft' },
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const plan = JSON.parse(readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8')) as {
                rows: Array<{ id: string; payloadPath: string }>;
            };
            const surfdash = plan.rows.find((row) => row.id === 'surfdash-pub.post');
            const podcast = plan.rows.find((row) => row.id === 'podcast-pub.episode');
            if (surfdash === undefined || podcast === undefined) throw new Error('rows missing');
            const sd = payloadFor(fx, surfdash.payloadPath);
            expect(sd.metadata.published).toBe(false);
            expect(sd.metadata.status).toBeUndefined();
            expect(sd.metadata.publishStatus).toBe('draft');
            const pc = payloadFor(fx, podcast.payloadPath);
            expect(pc.metadata.status).toBe('unpublished');
            expect(pc.metadata.published).toBeUndefined();
            expect(pc.metadata.publishStatus).toBe('draft');
        }, fixture);
    });

    it('maps an explicitly launched live row to its native live fields', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft' },
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'surfdash-pub,podcast-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
            } finally {
                out.restore();
            }
            const plan = JSON.parse(readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8')) as {
                rows: Array<{ id: string; payloadPath: string; mode: string }>;
            };
            for (const row of plan.rows) {
                expect(row.mode).toBe('live');
                const payload = payloadFor(fx, row.payloadPath);
                if (row.id.startsWith('surfdash')) expect(payload.metadata.published).toBe(true);
                else expect(payload.metadata.status).toBe('published');
                expect(payload.metadata.publishStatus).toBe('public');
            }
        }, fixture);
    });

    it('refuses a preset target whose options carry a mode key (promotion attempt)', async () => {
        for (const key of ['publishStatus', 'published', 'status']) {
            const fixture = makeFixture([
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    mode: 'draft',
                    options: { [key]: key === 'published' ? true : 'public' },
                },
            ]);
            await withCleanup(async (fx) => {
                const out = captureOutput();
                try {
                    expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                } finally {
                    out.restore();
                }
                expect(existsSync(join(fx.workDir, '4-publish/plan.after-generate.json'))).toBe(false);
            }, fixture);
        }
    });

    it('refuses skip_review and auto_publish in preset target options', async () => {
        for (const key of ['skip_review', 'auto_publish']) {
            const fixture = makeFixture([
                {
                    plugin: 'wechatmp-pub',
                    operation: '文章',
                    variant: 'article',
                    tier: 2,
                    mode: 'draft',
                    options: { [key]: true },
                },
            ]);
            await withCleanup(async (fx) => {
                const out = captureOutput();
                try {
                    expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                } finally {
                    out.restore();
                }
            }, fixture);
        }
    });
});

describe('publish-matrix send boundaries (0330 R2, R4, R5)', () => {
    it('a global --dummy plan builds payloads but never dispatches a transport', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
            { plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix([...planArgs(fx), '--dummy'], { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const dispatched: string[][] = [];
            const out2 = captureOutput();
            try {
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: async (argv) => {
                            dispatched.push(argv);
                            return 1;
                        },
                    }),
                ).toBe(0);
            } finally {
                out2.restore();
            }
            expect(dispatched).toHaveLength(0);
            const receiptsDir = join(fx.workDir, '4-publish', 'receipts');
            for (const name of ['surfdash-pub.post.json', 'xhs-pub.写长文.json']) {
                const receipt = JSON.parse(readFileSync(join(receiptsDir, name), 'utf-8')) as {
                    dummy?: boolean;
                    status: string;
                };
                expect(receipt.dummy).toBe(true);
                expect(receipt.status).toBe('succeeded');
            }
        }, fixture);
    });

    it('still refuses to promote a dummy target with --live-channels (regression)', async () => {
        const fixture = makeFixture([
            { plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'dummy' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'xhs-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(1);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('an explicit live launch sends for real under a fake transport', async () => {
        const fixture = makeFixture(
            [{ plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'draft' }],
            { article: contentJson('正文 xhs', { published: true, publishStatus: 'public', status: 'published' }) },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'xhs-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
            } finally {
                out.restore();
            }
            const fs = createNodeFileSystem();
            const dispatched: string[][] = [];
            const out2 = captureOutput();
            try {
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        fs,
                        dispatch: async (argv) => {
                            dispatched.push(argv);
                            const outPath = argv[argv.indexOf('--out') + 1] ?? '';
                            mkdirSync(dirname(outPath), { recursive: true });
                            writeFileSync(
                                outPath,
                                `${JSON.stringify({
                                    ok: true,
                                    targets: [
                                        { target: 'xhs-pub', ok: true, status: 'published', url: 'https://xhs.test/1' },
                                    ],
                                })}\n`,
                            );
                            return 0;
                        },
                    }),
                ).toBe(0);
            } finally {
                out2.restore();
            }
            expect(dispatched).toHaveLength(1);
            const receipt = JSON.parse(
                readFileSync(join(fx.workDir, '4-publish', 'receipts', 'xhs-pub.写长文.json'), 'utf-8'),
            ) as { mode: string; status: string; dummy?: boolean; url?: string };
            expect(receipt.mode).toBe('live');
            expect(receipt.status).toBe('succeeded');
            expect(receipt.dummy).toBeUndefined();
            expect(receipt.url).toBe('https://xhs.test/1');
        }, fixture);
    });

    it('keeps the shipped migration preset draftless short-post rows dummy and schema-valid (R4)', async () => {
        const presetPath = join(
            import.meta.dir,
            '..',
            '..',
            '..',
            'plugins',
            'kk',
            'publish-presets',
            'daily-ai-voice.json',
        );
        const preset = PublishPresetSchema.parse(JSON.parse(readFileSync(presetPath, 'utf-8')));
        const draftless = [
            { plugin: 'x-pub', operation: 'post' },
            { plugin: 'weibo-pub', operation: 'post' },
            { plugin: 'threads-pub', operation: 'post' },
        ];
        // A draftless row ships `dummy` unless the preset records an operator override for it — the
        // override is the only way a live post on a rail with no draft can be intended (ADR-022).
        const overridden = new Set((preset.overrides ?? []).map((row) => `${row.plugin}/${row.operation ?? ''}`));
        for (const { plugin, operation } of draftless) {
            const target = preset.targets.find((t) => t.plugin === plugin && t.operation === operation);
            if (target === undefined) throw new Error(`preset lost ${plugin} ${operation}`);
            if (target.mode === 'off') continue;
            const expected = overridden.has(`${plugin}/${operation}`) ? 'live' : 'dummy';
            expect(`${plugin}/${operation}: ${target.mode}`).toBe(`${plugin}/${operation}: ${expected}`);
        }
        // Every override names a row that exists and carries a reason.
        for (const override of preset.overrides ?? []) {
            expect(override.reason.length).toBeGreaterThan(0);
            const target = preset.targets.find(
                (t) => t.plugin === override.plugin && t.operation === override.operation,
            );
            expect(`${override.plugin}/${override.operation ?? ''}: ${String(target !== undefined)}`).toBe(
                `${override.plugin}/${override.operation ?? ''}: true`,
            );
        }
    });

    it('leaves the itc plan path untouched (R5)', async () => {
        const fixture = makeFixture([{ plugin: 'medium-pub', variant: 'article', tier: 2, mode: 'draft' }]);
        await withCleanup(async (fx) => {
            const resolved = await resolveItcTargets(
                { explicitPreset: 'daily-ai-voice', projectRoot: fx.root },
                createNodeFileSystem(),
            );
            expect(resolved.origin).toBe('explicit-preset');
            expect(resolved.presetName).toBe('daily-ai-voice');
            expect(resolved.targets.length).toBeGreaterThan(0);
        }, fixture);
    });
});
