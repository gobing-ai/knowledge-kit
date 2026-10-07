import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId, type Store } from '../../src/index';
import type { ProfileQuery } from '../../src/profile';
import { cleanupTempState, DOC_WITH_URL, DOC_WITHOUT_URL, makeTempDir, openTempStore, sha256Hex } from '../helpers';

afterAll(cleanupTempState);

describe('ItemsDao.upsertDocs', () => {
    it('inserts new docs with provenance and returns their ids', async () => {
        const { store } = await openTempStore(makeTempDir(), 'insert.db');
        const result = await store.items.upsertDocs('run-1', [DOC_WITH_URL, DOC_WITHOUT_URL]);

        expect(result).toEqual({
            inserted: 2,
            updated: 0,
            unchanged: 0,
            newIds: [itemId(DOC_WITH_URL), itemId(DOC_WITHOUT_URL)],
        });

        const stored = await store.items.findById(itemId(DOC_WITH_URL));
        expect(stored?.canonicalUrl).toBe('https://example.com/papers/attention');
        expect(stored?.source).toBe('web-search');
        expect(stored?.mediaType).toBe('text/markdown');
        expect(stored?.contentHash).toBe(sha256Hex('Attention Is All You Need\u0000# paper\n\nbody v1'));
        expect(stored?.publishedAt).toBe(Date.parse('2026-10-01T00:00:00Z'));
        expect(stored?.firstSeenRun).toBe('run-1');
        expect(stored?.lastSeenRun).toBe('run-1');
        expect(stored?.firstSeenAt).toBeGreaterThan(0);

        const urlLess = await store.items.findById(itemId(DOC_WITHOUT_URL));
        expect(urlLess?.canonicalUrl).toBeNull();
        expect(urlLess?.source).toBe('');
    });

    it('counts unchanged docs and keeps their first-seen provenance', async () => {
        const { store } = await openTempStore(makeTempDir(), 'unchanged.db');
        const first = await store.items.upsertDocs('run-1', [DOC_WITH_URL, DOC_WITHOUT_URL], 1_000);
        const second = await store.items.upsertDocs('run-2', [DOC_WITH_URL, DOC_WITHOUT_URL], 2_000);

        expect(first.newIds).toHaveLength(2);
        expect(second).toEqual({ inserted: 0, updated: 0, unchanged: 2, newIds: [] });

        const stored = await store.items.findById(itemId(DOC_WITH_URL));
        expect(stored?.firstSeenRun).toBe('run-1');
        expect(stored?.firstSeenAt).toBe(1_000);
        expect(stored?.lastSeenRun).toBe('run-2');
        expect(stored?.updatedAt).toBe(2_000);
    });

    it('treats a changed body as updated and clears that item labels', async () => {
        const { store } = await openTempStore(makeTempDir(), 'update.db');
        const id = itemId(DOC_WITH_URL);
        await store.items.upsertDocs('run-1', [DOC_WITH_URL, DOC_WITHOUT_URL]);
        await store.labels.upsertLabel({
            itemId: id,
            decisionId: 'kk-item-category',
            value: 'ai-research',
            maker: 'fm-local',
            source: 'model',
        });
        await store.labels.upsertLabel({
            itemId: itemId(DOC_WITHOUT_URL),
            decisionId: 'kk-item-category',
            value: 'non-ai',
            maker: 'heuristic',
            source: 'heuristic',
        });

        const edited: Doc = { ...DOC_WITH_URL, body: '# paper\n\nbody v2' };
        const result = await store.items.upsertDocs('run-2', [edited, DOC_WITHOUT_URL]);

        expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 1, newIds: [] });
        expect(await store.labels.listForItem(id)).toEqual([]);
        expect((await store.labels.listForItem(itemId(DOC_WITHOUT_URL))).map((row) => row.value)).toEqual(['non-ai']);
    });

    it('refreshes the canonical URL when the stored one changes', async () => {
        const { store } = await openTempStore(makeTempDir(), 'url-change.db');
        const shared: Doc = { id: 'doc', body: 'body', sourceUri: 'https://example.com/a' };
        await store.items.upsertDocs('run-1', [shared]);
        await store.items.upsertDocs('run-2', [{ ...shared, sourceUri: 'https://example.com/a?utm_source=x#frag' }]);

        const id = sha256Hex('https://example.com/a');
        expect((await store.items.findById(id))?.canonicalUrl).toBe('https://example.com/a');
    });

    it('counts a repeated id once and stores the last occurrence', async () => {
        const { store } = await openTempStore(makeTempDir(), 'dupe.db');
        const shared: Doc = { id: 'dupe', body: 'first', sourceUri: 'https://example.com/dupe' };
        const result = await store.items.upsertDocs('run-1', [shared, { ...shared, id: 'dupe-again', body: 'second' }]);

        const expectedId = sha256Hex('https://example.com/dupe');
        expect(result).toEqual({ inserted: 1, updated: 0, unchanged: 0, newIds: [expectedId] });
        const rows = await store.items.findAll();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.id).toBe(expectedId);
        expect(rows[0]?.body).toBe('second');
    });

    it('is a no-op for an empty batch', async () => {
        const { store } = await openTempStore(makeTempDir(), 'empty.db');
        expect(await store.items.upsertDocs('run-1', [])).toEqual({
            inserted: 0,
            updated: 0,
            unchanged: 0,
            newIds: [],
        });
    });
});

/**
 * Failure-first list for `ItemsDao.selectByProfile` — before the code:
 *
 * 1. A `where` predicate is ignored, so an item outside the category or below the score returns.
 * 2. An item missing a `where` decision's `labels` row leaks into the pool (the join must be inner).
 * 3. An item with `first_seen_at` before `now - windowMs` returns.
 * 4. `--exclude-used` does not exclude: a used item re-enters the pool.
 * 5. `excludeWorkflow` also excludes another workflow's usage (it must match that workflow exactly).
 * 6. `limit` is ignored, so a capped pool is not capped.
 * 7. Order terms are dropped — the decision ordering, the `first_seen_at` ordering and the
 *    `i.id ASC` tiebreak must all hold.
 * 8. A decision named only by `order` drops the item (that join must be a left join).
 * 9. `labels` are missing from the returned row, or a label value is not the stored one.
 * 10. `metadata_json` is not parsed into `metadata`.
 * 11. An empty pool throws instead of returning `[]`.
 */
describe('ItemsDao.selectByProfile', () => {
    /** The four seeded items, keyed by the slug their ids are derived from. */
    const SEED: Record<'newsA' | 'newsB' | 'research' | 'stale', Doc> = {
        newsA: { id: 'news-a', title: 'Item news-a', body: 'body of news-a', sourceUri: 'https://example.com/news-a' },
        newsB: { id: 'news-b', title: 'Item news-b', body: 'body of news-b', sourceUri: 'https://example.com/news-b' },
        research: { id: 'research', title: 'Item research', body: 'body of research', metadata: { source: 'rss' } },
        stale: { id: 'stale', title: 'Item stale', body: 'body of stale', sourceUri: 'https://example.com/stale' },
    };

    /** Seed the four items at distinct first-seen stamps plus their decision labels. */
    async function seed(): Promise<Store> {
        const { store } = await openTempStore(makeTempDir(), 'profile.db');
        await store.items.upsertDocs('run-1', [SEED.stale], 1);
        await store.items.upsertDocs('run-1', [SEED.newsA], 900);
        await store.items.upsertDocs('run-1', [SEED.newsB], 950);
        await store.items.upsertDocs('run-1', [SEED.research], 960);
        const label = (doc: Doc, decisionId: string, value: string) =>
            store.labels.upsertLabel({
                itemId: itemId(doc),
                decisionId,
                value,
                maker: 'heuristic',
                source: 'heuristic',
            });
        for (const [doc, category, quality, urgency] of [
            [SEED.newsA, 'ai-news', '4', '2'],
            [SEED.newsB, 'ai-industry', '3', '5'],
            [SEED.research, 'ai-research', '4', '3'],
            [SEED.stale, 'ai-news', '5', '5'],
        ] as const) {
            await label(doc, 'kk-item-category', category);
            await label(doc, 'kk-item-quality', quality);
            await label(doc, 'kk-item-urgency', urgency);
        }
        return store;
    }

    /** Design §4's ai-news profile, compiled: a 100 ms window ending at 1000, so `stale` falls outside. */
    const AI_NEWS_QUERY: ProfileQuery = {
        where: [
            { decisionId: 'kk-item-category', op: 'in', values: ['ai-news', 'ai-industry'] },
            { decisionId: 'kk-item-quality', op: 'gte', value: 3 },
        ],
        order: [
            { decisionId: 'kk-item-urgency', direction: 'desc' },
            { column: 'first_seen_at', direction: 'desc' },
        ],
        windowMs: 100,
        now: 1_000,
        limit: 20,
    };

    it('selects the labelled pool in order with labels and parsed metadata inlined', async () => {
        const store = await seed();
        const pool = await store.items.selectByProfile(AI_NEWS_QUERY);

        expect(pool.map((item) => item.id)).toEqual([itemId(SEED.newsB), itemId(SEED.newsA)]);
        expect(pool[0]?.title).toBe('Item news-b');
        expect(pool[0]?.sourceUri).toBe('https://example.com/news-b');
        expect(pool[0]?.body).toBe('body of news-b');
        expect(pool[0]?.metadata).toEqual({});
        expect(pool[0]?.labels).toEqual({
            'kk-item-category': 'ai-industry',
            'kk-item-quality': '3',
            'kk-item-urgency': '5',
        });
    });

    it('keeps a url-less item metadata and excludes one missing a where-key label', async () => {
        const store = await seed();
        const research = await store.items.selectByProfile({
            ...AI_NEWS_QUERY,
            where: [{ decisionId: 'kk-item-category', op: 'in', values: ['ai-research'] }],
        });
        expect(research.map((item) => item.metadata)).toEqual([{ source: 'rss' }]);
        expect(research[0]?.sourceUri).toBeNull();

        const missing = await store.items.selectByProfile({
            ...AI_NEWS_QUERY,
            where: [{ decisionId: 'kk-item-importance', op: 'gte', value: 1 }],
        });
        expect(missing).toEqual([]);
    });

    it('excludes an item outside the window', async () => {
        const store = await seed();
        const pool = await store.items.selectByProfile(AI_NEWS_QUERY);
        expect(pool.map((item) => item.id)).not.toContain(itemId(SEED.stale));

        const all = await store.items.selectByProfile({ ...AI_NEWS_QUERY, windowMs: 10_000 });
        expect(all.map((item) => item.id)).toContain(itemId(SEED.stale));
    });

    it('keeps an item whose order-only decision has no label row', async () => {
        const store = await seed();
        const pool = await store.items.selectByProfile({
            ...AI_NEWS_QUERY,
            order: [{ decisionId: 'kk-item-impact', direction: 'asc' }],
        });
        expect(pool).toHaveLength(2);
        expect(pool.map((item) => item.labels['kk-item-impact'])).toEqual([undefined, undefined]);
    });

    it('excludes items the workflow already used, and only that workflow', async () => {
        const store = await seed();
        await store.usage.markUsed({
            itemId: itemId(SEED.newsB),
            workflow: 'kk-daily-ai-voice2',
            runId: 'run-9',
        });

        const excluded = await store.items.selectByProfile({ ...AI_NEWS_QUERY, excludeWorkflow: 'kk-daily-ai-voice2' });
        expect(excluded.map((item) => item.id)).toEqual([itemId(SEED.newsA)]);

        const other = await store.items.selectByProfile({ ...AI_NEWS_QUERY, excludeWorkflow: 'another-workflow' });
        expect(other).toHaveLength(2);
    });

    it('applies the limit and returns [] for an empty pool', async () => {
        const store = await seed();
        expect(await store.items.selectByProfile({ ...AI_NEWS_QUERY, limit: 1 })).toHaveLength(1);
        expect(
            await store.items.selectByProfile({
                ...AI_NEWS_QUERY,
                where: [{ decisionId: 'kk-item-category', op: 'in', values: ['non-ai'] }],
            }),
        ).toEqual([]);
    });
});
