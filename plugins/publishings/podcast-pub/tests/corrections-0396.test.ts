/** 0396 R1/R2 / AC R17 — 已播纠错随新版节目送达并可追溯 (traceable public correction delivery). */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Doc } from '@gobing-ai/kk-core';
import {
    type Correction,
    type CorrectionDeliveryTarget,
    classifyCorrectionTarget,
    correctionDeliveryPath,
    deliveredCorrectionIds,
    emptyDeliveryLedger,
    planCorrectionDeliveries,
    priorEpisodeReference,
    readCorrectionDeliveries,
    readFrozenCorrections,
    recordCorrectionDeliveries,
    renderCorrectionsBlock,
    writeCorrectionDeliveries,
} from '../src/corrections';
import { PodcastPubTransport } from '../src/index';

/** A frozen 0384 snapshot carrying one correction (the upstream shape, consumed as-is). */
function snapshot(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        version: 1,
        runDate: '2026-11-19',
        preamble: '本期更正一处上期判断。',
        corrections: [
            {
                correctionId: 'corr-aaaaaaaaaaaaaaaa',
                supersedes: 'j-1',
                judgmentId: 'j-2',
                selectedId: 'x:1111',
                wording: 'OpenAI 实际在 11 月 17 日发布 Sora 2，而非 11 月 15 日。',
                text: '2026-11-18 的判断「Sora 2 于 11 月 15 日发布」经核验有误，现更正为：OpenAI 实际在 11 月 17 日发布。',
                retired: {
                    id: 'j-1',
                    date: '2026-11-18',
                    fact: 'Sora 2 于 11 月 15 日发布',
                    attribution: 'OpenAI',
                    comment: '首发日期',
                },
                evidence: { url: 'https://openai.com/index/sora-2', checkedAt: '2026-11-19T01:00:00.000Z' },
            },
        ],
        ...over,
    };
}

const set = readFrozenCorrections(snapshot());
const correction = set.corrections[0] as Correction;

function target(over: Partial<CorrectionDeliveryTarget> = {}): CorrectionDeliveryTarget {
    return { target: 'podcast-pub', state: 'dispatched', supportsCorrections: true, ...over };
}

describe('0396 R1 — the correction carried with the next episode', () => {
    test('block carries the correction id, the prior-episode reference, the corrected fact and the evidence', () => {
        const block = renderCorrectionsBlock(set) ?? '';
        expect(block).toContain('## 本期更正说明');
        expect(block).toContain('corr-aaaaaaaaaaaaaaaa');
        expect(block).toContain(priorEpisodeReference(correction.retired));
        expect(block).toContain('第261118期（2026-11-18）');
        expect(block).toContain('致歉');
        expect(block).toContain('Sora 2 于 11 月 15 日发布');
        expect(block).toContain('OpenAI 实际在 11 月 17 日发布 Sora 2');
        expect(block).toContain('https://openai.com/index/sora-2');
        expect(block).toContain('2026-11-19T01:00:00.000Z');
    });

    test('no frozen judgment ⇒ no block at all (no empty heading)', () => {
        expect(renderCorrectionsBlock(readFrozenCorrections({ version: 1, corrections: [] }))).toBeNull();
        expect(renderCorrectionsBlock(readFrozenCorrections(null))).toBeNull();
    });

    test('correction ids stay unique: a duplicate is ignored and reported', () => {
        const duplicated = readFrozenCorrections(
            snapshot({
                corrections: [(snapshot().corrections as unknown[])[0], (snapshot().corrections as unknown[])[0]],
            }),
        );
        expect(duplicated.corrections.map((entry) => entry.correctionId)).toEqual(['corr-aaaaaaaaaaaaaaaa']);
        expect(duplicated.diagnostics.join(' ')).toContain('duplicate correction id "corr-aaaaaaaaaaaaaaaa"');
    });

    test('a malformed entry never fabricates a correction and is reported', () => {
        const broken = readFrozenCorrections(
            snapshot({ corrections: [{ correctionId: 'corr-x', retired: { date: '2026-11-18' } }] }),
        );
        expect(broken.corrections).toEqual([]);
        expect(broken.diagnostics.join(' ')).toContain('corr-x');
    });

    test('show-notes render carries the block under the frozen title (podcast-pub integration)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'corr-0396-'));
        const path = join(dir, 'snapshot.json');
        writeFileSync(path, JSON.stringify(snapshot()), 'utf-8');
        const previous = process.env.PODCAST_PUB_CORRECTIONS;
        process.env.PODCAST_PUB_CORRECTIONS = path;
        try {
            const doc = {
                id: 'x:1111',
                title: 'Sora 2 发布',
                body: 'OpenAI 发布 Sora 应用。第二句。',
                sourceUri: 'https://openai.com/index/sora-2',
                mediaType: 'text/markdown',
                metadata: { brief: 'OpenAI 发布 Sora 应用。' },
            } as Doc;
            const result = await new PodcastPubTransport().publish({
                content: { title: 't', body: 'b', metadata: {} } as never,
                options: { operation: 'show-notes', docs: [doc], title: '第261119期 · 测试', runDate: '2026-11-19' },
            });
            const markdown = String((result.metadata as Record<string, unknown>).markdown);
            expect(markdown).toContain('## 本期更正说明');
            expect(markdown).toContain('corr-aaaaaaaaaaaaaaaa');
            expect(markdown.indexOf('## 本期更正说明')).toBeGreaterThan(markdown.indexOf('# 第261119期'));
        } finally {
            if (previous === undefined) delete process.env.PODCAST_PUB_CORRECTIONS;
            else process.env.PODCAST_PUB_CORRECTIONS = previous;
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('an absent correction path yields no block (no heading in the notes)', async () => {
        const doc = {
            id: 'x:1111',
            title: 'Sora 2 发布',
            body: 'OpenAI 发布 Sora。第二句。',
            mediaType: 'text/markdown',
        } as Doc;
        const result = await new PodcastPubTransport().publish({
            content: { title: 't', body: 'b', metadata: {} } as never,
            options: { operation: 'show-notes', docs: [doc], title: '第261119期 · 测试', runDate: '2026-11-19' },
        });
        const markdown = String((result.metadata as Record<string, unknown>).markdown);
        expect(markdown).not.toContain('本期更正说明');
    });
});

describe('0396 R2 — per-target delivery record with the exact recovery reason', () => {
    test('a dispatched correction-carrying target is recorded as delivered, naming target + correction id', () => {
        const [delivery] = planCorrectionDeliveries(set, [target()], {
            runDate: '2026-11-19',
            now: '2026-11-19T02:00:00.000Z',
        });
        expect(delivery?.state).toBe('delivered');
        expect(delivery?.target).toBe('podcast-pub');
        expect(delivery?.correctionId).toBe('corr-aaaaaaaaaaaaaaaa');
        expect(delivery?.deliveredAt).toBe('2026-11-19T02:00:00.000Z');
        expect(delivery?.reason).toContain('correction corr-aaaaaaaaaaaaaaaa');
    });

    test('manual / blocked / unsupported reasons are surfaced verbatim per target and never marked delivered', () => {
        const rows = planCorrectionDeliveries(
            set,
            [
                target({ target: 'wechatmp-pub', mode: 'draft', state: 'pending', manualStep: 'qr-scan' }),
                target({ target: 'surfdash-pub', state: 'blocked', blockedBy: ['podcast-pub'] }),
                target({ target: 'x-pub', mode: 'off', state: 'off' }),
                target({
                    target: 'jike-pub',
                    state: 'dispatched',
                    supportsCorrections: false,
                    capabilityReason: 'adapter has no same-item update',
                }),
                target({ target: 'weibo-pub', state: 'retry', lastError: 'HTTP 502' }),
            ],
            { runDate: '2026-11-19' },
        );
        const byTarget = new Map(rows.map((row) => [row.target, row]));
        expect(byTarget.get('wechatmp-pub')?.state).toBe('manual');
        expect(byTarget.get('wechatmp-pub')?.reason).toBe(
            'target "wechatmp-pub" requires the manual step "qr-scan": correction corr-aaaaaaaaaaaaaaaa stays a pending operator step until it is confirmed',
        );
        expect(byTarget.get('surfdash-pub')?.state).toBe('blocked');
        expect(byTarget.get('surfdash-pub')?.reason).toBe(
            'target "surfdash-pub" is blocked by unsatisfied dependency podcast-pub: correction corr-aaaaaaaaaaaaaaaa is not delivered yet',
        );
        expect(byTarget.get('x-pub')?.state).toBe('unsupported');
        expect(byTarget.get('x-pub')?.reason).toContain('off in the authorization matrix (mode=off)');
        expect(byTarget.get('jike-pub')?.state).toBe('unsupported');
        expect(byTarget.get('jike-pub')?.reason).toContain('adapter has no same-item update');
        expect(byTarget.get('weibo-pub')?.state).toBe('blocked');
        expect(byTarget.get('weibo-pub')?.reason).toContain('HTTP 502');
        for (const row of rows) {
            if (row.state === 'delivered') continue;
            expect(row.deliveredAt).toBeNull();
            expect(row.reason).toContain(`target "${row.target}"`);
        }
    });

    test('the delivery record is written per target and proves the correction id (mutation-sensitive case)', () => {
        const deliveries = planCorrectionDeliveries(
            set,
            [
                target(),
                // A neighbouring target may only claim delivery when it names the evidence that its
                // content carries the block (0396 review P3): the podcast row is anchored by the item
                // id/url the caller just produced, everything else must prove it.
                target({ target: 'surfdash-pub', deliveryEvidence: 'https://example.com/posts/daily-ai-20261119' }),
                target({ target: 'x-pub' }),
            ],
            { runDate: '2026-11-19', now: '2026-11-19T02:00:00.000Z' },
        );
        const byTarget = new Map(deliveries.map((entry) => [entry.target, entry]));
        // dispatched with evidence ⇒ delivered, and the evidence is recorded on the row
        expect(byTarget.get('surfdash-pub')?.state).toBe('delivered');
        expect(byTarget.get('surfdash-pub')?.url).toBe('https://example.com/posts/daily-ai-20261119');
        // dispatched without evidence ⇒ blocked, with the exact reason (never a false delivery)
        expect(byTarget.get('x-pub')?.state).toBe('blocked');
        expect(byTarget.get('x-pub')?.reason).toContain('carries no delivery evidence');

        const { ledger, recorded, skipped } = recordCorrectionDeliveries(emptyDeliveryLedger('2026-11-19'), deliveries);
        // Every classified row is recorded (the ledger is the recovery surface, not just the wins);
        // only the two with proof count as delivered.
        expect(recorded).toHaveLength(3);
        expect(skipped).toHaveLength(0);
        expect(ledger.deliveries.map((entry) => entry.state)).toEqual(['delivered', 'delivered', 'blocked']);
        expect(deliveredCorrectionIds(ledger)).toEqual(['corr-aaaaaaaaaaaaaaaa']);
        expect(deliveredCorrectionIds(ledger, 'surfdash-pub')).toEqual(['corr-aaaaaaaaaaaaaaaa']);
        expect(deliveredCorrectionIds(ledger, 'x-pub')).toEqual([]);
    });

    test('a blocked sibling keeps its own reason instead of the capability default', () => {
        // Dispatch-state reasons outrank the capability default: a row blocked on a dependency, or one
        // waiting on the operator's QR scan, must say so (0396 review) — "unsupported" is reserved for a
        // target that is otherwise dispatchable but cannot carry a correction.
        const [, sibling] = planCorrectionDeliveries(
            set,
            [
                target(),
                target({
                    target: 'wechatmp-pub',
                    state: 'blocked',
                    blockedBy: ['surfdash-pub@article'],
                    manualStep: 'qr-scan',
                }),
            ],
            { runDate: '2026-11-19', now: '2026-11-19T02:00:00.000Z' },
        );
        expect(sibling?.state).toBe('manual');
        expect(sibling?.reason).toContain('qr-scan');
        expect(sibling?.reason).not.toContain('cannot carry an episode correction');
    });

    test('a correction already delivered is not re-delivered', () => {
        const first = recordCorrectionDeliveries(
            emptyDeliveryLedger('2026-11-19'),
            planCorrectionDeliveries(set, [target()], { runDate: '2026-11-19', now: '2026-11-19T02:00:00.000Z' }),
        );
        const replay = recordCorrectionDeliveries(
            first.ledger,
            planCorrectionDeliveries(set, [target()], {
                runDate: '2026-11-19',
                prior: first.ledger.deliveries,
                now: '2026-11-19T05:00:00.000Z',
            }),
        );
        expect(replay.recorded).toHaveLength(0);
        expect(replay.skipped).toHaveLength(1);
        expect(replay.skipped[0]?.reason).toContain('already received correction corr-aaaaaaaaaaaaaaaa');
        expect(replay.ledger.deliveries).toHaveLength(1);
        expect(replay.ledger.deliveries[0]?.deliveredAt).toBe('2026-11-19T02:00:00.000Z');
    });

    test('a later non-delivered pass never downgrades a recorded delivery', () => {
        const delivered = recordCorrectionDeliveries(
            emptyDeliveryLedger('2026-11-19'),
            planCorrectionDeliveries(set, [target()], { runDate: '2026-11-19', now: '2026-11-19T02:00:00.000Z' }),
        );
        const later = recordCorrectionDeliveries(
            delivered.ledger,
            planCorrectionDeliveries(set, [target({ state: 'pending' })], { runDate: '2026-11-19' }),
        );
        expect(later.ledger.deliveries[0]?.state).toBe('delivered');
        expect(deliveredCorrectionIds(later.ledger)).toEqual(['corr-aaaaaaaaaaaaaaaa']);
    });

    test('classify honours an explicit prior delivery ahead of a stale dispatch state', () => {
        const prior = [
            {
                correctionId: 'corr-aaaaaaaaaaaaaaaa',
                target: 'podcast-pub',
                runDate: '2026-11-19',
                state: 'delivered' as const,
                reason: 'earlier',
                deliveredAt: '2026-11-19T02:00:00.000Z',
            },
        ];
        const again = classifyCorrectionTarget(correction, target({ state: 'pending' }), {
            prior,
            runDate: '2026-11-19',
        });
        expect(again.state).toBe('delivered');
        expect(again.deliveredAt).toBe('2026-11-19T02:00:00.000Z');
        expect(again.reason).toContain('not re-sent');
    });

    test('the ledger round-trips on disk and a corrupt file degrades to an empty ledger', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'corr-ledger-'));
        try {
            const path = correctionDeliveryPath(dir, '2026-11-19');
            expect(path.endsWith(join('31-publish', '2026-11-19_16_corrections-delivery.json'))).toBe(true);
            const { ledger } = recordCorrectionDeliveries(
                emptyDeliveryLedger('2026-11-19'),
                planCorrectionDeliveries(set, [target()], { runDate: '2026-11-19', now: '2026-11-19T02:00:00.000Z' }),
            );
            await writeCorrectionDeliveries(path, ledger);
            const read = await readCorrectionDeliveries(path, '2026-11-19');
            expect(deliveredCorrectionIds(read)).toEqual(['corr-aaaaaaaaaaaaaaaa']);
            expect(read.deliveries[0]?.url).toBeUndefined();
            writeFileSync(path, '{not json', 'utf-8');
            expect((await readCorrectionDeliveries(path, '2026-11-19')).deliveries).toEqual([]);
            expect((await readCorrectionDeliveries(join(dir, 'missing.json'), '2026-11-19')).deliveries).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
