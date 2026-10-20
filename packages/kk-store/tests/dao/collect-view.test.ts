/**
 * `CollectViewDao` — the read-only aggregates behind the Board reader's Collect store views
 * (G81, task 0307 R3/R5).
 *
 * ## Failure-first list — written before the code
 *
 * 1. A run with no `collect_runs` row is served as a zero row instead of absent (fabricated data).
 * 2. `labelRows` counts distinct items, or `labeledItems` counts observations — the funnel units blur.
 * 3. Yield double-counts an item that was selected and then published, or counts an item first seen
 *    in another run.
 * 4. `lastStoredAt` reports the newest `started_at`, or a stamp that is not RFC 3339.
 * 5. `labelQuality` loses rows with no confidence level, or merges decisions.
 * 6. `itemsPage` returns items of other runs, ignores a filter, or orders pages non-deterministically.
 * 7. The `decision`+`value` filter matches a STALE observation (other content hash) or a degraded
 *    `default` row instead of the current label.
 * 8. `itemSources` returns duplicates or an empty source.
 * 9. `unknownMigrationIds` reports a known journal, or misses a foreign one.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import {
    COLLECT_VIEW_PAGE_SIZE,
    type CollectViewDao,
    itemId,
    type LabelPolicy,
    openStore,
    type Store,
} from '../../src/index';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

const POLICY: LabelPolicy = { priority: ['*', 'heuristic'], decisionPriority: {}, minConfidence: 0.8 };

/** A Doc with a source and a URL, so `items.source` and `canonical_url` are populated. */
function doc(key: string, source: string): Doc {
    return {
        id: key,
        title: `Title ${key}`,
        body: `Body ${key}`,
        sourceUri: `https://example.com/${key}`,
        metadata: { source },
    };
}

/** Seed one item and return its id plus the content hash a current label must carry. */
async function seedItem(store: Store, runId: string, item: Doc): Promise<{ id: string; hash: string }> {
    const id = itemId(item);
    await store.items.upsertDocs(runId, [item]);
    const row = await store.items.findById(id);
    return { id, hash: row?.contentHash ?? '' };
}

/** Record one current-eligible observation for an item. */
async function label(
    store: Store,
    item: { id: string; hash: string },
    input: {
        runId: string;
        value: string;
        source?: 'model' | 'heuristic' | 'default';
        confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
        decisionId?: string;
        maker?: string;
    },
): Promise<void> {
    await store.labels.recordObservation({
        itemId: item.id,
        decisionId: input.decisionId ?? 'kk-item-category',
        value: input.value,
        maker: input.maker ?? (input.source === 'model' ? 'fm-local' : (input.source ?? 'heuristic')),
        source: input.source ?? 'heuristic',
        runId: input.runId,
        confidence: input.confidence ?? null,
        // A `model` row is only current above `minConfidence`: the real label pass records the
        // numeric payload, so the fixture does too.
        rawConfidence: (input.source ?? 'heuristic') === 'model' ? 0.95 : null,
        contentHash: item.hash,
    });
}

describe('CollectViewDao.runRows', () => {
    it('has no row for a run that never reached store (no fabricated zero)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-empty.db');
        await store.collectRuns.start({ runId: 'run-1' });
        const rows = await store.collectView.runRows(['run-1', 'run-2']);
        expect(rows.map((row) => row.runId)).toEqual(['run-1']);
    });

    it('aggregates the stored row, observation counts and per-source label rows', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-rows.db');
        const a = await seedItem(store, 'run-1', doc('a', 'rss'));
        const b = await seedItem(store, 'run-1', doc('b', 'hackernews'));
        await store.collectRuns.start({ runId: 'run-1', startedAt: 1_000 });
        await store.collectRuns.finish('run-1', {
            status: 'done',
            inserted: 2,
            updated: 3,
            sourceCounts: { rss: 1, hackernews: 1 },
            finishedAt: 2_000,
        });
        await label(store, a, { runId: 'run-1', value: 'ai-news', source: 'heuristic' });
        await label(store, a, { runId: 'run-1', value: 'ai-news', source: 'model', confidence: 'HIGH' });
        await label(store, b, { runId: 'run-1', value: 'ai-news', source: 'heuristic', decisionId: 'kk-item-quality' });

        const [row] = await store.collectView.runRows(['run-1']);
        expect(row?.runId).toBe('run-1');
        expect(row?.inserted).toBe(2);
        expect(row?.updated).toBe(3);
        expect(JSON.parse(row?.sourceCountsJson ?? '')).toEqual({ rss: 1, hackernews: 1 });
        // Observations (3) and distinct items (2) are different units.
        expect(row?.labelRows).toBe(3);
        expect(row?.labeledItems).toBe(2);
        expect(row?.labelRowsBySource).toEqual({ heuristic: 2, model: 1 });
        expect(row?.yield).toEqual({ selected: 0, published: 0, dropped: 0 });
    });

    it('counts distinct labelled ITEMS per run, never per (run, source) (0307 P2)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-labeled-items.db');
        const heuristicOnly = await seedItem(store, 'run-1', doc('h', 'rss'));
        const modelOnly = await seedItem(store, 'run-1', doc('m', 'rss'));
        await store.collectRuns.start({ runId: 'run-1' });
        await store.collectRuns.finish('run-1', { status: 'done' });
        // One item per source: taking the max of the per-source distinct counts would say 1.
        await label(store, heuristicOnly, { runId: 'run-1', value: 'ai-news', source: 'heuristic' });
        await label(store, modelOnly, { runId: 'run-1', value: 'ai-news', source: 'model', confidence: 'HIGH' });

        const [row] = await store.collectView.runRows(['run-1']);
        expect(row?.labelRows).toBe(2);
        expect(row?.labeledItems).toBe(2);
        expect(row?.labelRowsBySource).toEqual({ heuristic: 1, model: 1 });
    });

    it('counts yield by the strongest status of items FIRST seen in the run', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-yield.db');
        const fresh = await seedItem(store, 'run-2', doc('fresh', 'rss'));
        const older = await seedItem(store, 'run-1', doc('older', 'rss'));
        await store.collectRuns.start({ runId: 'run-1' });
        await store.collectRuns.finish('run-1', { status: 'done' });
        await store.collectRuns.start({ runId: 'run-2' });
        await store.collectRuns.finish('run-2', { status: 'done' });
        const base = { runId: 'run-2', storyId: 's-1', selectedAt: 1_000 };
        // The same item selected then PROMOTED is one published item, never one of each.
        await store.selections.insertMany([
            { ...base, topic: 'ai-news', itemId: fresh.id, status: 'selected' },
            { ...base, topic: 'other', itemId: older.id, status: 'selected' },
        ]);
        await store.selections.updateStatus('run-2', 'ai-news', 'published');
        await store.selections.updateStatus('run-2', 'other', 'dropped');

        const rows = await store.collectView.runRows(['run-1', 'run-2']);
        const newer = rows.find((row) => row.runId === 'run-2');
        const first = rows.find((row) => row.runId === 'run-1');
        expect(newer?.yield).toEqual({ selected: 0, published: 1, dropped: 0 });
        // The older item is dropped, but it was not FIRST seen in run-1's yield population… it was.
        expect(first?.yield).toEqual({ selected: 0, published: 0, dropped: 1 });
    });
});

describe('CollectViewDao.lastStoredAt', () => {
    it('is null with no store row, and the newest finished_at as RFC 3339 otherwise', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-last.db');
        expect(await store.collectView.lastStoredAt()).toBeNull();
        for (const [runId, finishedAt] of [
            ['run-1', 1_000],
            ['run-2', 9_000],
        ] as const) {
            await store.collectRuns.start({ runId, startedAt: finishedAt });
            await store.collectRuns.finish(runId, { status: 'done', finishedAt });
        }
        expect(await store.collectView.lastStoredAt()).toBe(new Date(9_000).toISOString());
    });
});

describe('CollectViewDao.labelQuality', () => {
    it('groups one run’s rows by value and confidence, keeping rows with no level', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-quality.db');
        const a = await seedItem(store, 'run-1', doc('a', 'rss'));
        await label(store, a, { runId: 'run-1', value: 'ai-news', source: 'model', confidence: 'HIGH' });
        await label(store, a, { runId: 'run-1', value: 'ai-news', source: 'heuristic', confidence: null });
        await label(store, a, {
            runId: 'run-1',
            value: 'other',
            source: 'model',
            confidence: 'MEDIUM',
            maker: 'fm-alt',
        });
        await label(store, a, {
            runId: 'run-1',
            value: '2',
            source: 'model',
            confidence: 'LOW',
            decisionId: 'kk-item-quality',
        });
        await label(store, a, { runId: 'run-other', value: 'ai-news', source: 'model', confidence: 'LOW' });

        const quality = await store.collectView.labelQuality('run-1');
        expect(quality.map((entry) => entry.decisionId)).toEqual(['kk-item-category', 'kk-item-quality']);
        expect(quality[0]?.run).toEqual([
            { value: 'ai-news', HIGH: 1, MEDIUM: 0, LOW: 0, none: 1 },
            { value: 'other', HIGH: 0, MEDIUM: 1, LOW: 0, none: 0 },
        ]);
        expect(quality[1]?.run).toEqual([{ value: '2', HIGH: 0, MEDIUM: 0, LOW: 1, none: 0 }]);
    });

    it('lists the distinct items labelled in the run', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-labeled.db');
        const a = await seedItem(store, 'run-1', doc('a', 'rss'));
        const b = await seedItem(store, 'run-1', doc('b', 'rss'));
        await label(store, a, { runId: 'run-1', value: 'ai-news' });
        await label(store, a, { runId: 'run-1', value: 'ai-news', decisionId: 'kk-item-quality' });
        await label(store, b, { runId: 'run-1', value: 'ai-news' });
        await label(store, b, { runId: 'run-2', value: 'ai-news' });

        expect(await store.collectView.labeledItemIds('run-1')).toEqual([a.id, b.id].sort());
    });
});

describe('CollectViewDao.itemSources', () => {
    it('returns the distinct non-empty item sources in order', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-sources.db');
        await seedItem(store, 'run-1', doc('a', 'rss'));
        await seedItem(store, 'run-1', doc('b', 'rss'));
        await seedItem(store, 'run-1', doc('c', 'aihot'));
        expect(await store.collectView.itemSources()).toEqual(['aihot', 'rss']);
    });
});

describe('CollectViewDao.itemsPage', () => {
    /** 30 items first seen in `run-1`, one of them re-seen in `run-2`. */
    async function seedMany(store: Store): Promise<{ reSeen: string; published: string }> {
        const docs = Array.from({ length: COLLECT_VIEW_PAGE_SIZE + 5 }, (_, index) =>
            doc(`item-${String(index).padStart(2, '0')}`, index % 2 === 0 ? 'rss' : 'hackernews'),
        );
        await store.items.upsertDocs('run-1', docs);
        const first = itemId(docs[0] as Doc);
        const second = itemId(docs[1] as Doc);
        await store.items.upsertDocs('run-2', [docs[0] as Doc]);
        const seeded = await store.items.findById(first);
        await label(
            store,
            { id: first, hash: seeded?.contentHash ?? '' },
            {
                runId: 'run-1',
                value: 'ai-news',
                source: 'model',
                confidence: 'HIGH',
            },
        );
        await store.selections.insertMany([
            { topic: 'ai-news', itemId: first, runId: 'run-2', storyId: first, status: 'published', selectedAt: 1 },
            { topic: 'ai-news', itemId: second, runId: 'run-2', storyId: second, status: 'selected', selectedAt: 1 },
        ]);
        return { reSeen: first, published: first };
    }

    it('pages 25 at a time and marks re-seen items as such', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-items-page.db');
        const { reSeen } = await seedMany(store);

        const page1 = await store.collectView.itemsPage('run-1', {}, 1, POLICY);
        expect(page1.total).toBe(COLLECT_VIEW_PAGE_SIZE + 5);
        expect(page1.items).toHaveLength(COLLECT_VIEW_PAGE_SIZE);
        const page2 = await store.collectView.itemsPage('run-1', {}, 2, POLICY);
        expect(page2.items).toHaveLength(5);
        expect(new Set([...page1.items, ...page2.items].map((item) => item.id)).size).toBe(page1.total);

        const all = await store.collectView.itemsPage('run-2', {}, 1, POLICY);
        expect(all.total).toBe(1);
        expect(all.items[0]?.id).toBe(reSeen);
        expect(all.items[0]?.seen).toBe('reseen');
        // Its own current label came along, and the selection status is the strongest one.
        expect(all.items[0]?.labels).toEqual({ 'kk-item-category': 'ai-news' });
        expect(all.items[0]?.selection).toBe('published');
    });

    it('filters by source, seen, selection and the item’s CURRENT label', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-items-filter.db');
        const { reSeen } = await seedMany(store);

        const rss = await store.collectView.itemsPage('run-1', { source: 'rss' }, 1, POLICY);
        expect(rss.total).toBe(15);
        expect(rss.items.every((item) => item.source === 'rss')).toBe(true);

        const fresh = await store.collectView.itemsPage('run-2', { seen: 'new' }, 1, POLICY);
        expect(fresh.total).toBe(0);
        const reseen = await store.collectView.itemsPage('run-2', { seen: 'reseen' }, 1, POLICY);
        expect(reseen.items.map((item) => item.id)).toEqual([reSeen]);
        // For run-1 the item is still `new`: its first sighting was run-1's.
        const firstRunNew = await store.collectView.itemsPage('run-1', { seen: 'new' }, 1, POLICY);
        expect(firstRunNew.items.some((item) => item.id === reSeen)).toBe(true);

        const none = await store.collectView.itemsPage('run-1', { selection: 'none' }, 1, POLICY);
        expect(none.total).toBe(COLLECT_VIEW_PAGE_SIZE + 3);
        const published = await store.collectView.itemsPage('run-1', { selection: 'published' }, 1, POLICY);
        expect(published.items.map((item) => item.id)).toEqual([reSeen]);

        const labelled = await store.collectView.itemsPage(
            'run-1',
            { decision: 'kk-item-category', value: 'ai-news' },
            1,
            POLICY,
        );
        expect(labelled.items.map((item) => item.id)).toEqual([reSeen]);
        const unmatched = await store.collectView.itemsPage(
            'run-1',
            { decision: 'kk-item-category', value: 'sports' },
            1,
            POLICY,
        );
        expect(unmatched.total).toBe(0);
    });

    it('never matches a stale observation or a degraded default row', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-items-current.db');
        const seeded = await seedItem(store, 'run-1', doc('stale', 'rss'));
        // A stale observation carrying an older content hash, and a `default` row on the current one.
        await store.labels.recordObservation({
            itemId: seeded.id,
            decisionId: 'kk-item-category',
            value: 'ai-news',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-1',
            confidence: 'HIGH',
            contentHash: 'stale-hash',
        });
        await label(store, seeded, { runId: 'run-1', value: 'ai-news', source: 'default' });

        const matched = await store.collectView.itemsPage(
            'run-1',
            { decision: 'kk-item-category', value: 'ai-news' },
            1,
            POLICY,
        );
        expect(matched.total).toBe(0);
        // Without a filter the item is still listed; its effective labels are simply empty.
        const all = await store.collectView.itemsPage('run-1', {}, 1, POLICY);
        expect(all.items[0]?.labels).toEqual({});
    });
});

describe('CollectViewDao.unknownMigrationIds', () => {
    it('is empty for the store this build just migrated', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-journal.db');
        expect(await store.collectView.unknownMigrationIds()).toEqual([]);
    });

    it('reports a journal id this build does not know', async () => {
        const { dbPath } = await openTempStore(makeTempDir(), 'cv-journal-newer.db');
        const raw = new Database(dbPath);
        raw.run('INSERT INTO "__kk_store_migrations" (id, applied_at) VALUES (?, ?)', ['9999_from_the_future', 1]);
        raw.close();
        // `migrate: false` — the guard is what a read-only open deliberately skips.
        const store = await openStore({ path: dbPath, migrate: false });
        try {
            expect(await store.collectView.unknownMigrationIds()).toEqual(['9999_from_the_future']);
        } finally {
            await store.close();
        }
    });
});

describe('CollectViewDao.selectionsPage and selectionTopics', () => {
    it('returns empty topics and selections when no selections exist', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-selections-empty.db');
        expect(await store.collectView.selectionTopics()).toEqual([]);
        const page = await store.collectView.selectionsPage();
        expect(page.total).toBe(0);
        expect(page.selections).toEqual([]);
        expect(page.topics).toEqual([]);
    });

    it('pages and filters selections joined with items', async () => {
        const { store } = await openTempStore(makeTempDir(), 'cv-selections.db');
        const item1 = await seedItem(store, 'run-1', doc('1', 'tech'));
        const item2 = await seedItem(store, 'run-1', doc('2', 'ai'));
        await store.selections.insertMany([
            {
                topic: 'tech',
                itemId: item1.id,
                runId: 'run-1',
                storyId: item1.id,
                status: 'published',
                rank: 1,
                reason: 'Top story',
                selectedAt: 1000,
            },
            {
                topic: 'ai',
                itemId: item2.id,
                runId: 'run-1',
                storyId: item2.id,
                status: 'selected',
                rank: 2,
                reason: 'Interesting',
                selectedAt: 2000,
            },
        ]);

        const topics = await store.collectView.selectionTopics();
        expect(topics).toEqual(['ai', 'tech']);

        const all = await store.collectView.selectionsPage();
        expect(all.total).toBe(2);
        expect(all.selections[0]?.title).toBe('Title 2');
        expect(all.selections[0]?.topic).toBe('ai');

        const filtered = await store.collectView.selectionsPage({ topic: 'tech' });
        expect(filtered.total).toBe(1);
        expect(filtered.selections[0]?.title).toBe('Title 1');
        expect(filtered.selections[0]?.status).toBe('published');

        const searched = await store.collectView.selectionsPage({ search: 'Title 2' });
        expect(searched.total).toBe(1);
        expect(searched.selections[0]?.itemId).toBe(item2.id);
    });
});

/** Compile-time proof the DAO type is exported under the frozen name. */
const _daoType: CollectViewDao | null = null;
void _daoType;
