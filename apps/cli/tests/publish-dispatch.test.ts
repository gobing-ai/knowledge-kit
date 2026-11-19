import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    applyDispatchResults,
    type DispatchLedger,
    type DispatchTarget,
    dependenciesOf,
    dispatchable,
    dispatchTargetId,
    effectiveMode,
    losAngelesDate,
    planDispatch,
    readDispatchLedger,
    resolveFrozenRunDate,
    resolveOwnerUrls,
    retryable,
    writeDispatchLedger,
} from '../src/publish-dispatch';

// Task 0388 (L3 R9) — one publish trigger per FROZEN run date. Every case below is a rehearsal the
// task's verification exit names: dry + fake sends, cross-midnight, DST, RSS window, partial success
// and per-target retry, with the operator clock and the authorization matrix untouched.
//
// AC R9 evidence: "each channel is triggered by one publish trigger and the authorization matrix is
// preserved".
//  * one trigger -> every dependency-satisfied target dispatched exactly once, across windows
//  * a second trigger for the same date re-runs nothing (completed effects are adopted)
//  * WeChat keeps the draft + QR boundary: a `live` wechatmp row dispatches as draft, never live
//  * an unready target retries per target without re-running the completed ones
//  * owner URLs resolve from THIS bundle's receipts only; drafts never become owner links
//  * legacy window compatibility: with nothing frozen, the overseas-rss window still reads yesterday
//  * cross-midnight and DST keep the episode day stable for one run and window-independent

const PRESET: DispatchTarget[] = [
    { plugin: 'surfdash-pub', operation: 'post', variant: 'article', tier: 0, window: 'after-generate', mode: 'live' },
    {
        plugin: 'podcast-pub',
        operation: 'episode',
        variant: 'episode',
        tier: 0,
        window: 'after-generate',
        mode: 'live',
    },
    { plugin: 'wechatmp-pub', operation: '播客', tier: 1, window: 'after-generate', mode: 'live' },
    { plugin: 'wechatmp-pub', operation: '文章', tier: 2, window: 'after-generate', mode: 'draft' },
    { plugin: 'weibo-pub', operation: 'article', tier: 2, window: 'cn-peak', mode: 'live' },
    { plugin: 'x-pub', operation: 'post', tier: 3, window: 'overseas-rss', mode: 'live' },
    { plugin: 'xhs-pub', operation: '写长文', tier: 2, window: 'after-generate', mode: 'off' },
];

function ledgerFor(window: string, ledger?: DispatchLedger | null, bundleRunId = 'run-388'): DispatchLedger {
    return planDispatch({
        runDate: '2026-11-18',
        window,
        targets: PRESET,
        frozenSource: 'bundle',
        bundleRunId,
        ...(ledger === undefined ? {} : { ledger }),
    });
}

describe('0388 — frozen run date (AC R9)', () => {
    it('freezes the flag day and never lets a window move it', () => {
        const forAfter = resolveFrozenRunDate({ runDate: '2026-11-18', window: 'after-generate' });
        const forOverseas = resolveFrozenRunDate({ runDate: '2026-11-18', window: 'overseas-rss' });
        expect(forAfter).toEqual({ runDate: '2026-11-18', source: 'flag', pinned: true });
        expect(forOverseas).toEqual(forAfter);
    });

    it('prefers the frozen bundle day over the window, the 0388 bug (content-launch.ts:525)', () => {
        // The retired entry changed the episode number by window: same bundle, two windows, two days.
        const after = resolveFrozenRunDate({ bundleRunDate: '20261118', window: 'after-generate' });
        const overseas = resolveFrozenRunDate({ bundleRunDate: '20261118', window: 'overseas-rss' });
        expect(after.runDate).toBe('2026-11-18');
        expect(overseas.runDate).toBe('2026-11-18');
        expect(overseas.source).toBe('bundle');
        // And a flag outranks a stale archived bundle.
        expect(
            resolveFrozenRunDate({ runDate: '20261119', bundleRunDate: '20261118', window: 'cn-peak' }).runDate,
        ).toBe('2026-11-19');
    });

    it('keeps legacy window compatibility when nothing is frozen', () => {
        // 2026-11-18T08:00:00Z = 00:00 in Los Angeles on 2026-11-18.
        const now = Date.parse('2026-11-18T08:00:00Z');
        const after = resolveFrozenRunDate({ window: 'after-generate', now });
        const overseas = resolveFrozenRunDate({ window: 'overseas-rss', now });
        expect(after).toEqual({ runDate: '2026-11-18', source: 'clock', pinned: false });
        expect(overseas.runDate).toBe('2026-11-17');
    });

    it('handles a cross-midnight LA date against a UTC date', () => {
        // 06:30Z on the 18th is still 22:30 on the 17th in Los Angeles: the episode day is the 17th.
        const crossMidnight = Date.parse('2026-11-18T06:30:00Z');
        expect(losAngelesDate(crossMidnight)).toBe('20261117');
        expect(resolveFrozenRunDate({ window: 'after-generate', now: crossMidnight }).runDate).toBe('2026-11-17');
        // A frozen date is untouched by the clock crossing midnight.
        expect(
            resolveFrozenRunDate({
                runDate: '20261117',
                window: 'after-generate',
                now: Date.parse('2026-11-18T09:00:00Z'),
            }).runDate,
        ).toBe('2026-11-17');
    });

    it('handles both DST switches without shifting the day', () => {
        // 2026-03-08 spring forward: 09:59Z is 01:59 PST, 10:00Z is 03:00 PDT — same LA day.
        expect(losAngelesDate(Date.parse('2026-03-08T09:59:00Z'))).toBe('20260308');
        expect(losAngelesDate(Date.parse('2026-03-08T10:00:00Z'))).toBe('20260308');
        // 2026-11-01 fall back: 08:59Z is 01:59 PDT, 09:00Z is 01:00 PST.
        expect(losAngelesDate(Date.parse('2026-11-01T08:59:00Z'))).toBe('20261101');
        expect(losAngelesDate(Date.parse('2026-11-01T09:00:00Z'))).toBe('20261101');
        // The frozen day survives the switch even when the clock disagrees.
        expect(
            resolveFrozenRunDate({
                bundleRunDate: '2026-11-01',
                window: 'overseas-rss',
                now: Date.parse('2026-11-01T09:30:00Z'),
            }).runDate,
        ).toBe('2026-11-01');
    });

    it('refuses a day that is not a real calendar day', () => {
        expect(() => resolveFrozenRunDate({ runDate: '20260230', window: 'after-generate' })).toThrow(/calendar day/);
        expect(() => resolveFrozenRunDate({ bundleRunDate: 'not-a-day', window: 'cn-peak' })).toThrow(/calendar day/);
    });
});

describe('0388 — one trigger dispatches the dependency graph once (AC R9)', () => {
    it('derives dependencies from tiers inside one window only', () => {
        const wechat = PRESET[2] as DispatchTarget;
        expect(dependenciesOf(wechat, PRESET)).toEqual(['surfdash-pub@post', 'podcast-pub@episode']);
        // The RSS window's x-pub row depends on nothing in another window.
        expect(dependenciesOf(PRESET[5] as DispatchTarget, PRESET)).toEqual([]);
    });

    it('dispatches every dependency-satisfied target of the firing window exactly once', () => {
        const ledger = ledgerFor('after-generate');
        const byId = new Map(ledger.entries.map((entry) => [entry.id, entry]));
        // Tier 0 runs now.
        expect(byId.get('surfdash-pub@post')?.state).toBe('pending');
        expect(byId.get('podcast-pub@episode')?.state).toBe('pending');
        // Tier 1/2 wait on the tier-0 owner rows until they are dispatched.
        expect(byId.get('wechatmp-pub@播客')?.state).toBe('blocked');
        expect(byId.get('wechatmp-pub@播客')?.blockedBy).toEqual(['surfdash-pub@post', 'podcast-pub@episode']);
        // Other windows belong to a later window of the SAME trigger — deferred, not dropped.
        expect(byId.get('weibo-pub@article')?.state).toBe('deferred');
        expect(byId.get('x-pub@post')?.state).toBe('deferred');
        // The authorization matrix is preserved: `off` never dispatches.
        expect(byId.get('xhs-pub@写长文')?.state).toBe('off');
        // One trigger sees the whole graph — every preset row is represented once.
        expect(ledger.entries).toHaveLength(PRESET.length);
        expect(new Set(ledger.entries.map((entry) => entry.id)).size).toBe(PRESET.length);
    });

    it('advances the graph as tiers complete, and a second trigger re-runs nothing', () => {
        const pass1 = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'https://surfdash.example/e/1' },
            { id: 'podcast-pub@episode', ok: true, url: 'https://podcast.example/e/1' },
        ]);
        const pass2 = ledgerFor('after-generate', pass1);
        const byId = new Map(pass2.entries.map((entry) => [entry.id, entry]));
        expect(byId.get('surfdash-pub@post')?.state).toBe('dispatched');
        expect(byId.get('surfdash-pub@post')?.attempts).toBe(1);
        // The now-satisfied tier 1/2 rows run on THIS trigger, once.
        expect(byId.get('wechatmp-pub@播客')?.state).toBe('pending');
        expect(byId.get('wechatmp-pub@文章')?.state).toBe('blocked');
        // Tier 1 runs now; tier 2 still waits on tier 1 — exactly one row is dispatchable.
        expect(dispatchable(pass2).map((entry) => entry.id)).toEqual(['wechatmp-pub@播客']);

        // A third trigger for the same frozen date adopts pass 2: no completed effect is repeated.
        const pass3 = ledgerFor('after-generate', pass2);
        expect(dispatchable(pass3).map((entry) => entry.id)).toEqual(['wechatmp-pub@播客']);
        expect(pass3.entries.find((entry) => entry.id === 'surfdash-pub@post')?.attempts).toBe(1);
    });

    it('rebuilds the ledger for a different frozen date instead of adopting old effects', () => {
        const done = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'u' },
            { id: 'podcast-pub@episode', ok: true, url: 'u' },
        ]);
        const nextDay = planDispatch({
            runDate: '2026-11-19',
            window: 'after-generate',
            targets: PRESET,
            bundleRunId: 'run-388',
            ledger: done,
        });
        expect(nextDay.entries.find((entry) => entry.id === 'surfdash-pub@post')?.state).toBe('pending');
        expect(nextDay.entries.find((entry) => entry.id === 'surfdash-pub@post')?.attempts).toBe(0);
    });

    it('dispatches each later window once when its own trigger fires on the same frozen date', () => {
        const afterDone = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'u' },
            { id: 'podcast-pub@episode', ok: true, url: 'u' },
        ]);
        const cnPeak = ledgerFor('cn-peak', afterDone);
        const byId = new Map(cnPeak.entries.map((entry) => [entry.id, entry]));
        expect(byId.get('weibo-pub@article')?.state).toBe('pending');
        // The already-delivered after-generate rows stay dispatched — not re-sent by the later window.
        expect(byId.get('surfdash-pub@post')?.state).toBe('dispatched');
        expect(byId.get('x-pub@post')?.state).toBe('deferred');
        // ...and the cn-peak pass is dispatched exactly once too.
        const cnDone = applyDispatchResults(cnPeak, [
            { id: 'weibo-pub@article', ok: true, url: 'https://weibo.example/1' },
        ]);
        expect(ledgerFor('cn-peak', cnDone).entries.find((entry) => entry.id === 'weibo-pub@article')?.attempts).toBe(
            1,
        );
    });
});

describe('0388 — WeChat keeps the draft and QR boundary (AC R9)', () => {
    it('never dispatches a live wechatmp row as live', () => {
        expect(effectiveMode({ plugin: 'wechatmp-pub', mode: 'live' })).toEqual({
            mode: 'draft',
            manualStep: 'qr-scan',
        });
        expect(effectiveMode({ plugin: 'wechatmp-pub', mode: 'draft' })).toEqual({
            mode: 'draft',
            manualStep: 'qr-scan',
        });
        expect(effectiveMode({ plugin: 'wechatmp-pub', mode: 'dummy' })).toEqual({ mode: 'dummy' });
        expect(effectiveMode({ plugin: 'wechatmp-pub', mode: 'off' })).toEqual({ mode: 'off' });
    });

    it('records the QR manual step for every dispatched WeChat row and leaves live rows alone', () => {
        const pass1 = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'u' },
            { id: 'podcast-pub@episode', ok: true, url: 'u' },
        ]);
        const ledger = ledgerFor('after-generate', pass1);
        const wechat = ledger.entries.find((entry) => entry.id === 'wechatmp-pub@播客');
        expect(wechat?.mode).toBe('draft');
        expect(wechat?.manualStep).toBe('qr-scan');
        expect(wechat?.state).toBe('pending');
        // No WeChat row in the graph is ever `live`.
        expect(
            ledger.entries.filter((entry) => entry.plugin === 'wechatmp-pub').every((entry) => entry.mode !== 'live'),
        ).toBe(true);
        // A non-WeChat live row keeps its authoritative preset mode.
        expect(ledger.entries.find((entry) => entry.id === 'podcast-pub@episode')?.mode).toBe('live');
    });
});

describe('0388 — per-target retry without repeating completed effects (AC R9)', () => {
    it('retries only the failed target', () => {
        const pass1 = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'u1' },
            { id: 'podcast-pub@episode', ok: false, error: 'network timeout' },
        ]);
        expect(retryable(pass1).map((entry) => entry.id)).toEqual(['podcast-pub@episode']);
        expect(pass1.entries.find((entry) => entry.id === 'podcast-pub@episode')?.lastError).toBe('network timeout');
        // Nothing but the failed target may be re-attempted.
        expect(dispatchable(pass1)).toEqual([]);

        const retried = ledgerFor('after-generate', pass1);
        expect(retryable(retried).map((entry) => entry.id)).toEqual(['podcast-pub@episode']);
        expect(retried.entries.find((entry) => entry.id === 'surfdash-pub@post')?.attempts).toBe(1);
        const recovered = applyDispatchResults(retried, [{ id: 'podcast-pub@episode', ok: true, url: 'u2' }]);
        expect(recovered.entries.find((entry) => entry.id === 'podcast-pub@episode')?.state).toBe('dispatched');
        expect(recovered.entries.find((entry) => entry.id === 'podcast-pub@episode')?.attempts).toBe(2);
        // The completed effect still has exactly one attempt.
        expect(recovered.entries.find((entry) => entry.id === 'surfdash-pub@post')?.attempts).toBe(1);
    });

    it('leaves a downstream row blocked while its dependency is only retryable', () => {
        const pass1 = applyDispatchResults(ledgerFor('after-generate'), [
            { id: 'surfdash-pub@post', ok: true, url: 'u1' },
            { id: 'podcast-pub@episode', ok: false, error: 'RSS miss' },
        ]);
        const next = ledgerFor('after-generate', pass1);
        const downstream = next.entries.find((entry) => entry.id === 'wechatmp-pub@播客');
        expect(downstream?.state).toBe('blocked');
        expect(downstream?.blockedBy).toEqual(['podcast-pub@episode']);
    });

    it('ignores results for targets that are not pending or retryable', () => {
        const ledger = ledgerFor('after-generate');
        const mutated = applyDispatchResults(ledger, [
            { id: 'x-pub@post', ok: true, url: 'nope' },
            { id: 'xhs-pub@写长文', ok: true, url: 'nope' },
            { id: 'unknown-target', ok: true },
        ]);
        expect(mutated.entries.find((entry) => entry.id === 'x-pub@post')?.state).toBe('deferred');
        expect(mutated.entries.find((entry) => entry.id === 'xhs-pub@写长文')?.state).toBe('off');
    });
});

describe('0388 — owner URLs resolve from this bundle’s receipts only (AC R9)', () => {
    it('resolves live owners and keeps drafts out of owner links', () => {
        const resolution = resolveOwnerUrls(
            [
                { targetId: 'surfdash-pub@post', bundleRunId: 'b388', status: 'ok', url: 'https://surfdash.example/1' },
                {
                    targetId: 'podcast-pub@episode',
                    bundleRunId: 'b388',
                    status: 'ok',
                    url: 'https://podcast.example/1',
                },
                {
                    targetId: 'wechatmp-pub@文章',
                    bundleRunId: 'b388',
                    status: 'draft',
                    url: 'https://mp.weixin.qq.com/draft/1',
                },
            ],
            { bundleRunId: 'b388' },
        );
        expect(resolution.owner).toEqual({
            'surfdash-pub@post': 'https://surfdash.example/1',
            'podcast-pub@episode': 'https://podcast.example/1',
        });
        expect(resolution.draft).toEqual({ 'wechatmp-pub@文章': 'https://mp.weixin.qq.com/draft/1' });
    });

    it('ignores a stale bundle’s receipt and a non-success receipt', () => {
        const resolution = resolveOwnerUrls(
            [
                { targetId: 'surfdash-pub@post', bundleRunId: 'b387', status: 'ok', url: 'https://old.example/9' },
                { targetId: 'podcast-pub@episode', parentRunId: 'b388', status: 'skipped', url: 'https://x.example/1' },
                { id: 'weibo-pub@article', bundleRunId: 'b388', status: 'failed' },
                { targetId: 'x-pub@post', bundleRunId: 'b388', status: 'ok' },
                { targetId: 'threads-pub@post', bundleRunId: 'b388', status: 'ok', url: 'https://threads.example/1' },
            ],
            { bundleRunId: 'b388' },
        );
        expect(resolution.owner).toEqual({ 'threads-pub@post': 'https://threads.example/1' });
        expect(resolution.ignored).toEqual([
            'surfdash-pub@post',
            'podcast-pub@episode',
            'weibo-pub@article',
            'x-pub@post',
        ]);
    });

    it('uses the stable target id helper the matrix also uses', () => {
        expect(dispatchTargetId({ plugin: 'weibo-pub', operation: 'article' })).toBe('weibo-pub@article');
        expect(dispatchTargetId({ plugin: 'weibo-pub' })).toBe('weibo-pub');
        expect(dispatchTargetId({ plugin: 'weibo-pub', operation: 'article', id: 'pinned' })).toBe('pinned');
    });
});

describe('0388 — the ledger is the durable record', () => {
    it('round-trips through the run’s 4-publish directory and survives a corrupt file', async () => {
        const root = mkdtempSync(join(tmpdir(), 'kk-0388-'));
        try {
            const fs = createNodeFileSystem();
            const ledger = ledgerFor('after-generate');
            const path = await writeDispatchLedger(fs, root, ledger);
            expect(path).toBe(join(root, '4-publish', 'dispatch-ledger.json'));
            expect(await readDispatchLedger(fs, root)).toEqual(ledger);
            expect(await readDispatchLedger(fs, join(root, 'missing'))).toBeNull();
            await Bun.write(path, '{not json');
            expect(await readDispatchLedger(fs, root)).toBeNull();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
