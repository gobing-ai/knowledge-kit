import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
    planPublishMatrix,
    runPublishMatrixClassify,
    runPublishMatrixRssGate,
    runPublishMatrixValidate,
    sendPublishMatrix,
} from '../src/publish-matrix';
import { captureOutput } from './capture';

// Task 0332 failure-first matrix (written before the fixes): receipts, links and the RSS gate must
// bind to the CURRENT bundle revision, and dates must be canonical before any side effect.
//  1. unchanged replay skips without re-dispatch (R2 idempotence)
//  2. stale parent receipt (other bundle revision) fails closed, no overwrite, no resend (R3)
//  3. changed payload under the same parent fails closed (R3)
//  4. draft -> live promotion is a reconciliation failure, not a silent resend (R2)
//  5. dummy -> real dispatches exactly once (R2)
//  6. corrupt receipt + live row is never auto-resent (R3)
//  7. corrupt receipt + draft row re-attempts (safe carve-out, R3)
//  8. links resolve across windows from current-bundle tier-0 receipts (R4)
//  9. a stale-bundle tier-0 receipt does not resolve links (R4)
// 10. draft URLs never resolve into real (live) public links; dummy rows may use them (R4)
// 11. receipt persists the plugin's episode guid (R5)
// 12. guid-known feed missing that guid misses even on a same-date title (R5 wrong episode)
// 13. legacy receipt without guid keeps the title-date fallback (R5 compat)
// 14. wrong gate date vs plan refuses instead of authorizing (R5/R1)
// 15. classify normalizes compact dates and refuses a mismatch; omitted derives from the plan (R1)
// 16. validate accepts compact/ISO, derives from bundle, refuses garbage (R1)
// 17. missing optional variant plans the rest and writes a failed effect-none receipt (R6)
// 18. missing required variant still refuses planning (R6)
// 19. failed dummy payload preparation stays dummy in accounting (R6)
// 20. publish3 workflow validates run_date before send and classify no longer needs the late guard (F13)

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
    options: { runDate?: string; safetyVariants?: string[] } = {},
): Fixture {
    const variants: Record<string, string> = {
        article: contentJson('正文 {{article_url}}', {
            published: true,
            publishStatus: 'public',
            status: 'published',
        }),
        // The cn-peak podcast links the tier-0 article (0332 R4): tier-0 sends keep placeholders,
        // tier-1 sends must resolve the article URL from the after-generate receipt.
        episode: contentJson('播客 {{article_url}}', {
            published: true,
            publishStatus: 'public',
            status: 'published',
        }),
        social: contentJson('帖子 {{article_url}}', {}),
    };
    const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0332-'));
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
        runDate: options.runDate ?? '2026-10-22',
        runs: [],
        episode: { title: '每日AI乱炖 · 2026-10-22' },
        variants: variantEntries,
    };
    if (options.safetyVariants !== undefined) {
        const reviewed: Record<string, string> = {};
        for (const key of options.safetyVariants) {
            const text = variants[key];
            if (text === undefined) throw new Error(`safetyVariants: no fixture variant '${key}'`);
            reviewed[key] = sha256(text);
        }
        bundle.safety = {
            status: 'pass',
            digest: sha256(options.safetyVariants.slice().sort().join('\n')),
            excludedPlatforms: [],
            variants: reviewed,
        };
    }
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

    writeFileSync(
        join(root, '.kk', 'publish-presets', 'daily-ai-voice.json'),
        `${JSON.stringify({ schemaVersion: 1, name: 'daily-ai-voice', targets }, null, 2)}\n`,
    );

    return { root, workDir, bundlePath };
}

async function withCleanup(fn: (fixture: Fixture) => Promise<void>, fixture: Fixture): Promise<void> {
    try {
        await fn(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

function planArgs(fixture: Fixture, window: string, extra: string[] = []): string[] {
    return [
        fixture.workDir,
        '--bundle',
        fixture.bundlePath,
        '--preset',
        'daily-ai-voice',
        '--window',
        window,
        ...extra,
    ];
}

/** Dispatch fake that records calls and writes a successful fanout aggregate per call. */
function fakeDispatch(options: { guid?: string; url?: string } = {}): {
    dispatch: (argv: string[]) => Promise<number>;
    calls: string[][];
} {
    const calls: string[][] = [];
    return {
        calls,
        dispatch: async (argv) => {
            calls.push(argv);
            const outPath = argv[argv.indexOf('--out') + 1] ?? '';
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(
                outPath,
                `${JSON.stringify({
                    ok: true,
                    targets: [
                        {
                            target: argv[argv.indexOf('--target') + 1],
                            ok: true,
                            status: 'published',
                            url: options.url ?? 'https://published.test/1',
                            metadata: options.guid === undefined ? {} : { guid: options.guid },
                        },
                    ],
                })}\n`,
            );
            return 0;
        },
    };
}

interface ReceiptFile {
    parentRunId?: string;
    payloadDigest?: string;
    mode?: string;
    dummy?: boolean;
    status?: string;
    effect?: string;
    guid?: string;
    url?: string;
    error?: string;
    target?: string;
    window?: string;
    attemptId?: string;
    schemaVersion?: number;
    planDigest?: string;
    plugin?: string;
    profile?: string;
    publicUrlVerified?: boolean;
    aggregatePath?: string;
    startedAt?: string;
    finishedAt?: string;
}

function readReceipt(fixture: Fixture, key: string): ReceiptFile {
    return JSON.parse(
        readFileSync(join(fixture.workDir, '4-publish', 'receipts', `${key}.json`), 'utf-8'),
    ) as ReceiptFile;
}

// Article tier 0 in after-generate; podcast tier 1 + x tier 2 in cn-peak, so link resolution must
// reach across windows (the current code only scans the sending window's own plan rows).
const TWO_WINDOW_TARGETS = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
    {
        plugin: 'podcast-pub',
        operation: 'episode',
        variant: 'episode',
        tier: 1,
        mode: 'draft',
        window: 'cn-peak',
        required: true,
    },
    { plugin: 'x-pub', operation: 'post', variant: 'social', tier: 2, mode: 'draft', window: 'cn-peak' },
];

describe('receipt identity on the shared send path (0332 R2, R3)', () => {
    it('replays an unchanged window without re-dispatching any row', async () => {
        const fixture = makeFixture(TWO_WINDOW_TARGETS);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const first = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                const second = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: second.dispatch }),
                ).toBe(0);
                expect(second.calls).toHaveLength(0);
                expect(readReceipt(fx, 'surfdash-pub.post').status).toBe('succeeded');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('fails closed on a succeeded receipt from a different bundle revision', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
            // A receipt an older bundle revision wrote for the same target: same payload bytes,
            // different parent. The row must not silently re-send or overwrite it.
            const payloadPath = JSON.parse(
                readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8'),
            ) as { rows: Array<{ payloadPath: string }> };
            const stale = {
                schemaVersion: 1,
                parentRunId: 'gen-run-0',
                planDigest: '0'.repeat(64),
                payloadDigest: sha256(readFileSync(join(fx.workDir, payloadPath.rows[0]?.payloadPath ?? ''), 'utf-8')),
                plugin: 'surfdash-pub',
                profile: 'article',
                mode: 'draft',
                attemptId: 'attempt-1',
                status: 'succeeded',
                effect: 'confirmed',
                url: 'https://old.test/1',
            };
            const receiptPath = join(fx.workDir, '4-publish', 'receipts', 'surfdash-pub.post.json');
            mkdirSync(dirname(receiptPath), { recursive: true });
            writeFileSync(receiptPath, `${JSON.stringify(stale, null, 2)}\n`);
            const dispatched = fakeDispatch();
            const out = captureOutput();
            let code: number;
            try {
                code = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    dispatch: dispatched.dispatch,
                });
            } finally {
                out.restore();
            }
            expect(code).toBe(1);
            expect(dispatched.calls).toHaveLength(0);
            expect(readReceipt(fx, 'surfdash-pub.post').url).toBe('https://old.test/1');
        }, fixture);
    });

    it('fails closed when a succeeded receipt carries a different payload digest', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
            { plugin: 'x-pub', operation: 'post', variant: 'social', tier: 2, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const first = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                // Re-plan with edited article bytes: generate ships a fresh manifest digest with
                // them, so the plan stays valid — but the tier-0 receipt still belongs to the old
                // content and must fail the send closed.
                const edited = contentJson('正文改了 {{article_url}}', {
                    published: true,
                    publishStatus: 'public',
                    status: 'published',
                });
                writeFileSync(join(fx.workDir, 'variants/article.json'), edited);
                const bundle = JSON.parse(readFileSync(fx.bundlePath, 'utf-8')) as {
                    variants: Record<string, { path: string; sha256: string }>;
                };
                bundle.variants.article = { path: 'variants/article.json', sha256: sha256(edited) };
                writeFileSync(fx.bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const second = fakeDispatch();
                const code = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    dispatch: second.dispatch,
                });
                expect(code).toBe(1);
                // Nothing re-dispatched, and the tier-0 receipt still points at the old delivery.
                expect(second.calls).toHaveLength(0);
                expect(readReceipt(fx, 'surfdash-pub.post').url).toBe('https://published.test/1');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('treats draft-to-live promotion as reconciliation, never as a silent resend', async () => {
        const fixture = makeFixture(
            [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true }],
            { safetyVariants: ['article'] },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const first = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: first.dispatch }),
                ).toBe(0);
                expect(readReceipt(fx, 'surfdash-pub.post').mode).toBe('draft');
                // Same bundle, same bytes — but now the operator wants the real send.
                expect(
                    await planPublishMatrix([...planArgs(fx, 'after-generate'), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                const second = fakeDispatch();
                const code = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    dispatch: second.dispatch,
                });
                expect(code).toBe(1);
                expect(second.calls).toHaveLength(0);
                const receipt = readReceipt(fx, 'surfdash-pub.post');
                expect(receipt.mode).toBe('draft');
                expect(receipt.status).toBe('succeeded');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('dispatches a dummy-rehearsed row exactly once when promoted to real', async () => {
        const fixture = makeFixture(
            [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true }],
            { safetyVariants: ['article'] },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx, 'after-generate'), '--dummy'], { projectRoot: fx.root }),
                ).toBe(0);
                const rehearsal = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: rehearsal.dispatch,
                    }),
                ).toBe(0);
                expect(readReceipt(fx, 'surfdash-pub.post').dummy).toBe(true);
                expect(
                    await planPublishMatrix([...planArgs(fx, 'after-generate'), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                const real = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: real.dispatch }),
                ).toBe(0);
                expect(real.calls).toHaveLength(1);
                const receipt = readReceipt(fx, 'surfdash-pub.post');
                expect(receipt.mode).toBe('live');
                expect(receipt.dummy).toBeUndefined();
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('never auto-resends a live row whose receipt is unreadable', async () => {
        const fixture = makeFixture(
            [{ plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true }],
            { safetyVariants: ['article'] },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx, 'after-generate'), '--live-channels', 'surfdash-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                const receiptPath = join(fx.workDir, '4-publish', 'receipts', 'surfdash-pub.post.json');
                mkdirSync(dirname(receiptPath), { recursive: true });
                writeFileSync(receiptPath, '{ truncated');
                const dispatched = fakeDispatch();
                const code = await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                    dispatch: dispatched.dispatch,
                });
                expect(code).toBe(1);
                expect(dispatched.calls).toHaveLength(0);
                expect(readFileSync(receiptPath, 'utf-8')).toBe('{ truncated');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('re-attempts a draft row whose receipt is unreadable (safe carve-out)', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const receiptPath = join(fx.workDir, '4-publish', 'receipts', 'surfdash-pub.post.json');
                mkdirSync(dirname(receiptPath), { recursive: true });
                writeFileSync(receiptPath, '{ truncated');
                const dispatched = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: dispatched.dispatch,
                    }),
                ).toBe(0);
                expect(dispatched.calls).toHaveLength(1);
                expect(readReceipt(fx, 'surfdash-pub.post').status).toBe('succeeded');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('cross-window current-bundle links (0332 R4)', () => {
    it('resolves article links for a cn-peak podcast from the after-generate tier-0 receipt', async () => {
        const fixture = makeFixture(TWO_WINDOW_TARGETS);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const tier0 = fakeDispatch({ url: 'https://surfdash.test/abc' });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: tier0.dispatch }),
                ).toBe(0);
                expect(await planPublishMatrix(planArgs(fx, 'cn-peak'), { projectRoot: fx.root })).toBe(0);
                const tier1 = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'cn-peak', '--tier', '1'], {
                        dispatch: tier1.dispatch,
                    }),
                ).toBe(0);
                expect(tier1.calls).toHaveLength(1);
                const content = tier1.calls[0]?.[tier1.calls[0].indexOf('--content') + 1] ?? '';
                const resolved = JSON.parse(readFileSync(content, 'utf-8')) as { body: string };
                expect(resolved.body).toContain('https://surfdash.test/abc');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('does not resolve links from a tier-0 receipt of another bundle revision', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
            { plugin: 'x-pub', operation: 'post', variant: 'social', tier: 2, mode: 'draft', window: 'cn-peak' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                expect(await planPublishMatrix(planArgs(fx, 'cn-peak'), { projectRoot: fx.root })).toBe(0);
                const receiptPath = join(fx.workDir, '4-publish', 'receipts', 'surfdash-pub.post.json');
                mkdirSync(dirname(receiptPath), { recursive: true });
                writeFileSync(
                    receiptPath,
                    `${JSON.stringify({
                        schemaVersion: 1,
                        parentRunId: 'gen-run-0',
                        planDigest: '0'.repeat(64),
                        payloadDigest: '0'.repeat(64),
                        plugin: 'surfdash-pub',
                        profile: 'article',
                        mode: 'live',
                        attemptId: 'attempt-1',
                        status: 'succeeded',
                        effect: 'confirmed',
                        url: 'https://stale.test/1',
                    })}\n`,
                );
                const dispatched = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'cn-peak', '--tier', '2'], {
                        dispatch: dispatched.dispatch,
                    }),
                ).toBe(0);
                expect(dispatched.calls).toHaveLength(0);
                const receipt = readReceipt(fx, 'x-pub.post');
                expect(receipt.status).toBe('failed');
                expect(receipt.effect).toBe('none');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('keeps draft URLs out of real live links but lets dummy rows use them', async () => {
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
                { plugin: 'x-pub', operation: 'post', variant: 'social', tier: 2, mode: 'draft', window: 'cn-peak' },
            ],
            { safetyVariants: ['article', 'social'] },
        );
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                // tier 0 delivers as a DRAFT: the URL exists but is not public yet.
                const tier0 = fakeDispatch({ url: 'https://surfdash.test/draft' });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: tier0.dispatch }),
                ).toBe(0);
                // A live x-pub row must NOT pick up the draft URL: it is not public yet.
                expect(
                    await planPublishMatrix([...planArgs(fx, 'cn-peak'), '--live-channels', 'x-pub'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                const live = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'cn-peak', '--tier', '2'], {
                        dispatch: live.dispatch,
                    }),
                ).toBe(0);
                expect(live.calls).toHaveLength(0);
                expect(readReceipt(fx, 'x-pub.post').status).toBe('failed');

                // The same draft URL satisfies a rehearsal row. Dummy rows never dispatch (0322);
                // the rehearsal is proven by the resolved payload it prepared.
                expect(
                    await planPublishMatrix([...planArgs(fx, 'cn-peak'), '--channels', 'x-pub', '--dummy'], {
                        projectRoot: fx.root,
                    }),
                ).toBe(0);
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'cn-peak', '--tier', '2'], {
                        dispatch: live.dispatch,
                    }),
                ).toBe(0);
                const rehearsalReceipt = readReceipt(fx, 'x-pub.post');
                expect(rehearsalReceipt.dummy).toBe(true);
                expect(rehearsalReceipt.status).toBe('succeeded');
                const resolved = readFileSync(
                    join(fx.workDir, '4-publish/payloads/content.x-pub.post.resolved.json'),
                    'utf-8',
                );
                expect(resolved).toContain('https://surfdash.test/draft');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('episode guid and RSS binding (0332 R5)', () => {
    it('persists the plugin result guid on the receipt', async () => {
        const fixture = makeFixture([
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const dispatched = fakeDispatch({ guid: 'ep-2026-10-22' });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: dispatched.dispatch,
                    }),
                ).toBe(0);
                expect(readReceipt(fx, 'podcast-pub.episode').guid).toBe('ep-2026-10-22');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    const FEED = `<?xml version="1.0"?><rss><channel>
      <item><title>每日AI乱炖 · 2026-10-22</title><guid>ep-someone-else</guid></item>
    </channel></rss>`;

    it('misses when the known guid is absent even though a same-date title exists', async () => {
        const fixture = makeFixture([
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const tier0 = fakeDispatch({ guid: 'ep-mine' });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch: tier0.dispatch }),
                ).toBe(0);
                expect(readReceipt(fx, 'podcast-pub.episode').guid).toBe('ep-mine');
                const code = await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-22'], {
                    readFeed: async () => FEED,
                });
                expect(code).toBe(3);
                const gate = JSON.parse(readFileSync(join(fx.workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
                    hit: boolean;
                };
                expect(gate.hit).toBe(false);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('keeps the title-date fallback for legacy receipts without a guid', async () => {
        const fixture = makeFixture([
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const dispatched = fakeDispatch({ guid: undefined });
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: dispatched.dispatch,
                    }),
                ).toBe(0);
                expect(readReceipt(fx, 'podcast-pub.episode').guid).toBeUndefined();
                expect(
                    await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-22'], { readFeed: async () => FEED }),
                ).toBe(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('refuses a gate date that disagrees with the bundle instead of authorizing', async () => {
        const fixture = makeFixture([
            { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const code = await runPublishMatrixRssGate([fx.workDir, '--date', '2026-10-23'], {
                    readFeed: async () => FEED,
                });
                expect(code).toBe(1);
                expect(existsSync(join(fx.workDir, '4-publish/rss-gate.json'))).toBe(false);
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('run-date validation (0332 R1)', () => {
    it('normalizes compact dates in classify and refuses a mismatch with the plan', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                expect(
                    await runPublishMatrixClassify([
                        fx.workDir,
                        '--window',
                        'after-generate',
                        '--run-date',
                        '20261022',
                    ]),
                ).toBe(0);
                const outcome = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/outcome.after-generate.json'), 'utf-8'),
                ) as { runDate: string };
                expect(outcome.runDate).toBe('2026-10-22');
                expect(
                    await runPublishMatrixClassify([
                        fx.workDir,
                        '--window',
                        'after-generate',
                        '--run-date',
                        '2026-10-23',
                    ]),
                ).toBe(1);
                // Omitted run_date derives from the plan's bundle date.
                expect(await runPublishMatrixClassify([fx.workDir, '--window', 'after-generate'])).toBe(0);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('accepts compact and ISO, derives from the bundle, and refuses garbage', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await runPublishMatrixValidate([fx.workDir, '--run-date', '20261022'])).toBe(0);
                expect(readFileSync(join(fx.workDir, '4-publish/run-date.txt'), 'utf-8').trim()).toBe('2026-10-22');
                expect(await runPublishMatrixValidate([fx.workDir])).toBe(0);
                expect(readFileSync(join(fx.workDir, '4-publish/run-date.txt'), 'utf-8').trim()).toBe('2026-10-22');
                expect(await runPublishMatrixValidate([fx.workDir, '--run-date', '2026-13-99'])).toBe(1);
                expect(await runPublishMatrixValidate([fx.workDir, '--run-date', 'not-a-date'])).toBe(1);
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('optional variant omission (0332 R6)', () => {
    it('plans the remaining targets and records a failed effect-none receipt for a missing optional variant', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
            { plugin: 'x-pub', operation: 'post', variant: 'social-x', tier: 2, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(0);
                const plan = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8'),
                ) as { rows: Array<{ id: string }> };
                expect(plan.rows.map((row) => row.id)).toEqual(['surfdash-pub.post']);
                const receipt = readReceipt(fx, 'x-pub.post');
                expect(receipt.status).toBe('failed');
                expect(receipt.effect).toBe('none');
                expect(receipt.error).toContain('social-x');
                const dispatched = fakeDispatch();
                expect(
                    await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], {
                        dispatch: dispatched.dispatch,
                    }),
                ).toBe(0);
                expect(dispatched.calls).toHaveLength(1);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('still refuses planning when a required variant is missing', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'absent', tier: 0, mode: 'draft', required: true },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(await planPublishMatrix(planArgs(fx, 'after-generate'), { projectRoot: fx.root })).toBe(1);
                expect(existsSync(join(fx.workDir, '4-publish/plan.after-generate.json'))).toBe(false);
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('keeps a failed dummy payload preparation dummy in outcome accounting', async () => {
        const fixture = makeFixture([
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
            { plugin: 'x-pub', operation: 'post', variant: 'social-x', tier: 2, mode: 'draft' },
        ]);
        await withCleanup(async (fx) => {
            const out = captureOutput();
            try {
                expect(
                    await planPublishMatrix([...planArgs(fx, 'after-generate'), '--dummy'], { projectRoot: fx.root }),
                ).toBe(0);
                const receipt = readReceipt(fx, 'x-pub.post');
                expect(receipt.dummy).toBe(true);
                expect(receipt.status).toBe('failed');
                expect(receipt.effect).toBe('none');
                expect(
                    await runPublishMatrixClassify([
                        fx.workDir,
                        '--window',
                        'after-generate',
                        '--run-date',
                        '2026-10-22',
                    ]),
                ).toBe(0);
                const outcome = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/outcome.after-generate.json'), 'utf-8'),
                ) as { status: string };
                expect(outcome.status).toBe('dummy');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});

describe('publish3 workflow run_date guard (0332 R1, F13)', () => {
    it('validates run_date before any send and drops the after-send classify guard', () => {
        const yaml = readFileSync(
            resolve(import.meta.dir, '../../../plugins/kk/workflows/kk-daily-publish3.yaml'),
            'utf-8',
        );
        const validatePos = yaml.indexOf('publish-matrix-validate');
        const sendPos = yaml.indexOf('publish-matrix-send');
        expect(validatePos).toBeGreaterThan(-1);
        expect(validatePos).toBeLessThan(sendPos);
        expect(yaml).not.toContain('classify needs run_date');
    });
});
