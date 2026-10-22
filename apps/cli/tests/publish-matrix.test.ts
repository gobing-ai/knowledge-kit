import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { NodeProcessExecutor, type ProcessOptions, type ProcessResult } from '@gobing-ai/ts-runtime';
import { PublishPresetSchema, resolveItcTargets } from '../src/itc-plan';
import { checkPublishMatrix, planPublishMatrix, sendPublishMatrix } from '../src/publish-matrix';
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

    it('rejects a preset file that tries to yield a live send', async () => {
        const fixture = makeFixture([{ plugin: 'podcast-pub', variant: 'episode', tier: 0, mode: 'live' }]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx), { projectRoot: fx.root })).toBe(1);
                expect(out.readErr()).toContain('malformed publish preset');
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

        const missing = makeFixture([{ plugin: 'podcast-pub', variant: 'cards', tier: 0, mode: 'draft' }]);
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
                expect(events.filter((event) => event.event === 'sent')).toHaveLength(3);
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
