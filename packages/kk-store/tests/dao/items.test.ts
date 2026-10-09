/**
 * `ItemsDao` after the v2 cut-over — the content-hash change no longer drops observations (R5),
 * and `selectByProfile` excludes by topic-scoped selections (R6).
 *
 * ## Failure-first list — written before the code
 *
 * 1. A `content_hash` change still deletes the item's `labels` rows, so backtest evidence is
 *    destroyed and an observation loses the hash it was made against (R5).
 * 2. The changed item is not counted `updated`, so the label pass never re-labels it.
 * 3. A stored observation's `content_hash` is overwritten by the item's new hash.
 * 4. Exclusion still reads `episode_usage` (deleted by the cut-over), so extraction throws.
 * 5. Exclusion ignores the topic, excludes a `dropped` selection, or excludes another topic's
 *    published story.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId, type LabelPolicy, type Store, type StoredDoc } from '../../src/index';
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
        // story_id starts as the item's own id until 0227's clustering lands.
        expect(stored?.storyId).toBe(itemId(DOC_WITH_URL));

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

    it('treats a changed body as updated and keeps the item’s past observations (R5)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'update.db');
        const id = itemId(DOC_WITH_URL);
        await store.items.upsertDocs('run-1', [DOC_WITH_URL, DOC_WITHOUT_URL]);
        const originalHash = (await store.items.findById(id))?.contentHash as string;
        await store.labels.recordObservation({
            itemId: id,
            decisionId: 'kk-item-category',
            value: 'ai-research',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-1',
            contentHash: originalHash,
        });
        await store.labels.recordObservation({
            itemId: itemId(DOC_WITHOUT_URL),
            decisionId: 'kk-item-category',
            value: 'non-ai',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'run-1',
        });

        const edited: Doc = { ...DOC_WITH_URL, body: '# paper\n\nbody v2' };
        const result = await store.items.upsertDocs('run-2', [edited, DOC_WITHOUT_URL]);

        expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 1, newIds: [] });
        const kept = await store.labels.listForItem(id);
        expect(kept).toHaveLength(1);
        // The observation keeps the hash it was made against — not the item's new hash.
        expect(kept[0]?.contentHash).toBe(originalHash);
        expect(originalHash).not.toBe((await store.items.findById(id))?.contentHash);
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
 * 4. `excludeTopic` does not exclude: an item already selected for that topic re-enters the pool.
 * 5. `excludeTopic` also excludes another topic's selections (exclusion must be per topic).
 * 6. A `dropped` selection still excludes (released items must re-enter).
 * 7. `limit` is ignored, so a capped pool is not capped.
 * 8. Order terms are dropped — the decision ordering, the `first_seen_at` ordering and the
 *    `i.id ASC` tiebreak must all hold.
 * 9. A decision named only by `order` drops the item (that join must be a left join).
 * 10. `labels` are missing from the returned row, or a label value is not the stored one.
 * 11. `metadata_json` is not parsed into `metadata`.
 * 12. An empty pool throws instead of returning `[]`.
 */
describe('ItemsDao.selectByProfile', () => {
    /** The default labels policy (task 0226 R4): any maker, the keyword heuristic second. */
    const POLICY: LabelPolicy = { priority: ['*', 'heuristic'], decisionPriority: {}, minConfidence: 0.8 };

    /** `selectByProfile` under the default policy — the only policy these profile tests need. */
    const select = (store: Store, query: ProfileQuery): Promise<StoredDoc[]> =>
        store.items.selectByProfile(query, POLICY);

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
        // Every observation must carry the item's CURRENT content hash: `labels_current` joins
        // `items` on it, so a row without one is not eligible (task 0226 R4).
        const label = async (doc: Doc, decisionId: string, value: string) => {
            const item = await store.items.findById(itemId(doc));
            return store.labels.recordObservation({
                itemId: itemId(doc),
                decisionId,
                value,
                maker: 'heuristic',
                source: 'heuristic',
                runId: 'run-1',
                contentHash: item?.contentHash ?? null,
            });
        };
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
        const pool = await select(store, AI_NEWS_QUERY);

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
        const research = await select(store, {
            ...AI_NEWS_QUERY,
            where: [{ decisionId: 'kk-item-category', op: 'in', values: ['ai-research'] }],
        });
        expect(research.map((item) => item.metadata)).toEqual([{ source: 'rss' }]);
        expect(research[0]?.sourceUri).toBeNull();

        const missing = await select(store, {
            ...AI_NEWS_QUERY,
            where: [{ decisionId: 'kk-item-importance', op: 'gte', value: 1 }],
        });
        expect(missing).toEqual([]);
    });

    it('excludes an item outside the window', async () => {
        const store = await seed();
        const pool = await select(store, AI_NEWS_QUERY);
        expect(pool.map((item) => item.id)).not.toContain(itemId(SEED.stale));

        const all = await select(store, { ...AI_NEWS_QUERY, windowMs: 10_000 });
        expect(all.map((item) => item.id)).toContain(itemId(SEED.stale));
    });

    it('keeps an item whose order-only decision has no label row', async () => {
        const store = await seed();
        const pool = await select(store, {
            ...AI_NEWS_QUERY,
            order: [{ decisionId: 'kk-item-impact', direction: 'asc' }],
        });
        expect(pool).toHaveLength(2);
        expect(pool.map((item) => item.labels['kk-item-impact'])).toEqual([undefined, undefined]);
    });

    it('excludes a story selected or published for the topic, per topic, and frees a dropped one', async () => {
        const store = await seed();
        await store.selections.insertMany([
            {
                topic: 'ai-news',
                itemId: itemId(SEED.newsB),
                runId: 'run-9',
                storyId: itemId(SEED.newsB),
                status: 'selected',
            },
        ]);

        const excluded = await select(store, { ...AI_NEWS_QUERY, excludeTopic: 'ai-news' });
        expect(excluded.map((item) => item.id)).toEqual([itemId(SEED.newsA)]);

        // Another topic's window is unaffected by ai-news' selections.
        const otherTopic = await select(store, { ...AI_NEWS_QUERY, excludeTopic: 'ai-research' });
        expect(otherTopic).toHaveLength(2);

        // Releasing the run returns the story to the pool.
        expect(await store.selections.updateStatus('run-9', 'ai-news', 'dropped')).toBe(1);
        const freed = await select(store, { ...AI_NEWS_QUERY, excludeTopic: 'ai-news' });
        expect(freed).toHaveLength(2);

        // A published row is never released (R3).
        await store.selections.insertMany([
            {
                topic: 'ai-news',
                itemId: itemId(SEED.newsB),
                runId: 'run-10',
                storyId: itemId(SEED.newsB),
                status: 'published',
            },
        ]);
        expect(await store.selections.updateStatus('run-10', 'ai-news', 'dropped')).toBe(0);
    });

    it('applies the limit and returns [] for an empty pool', async () => {
        const store = await seed();
        expect(await select(store, { ...AI_NEWS_QUERY, limit: 1 })).toHaveLength(1);
        expect(
            await select(store, {
                ...AI_NEWS_QUERY,
                where: [{ decisionId: 'kk-item-category', op: 'in', values: ['non-ai'] }],
            }),
        ).toEqual([]);
    });
});

/**
 * `selectByProfile` reads `labels_current` only, so the pool follows maker priority, the configured
 * threshold and the item's current content hash (task 0226 R4; AC2).
 *
 * ## Failure-first list — written before the code
 *
 * 1. A stale-hash observation satisfies a `where` predicate for the item it was made against — an
 *    edited item would be pooled on a label its current content no longer supports.
 * 2. A below-threshold `source 'model'` answer is treated as a label, so an untrusted answer admits
 *    (or excludes) an item; with no other row the item must NOT enter the pool at all.
 * 3. Maker priority is ignored, so a model answer cannot outrank the heuristic baseline.
 * 4. The inlined `metadata.labels` disagree with the `where` join, so a pooled item carries a label
 *    the predicate did not match.
 */
describe('ItemsDao.selectByProfile — current labels only (0226 R4)', () => {
    const POLICY: LabelPolicy = { priority: ['*', 'heuristic'], decisionPriority: {}, minConfidence: 0.8 };

    const SEED: Record<'modelWins' | 'belowThreshold' | 'staleHash' | 'modelOnly', Doc> = {
        modelWins: { id: 'cur-model', title: 'Model wins', body: 'body', sourceUri: 'https://example.com/cur-model' },
        belowThreshold: {
            id: 'cur-low',
            title: 'Below threshold',
            body: 'body',
            sourceUri: 'https://example.com/cur-low',
        },
        staleHash: { id: 'cur-stale', title: 'Stale hash', body: 'body', sourceUri: 'https://example.com/cur-stale' },
        modelOnly: { id: 'cur-only', title: 'Model only', body: 'body', sourceUri: 'https://example.com/cur-only' },
    };

    /** One observation, with the item's current hash unless `contentHash` overrides it. */
    async function observe(
        store: Store,
        doc: Doc,
        input: {
            value: string;
            maker: string;
            source: 'heuristic' | 'model' | 'default';
            runId: string;
            rawConfidence?: number | null;
            contentHash?: string;
        },
    ): Promise<void> {
        const item = await store.items.findById(itemId(doc));
        await store.labels.recordObservation({
            itemId: itemId(doc),
            decisionId: 'kk-item-category',
            value: input.value,
            maker: input.maker,
            source: input.source,
            runId: input.runId,
            rawConfidence: input.rawConfidence ?? null,
            contentHash: input.contentHash ?? item?.contentHash ?? null,
        });
    }

    async function seed(): Promise<Store> {
        const { store } = await openTempStore(makeTempDir(), 'profile-current.db');
        await store.items.upsertDocs('run-1', Object.values(SEED));

        // The model answer outranks the heuristic baseline (wildcard position 0 before 'heuristic').
        await observe(store, SEED.modelWins, {
            value: 'non-ai',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'run-1',
        });
        await observe(store, SEED.modelWins, {
            value: 'ai-news',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-2',
            rawConfidence: 0.9,
        });

        // The model answer is real but below the threshold: the heuristic row is what stays current.
        await observe(store, SEED.belowThreshold, {
            value: 'ai-news',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'run-1',
        });
        await observe(store, SEED.belowThreshold, {
            value: 'non-ai',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-2',
            rawConfidence: 0.4,
        });

        // A later observation made against the OLD hash cannot speak for the edited item.
        await observe(store, SEED.staleHash, {
            value: 'non-ai',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'run-1',
        });
        await observe(store, SEED.staleHash, {
            value: 'ai-news',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-2',
            rawConfidence: 0.99,
            contentHash: 'stale-hash',
        });

        // The only answer is below the threshold: the pair has NO current label (fail-closed).
        await observe(store, SEED.modelOnly, {
            value: 'ai-news',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-2',
            rawConfidence: 0.4,
        });
        return store;
    }

    const AI_NEWS: ProfileQuery = {
        where: [{ decisionId: 'kk-item-category', op: 'in', values: ['ai-news'] }],
        order: [{ column: 'first_seen_at', direction: 'desc' }],
        windowMs: 10_000,
        now: Date.now() + 1,
        limit: 20,
    };

    it('pools only the items whose CURRENT label matches, and inlines that same label', async () => {
        const store = await seed();
        const pool = await store.items.selectByProfile(AI_NEWS, POLICY);

        expect(new Set(pool.map((item) => item.id))).toEqual(
            new Set([itemId(SEED.modelWins), itemId(SEED.belowThreshold)]),
        );
        // The model row won on priority: the inlined label is the model's, not the heuristic's.
        const winner = pool.find((item) => item.id === itemId(SEED.modelWins));
        expect(winner?.labels).toEqual({ 'kk-item-category': 'ai-news' });
        // The below-threshold model row lost: the heuristic value is the current label.
        const low = pool.find((item) => item.id === itemId(SEED.belowThreshold));
        expect(low?.labels).toEqual({ 'kk-item-category': 'ai-news' });
    });

    it('drops an item whose only current label is below the threshold or carries a stale hash', async () => {
        const store = await seed();
        const pool = await store.items.selectByProfile(AI_NEWS, POLICY);
        const ids = pool.map((item) => item.id);
        expect(ids).not.toContain(itemId(SEED.modelOnly));
        expect(ids).not.toContain(itemId(SEED.staleHash));

        // Lowering the threshold admits the model-only item — the threshold, not the row, was the gate.
        const admitted = await store.items.selectByProfile(AI_NEWS, { ...POLICY, minConfidence: 0.2 });
        expect(admitted.map((item) => item.id)).toContain(itemId(SEED.modelOnly));
    });

    it('excludes an item whose labels were written by an unlisted maker', async () => {
        const store = await seed();
        const heuristicOnly: LabelPolicy = { priority: ['heuristic'], decisionPriority: {}, minConfidence: 0.8 };
        const pool = await store.items.selectByProfile(AI_NEWS, heuristicOnly);
        // `modelWins` current label is then the heuristic's 'non-ai'; `belowThreshold` keeps its
        // heuristic 'ai-news'.
        expect(pool.map((item) => item.id)).toEqual([itemId(SEED.belowThreshold)]);
    });
});
