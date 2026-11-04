import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planPublishMatrix, runPublishMatrixBundle, sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

// Task 0331 failure-first matrix (written before the fixes): reviewed-variant safety evidence and
// platform exclusions must gate every real plan/send.
//  1. unknown exclusion identifier -> actionable refusal (R4)
//  2. wechatmp exclusion drops BOTH wechatmp-pub operations from the plan (R4)
//  3. xiaoyuzhou/apple-podcasts exclusion drops the podcast-pub row only (R4)
//  4. live row without bundle safety evidence -> refused; same bundle plans fine with --dummy (R3)
//  5. social variant edited after review (variants digest stale) -> real plan refused (R3)
//  6. card copy edited after review -> real plan refused (R3)
//  7. legacy bundle without a safety object still parses and plans drafts unchanged (R2 compat)
//  8. payload edited between plan and send -> send refuses before any dispatch (R5 edit-while-paused)
//  9. live row whose variant file changed after freeze -> send refuses (R5)
// 10. URL-slot-only substitution accepted; resolved payload differs from raw only in link slots (R5)
// 11. safety evidence file with status block -> freeze refuses a real-capable bundle (R2/R3)
// 12. valid evidence file -> freeze attaches it to the bundle verbatim (R3)

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

interface FixtureOptions {
    safety?: Record<string, unknown> | null;
    variants?: Record<string, string>;
}

function makeFixture(targets: Array<Record<string, unknown>>, options: FixtureOptions = {}): Fixture {
    const variants = options.variants ?? {
        article: contentJson('正文 {{article_url}}', { published: true, publishStatus: 'public', status: 'published' }),
        episode: contentJson('播客 {{podcast_url}}', { published: true, publishStatus: 'public', status: 'published' }),
    };
    const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0331-'));
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const variantEntries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, text] of Object.entries(variants)) {
        const path = join(workDir, 'variants', `${name}.json`);
        writeFileSync(path, text);
        variantEntries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }

    const bundle: Record<string, unknown> = {
        schemaVersion: 1,
        runId: 'gen-run-1',
        runDate: '2026-10-22',
        runs: [],
        episode: { title: '每日AI乱炖 · 2026-10-22' },
        variants: variantEntries,
    };
    if (options.safety !== undefined && options.safety !== null) bundle.safety = options.safety;
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

    writeFileSync(
        join(root, '.kk', 'publish-presets', 'daily-ai-voice.json'),
        `${JSON.stringify({ schemaVersion: 1, name: 'daily-ai-voice', targets }, null, 2)}\n`,
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

interface PlanFile {
    rows: Array<{ id: string; mode: string; payloadPath: string; variantDigest?: string }>;
}

function readPlan(fixture: Fixture): PlanFile {
    return JSON.parse(readFileSync(join(fixture.workDir, '4-publish/plan.after-generate.json'), 'utf-8')) as PlanFile;
}

/** Reviewed-evidence object whose variants digests match the fixture's current variant bytes. */
function evidence(variants: Record<string, string>, keys: string[], excluded: string[] = []): Record<string, unknown> {
    const map: Record<string, string> = {};
    for (const key of keys) map[key] = sha256(variants[key] ?? '');
    return {
        status: 'pass',
        digest: sha256(keys.sort().join('\n')),
        excludedPlatforms: excluded,
        variants: map,
    };
}

const THREE_TARGETS = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
    { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft' },
    { plugin: 'wechatmp-pub', operation: '播客', variant: 'episode', tier: 1, mode: 'draft' },
    { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
    { plugin: 'x-pub', operation: 'post', variant: 'article', tier: 3, mode: 'draft' },
];

describe('publish-matrix platform exclusions (0331 R4)', () => {
    it('rejects an unknown exclusion identifier with an actionable failure', async () => {
        const fixture = makeFixture(THREE_TARGETS.slice(0, 1), {
            safety: evidence(
                {
                    article: contentJson('正文 {{article_url}}', {
                        published: true,
                        publishStatus: 'public',
                        status: 'published',
                    }),
                },
                ['article'],
                ['tiktok'],
            ),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
            } finally {
                out.restore();
            }
            expect(existsSync(join(fx.workDir, '4-publish/plan.after-generate.json'))).toBe(false);
        }, fixture);
    });

    it('drops both wechatmp-pub operations when the wechatmp platform is excluded', async () => {
        const variants = {
            article: contentJson('正文 {{article_url}}', {
                published: true,
                publishStatus: 'public',
                status: 'published',
            }),
            episode: contentJson('播客 {{podcast_url}}', {
                published: true,
                publishStatus: 'public',
                status: 'published',
            }),
        };
        const fixture = makeFixture(THREE_TARGETS, {
            variants,
            safety: evidence(variants, ['article', 'episode'], ['wechatmp']),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const ids = readPlan(fx).rows.map((row) => row.id);
            expect(ids).not.toContain('wechatmp-pub.播客');
            expect(ids).not.toContain('wechatmp-pub.文章');
            expect(ids).toContain('surfdash-pub.post');
            expect(ids).toContain('podcast-pub.episode');
        }, fixture);
    });

    it('drops only the podcast-pub row for xiaoyuzhou/apple-podcasts exclusions', async () => {
        const variants = {
            article: contentJson('正文 {{article_url}}', {
                published: true,
                publishStatus: 'public',
                status: 'published',
            }),
            episode: contentJson('播客 {{podcast_url}}', {
                published: true,
                publishStatus: 'public',
                status: 'published',
            }),
        };
        const fixture = makeFixture(THREE_TARGETS, {
            variants,
            safety: evidence(variants, ['article', 'episode'], ['xiaoyuzhou', 'apple-podcasts']),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const ids = readPlan(fx).rows.map((row) => row.id);
            expect(ids).not.toContain('podcast-pub.episode');
            expect(ids).toContain('wechatmp-pub.播客');
            expect(ids).toContain('wechatmp-pub.文章');
        }, fixture);
    });
});

describe('publish-matrix real-dispatch safety evidence (0331 R2, R3)', () => {
    it('refuses a live row when the bundle carries no safety evidence, but plans the same bundle with --dummy', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(1);
            } finally {
                out.restore();
            }
            expect(existsSync(join(fx.workDir, '4-publish/plan.after-generate.json'))).toBe(false);
            const out2 = captureOutput();
            try {
                expect(await planPublishMatrix([...planArgs(fx), '--dummy'], { projectRoot: fx.root })).toBe(0);
            } finally {
                out2.restore();
            }
            expect(readPlan(fx).rows.every((row) => row.mode === 'dummy')).toBe(true);
        }, fixture);
    });

    it('refuses a real plan when a social variant was edited after its review digest was recorded', async () => {
        // Review saw 旧帖 and recorded its digest; the bundle now ships the edited file. The plan
        // must refuse the real rows: the reviewed bytes are not the frozen bytes.
        const article = contentJson('正文', { published: true, publishStatus: 'public', status: 'published' });
        const reviewedSocial = contentJson('旧帖', {});
        const shippedSocial = contentJson('改过的帖', {});
        const fixture = makeFixture(
            [
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    mode: 'draft',
                    required: true,
                },
                { plugin: 'x-pub', operation: 'post', variant: 'social:x', tier: 3, mode: 'draft' },
            ],
            {
                variants: { article, 'social:x': shippedSocial },
                safety: {
                    status: 'pass',
                    digest: 'a'.repeat(64),
                    excludedPlatforms: [],
                    variants: { article: sha256(article), 'social:x': sha256(reviewedSocial) },
                },
            },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(1);
            } finally {
                out.restore();
            }
            expect(existsSync(join(fx.workDir, '4-publish/plan.after-generate.json'))).toBe(false);
        }, fixture);
    });

    it('refuses a real plan when card copy was edited after review', async () => {
        const article = contentJson('正文', { published: true, publishStatus: 'public', status: 'published' });
        const reviewedCards = contentJson('旧卡片', {});
        const shippedCards = contentJson('改过的卡片', {});
        const fixture = makeFixture(
            [
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    mode: 'draft',
                    required: true,
                },
                { plugin: 'xhs-pub', operation: '上传图文', variant: 'cards', tier: 3, mode: 'draft' },
            ],
            {
                variants: { article, cards: shippedCards },
                safety: {
                    status: 'pass',
                    digest: 'a'.repeat(64),
                    excludedPlatforms: [],
                    variants: { article: sha256(article), cards: sha256(reviewedCards) },
                },
            },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(1);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('plans a legacy bundle without a safety object unchanged for draft rows (R2 compat)', async () => {
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
            expect(readPlan(fx).rows[0]?.mode).toBe('draft');
        }, fixture);
    });
});

describe('publish-matrix send revalidation (0331 R5)', () => {
    it('refuses to dispatch when a payload was edited between plan and send', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            const plan = readPlan(fx);
            const payloadPath = plan.rows[0]?.payloadPath;
            if (payloadPath === undefined) throw new Error('no payload');
            writeFileSync(join(fx.workDir, payloadPath), contentJson('静默改过的正文', {}));
            const dispatched: string[][] = [];
            const out2 = captureOutput();
            try {
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: async (argv) => {
                            dispatched.push(argv);
                            return 0;
                        },
                    }),
                ).toBe(1);
            } finally {
                out2.restore();
            }
            expect(dispatched).toHaveLength(0);
        }, fixture);
    });

    it('refuses to dispatch a live row whose variant file changed after the freeze', async () => {
        const article = contentJson('正文', { published: true, publishStatus: 'public', status: 'published' });
        const fixture = makeFixture(
            [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft' }],
            { variants: { article }, safety: evidence({ article }, ['article']) },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
            } finally {
                out.restore();
            }
            // Variant source edited after plan freeze (safety evidence binds to old bytes).
            writeFileSync(
                join(fx.workDir, 'variants/article.json'),
                contentJson('正文被改', { published: true, publishStatus: 'public', status: 'published' }),
            );
            const dispatched: string[][] = [];
            const out2 = captureOutput();
            try {
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: async (argv) => {
                            dispatched.push(argv);
                            return 0;
                        },
                    }),
                ).toBe(1);
            } finally {
                out2.restore();
            }
            expect(dispatched).toHaveLength(0);
        }, fixture);
    });

    it('accepts URL-slot-only substitution and dispatches the resolved payload', async () => {
        const fixture = makeFixture(
            [
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    mode: 'draft',
                    required: true,
                },
                { plugin: 'x-pub', operation: 'post', variant: 'article', tier: 2, mode: 'draft' },
            ],
            { variants: { article: contentJson('正文 {{article_url}} 尾部', {}) } },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }
            // tier-0 success receipt provides the article link
            const receiptsDir = join(fx.workDir, '4-publish', 'receipts');
            mkdirSync(receiptsDir, { recursive: true });
            writeFileSync(
                join(receiptsDir, 'surfdash-pub.post.json'),
                `${JSON.stringify({ status: 'succeeded', url: 'https://surfdash.test/abc' })}\n`,
            );
            const sentPayloads: string[] = [];
            const out2 = captureOutput();
            try {
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate', '--tier', '2'], {
                        dispatch: async (argv) => {
                            const content = argv[argv.indexOf('--content') + 1] ?? '';
                            sentPayloads.push(content);
                            const outPath = argv[argv.indexOf('--out') + 1] ?? '';
                            mkdirSync(dirname(outPath), { recursive: true });
                            writeFileSync(
                                outPath,
                                `${JSON.stringify({
                                    ok: true,
                                    targets: [
                                        { target: 'x-pub', ok: true, status: 'published', url: 'https://x.test/1' },
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
            expect(sentPayloads).toHaveLength(1);
            const resolved = JSON.parse(readFileSync(sentPayloads[0] ?? '', 'utf-8')) as { body: string };
            expect(resolved.body).toBe('正文 https://surfdash.test/abc 尾部');
        }, fixture);
    });
});

describe('publish-matrix freeze admission (0331 R2, R3)', () => {
    it('refuses to freeze a real-capable bundle whose evidence records status block', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0331b-'));
        const workDir = join(root, 'work');
        try {
            mkdirSync(join(workDir, '30-variants'), { recursive: true });
            writeFileSync(join(workDir, '30-variants', 'article.content.json'), contentJson('正文', {}));
            mkdirSync(join(workDir, '4-safety-variants'), { recursive: true });
            writeFileSync(
                join(workDir, '4-safety-variants', 'safety.json'),
                `${JSON.stringify({ status: 'block', digest: '0'.repeat(64), excludedPlatforms: [], variants: {} })}\n`,
            );
            const out = captureOutput();
            try {
                expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'gen-1'])).toBe(
                    1,
                );
            } finally {
                out.restore();
            }
            expect(existsSync(join(workDir, 'bundle.json'))).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('attaches valid safety evidence to the frozen bundle verbatim', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0331c-'));
        const workDir = join(root, 'work');
        try {
            mkdirSync(join(workDir, '30-variants'), { recursive: true });
            const raw = contentJson('正文', {});
            writeFileSync(join(workDir, '30-variants', 'article.content.json'), raw);
            mkdirSync(join(workDir, '4-safety-variants'), { recursive: true });
            const safety = {
                status: 'pass',
                digest: 'a'.repeat(64),
                excludedPlatforms: ['wechatmp'],
                variants: { article: sha256(raw) },
            };
            writeFileSync(join(workDir, '4-safety-variants', 'safety.json'), `${JSON.stringify(safety, null, 2)}\n`);
            const out = captureOutput();
            try {
                expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'gen-1'])).toBe(
                    0,
                );
            } finally {
                out.restore();
            }
            const bundle = JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')) as { safety?: unknown };
            expect(bundle.safety).toEqual(safety);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('freezes without safety evidence when none exists (dummy-capable bundle)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0331d-'));
        const workDir = join(root, 'work');
        try {
            mkdirSync(join(workDir, '30-variants'), { recursive: true });
            writeFileSync(join(workDir, '30-variants', 'article.content.json'), contentJson('正文', {}));
            const out = captureOutput();
            try {
                expect(await runPublishMatrixBundle([workDir, '--run-date', '2026-10-22', '--run-id', 'gen-1'])).toBe(
                    0,
                );
            } finally {
                out.restore();
            }
            const bundle = JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')) as { safety?: unknown };
            expect(bundle.safety).toBeUndefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
