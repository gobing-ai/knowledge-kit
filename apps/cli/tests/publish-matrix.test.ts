import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    createNodeFileSystem,
    NodeProcessExecutor,
    type ProcessOptions,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import { PublishPresetSchema, resolveItcTargets } from '../src/itc-plan';
import { main } from '../src/main';
import {
    checkPublishMatrix,
    classifyPublishMatrix,
    DEFAULT_PUBLISH_PRESET,
    feedItems,
    matchRssGate,
    planPublishMatrix,
    readPublishPresetSelector,
    runPublishMatrixClassify,
    runPublishMatrixRssGate,
    runPublishMatrixWaitUntil,
    sendPublishMatrix,
} from '../src/publish-matrix';
import { captureOutput } from './capture';

// Every way this surface can fail, written before the fixtures (AGENTS testing rule).
//  1. unknown preset slug
//  2. a preset file carrying `mode: live` (live is launch-only, ADR-022)
//  3. `--live-channels` naming a target the window does not list
//  4. `--live-channels` naming a dummy-only target
//  5. `--channels` naming a channel the preset never lists (typo, not a silent empty plan)
//  6. a missing bundle variant, and a variant whose sha256 disagrees with the bundle
//  7. two preset rows resolving to the same target id
//  8. a link placeholder with no tier-0 url
//  9. an itc-shaped preset (no matrix fields) that must still validate

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

/**
 * Build a works dir with a bundle, its variant files and a project publish preset. The preset is
 * deliberately project-scoped (`<root>/.kk/publish-presets`) so the same resolver the itc surface
 * uses is what the matrix reads.
 */
function makeFixture(
    targets: Array<Record<string, unknown>>,
    variants: Record<string, string> = {
        article: contentJson('正文 {{article_url}}'),
        episode: contentJson('播客 {{podcast_url}}'),
    },
    presetName = 'daily-ai-voice',
): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-'));
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

/** Dispatch seam: writes the aggregate result the shared send loop reads, never spawns a plugin. */
function fakeDispatch(outcomes: Record<string, { ok: boolean; url?: string; error?: string }> = {}) {
    const calls: string[][] = [];
    const dispatch = async (argv: string[]): Promise<number> => {
        calls.push(argv);
        const target = argv[argv.indexOf('--target') + 1] ?? '';
        const outPath = argv[argv.indexOf('--out') + 1] ?? '';
        const outcome = outcomes[target] ?? { ok: true, url: `https://example.test/${target}` };
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(
            outPath,
            JSON.stringify({
                ok: outcome.ok,
                targets: [
                    {
                        target,
                        ok: outcome.ok,
                        status: outcome.ok ? 'published' : 'failed',
                        ...(outcome.url ? { url: outcome.url } : {}),
                        ...(outcome.error ? { error: outcome.error } : {}),
                    },
                ],
            }),
        );
        return outcome.ok ? 0 : 1;
    };
    return { dispatch, calls };
}

const TIER0 = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
    { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft', required: true },
];

/** Tier 0 without the publication-contract requirement, so a failure never skips later tiers. */
const TIER0_SOFT = TIER0.map((target) => ({ ...target, required: false }));

const DOMESTIC = [
    { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
    { plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'dummy' },
];

async function withCleanup(fn: (fixture: Fixture) => Promise<void>, fixture: Fixture): Promise<void> {
    try {
        await fn(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

describe('publish-matrix-plan (0321 R1, R2)', () => {
    it('plans one row per in-window target with payload paths, digests and approval flags', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
            } finally {
                out.restore();
            }

            const planPath = join(fx.workDir, '4-publish/plan.after-generate.json');
            expect(existsSync(planPath)).toBe(true);
            const plan = JSON.parse(readFileSync(planPath, 'utf-8')) as {
                window: string;
                presetName: string;
                parentRunId: string;
                rows: Array<{
                    id: string;
                    mode: string;
                    approval: string;
                    tier: number;
                    payloadPath: string;
                    payloadDigest: string;
                }>;
            };
            expect(plan.window).toBe('after-generate');
            expect(plan.presetName).toBe('daily-ai-voice');
            // A bundle without parentRunId still binds receipts to a run: its own run id.
            expect(plan.parentRunId).toBe('gen-run-1');
            expect(plan.rows.map((row) => row.id)).toEqual([
                'surfdash-pub.post',
                'podcast-pub.episode',
                'wechatmp-pub.文章',
                'xhs-pub.写长文',
            ]);
            const wechat = plan.rows[2];
            const xhs = plan.rows[3];
            if (wechat === undefined || xhs === undefined) throw new Error('plan rows missing');
            expect(wechat.mode).toBe('draft');
            expect(wechat.approval).toBe('none');
            expect(xhs.mode).toBe('dummy');
            expect(xhs.tier).toBe(2);

            const payload = JSON.parse(readFileSync(join(fx.workDir, wechat.payloadPath as string), 'utf-8')) as {
                metadata: Record<string, unknown>;
            };
            expect(payload.metadata.operation).toBe('文章');
            expect(payload.metadata.publishStatus).toBe('draft');
            expect(sha256(readFileSync(join(fx.workDir, wechat.payloadPath as string), 'utf-8'))).toBe(
                wechat.payloadDigest,
            );

            const events = readFileSync(join(fx.workDir, '4-publish/publish-events.jsonl'), 'utf-8')
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as { event: string; id?: string });
            expect(events.filter((event) => event.event === 'planned')).toHaveLength(4);
        }, fixture);
    });

    it('keeps a window disjoint: cn-peak plans only its own targets', async () => {
        const fixture = makeFixture([
            ...TIER0,
            { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
            { plugin: 'xhs-pub', operation: '上传图文', variant: 'article', tier: 3, mode: 'draft', window: 'cn-peak' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx).slice(0, 6), 'cn-peak'], { projectRoot: fx.root }),
                ).toBe(0);
            } finally {
                out.restore();
            }
            const plan = JSON.parse(readFileSync(join(fx.workDir, '4-publish/plan.cn-peak.json'), 'utf-8')) as {
                rows: Array<{ id: string }>;
            };
            expect(plan.rows.map((row) => row.id)).toEqual(['xhs-pub.上传图文']);
        }, fixture);
    });

    it('narrows with --channels and refuses a channel the preset never lists', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix(planArgs(fx, ['--channels', 'surfdash-pub']), { projectRoot: fx.root }),
                ).toBe(0);
                expect(
                    await planPublishMatrix(planArgs(fx, ['--channels', 'nope-pub']), { projectRoot: fx.root }),
                ).toBe(1);
            } finally {
                out.restore();
            }
            const plan = JSON.parse(readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8')) as {
                rows: Array<{ plugin: string }>;
            };
            expect(plan.rows.map((row) => row.plugin)).toEqual(['surfdash-pub']);
        }, fixture);
    });

    it('promotes a listed channel to live and records the approval it needs', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix(planArgs(fx, ['--live-channels', 'wechatmp-pub']), {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                const plan = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8'),
                ) as { rows: Array<{ id: string; mode: string; approval: string }> };
                const wechat = plan.rows.find((row) => row.id === 'wechatmp-pub.文章');
                expect(wechat?.mode).toBe('live');
                expect(wechat?.approval).toBe('required');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('refuses a live promotion the preset window does not list, or a dummy-only target', async () => {
        const fixture = makeFixture([
            ...TIER0,
            ...DOMESTIC,
            { plugin: 'xhs-pub', operation: '上传图文', variant: 'article', tier: 3, mode: 'draft', window: 'cn-peak' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                // 上传图文 exists in the preset but not in after-generate.
                expect(
                    await planPublishMatrix(planArgs(fx, ['--live-channels', 'xhs-pub.上传图文']), {
                        projectRoot: fx.root,
                    }),
                ).toBe(1);
                // xhs-pub 写长文 is dummy-only.
                expect(
                    await planPublishMatrix(planArgs(fx, ['--live-channels', 'xhs-pub']), { projectRoot: fx.root }),
                ).toBe(1);
                expect(
                    await planPublishMatrix(planArgs(fx, ['--live-channels', 'nope-pub']), { projectRoot: fx.root }),
                ).toBe(1);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('accepts a preset row that yields a live send (ADR-022 amendment 2026-11-12)', async () => {
        const fixture = makeFixture([{ plugin: 'podcast-pub', variant: 'episode', tier: 0, mode: 'live' }]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const plan = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish', 'plan.after-generate.json'), 'utf-8'),
                ) as { rows: Array<{ plugin: string; mode: string }> };
                expect(plan.rows.find((row) => row.plugin === 'podcast-pub')?.mode).toBe('live');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('rejects an unknown preset, a missing variant, a digest mismatch and a duplicate target id', async () => {
        const unknown = makeFixture([...TIER0]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix(
                        [
                            fx.workDir,
                            '--bundle',
                            fx.bundlePath,
                            '--preset',
                            'no-such-preset',
                            '--window',
                            'after-generate',
                        ],
                        { projectRoot: fx.root },
                    ),
                ).toBe(1);
            } finally {
                out.restore();
            }
        }, unknown);

        // 0332 R6: only a REQUIRED missing variant aborts the plan; an optional one is omitted
        // with a failed effect-none receipt instead.
        const missing = makeFixture([
            { plugin: 'podcast-pub', variant: 'cards', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                expect(out.readErr()).toContain("bundle has no variant 'cards'");
            } finally {
                out.restore();
            }
        }, missing);

        const mismatch = makeFixture([...TIER0], { article: contentJson('tampered'), episode: contentJson('ok') });
        await withCleanup(async (fx) => {
            // Corrupt the recorded digest without touching the file: the plan must refuse.
            const bundlePath = fx.bundlePath;
            const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8')) as {
                variants: Record<string, { sha256: string }>;
            };
            const article = bundle.variants.article as { sha256: string };
            article.sha256 = 'deadbeef';
            writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                expect(out.readErr()).toContain('variant digest mismatch');
            } finally {
                out.restore();
            }
        }, mismatch);

        const duplicate = makeFixture([...TIER0, { ...TIER0[0], id: 'surfdash-pub.post' }]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                expect(out.readErr()).toContain("duplicate target id 'surfdash-pub.post'");
            } finally {
                out.restore();
            }
        }, duplicate);
    });
});

describe('publish-matrix-send (0321 R4, R5)', () => {
    it('sends in tier order, keys receipts by target id and fills tier-0 links', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const { dispatch, calls } = fakeDispatch({
                    'surfdash-pub': { ok: true, url: 'https://surfdash.test/a' },
                    'podcast-pub': { ok: true, url: 'https://podcast.test/e' },
                });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                // Tier 0 dispatches before tier 2; the dummy 写长文 row never spawns a plugin.
                expect(calls).toHaveLength(3);
                expect(calls[0]).toContain('surfdash-pub');

                const receiptsDir = join(fx.workDir, '4-publish/receipts');
                const surfdash = JSON.parse(readFileSync(join(receiptsDir, 'surfdash-pub.post.json'), 'utf-8')) as {
                    target: string;
                    window: string;
                    effect: string;
                };
                expect(surfdash.target).toBe('surfdash-pub.post');
                expect(surfdash.window).toBe('after-generate');
                expect(surfdash.effect).toBe('confirmed');

                // The tier-2 payload is the resolved copy, not the raw placeholder text.
                const resolved = readFileSync(
                    join(fx.workDir, '4-publish/payloads/content.wechatmp-pub.文章.resolved.json'),
                    'utf-8',
                );
                expect(resolved).toContain('https://surfdash.test/a');
                expect(resolved).not.toContain('{{article_url}}');

                const events = readFileSync(join(fx.workDir, '4-publish/publish-events.jsonl'), 'utf-8')
                    .trim()
                    .split('\n')
                    .map((line) => JSON.parse(line) as { event: string; id?: string });
                // Three real sends plus the dummy row's synthetic succeeded receipt (task 0322).
                expect(events.filter((event) => event.event === 'sent')).toHaveLength(4);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('never resends a window it already delivered', async () => {
        const fixture = makeFixture([...TIER0]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const first = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                const second = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: second.dispatch }),
                ).toBe(0);
                expect(first.calls).toHaveLength(2);
                expect(second.calls).toHaveLength(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('fails a row whose link placeholder has no tier-0 url, without dispatching it', async () => {
        const fixture = makeFixture([...TIER0_SOFT, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                // surfdash is not required, so a failed tier-0 does not skip later tiers here.
                const { dispatch, calls } = fakeDispatch({ 'surfdash-pub': { ok: false, error: 'boom' } });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                const receipt = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/receipts/wechatmp-pub.文章.json'), 'utf-8'),
                ) as { effect: string; error: string };
                expect(receipt.effect).toBe('none');
                expect(receipt.error).toBe('unresolved-link');
                // surfdash + podcast + xhs dispatched; the 文章 row never reached a plugin.
                expect(calls.some((argv) => argv.includes('wechatmp-pub'))).toBe(false);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('skips every later tier when a required tier-0 row fails', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const { dispatch, calls } = fakeDispatch({ 'surfdash-pub': { ok: false, error: 'boom' } });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                expect(calls.some((argv) => argv.includes('wechatmp-pub'))).toBe(false);
                const events = readFileSync(join(fx.workDir, '4-publish/publish-events.jsonl'), 'utf-8');
                expect(events).toContain('tier-0-required-failed');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('re-enters a window whose tier 0 already succeeded and still sends the later tiers', async () => {
        // No placeholders, so a later-tier re-entry needs no link resolution.
        const fixture = makeFixture([...TIER0, ...DOMESTIC], {
            article: contentJson('正文'),
            episode: contentJson('播客'),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const first = fakeDispatch({ 'wechatmp-pub': { ok: false, error: 'boom' } });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                expect(first.calls.some((argv) => argv.includes('wechatmp-pub'))).toBe(true);

                // Tier 0 is skipped as already-succeeded; that must not read as a tier-0 failure.
                const second = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: second.dispatch }),
                ).toBe(0);
                expect(second.calls.map((argv) => argv[argv.indexOf('--target') + 1])).toEqual(['wechatmp-pub']);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('restricts to one tier and only retries effect:none failures under --retry', async () => {
        // No link placeholders, so a tier-2-only run has nothing to resolve against tier 0.
        const fixture = makeFixture([...TIER0, ...DOMESTIC], {
            article: contentJson('正文'),
            episode: contentJson('播客'),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const tierTwo = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate', '--tier', '2'], {
                        dispatch: tierTwo.dispatch,
                    }),
                ).toBe(0);
                expect(tierTwo.calls).toHaveLength(1);

                const retry = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate', '--tier', '2', '--retry'], {
                        dispatch: retry.dispatch,
                    }),
                ).toBe(0);
                // Nothing failed with effect:none, so --retry dispatches nothing.
                expect(retry.calls).toHaveLength(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish3 stage surface (0323 R2, R3, R5)', () => {
    const FEED = `<?xml version="1.0"?><rss><channel>
      <item><title>每日AI乱炖 · 2026-10-20</title><guid>ep-10-20</guid></item>
      <item><title><![CDATA[每日AI乱炖 · 2026-10-21]]></title><guid>ep-10-21</guid></item>
    </channel></rss>`;

    it('parses feed items and matches on guid first, then the title date', () => {
        const items = feedItems(FEED);
        expect(items).toEqual([
            { title: '每日AI乱炖 · 2026-10-20', guid: 'ep-10-20' },
            { title: '每日AI乱炖 · 2026-10-21', guid: 'ep-10-21' },
        ]);
        expect(matchRssGate(items, '2026-10-21', 'ep-10-21')).toBe('guid');
        // The guid wins even when the date belongs to a different item.
        expect(matchRssGate(items, '2026-10-20', 'ep-10-21')).toBe('guid');
        // Title fallback when no receipt guid is available.
        expect(matchRssGate(items, '2026-10-20', '')).toBe('title');
        expect(matchRssGate(items, '2026-10-22', '')).toBe('missing');
    });

    it('exits 0 on a gate hit and 3 on a miss, writing rss-gate.json either way', async () => {
        const fixture = makeFixture([...TIER0]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-21'], {
                        readFeed: async () => FEED,
                    }),
                ).toBe(0);
                const hit = JSON.parse(readFileSync(join(fx.workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
                    hit: boolean;
                    reason: string;
                    date: string;
                };
                expect(hit.hit).toBe(true);
                expect(hit.reason).toBe('title');
                expect(hit.date).toBe('2026-10-21');

                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-22'], {
                        readFeed: async () => FEED,
                    }),
                ).toBe(3);
                const miss = JSON.parse(readFileSync(join(fx.workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
                    hit: boolean;
                    reason: string;
                };
                expect(miss.hit).toBe(false);
                expect(miss.reason).toBe('missing');

                // An outage is a miss, never a hit: an unpublished episode must not slip through.
                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-21'], {
                        readFeed: async () => {
                            throw new Error('ECONNREFUSED');
                        },
                    }),
                ).toBe(3);
                const failed = JSON.parse(readFileSync(join(fx.workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
                    hit: boolean;
                    reason: string;
                    detail: string;
                };
                expect(failed.hit).toBe(false);
                expect(failed.reason).toBe('fetch-failed');
                expect(failed.detail).toContain('ECONNREFUSED');

                const events = readFileSync(join(fx.workDir, '4-publish/publish-events.jsonl'), 'utf-8');
                expect(events).toContain('gate-miss');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('reads the feed over HTTP by default and treats an error status as fetch-failed, not missing', async () => {
        const fixture = makeFixture([...TIER0]);
        const server = Bun.serve({
            port: 0,
            fetch: (req) =>
                new URL(req.url).pathname === '/ok' ? new Response(FEED) : new Response('oops', { status: 503 }),
        });
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                const base = `http://127.0.0.1:${server.port}`;
                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-21', '--feed', `${base}/ok`]),
                ).toBe(0);
                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-21', '--feed', `${base}/down`]),
                ).toBe(3);
                const failed = JSON.parse(readFileSync(join(fx.workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
                    reason: string;
                    detail: string;
                };
                expect(failed.reason).toBe('fetch-failed');
                expect(failed.detail).toContain('HTTP 503');
            } finally {
                out.restore();
                server.stop(true);
            }
        }, fixture);
    });

    it('waits only when the target wall-clock time is still ahead, and corrects for DST', async () => {
        const slept: number[] = [];
        const out = captureOutput();
        try {
            // 2026-10-22T23:00Z is 16:00 in Los Angeles and 07:00 the next day in Shanghai, so a
            // 09:00 Shanghai target is two hours away.
            const base = Date.UTC(2026, 9, 22, 23, 0, 0);
            expect(
                await runPublishMatrixWaitUntil(['09:00', 'Asia/Shanghai'], {
                    now: () => base,
                    sleep: async (ms) => {
                        slept.push(ms);
                    },
                }),
            ).toBe(0);
            expect(slept).toHaveLength(1);
            expect(Math.round((slept[0] ?? 0) / 60_000)).toBe(120);

            // Already past: no sleep at all.
            slept.length = 0;
            expect(
                await runPublishMatrixWaitUntil(['09:00', 'Asia/Shanghai'], {
                    now: () => Date.UTC(2026, 9, 23, 3, 0, 0), // 11:00 Shanghai
                    sleep: async (ms) => {
                        slept.push(ms);
                    },
                }),
            ).toBe(0);
            expect(slept).toHaveLength(0);

            // Wrapped past midnight in target zone (e.g. 02:30 Shanghai = 10:30 PDT on the same US day,
            // 17.5h after 09:00 Shanghai and outside the <=180min DST pre-tick cushion): no sleep.
            slept.length = 0;
            expect(
                await runPublishMatrixWaitUntil(['09:00', 'Asia/Shanghai'], {
                    now: () => Date.UTC(2026, 9, 23, 18, 30, 0), // 02:30 Shanghai (+1d)
                    sleep: async (ms) => {
                        slept.push(ms);
                    },
                }),
            ).toBe(0);
            expect(slept).toHaveLength(0);
        } finally {
            out.restore();
        }

        const bad = captureOutput();
        try {
            expect(await runPublishMatrixWaitUntil(['25:00', 'Asia/Shanghai'])).toBe(1);
            expect(await runPublishMatrixWaitUntil(['09:00'])).toBe(1);
        } finally {
            bad.restore();
        }
    });

    it('selects the preset from config, defaulting when the block is absent and refusing an unknown key', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-publish3-config-'));
        try {
            const fs = createNodeFileSystem();
            const missing = join(root, 'nope.yaml');
            expect(await readPublishPresetSelector({ KK_CONFIG: missing, HOME: root }, fs)).toBe(
                DEFAULT_PUBLISH_PRESET,
            );

            const good = join(root, 'good.yaml');
            writeFileSync(good, 'workflows:\n  kk-daily-ai-voice3:\n    publish_preset: my-preset\n');
            expect(await readPublishPresetSelector({ KK_CONFIG: good, HOME: root }, fs)).toBe('my-preset');

            const empty = join(root, 'empty.yaml');
            writeFileSync(empty, 'workflows:\n  kk-daily-ai-voice3: {}\n');
            expect(await readPublishPresetSelector({ KK_CONFIG: empty, HOME: root }, fs)).toBe(DEFAULT_PUBLISH_PRESET);

            // `~` must expand against $HOME, exactly like `itc-config.ts` resolves every other kk
            // config read: an unexpanded `~` silently read a file under the cwd instead.
            mkdirSync(join(root, '.config', 'kk'), { recursive: true });
            writeFileSync(
                join(root, '.config', 'kk', 'config.yaml'),
                'workflows:\n  kk-daily-ai-voice3:\n    publish_preset: from-home\n',
            );
            expect(await readPublishPresetSelector({ KK_CONFIG: '~/.config/kk/config.yaml', HOME: root }, fs)).toBe(
                'from-home',
            );

            const unknownKey = join(root, 'unknown.yaml');
            writeFileSync(unknownKey, 'workflows:\n  kk-daily-ai-voice3:\n    channels: x\n');
            await expect(readPublishPresetSelector({ KK_CONFIG: unknownKey, HOME: root }, fs)).rejects.toThrow(
                'is not a declared setting',
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('ships a preset whose every row belongs to exactly one window and publishes live by default', async () => {
        const shipped = JSON.parse(
            readFileSync(join(import.meta.dir, '../../../plugins/kk/publish-presets/daily-ai-voice.json'), 'utf-8'),
        ) as { targets: Array<{ plugin: string; window?: string; mode?: string }> };
        const parsed = PublishPresetSchema.safeParse(shipped);
        expect(parsed.success).toBe(true);
        for (const target of shipped.targets) {
            expect(['after-generate', 'cn-peak', 'overseas-rss']).toContain(target.window ?? '');
        }
        // ADR-022 amendment 2026-11-12: the operator's live consent is the preset itself, so every
        // enabled row publishes live. Two closed exceptions stay: `off` opts a channel out, and a
        // DRAFTLESS row (no draft mode in its plugin profile — the social `post` rails) stays
        // `dummy`, because there is no reversible state to fall back to.
        const draftless = new Set(['x-pub.post', 'weibo-pub.post', 'threads-pub.post', 'linkedin-pub.post']);
        const enabled = shipped.targets.filter((target) => target.mode !== 'off');
        expect(enabled.length).toBeGreaterThan(0);
        for (const target of enabled) {
            const key = `${target.plugin}.${(target as { operation?: string }).operation ?? ''}`;
            expect(target.mode).toBe(draftless.has(key) ? 'dummy' : 'live');
        }
        // The owned publication contract is required and live on after-generate.
        const tier0 = shipped.targets.filter((target) => target.window === 'after-generate');
        expect(tier0.some((target) => target.plugin === 'surfdash-pub' && target.mode === 'live')).toBe(true);
        expect(tier0.some((target) => target.plugin === 'podcast-pub' && target.mode === 'live')).toBe(true);
    });
});

describe('publish-matrix receipt classification (0326 R1, R2)', () => {
    const plan = {
        schemaVersion: 1 as const,
        window: 'after-generate' as const,
        bundleRunId: 'gen-run-1',
        parentRunId: 'gen-run-1',
        presetName: 'daily-ai-voice',
        presetDigest: 'd1',
        excluded: [] as Array<{ id: string; plugin: string; reason: string }>,
        rows: [
            {
                id: 'surfdash-pub.post',
                plugin: 'surfdash-pub',
                variant: 'article',
                tier: 0,
                window: 'after-generate' as const,
                mode: 'draft' as const,
                required: true,
                approval: 'none' as const,
                status: 'planned' as const,
                payloadPath: 'p',
                payloadDigest: 'd',
            },
            {
                id: 'xhs-pub.写长文',
                plugin: 'xhs-pub',
                variant: 'article',
                tier: 2,
                window: 'after-generate' as const,
                mode: 'dummy' as const,
                required: false,
                approval: 'none' as const,
                status: 'planned' as const,
                payloadPath: 'p',
                payloadDigest: 'd',
            },
        ],
    };

    function receipt(target: string, fields: Record<string, unknown>): Record<string, unknown> {
        return {
            schemaVersion: 1,
            parentRunId: 'gen-run-1',
            planDigest: 'd1',
            payloadDigest: 'd2',
            plugin: target.split('.')[0],
            profile: 'article',
            mode: 'draft',
            attemptId: 'attempt-1',
            ...fields,
            target,
        };
    }

    it('classifies full, partial, none and dummy over the non-dummy rows only', () => {
        const succeeded = receipt('surfdash-pub.post', { status: 'succeeded', effect: 'confirmed' });
        const dummy = receipt('xhs-pub.写长文', { status: 'succeeded', effect: 'none', dummy: true });
        const failed = receipt('surfdash-pub.post', { status: 'failed', effect: 'none' });

        const full = classifyPublishMatrix(plan, [succeeded as never, dummy as never], '20261022');
        expect(full.status).toBe('full');
        expect(full.published).toBe(1);
        expect(full.targets).toBe(1);
        expect(full.rows.find((row) => row.id === 'xhs-pub.写长文')?.dummy).toBe(true);

        expect(classifyPublishMatrix(plan, [failed as never, dummy as never], '20261022').status).toBe('none');

        // A planned row with no receipt is not a success.
        expect(classifyPublishMatrix(plan, [dummy as never], '20261022').status).toBe('none');

        // All-dummy and no-receipts windows are `dummy`, never `full`.
        const allDummyPlan = { ...plan, rows: [plan.rows[1] as (typeof plan.rows)[number]] };
        expect(classifyPublishMatrix(allDummyPlan, [dummy as never], '20261022').status).toBe('dummy');
        expect(classifyPublishMatrix(allDummyPlan, [], '20261022').status).toBe('none');
    });

    it('classifies partial when at least one non-dummy row succeeded', () => {
        const partialPlan = {
            ...plan,
            rows: [
                plan.rows[0] as (typeof plan.rows)[number],
                { ...(plan.rows[1] as (typeof plan.rows)[number]), id: 'wechatmp-pub.文章', mode: 'draft' as const },
            ],
        };
        const outcome = classifyPublishMatrix(
            partialPlan,
            [receipt('surfdash-pub.post', { status: 'succeeded', effect: 'confirmed' }) as never],
            '20261022',
        );
        expect(outcome.status).toBe('partial');
        expect(outcome.published).toBe(1);
        expect(outcome.targets).toBe(2);
    });

    it('writes the outcome, the status file and the ledger summary, and bridges the legacy names', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const { dispatch } = fakeDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                expect(
                    await runPublishMatrixClassify([
                        fx.workDir,
                        '--window',
                        'after-generate',
                        '--run-date',
                        '20261022',
                    ]),
                ).toBe(0);

                const publishDir = join(fx.workDir, '4-publish');
                const outcome = JSON.parse(readFileSync(join(publishDir, 'outcome.after-generate.json'), 'utf-8')) as {
                    status: string;
                    published: number;
                    targets: number;
                    rows: Array<{ id: string; dummy: boolean }>;
                };
                // surfdash + podcast + wechatmp sent, xhs dummy → every real row succeeded.
                expect(outcome.status).toBe('full');
                expect(outcome.published).toBe(3);
                expect(outcome.targets).toBe(3);
                expect(outcome.rows.find((row) => row.id === 'xhs-pub.写长文')?.dummy).toBe(true);
                expect(readFileSync(join(publishDir, 'publish-status.after-generate.txt'), 'utf-8').trim()).toBe(
                    'full',
                );
                expect(readFileSync(join(fx.workDir, 'publish-classify.summary.txt'), 'utf-8')).toContain(
                    '"status":"full","published":3,"targets":3',
                );

                const legacy = join(fx.workDir, '31-publish');
                const surfdashLegacy = JSON.parse(
                    readFileSync(join(legacy, '20261022_14_publish-surfdash_result.json'), 'utf-8'),
                ) as { targets: Array<{ target: string }> };
                expect(surfdashLegacy.targets[0]?.target).toBe('surfdash-pub');
                expect(existsSync(join(legacy, '20261022_16_publish-podcast_result.json'))).toBe(true);

                // The proof the bridge exists for: voice2's own classifier runs unchanged on this dir.
                const legacyRun = await main([
                    'node',
                    'kk',
                    'daily',
                    'publish-classify',
                    '--work-dir',
                    fx.workDir,
                    '--run-date',
                    '20261022',
                ]);
                expect(legacyRun).toBe(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('bridges nothing for an all-dummy window and nothing outside after-generate', async () => {
        const dummyFixture = makeFixture([...TIER0]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, ['--dummy']), { projectRoot: fx.root })).toBe(0);
                const { dispatch } = fakeDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                expect(
                    await runPublishMatrixClassify([
                        fx.workDir,
                        '--window',
                        'after-generate',
                        '--run-date',
                        '20261022',
                    ]),
                ).toBe(0);
                const publishDir = join(fx.workDir, '4-publish');
                expect(readFileSync(join(publishDir, 'publish-status.after-generate.txt'), 'utf-8').trim()).toBe(
                    'dummy',
                );
                expect(existsSync(join(fx.workDir, '31-publish'))).toBe(false);
            } finally {
                out.restore();
            }
        }, dummyFixture);

        const peakFixture = makeFixture([
            {
                plugin: 'surfdash-pub',
                operation: 'post',
                variant: 'article',
                tier: 0,
                mode: 'draft',
                window: 'cn-peak',
            },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx).slice(0, 6), 'cn-peak'], { projectRoot: fx.root }),
                ).toBe(0);
                const { dispatch } = fakeDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'cn-peak'], { dispatch })).toBe(0);
                expect(
                    await runPublishMatrixClassify([fx.workDir, '--window', 'cn-peak', '--run-date', '20261022']),
                ).toBe(0);
                // The legacy names are the after-generate contract only.
                expect(existsSync(join(fx.workDir, '31-publish'))).toBe(false);
            } finally {
                out.restore();
            }
        }, peakFixture);
    });

    it('reports none and exits 0 when the window has no plan', async () => {
        const fixture = makeFixture([...TIER0]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await runPublishMatrixClassify([fx.workDir, '--window', 'overseas-rss', '--run-date', '20261022']),
                ).toBe(0);
                const status = readFileSync(
                    join(fx.workDir, '4-publish/publish-status.overseas-rss.txt'),
                    'utf-8',
                ).trim();
                expect(status).toBe('none');
                // The ledger's Result cell reads this file; a never-planned window must say `none`.
                expect(readFileSync(join(fx.workDir, 'publish-classify.summary.txt'), 'utf-8')).toContain(
                    '"status":"none","published":0,"targets":0',
                );
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish-matrix preset preflight (0325 R1, R2)', () => {
    /** Injected plugin records: only ones that declare `check` are actually probed. */
    const pluginRecords = ['wechatmp-pub', 'xhs-pub', 'surfdash-pub', 'podcast-pub'].map((name) => ({
        name,
        kind: 'publish' as const,
        entry: `/tmp/${name}/index.js`,
        check: `/tmp/${name}/check.js`,
        dir: `/tmp/${name}`,
        manifestPath: `/tmp/${name}/plugin.json`,
        origin: 'builtin' as const,
    }));

    it('probes exactly the draft rows of every window from the preset, with no plan file', async () => {
        const fixture = makeFixture([
            { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
            { plugin: 'xhs-pub', operation: '写播客', variant: 'episode', tier: 1, mode: 'draft', window: 'cn-peak' },
            { plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'dummy' },
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'off' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                const code = await checkPublishMatrix([fx.workDir, '--preset', 'daily-ai-voice', '--all-windows'], {
                    projectRoot: fx.root,
                    plugins: pluginRecords,
                    executor: new (class extends NodeProcessExecutor {
                        override async run(options: ProcessOptions): Promise<ProcessResult> {
                            return {
                                command: options.command,
                                args: options.args ?? [],
                                exitCode: 0,
                                stdout: '',
                                stderr: '',
                                durationMs: 0,
                            } as ProcessResult;
                        }
                    })(),
                });
                expect(code).toBe(0);

                const record = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/check.preflight.json'), 'utf-8'),
                ) as { window: string; plugins: Array<{ plugin: string; ok: boolean }> };
                expect(record.window).toBe('preflight');
                // Both windows contribute; dummy and off rows never do.
                expect(record.plugins.map((probe) => probe.plugin)).toEqual(['wechatmp-pub', 'xhs-pub']);
                expect(out.read()).toContain('2 probe(s) recorded for preflight');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('passes with no probes when every preset row is dummy or off', async () => {
        const fixture = makeFixture([
            { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'dummy' },
            { plugin: 'xhs-pub', operation: '写长文', variant: 'article', tier: 2, mode: 'off' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await checkPublishMatrix([fx.workDir, '--preset', 'daily-ai-voice', '--all-windows'], {
                        projectRoot: fx.root,
                        plugins: pluginRecords,
                    }),
                ).toBe(0);
                expect(out.read()).toContain('no probes');
                const record = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/check.preflight.json'), 'utf-8'),
                ) as { plugins: unknown[] };
                expect(record.plugins).toHaveLength(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('fails an invalid preset that names an uninstalled plugin', async () => {
        const fixture = makeFixture([{ plugin: 'linkedin-pub', variant: 'article', tier: 2, mode: 'draft' }]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await checkPublishMatrix([fx.workDir, '--preset', 'daily-ai-voice', '--all-windows'], {
                        projectRoot: fx.root,
                        plugins: pluginRecords,
                    }),
                ).toBe(1);
                expect(out.readErr()).toContain('names uninstalled plugin(s): linkedin-pub');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish-matrix dummy mode (0322 R1, R2, R3)', () => {
    /** Steps that must never run for a dummy row: a dispatch attempt fails the test loudly. */
    function throwingDispatch() {
        const calls: string[][] = [];
        const dispatch = async (argv: string[]): Promise<number> => {
            calls.push(argv);
            throw new Error(`dummy row reached dispatch: ${argv.join(' ')}`);
        };
        return { dispatch, calls };
    }

    it('rehearses the whole matrix with zero dispatches and one synthetic receipt per row', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                // `--dummy` forces every planned row to dummy, so nothing can reach a plugin.
                expect(await planPublishMatrix(planArgs(fx, ['--dummy']), { projectRoot: fx.root })).toBe(0);
                const { dispatch, calls } = throwingDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                expect(calls).toHaveLength(0);

                const receiptsDir = join(fx.workDir, '4-publish/receipts');
                const receipts = [
                    'surfdash-pub.post',
                    'podcast-pub.episode',
                    'wechatmp-pub.文章',
                    'xhs-pub.写长文',
                ].map(
                    (id) =>
                        JSON.parse(readFileSync(join(receiptsDir, `${id}.json`), 'utf-8')) as {
                            status: string;
                            effect: string;
                            dummy: boolean;
                            mode: string;
                            url: string;
                            target: string;
                            window: string;
                            startedAt: string;
                            finishedAt: string;
                        },
                );
                for (const receipt of receipts) {
                    expect(receipt.status).toBe('succeeded');
                    expect(receipt.effect).toBe('none');
                    expect(receipt.dummy).toBe(true);
                    expect(receipt.mode).toBe('draft');
                    expect(receipt.url).toBe(`dummy://${receipt.target}`);
                    expect(receipt.window).toBe('after-generate');
                    expect(receipt.startedAt.length).toBeGreaterThan(0);
                    expect(receipt.finishedAt.length).toBeGreaterThan(0);
                }

                // The tier-0 dummy urls are what the tier-2 copy links to: still no network needed.
                const resolved = readFileSync(
                    join(fx.workDir, '4-publish/payloads/content.wechatmp-pub.文章.resolved.json'),
                    'utf-8',
                );
                expect(resolved).toContain('dummy://surfdash-pub.post');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('never links a real row to a dummy tier-0 url, while a dummy row still resolves it', async () => {
        const fixture = makeFixture([...TIER0_SOFT.map((target) => ({ ...target, mode: 'dummy' })), ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const { dispatch, calls } = fakeDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                // The draft 文章 row would have published `dummy://…`: it fails before dispatch instead.
                expect(calls).toHaveLength(0);
                const receipt = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/receipts/wechatmp-pub.文章.json'), 'utf-8'),
                ) as { effect: string; error: string };
                expect(receipt.effect).toBe('none');
                expect(receipt.error).toBe('unresolved-link');

                const rehearsed = readFileSync(
                    join(fx.workDir, '4-publish/payloads/content.xhs-pub.写长文.resolved.json'),
                    'utf-8',
                );
                expect(rehearsed).toContain('dummy://surfdash-pub.post');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('escapes a tier-0 url as a JSON string fragment when resolving a placeholder', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const { dispatch } = fakeDispatch({ 'surfdash-pub': { ok: true, url: 'https://surfdash.test/a"b' } });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                const resolved = JSON.parse(
                    readFileSync(
                        join(fx.workDir, '4-publish/payloads/content.wechatmp-pub.文章.resolved.json'),
                        'utf-8',
                    ),
                ) as { body: string };
                expect(resolved.body).toContain('https://surfdash.test/a"b');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('is idempotent, and a dummy receipt never blocks a later real send', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'dummy' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                const first = throwingDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                expect(first.calls).toHaveLength(0);

                // A rerun skips the succeeded dummy receipt like any other.
                const rerun = throwingDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: rerun.dispatch }),
                ).toBe(0);
                expect(rerun.calls).toHaveLength(0);

                // Flip the preset row to draft: the same target must now be sent for real, once.
                const presetPath = join(fx.root, '.kk/publish-presets/daily-ai-voice.json');
                const preset = JSON.parse(readFileSync(presetPath, 'utf-8')) as {
                    targets: Array<{ mode?: string }>;
                };
                if (preset.targets[0] !== undefined) preset.targets[0].mode = 'draft';
                writeFileSync(presetPath, JSON.stringify(preset));
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);

                const real = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: real.dispatch }),
                ).toBe(0);
                expect(real.calls).toHaveLength(1);

                const receipt = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/receipts/surfdash-pub.post.json'), 'utf-8'),
                ) as { dummy?: boolean; status: string };
                expect(receipt.dummy).toBeUndefined();
                expect(receipt.status).toBe('succeeded');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('fails a dummy row whose payload is not valid Content, without dispatching it', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'dummy', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);
                // The planner refuses invalid Content, so corrupt the built payload the way a
                // generate-side bug would: the rehearsal must still catch it at send time.
                const payloadPath = join(fx.workDir, '4-publish/payloads/content.surfdash-pub.post.json');
                const payload = JSON.parse(readFileSync(payloadPath, 'utf-8')) as Record<string, unknown>;
                delete payload.body;
                writeFileSync(payloadPath, `${JSON.stringify(payload)}\n`);

                const { dispatch, calls } = throwingDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);
                expect(calls).toHaveLength(0);

                const receipt = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/receipts/surfdash-pub.post.json'), 'utf-8'),
                ) as { status: string; effect: string; dummy: boolean; error: string };
                expect(receipt.status).toBe('failed');
                expect(receipt.effect).toBe('none');
                expect(receipt.dummy).toBe(true);
                expect(receipt.error).toBe('invalid-payload');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish-matrix-check (0321 R3)', () => {
    it('records a probe refusal but stays warn-only (exit 0)', async () => {
        const fixture = makeFixture([...TIER0, ...DOMESTIC]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(0);

                // Refuse every probe, and leave wechatmp-pub out of the discovered set so the
                // "plugin not installed" branch is exercised too.
                const refusing = new (class extends NodeProcessExecutor {
                    override async run(options: ProcessOptions): Promise<ProcessResult> {
                        return {
                            command: options.command,
                            args: options.args ?? [],
                            exitCode: 1,
                            stdout: '{"status":"refused","detail":"session expired"}',
                            stderr: '',
                            durationMs: 0,
                        } as ProcessResult;
                    }
                })();
                const probed = ['surfdash-pub', 'podcast-pub'].map((name) => ({
                    name,
                    kind: 'publish' as const,
                    entry: `/tmp/${name}/index.js`,
                    check: `/tmp/${name}/check.js`,
                    dir: `/tmp/${name}`,
                    manifestPath: `/tmp/${name}/plugin.json`,
                    origin: 'builtin' as const,
                }));

                const code = await checkPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    executor: refusing,
                    plugins: probed,
                });
                expect(code).toBe(0);

                const record = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/check.after-generate.json'), 'utf-8'),
                ) as { plugins: Array<{ plugin: string; ok: boolean; detail?: string }> };
                // xhs-pub is dummy-only in this preset, so it is never probed.
                expect(record.plugins.map((probe) => probe.plugin)).toEqual([
                    'surfdash-pub',
                    'podcast-pub',
                    'wechatmp-pub',
                ]);
                expect(record.plugins[0]).toEqual({
                    plugin: 'surfdash-pub',
                    ok: false,
                    detail: 'refused: session expired',
                });
                expect(record.plugins[2]).toEqual({
                    plugin: 'wechatmp-pub',
                    ok: false,
                    detail: 'plugin not installed',
                });
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish-matrix stage wiring and itc coexistence (0321 R6, R7)', () => {
    it('still validates an itc-shaped preset with no matrix fields', async () => {
        const legacy = {
            schemaVersion: 1,
            name: 'itc-main',
            targets: [{ plugin: 'medium-pub' }, { plugin: 'qiita-pub', profile: 'ja' }],
        };
        expect(PublishPresetSchema.safeParse(legacy).success).toBe(true);

        const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-itc-'));
        try {
            mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });
            writeFileSync(join(root, '.kk/publish-presets/itc-main.json'), JSON.stringify(legacy));
            const resolved = await resolveItcTargets({ explicitPreset: 'itc-main', projectRoot: root });
            expect(resolved.origin).toBe('explicit-preset');
            expect(resolved.targets).toEqual([{ plugin: 'medium-pub' }, { plugin: 'qiita-pub', profile: 'ja' }]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
