import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planPublishMatrix, sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

// Task 0431 regression matrix (written before the fix): the variants safety gate excluded the
// podcast destination, so no tier-0 `podcast-pub` receipt existed and every promo carrying
// `{{podcast_url}}` failed with `error: unresolved-link` (dogfood 2026-11-24). The only same-day
// repair was re-authoring frozen variant copy, which the immutable freeze refuses.
//  1. podcast excluded, article published -> the promo SHIPS with the article url (R1) and
//     `publish-events.jsonl` names the substituted source (`article`, R2). Remove the substitution
//     and this fails: the row records `podcast-link-missing` instead of `sent`.
//  2. podcast excluded AND the article row failed -> the promo is skipped with `effect: none` and the
//     named reason `podcast-link-missing`, never dispatched (R1 second arm).
//  3. the frozen bundle and its variant bytes are untouched by the fallback, so no same-day re-point
//     and no `bundle.json` deletion is needed (R3); a missing `{{article_url}}` keeps its generic
//     `unresolved-link` (existing semantics preserved, no new fallback).

interface Fixture {
    root: string;
    workDir: string;
    bundlePath: string;
    variants: Record<string, string>;
}

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function contentJson(body: string, extra: Record<string, unknown> = {}): string {
    return `${JSON.stringify({ title: '标题', format: 'markdown', body, metadata: extra }, null, 2)}\n`;
}

/** The daily promo footer `buildSocialContent` writes when `listenUrl` is supplied (0410). */
const SOCIAL_COPY = contentJson('今日要点\n\n🎧 完整节目：{{podcast_url}}', { platform: 'x' });

const DEFAULT_VARIANTS: Record<string, string> = {
    article: contentJson('正文 {{article_url}}'),
    episode: contentJson('播客 {{podcast_url}}'),
    'social:x': SOCIAL_COPY,
    'social:threads': SOCIAL_COPY,
    'social:jike': SOCIAL_COPY,
};

/** The 2026-11-24 preset shape: tier-0 owned rows live, four social promos live, podcast live. */
const TARGETS: Array<Record<string, unknown>> = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'live', required: true },
    { plugin: 'podcast-pub', operation: 'episode', variant: 'episode', tier: 0, mode: 'live', required: true },
    { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
    { plugin: 'x-pub', operation: 'post', variant: 'social:x', tier: 3, mode: 'live' },
    { plugin: 'threads-pub', operation: 'post', variant: 'social:threads', tier: 3, mode: 'live' },
    { plugin: 'jike-pub', operation: 'post', variant: 'social:jike', tier: 3, mode: 'live' },
];

function makeFixture(
    targets: Array<Record<string, unknown>> = TARGETS,
    variants: Record<string, string> = DEFAULT_VARIANTS,
): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'kk-publish-matrix-0431-'));
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    const variantEntries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, text] of Object.entries(variants)) {
        writeFileSync(join(workDir, 'variants', `${name}.json`), text);
        variantEntries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }

    const bundle = {
        schemaVersion: 1,
        runId: 'gen-run-1',
        runDate: '2026-11-24',
        runs: [],
        episode: { title: '每日AI乱炖 · 2026-11-24' },
        variants: variantEntries,
        // The dogfood's verdict: the variants safety gate excluded the podcast destination.
        safety: {
            status: 'pass',
            digest: '0'.repeat(64),
            excludedPlatforms: ['xiaoyuzhou'],
            variants: Object.fromEntries(Object.entries(variantEntries).map(([name, entry]) => [name, entry.sha256])),
        },
    };
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);

    writeFileSync(
        join(root, '.kk', 'publish-presets', 'daily-ai-voice.json'),
        `${JSON.stringify({ schemaVersion: 1, name: 'daily-ai-voice', targets }, null, 2)}\n`,
    );

    return { root, workDir, bundlePath, variants };
}

/** Dispatch seam: writes the aggregate result the shared send loop reads, never spawns a plugin. */
function fakeDispatch(outcomes: Record<string, { ok: boolean; url?: string; error?: string }> = {}) {
    const calls: string[] = [];
    const dispatch = async (argv: string[]): Promise<number> => {
        const target = argv[argv.indexOf('--target') + 1] ?? '';
        calls.push(target);
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

async function withCleanup(fn: (fixture: Fixture) => Promise<void>, fixture: Fixture): Promise<void> {
    try {
        await fn(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

interface PublishEvent {
    event: string;
    id?: string;
    error?: string;
    source?: string;
    placeholder?: string;
    url?: string;
}

function readEvents(fixture: Fixture): PublishEvent[] {
    return readFileSync(join(fixture.workDir, '4-publish/publish-events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as PublishEvent);
}

function readReceipt(fixture: Fixture, id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(fixture.workDir, `4-publish/receipts/${id}.json`), 'utf-8')) as Record<
        string,
        unknown
    >;
}

describe('publish-matrix-send (0431: promos ship when the podcast row is held back)', () => {
    it('fills {{podcast_url}} from the article receipt and names the substitution (R1/R2)', async () => {
        const fixture = makeFixture();
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
                            'daily-ai-voice',
                            '--window',
                            'after-generate',
                        ],
                        { projectRoot: fx.root },
                    ),
                ).toBe(0);
                const plan = JSON.parse(
                    readFileSync(join(fx.workDir, '4-publish/plan.after-generate.json'), 'utf-8'),
                ) as {
                    excluded: Array<{ id: string; plugin: string; reason: string }>;
                    rows: Array<{ id: string; tier: number; mode: string }>;
                };
                // The reproducer: the safety verdict held the podcast row back, so tier 0 has no
                // podcast receipt to resolve the promo's episode link from.
                expect(plan.rows.some((row) => row.id === 'podcast-pub.episode')).toBe(false);
                expect(plan.excluded).toEqual([
                    { id: 'podcast-pub.episode', plugin: 'podcast-pub', reason: 'excluded by bundle safety' },
                ]);

                const { dispatch, calls } = fakeDispatch();
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);

                // AC1: the promo went out, carrying the tier-0 ARTICLE url in the podcast slot.
                expect(calls).toContain('x-pub');
                const raw = readFileSync(join(fx.workDir, '4-publish/payloads/content.x-pub.post.json'), 'utf-8');
                expect(raw).toContain('{{podcast_url}}');
                const resolved = readFileSync(
                    join(fx.workDir, '4-publish/payloads/content.x-pub.post.resolved.json'),
                    'utf-8',
                );
                expect(resolved).not.toContain('{{podcast_url}}');
                expect(resolved).toContain('https://example.test/surfdash-pub');

                const events = readEvents(fx);
                expect(events).toContainEqual(expect.objectContaining({ event: 'sent', id: 'x-pub.post' }));
                expect(events.some((event) => event.event === 'failed' && event.error === 'unresolved-link')).toBe(
                    false,
                );
                // AC2: the substituted link source is named for the operator.
                for (const id of ['x-pub.post', 'threads-pub.post', 'jike-pub.post']) {
                    expect(events).toContainEqual(
                        expect.objectContaining({
                            event: 'link-fallback',
                            id,
                            placeholder: '{{podcast_url}}',
                            source: 'article',
                            url: 'https://example.test/surfdash-pub',
                        }),
                    );
                    expect(readReceipt(fx, id).status).toBe('succeeded');
                }

                // R3: the fallback rides the frozen bytes — the bundle and its variants are untouched,
                // so no same-day re-point and no `bundle.json` deletion is needed.
                const bundleText = readFileSync(fx.bundlePath, 'utf-8');
                const bundle = JSON.parse(bundleText) as { variants: Record<string, { sha256: string }> };
                const frozen = bundle.variants['social:x'];
                if (frozen === undefined) throw new Error('bundle has no social:x variant');
                expect(frozen.sha256).toBe(sha256(fx.variants['social:x'] ?? ''));
                expect(sha256(readFileSync(join(fx.workDir, 'variants/social:x.json'), 'utf-8'))).toBe(frozen.sha256);
                expect(bundleText).not.toContain('https://example.test/surfdash-pub');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('skips the promo with the named reason when the article link is missing too (R1)', async () => {
        const fixture = makeFixture();
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
                            'daily-ai-voice',
                            '--window',
                            'after-generate',
                        ],
                        { projectRoot: fx.root },
                    ),
                ).toBe(0);
                // No tier-0 article receipt either: the fallback has nothing to fall back to.
                const { dispatch, calls } = fakeDispatch({
                    'surfdash-pub': { ok: false, error: 'cms down' },
                });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);

                // AC3: `effect: none` plus a reason that NAMES the missing podcast link, and no send.
                for (const id of ['x-pub.post', 'threads-pub.post', 'jike-pub.post']) {
                    const receipt = readReceipt(fx, id);
                    expect(receipt.status).toBe('failed');
                    expect(receipt.effect).toBe('none');
                    expect(receipt.error).toBe('podcast-link-missing');
                    expect(calls).not.toContain(id.replace('.post', ''));
                }
                expect(readEvents(fx)).toContainEqual(
                    expect.objectContaining({ event: 'failed', id: 'x-pub.post', error: 'podcast-link-missing' }),
                );

                // A slot with no declared fallback keeps its existing generic semantics.
                expect(readReceipt(fx, 'wechatmp-pub.文章').error).toBe('unresolved-link');
            } finally {
                out.restore();
            }
        }, fixture);
    });

    it('still refuses a draft whose BODY carries the dropped cross-link (0383 invariant)', async () => {
        // The draft lane may drop the optional `metadata.originalUrl` slot (0383 follow-up), but only
        // that occurrence: a body that carries `{{article_url}}` must keep the row at `effect: none`.
        // Dropping the slot and clearing the unresolved list unconditionally would publish the literal.
        const variants: Record<string, string> = {
            ...DEFAULT_VARIANTS,
            'wechat-article': contentJson('正文 {{article_url}}', { originalUrl: '{{article_url}}' }),
        };
        const targets: Array<Record<string, unknown>> = [
            { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'live', required: true },
            {
                plugin: 'wechatmp-pub',
                operation: '文章',
                variant: 'wechat-article',
                tier: 2,
                mode: 'draft',
            },
        ];
        const fixture = makeFixture(targets, variants);
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
                            'daily-ai-voice',
                            '--window',
                            'after-generate',
                        ],
                        { projectRoot: fx.root },
                    ),
                ).toBe(0);
                const { dispatch, calls } = fakeDispatch({ 'surfdash-pub': { ok: false, error: 'cms down' } });
                expect(await sendPublishMatrix([fx.workDir, '--window', 'after-generate'], { dispatch })).toBe(0);

                const receipt = readReceipt(fx, 'wechatmp-pub.文章');
                expect(receipt.error).toBe('unresolved-link');
                expect(receipt.effect).toBe('none');
                expect(calls).not.toContain('wechatmp-pub');
            } finally {
                out.restore();
            }
        }, fixture);
    });
});
