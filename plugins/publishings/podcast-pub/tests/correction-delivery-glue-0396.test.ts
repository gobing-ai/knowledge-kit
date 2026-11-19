/**
 * 0396 — the plugin-glue half of traceable public corrections, driven the way production drives it:
 * `processPublishIO` on a temp workspace carrying the frozen 0384 judgment snapshot and the 0388
 * dispatch rows (`options.correctionTargets`). The unit suite (corrections-0396.test.ts) pins
 * `corrections.ts`; this file pins the wiring inside `src/index.ts` — the block actually reaching the
 * show-notes markdown, the per-target delivery ledger actually hitting disk, and the exact
 * target-level reason actually reaching the warning channel.
 */
import { describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Doc, ResultSchema } from '@gobing-ai/kk-core';
import { PodcastPubTransport, processPublishIO } from '../src/index';

const RUN_DATE = '2026-11-19';
const CORRECTION_ID = 'corr-aaaaaaaaaaaaaaaa';
const ITEM_ID = 'ITEM-CORR';
const PUBLIC_URL = 'https://feed.example.com/i/corr-ep-ITEM-CORR/';

/** The frozen 0384 snapshot shape, carrying one correction owed to the next episode. */
function judgmentSnapshot(): Record<string, unknown> {
    return {
        version: 1,
        runDate: RUN_DATE,
        preamble: '本期更正一处上期判断。',
        corrections: [
            {
                correctionId: CORRECTION_ID,
                supersedes: 'j-1',
                judgmentId: 'j-2',
                selectedId: 'x:1111',
                wording: 'OpenAI 实际在 11 月 17 日发布 Sora 2，而非 11 月 15 日。',
                text: '2026-11-18 的判断「Sora 2 于 11 月 15 日发布」经核验有误，现更正为：OpenAI 实际在 11 月 17 日发布。',
                retired: { id: 'j-1', date: '2026-11-18', fact: 'Sora 2 于 11 月 15 日发布', attribution: 'OpenAI' },
                evidence: { url: 'https://openai.com/index/sora-2', checkedAt: '2026-11-19T01:00:00.000Z' },
            },
        ],
    };
}

/**
 * The 0388 dispatch rows the stage forwards, exactly as the ledger sees them — including rows the
 * correction classifier must never mark delivered, and rows that are outright malformed (the
 * untrusted-shape filtering in `readCorrectionTargets`).
 */
function dispatchRows(): unknown[] {
    return [
        // manual operator step on a correction-capable adapter
        { target: 'wechatmp-pub', mode: 'draft', state: 'pending', manualStep: 'qr-scan', supportsCorrections: true },
        // dispatched, but the adapter cannot carry/update episode content: absent capability=false
        { target: 'jike-pub', state: 'dispatched', capabilityReason: 'adapter has no same-item update' },
        // deferred: carried when that target's own, later dispatch window runs
        { target: 'xhs-pub', state: 'deferred', supportsCorrections: true },
        // blocked by an unsatisfied dependency; a non-string blocker id is filtered out
        { target: 'surfdash-pub', state: 'blocked', blockedBy: ['podcast-pub', 42], supportsCorrections: true },
        // malformed rows: dropped, never thrown on, never recorded as a delivery
        null,
        'not-a-row',
        42,
        { target: '   ' },
        { state: 'dispatched' },
        { target: 17, supportsCorrections: true },
    ];
}

interface CapturedRequest {
    url: string;
    method: string;
}

/** Offline fake microfeed: one create call, then the canonical-URL re-read of the hosted item. */
function installFakeApi(): { requests: CapturedRequest[]; restore: () => void } {
    const requests: CapturedRequest[] = [];
    const spy = spyOn(globalThis, 'fetch').mockImplementation((async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        requests.push({ url, method });
        if (method === 'POST' && url.endsWith('/api/v1/items')) {
            return new Response(JSON.stringify({ id: ITEM_ID }), { status: 201 });
        }
        if (method === 'GET' && url.endsWith(`/api/v1/items/${ITEM_ID}`)) {
            return new Response(
                JSON.stringify({ items: [{ id: ITEM_ID, url: PUBLIC_URL, _microfeed: { web_url: PUBLIC_URL } }] }),
                { status: 200 },
            );
        }
        throw new Error(`fake API has no route for ${method} ${url}`);
    }) as typeof fetch);
    return { requests, restore: () => spy.mockRestore() };
}

/** Scoped env for one case; restores exactly the keys it touched. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
    const saved: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(env)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

/** A temp run workspace: frozen snapshot + publish input/output + the delivery ledger path. */
function workspace(): { dir: string; snapshotPath: string; ledgerPath: string; inPath: string; outPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'corr-glue-0396-'));
    // the snapshot's own `21-plan/<date>_judgment-snapshot.json` home (0384 layout)
    mkdirSync(join(dir, '21-plan'), { recursive: true });
    const snapshotPath = join(dir, '21-plan', `${RUN_DATE}_judgment-snapshot.json`);
    const ledgerPath = join(dir, '31-publish', `${RUN_DATE}_16_corrections-delivery.json`);
    return { dir, snapshotPath, ledgerPath, inPath: join(dir, 'in.json'), outPath: join(dir, 'out.json') };
}

const CORRECTION_WARNINGS = (warnings: string[]): string[] =>
    warnings.filter((warning) => warning.startsWith('WARN podcast-pub: correction '));

describe('0396 plugin glue — corrections reach the episode and the delivery ledger', () => {
    test('processPublishIO delivers the correction, writes the per-target ledger, and names each non-delivered reason', async () => {
        const ws = workspace();
        writeFileSync(ws.snapshotPath, JSON.stringify(judgmentSnapshot()), 'utf-8');
        writeFileSync(
            ws.inPath,
            JSON.stringify({
                title: 'Episode 2: Correction',
                body: '本期节目继续跟进。',
                format: 'markdown',
                metadata: { audioUrl: 'https://cdn.example.com/ep2.mp3' },
                options: { correctionTargets: dispatchRows() },
            }),
            'utf-8',
        );
        const api = installFakeApi();
        try {
            await withEnv(
                {
                    MICROFEED_BASE_URL: 'https://feed.example.com',
                    MICROFEED_API_KEY: 'mf_test_key',
                    PODCAST_PUB_CORRECTIONS: ws.snapshotPath,
                    PODCAST_PUB_CORRECTION_DELIVERY: ws.ledgerPath,
                },
                async () => {
                    await processPublishIO(ws.inPath, ws.outPath, new PodcastPubTransport());
                },
            );

            const result = ResultSchema.parse(JSON.parse(readFileSync(ws.outPath, 'utf-8')));
            expect(result.ok).toBe(true);
            expect(result.url).toBe(PUBLIC_URL);
            const metadata = result.metadata as Record<string, unknown>;
            // The publish result names the correction it carried and where it landed.
            expect(metadata.corrections).toEqual({ correctionIds: [CORRECTION_ID], delivered: ['podcast-pub'] });

            // The ledger on disk is the durable, traceable record: one row per 0388 target.
            const ledger = JSON.parse(readFileSync(ws.ledgerPath, 'utf-8')) as {
                runDate: string;
                deliveries: Array<Record<string, unknown>>;
            };
            expect(ledger.runDate).toBe(RUN_DATE);
            expect(ledger.deliveries.map((entry) => entry.target).sort()).toEqual([
                'jike-pub',
                'podcast-pub',
                'surfdash-pub',
                'wechatmp-pub',
                'xhs-pub',
            ]);
            const byTarget = new Map(ledger.deliveries.map((entry) => [String(entry.target), entry]));

            // The podcast delivery is the one that reached the audience — addressed by item id + url.
            const podcast = byTarget.get('podcast-pub');
            expect(podcast?.state).toBe('delivered');
            expect(podcast?.correctionId).toBe(CORRECTION_ID);
            expect(podcast?.itemId).toBe(ITEM_ID);
            expect(podcast?.url).toBe(PUBLIC_URL);
            expect(podcast?.deliveredAt).not.toBeNull();

            // A manual target surfaces its exact operator step, not a generic "failed".
            expect(byTarget.get('wechatmp-pub')?.state).toBe('manual');
            expect(byTarget.get('wechatmp-pub')?.reason).toBe(
                `target "wechatmp-pub" requires the manual step "qr-scan": correction ${CORRECTION_ID} stays a pending operator step until it is confirmed`,
            );
            expect(byTarget.get('wechatmp-pub')?.deliveredAt).toBeNull();

            // An adapter that cannot carry a correction names its capability gap.
            expect(byTarget.get('jike-pub')?.state).toBe('unsupported');
            expect(byTarget.get('jike-pub')?.reason).toBe(
                `target "jike-pub" cannot carry an episode correction (adapter has no same-item update): correction ${CORRECTION_ID} is unsupported there`,
            );

            // A blocked target names the dependency that blocks it (the non-string id was dropped).
            expect(byTarget.get('surfdash-pub')?.state).toBe('blocked');
            expect(byTarget.get('surfdash-pub')?.reason).toBe(
                `target "surfdash-pub" is blocked by unsatisfied dependency podcast-pub: correction ${CORRECTION_ID} is not delivered yet`,
            );

            // A deferred target is queued, not lost: it names its own later window.
            expect(byTarget.get('xhs-pub')?.state).toBe('pending');
            expect(byTarget.get('xhs-pub')?.reason).toBe(
                `target "xhs-pub" dispatches in its own, later window: correction ${CORRECTION_ID} is carried when that window runs`,
            );

            // Every non-delivered row is reported verbatim; the malformed rows produced nothing at all.
            const warnings = CORRECTION_WARNINGS((metadata.warnings as string[] | undefined) ?? []);
            expect(warnings).toHaveLength(4);
            expect(warnings.join('\n')).toContain('requires the manual step "qr-scan"');
            expect(warnings.join('\n')).toContain('adapter has no same-item update');
            expect(warnings.join('\n')).toContain('blocked by unsatisfied dependency podcast-pub');
            expect(warnings.join('\n')).toContain('dispatches in its own, later window');
            // the delivered podcast row is never reported as a failure
            expect(warnings.some((warning) => warning.includes('not delivered to target "podcast-pub"'))).toBe(false);

            // Exactly one create + one canonical-URL read: the delivery bookkeeping calls no API.
            expect(api.requests.map((request) => request.method)).toEqual(['POST', 'GET']);
        } finally {
            api.restore();
            rmSync(ws.dir, { recursive: true, force: true });
        }
    });

    test('a replayed publish never re-delivers: the ledger keeps one delivered row and says so', async () => {
        const ws = workspace();
        writeFileSync(ws.snapshotPath, JSON.stringify(judgmentSnapshot()), 'utf-8');
        writeFileSync(
            ws.inPath,
            JSON.stringify({
                title: 'Episode 2: Correction',
                body: '本期节目继续跟进。',
                format: 'markdown',
                metadata: { audioUrl: 'https://cdn.example.com/ep2.mp3' },
                options: {
                    correctionTargets: [{ target: 'wechatmp-pub', manualStep: 'qr-scan', supportsCorrections: true }],
                },
            }),
            'utf-8',
        );
        const api = installFakeApi();
        try {
            await withEnv(
                {
                    MICROFEED_BASE_URL: 'https://feed.example.com',
                    MICROFEED_API_KEY: 'mf_test_key',
                    PODCAST_PUB_CORRECTIONS: ws.snapshotPath,
                    PODCAST_PUB_CORRECTION_DELIVERY: ws.ledgerPath,
                },
                async () => {
                    await processPublishIO(ws.inPath, ws.outPath, new PodcastPubTransport());
                    await processPublishIO(ws.inPath, ws.outPath, new PodcastPubTransport());
                },
            );
            const result = ResultSchema.parse(JSON.parse(readFileSync(ws.outPath, 'utf-8')));
            const metadata = result.metadata as Record<string, unknown>;
            const ledger = JSON.parse(readFileSync(ws.ledgerPath, 'utf-8')) as {
                deliveries: Array<Record<string, unknown>>;
            };
            expect(ledger.deliveries).toHaveLength(2);
            expect(
                ledger.deliveries.filter((entry) => entry.target === 'podcast-pub' && entry.state === 'delivered'),
            ).toHaveLength(1);
            expect((metadata.warnings as string[]).join('\n')).toContain(
                `correction ${CORRECTION_ID} already delivered to target "podcast-pub" — not re-sent`,
            );
        } finally {
            api.restore();
            rmSync(ws.dir, { recursive: true, force: true });
        }
    });

    test('the show-notes entry carries the correction block under the title; no snapshot ⇒ no block', async () => {
        const ws = workspace();
        writeFileSync(ws.snapshotPath, JSON.stringify(judgmentSnapshot()), 'utf-8');
        const docs = [
            {
                id: 'x:1111',
                title: 'Sora 2 发布',
                body: 'OpenAI 发布 Sora 应用。第二句。',
                sourceUri: 'https://openai.com/index/sora-2',
                mediaType: 'text/markdown',
            } as Doc,
        ];
        writeFileSync(ws.inPath, JSON.stringify(docs), 'utf-8');

        const base = { PODCAST_PUB_TITLE: '第261120期 · 测试', PODCAST_PUB_RUN_DATE: RUN_DATE };
        await withEnv({ ...base, PODCAST_PUB_CORRECTIONS: ws.snapshotPath }, async () => {
            await processPublishIO(ws.inPath, ws.outPath, new PodcastPubTransport());
        });
        const withCorrection = readFileSync(ws.outPath, 'utf-8');
        expect(withCorrection).toContain('## 本期更正说明');
        // acknowledgement + apology, corrected fact, prior-episode reference, correction id, evidence
        expect(withCorrection).toContain('经核验有误，我们在此更正并致歉');
        expect(withCorrection).toContain('原判断：「Sora 2 于 11 月 15 日发布」');
        expect(withCorrection).toContain('更正为：OpenAI 实际在 11 月 17 日发布 Sora 2');
        expect(withCorrection).toContain('上期节目 第261118期（2026-11-18）');
        expect(withCorrection).toContain(CORRECTION_ID);
        expect(withCorrection).toContain('https://openai.com/index/sora-2');
        // directly under the episode title, before the news items
        const titleAt = withCorrection.indexOf('# 第261120期');
        const blockAt = withCorrection.indexOf('## 本期更正说明');
        expect(titleAt).toBeGreaterThanOrEqual(0);
        expect(blockAt).toBeGreaterThan(titleAt);
        expect(blockAt).toBeLessThan(withCorrection.indexOf('## 1.'));

        // No configured snapshot ⇒ no correction block at all (no empty heading).
        await withEnv({ ...base, PODCAST_PUB_CORRECTIONS: undefined }, async () => {
            await processPublishIO(ws.inPath, ws.outPath, new PodcastPubTransport());
        });
        const withoutCorrection = readFileSync(ws.outPath, 'utf-8');
        expect(withoutCorrection).not.toContain('本期更正说明');
        expect(withoutCorrection).toContain('# 第261120期');

        rmSync(ws.dir, { recursive: true, force: true });
    });
});
