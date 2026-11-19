import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    carryOfficialAccountLink,
    gateChannelsCard,
    isChannelsCardTarget,
    verifyOfficialAccountUrl,
} from '../src/publish-channels-link';
import { type OwnerReceipt, readDispatchLedger, retryable } from '../src/publish-dispatch';
import { planPublishMatrix, sendPublishMatrix } from '../src/publish-matrix';
import { captureOutput } from './capture';

// Task 0395 (L3 R18) — 视频号卡片只使用已确认的公众号文章链接.
//
// The Channels 图文 card may only carry the CONFIRMED Official Account article of the SAME episode.
// A prepared WeChat draft has no public URL, so before the operator releases the article the card
// alone is deferred (the other targets keep their configured modes and still dispatch); once the
// article is public and its link is verified as the 公众号 article, a per-target retry sends the
// card once, carrying exactly that URL. A foreign/unsafe link is never sent.
//
// The central case (draft article -> card deferred, siblings dispatched) is mutation-sensitive: stub
// the gate to always allow and it fails — the card dispatches without a confirmed link.

const CONFIRMED = 'https://mp.weixin.qq.com/s/AbCdEf123456';

function receipt(input: Partial<OwnerReceipt> & { targetId: string; url?: string }): OwnerReceipt {
    return { parentRunId: 'gen-run-1', status: 'succeeded', mode: 'live', ...input };
}

describe('0395 — the official-account link gate (AC R18)', () => {
    it('detects only the Channels 图文 target', () => {
        expect(isChannelsCardTarget({ plugin: 'shipinhao-pub', operation: 'image' })).toBe(true);
        expect(isChannelsCardTarget({ plugin: 'shipinhao-pub' })).toBe(true);
        expect(isChannelsCardTarget({ plugin: 'shipinhao-pub', operation: 'audio' })).toBe(false);
        expect(isChannelsCardTarget({ plugin: 'wechatmp-pub', operation: 'image' })).toBe(false);
    });

    it('accepts only a https 公众号 article URL and normalizes it', () => {
        expect(verifyOfficialAccountUrl(CONFIRMED)).toEqual({ ok: true, url: CONFIRMED });
        expect(verifyOfficialAccountUrl('http://mp.weixin.qq.com/s/AbC')).toEqual({ ok: false, reason: 'not-https' });
        expect(verifyOfficialAccountUrl('https://evil.test/s/AbC')).toEqual({
            ok: false,
            reason: 'foreign-host (evil.test)',
        });
        expect(verifyOfficialAccountUrl('https://mp.weixin.qq.com/other/AbC')).toEqual({
            ok: false,
            reason: 'not-an-article-path',
        });
        expect(verifyOfficialAccountUrl('https://user:pw@mp.weixin.qq.com/s/AbC')).toEqual({
            ok: false,
            reason: 'has-credentials',
        });
        expect(verifyOfficialAccountUrl('not a url')).toEqual({ ok: false, reason: 'unparseable' });
    });

    it('binds the link to the same bundle revision (0388 receipt resolution)', () => {
        const ok = gateChannelsCard({
            receipts: [receipt({ targetId: 'wechatmp-pub.文章', url: CONFIRMED })],
            parentRunId: 'gen-run-1',
            producerIds: ['wechatmp-pub.文章'],
        });
        expect(ok).toEqual({ ok: true, url: CONFIRMED, receiptId: 'wechatmp-pub.文章' });

        // Another episode's article — a previous bundle revision — confirms nothing.
        const stale = gateChannelsCard({
            receipts: [receipt({ targetId: 'wechatmp-pub.文章', parentRunId: 'gen-run-0', url: CONFIRMED })],
            parentRunId: 'gen-run-1',
            producerIds: ['wechatmp-pub.文章'],
        });
        expect(stale.ok).toBe(false);
        expect(stale.ok === false && stale.reason).toBe('article-not-published');
    });

    it('classifies missing, drafted, unplanned and unsafe links', () => {
        const missing = gateChannelsCard({
            receipts: [],
            parentRunId: 'gen-run-1',
            producerIds: ['wechatmp-pub.文章'],
        });
        expect(missing.ok === false && missing.reason).toBe('article-not-published');

        // A draft receipt is recorded but never a public link.
        const drafted = gateChannelsCard({
            receipts: [receipt({ targetId: 'wechatmp-pub.文章', mode: 'draft', url: 'https://mp.weixin.qq.com/s/x' })],
            parentRunId: 'gen-run-1',
            producerIds: ['wechatmp-pub.文章'],
        });
        expect(drafted.ok === false && drafted.reason).toBe('article-still-draft');

        const unplanned = gateChannelsCard({ receipts: [], parentRunId: 'gen-run-1', producerIds: [] });
        expect(unplanned.ok === false && unplanned.reason).toBe('article-not-planned');

        const unsafe = gateChannelsCard({
            receipts: [receipt({ targetId: 'wechatmp-pub.文章', url: 'https://evil.test/s/AbC' })],
            parentRunId: 'gen-run-1',
            producerIds: ['wechatmp-pub.文章'],
        });
        expect(unsafe.ok === false && unsafe.reason).toBe('article-url-unsafe');
        expect(unsafe.ok === false && unsafe.detail).toContain('foreign-host');
    });

    it('carries the link into the approved card payload and says where it landed', () => {
        const cards = `${JSON.stringify(
            { title: '卡片标题', format: 'markdown', body: '今日要点', metadata: { images: [{ path: 'a.png' }] } },
            null,
            2,
        )}\n`;
        const carried = carryOfficialAccountLink(cards, CONFIRMED);
        expect(carried.placement).toBe('caption');
        const parsed = JSON.parse(carried.text) as {
            body: string;
            title: string;
            metadata: { images: unknown[]; officialAccountUrl: string; officialAccountLinkPlacement: string };
        };
        expect(parsed.title).toBe('卡片标题');
        expect(parsed.metadata.images).toHaveLength(1);
        expect(parsed.body).toContain(`原文链接：${CONFIRMED}`);
        expect(parsed.metadata.officialAccountUrl).toBe(CONFIRMED);
        expect(parsed.metadata.officialAccountLinkPlacement).toBe('caption');
        // Idempotent: a retry produces the same bytes (same payload digest, no second link).
        expect(carryOfficialAccountLink(carried.text, CONFIRMED).text).toBe(carried.text);

        const templated = carryOfficialAccountLink('{"title":"t","body":"看 {{official_account_url}}"}', CONFIRMED);
        expect(templated.placement).toBe('placeholder');
        expect(templated.text).toContain(CONFIRMED);
        expect(templated.text).not.toContain('{{official_account_url}}');
    });
});

// ---- end-to-end: the publish batch defers only the Channels target, then retries it once ----

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

const TARGETS = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, mode: 'draft', required: true },
    { plugin: 'wechatmp-pub', operation: '文章', variant: 'article', tier: 2, mode: 'draft' },
    { plugin: 'x-pub', operation: 'post', variant: 'social', tier: 2, mode: 'draft' },
    { plugin: 'shipinhao-pub', operation: 'image', variant: 'cards', tier: 3, mode: 'draft' },
];

function makeFixture(): Fixture {
    const variants: Record<string, string> = {
        article: contentJson('正文'),
        social: contentJson('帖子'),
        cards: contentJson('今日要点', { images: [{ path: 'card-1.png' }] }),
    };
    const root = mkdtempSync(join(tmpdir(), 'kk-channels-0395-'));
    const workDir = join(root, 'work');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });
    const variantEntries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, text] of Object.entries(variants)) {
        writeFileSync(join(workDir, 'variants', `${name}.json`), text);
        variantEntries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }
    const bundlePath = join(workDir, 'bundle.json');
    writeFileSync(
        bundlePath,
        `${JSON.stringify(
            {
                schemaVersion: 1,
                runId: 'gen-run-1',
                runDate: '2026-11-18',
                runs: [],
                episode: { title: '每日AI乱炖 · 2026-11-18' },
                variants: variantEntries,
            },
            null,
            2,
        )}\n`,
    );
    writeFileSync(
        join(root, '.kk', 'publish-presets', 'daily-ai-voice.json'),
        `${JSON.stringify({ schemaVersion: 1, name: 'daily-ai-voice', targets: TARGETS }, null, 2)}\n`,
    );
    return { root, workDir, bundlePath };
}

/** Fake dispatch: records argv (including the `--content` payload) and reports success. */
function fakeDispatch(): { dispatch: (argv: string[]) => Promise<number>; calls: string[][]; contents: string[] } {
    const calls: string[][] = [];
    const contents: string[] = [];
    return {
        calls,
        contents,
        dispatch: async (argv) => {
            calls.push(argv);
            contents.push(argv[argv.indexOf('--content') + 1] ?? '');
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
                            url: CONFIRMED,
                        },
                    ],
                })}\n`,
            );
            return 0;
        },
    };
}

function receiptPath(fixture: Fixture, key: string): string {
    return join(fixture.workDir, '4-publish', 'receipts', `${key}.json`);
}

function readReceipt(
    fixture: Fixture,
    key: string,
): { status?: string; effect?: string; error?: string; url?: string; mode?: string; parentRunId?: string } {
    return JSON.parse(readFileSync(receiptPath(fixture, key), 'utf-8')) as {
        status?: string;
        effect?: string;
        error?: string;
        url?: string;
        mode?: string;
        parentRunId?: string;
    };
}

/** Simulate the operator releasing the article: the SAME receipt now names the public link. */
function publishArticleReceipt(fixture: Fixture, url: string): void {
    const path = receiptPath(fixture, 'wechatmp-pub.文章');
    const prior = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...prior, mode: 'live', status: 'succeeded', url }, null, 2)}\n`);
}

async function withFixture(fn: (fixture: Fixture) => Promise<void>): Promise<void> {
    const fixture = makeFixture();
    try {
        await fn(fixture);
    } finally {
        rmSync(fixture.root, { recursive: true, force: true });
    }
}

async function plan(fixture: Fixture): Promise<void> {
    const out = captureOutput();
    try {
        const code = await planPublishMatrix(
            [
                fixture.workDir,
                '--bundle',
                fixture.bundlePath,
                '--preset',
                'daily-ai-voice',
                '--window',
                'after-generate',
            ],
            { projectRoot: fixture.root },
        );
        expect(code).toBe(0);
    } finally {
        out.restore();
    }
}

async function send(fixture: Fixture, extra: string[] = []): Promise<{ calls: string[][]; contents: string[] }> {
    const fake = fakeDispatch();
    const out = captureOutput();
    try {
        expect(
            await sendPublishMatrix([fixture.workDir, '--window', 'after-generate', ...extra], {
                dispatch: fake.dispatch,
            }),
        ).toBe(0);
    } finally {
        out.restore();
    }
    return { calls: fake.calls, contents: fake.contents };
}

/** The plan row id each dispatch belongs to (`--out` is `fanout-result.<row id>.json`). */
function dispatchedTargets(calls: string[][]): string[] {
    return calls.map((argv) => {
        const out = (argv[argv.indexOf('--out') + 1] ?? '').split('/').at(-1) ?? '';
        return out.replace(/^fanout-result\./, '').replace(/(\.retry)?\.json$/, '');
    });
}

describe('0395 — the publish batch defers only the Channels card (AC R18)', () => {
    it('defers the card while the article is a draft and dispatches every sibling', async () => {
        await withFixture(async (fixture) => {
            await plan(fixture);
            const first = await send(fixture);
            // Every other target keeps its configured mode and still dispatches.
            expect(dispatchedTargets(first.calls).sort()).toEqual([
                'surfdash-pub.post',
                'wechatmp-pub.文章',
                'x-pub.post',
            ]);
            expect(dispatchedTargets(first.calls)).not.toContain('shipinhao-pub.image');
            // The card alone records a visible non-send, with the reason and no payload sent.
            const card = readReceipt(fixture, 'shipinhao-pub.image');
            expect(card.status).toBe('failed');
            expect(card.effect).toBe('none');
            expect(card.error).toBe('channels-card-article-still-draft');
            // ...and it is the ledger's per-target retry, not a second mechanism.
            const ledger = await readDispatchLedger(createNodeFileSystem(), fixture.workDir);
            expect(ledger === null ? [] : retryable(ledger).map((entry) => entry.id)).toEqual(['shipinhao-pub.image']);
        });
    });

    it('defers the card when no article receipt exists at all', async () => {
        await withFixture(async (fixture) => {
            await plan(fixture);
            await send(fixture);
            rmSync(receiptPath(fixture, 'wechatmp-pub.文章'));
            const second = await send(fixture);
            expect(dispatchedTargets(second.calls)).not.toContain('shipinhao-pub.image');
            expect(readReceipt(fixture, 'shipinhao-pub.image').error).toBe('channels-card-article-not-published');
        });
    });

    it('never sends a foreign or unsafe link', async () => {
        await withFixture(async (fixture) => {
            await plan(fixture);
            await send(fixture);
            publishArticleReceipt(fixture, 'https://evil.test/s/AbCdEf');
            const second = await send(fixture, ['--retry', '--tier', '3']);
            expect(second.calls).toHaveLength(0);
            expect(readReceipt(fixture, 'shipinhao-pub.image').error).toBe('channels-card-article-url-unsafe');
        });
    });

    it('retries after the article publishes and sends the card ONCE with that exact URL', async () => {
        await withFixture(async (fixture) => {
            await plan(fixture);
            await send(fixture);
            expect(readReceipt(fixture, 'shipinhao-pub.image').status).toBe('failed');
            publishArticleReceipt(fixture, CONFIRMED);

            const retried = await send(fixture, ['--retry', '--tier', '3']);
            expect(dispatchedTargets(retried.calls)).toEqual(['shipinhao-pub.image']);
            const sent = readReceipt(fixture, 'shipinhao-pub.image');
            expect(sent.status).toBe('succeeded');
            expect(sent.url).toBe(CONFIRMED);
            // The approved card payload went out with the confirmed link in its caption.
            const payload = JSON.parse(readFileSync(retried.contents[0] as string, 'utf-8')) as {
                body: string;
                metadata: { images: unknown[]; officialAccountUrl: string; officialAccountLinkPlacement: string };
            };
            expect(payload.metadata.images).toHaveLength(1);
            expect(payload.metadata.officialAccountUrl).toBe(CONFIRMED);
            expect(payload.metadata.officialAccountLinkPlacement).toBe('caption');
            expect(payload.body).toContain(CONFIRMED);

            // A further per-target retry does not send it a second time.
            const again = await send(fixture, ['--retry', '--tier', '3']);
            expect(again.calls).toHaveLength(0);
        });
    });
});
