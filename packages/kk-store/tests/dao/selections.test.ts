/**
 * `SelectionsDao` — the topic-scoped dedup ledger that replaces `episode_usage` (task 0225 R6).
 *
 * ## Failure-first list — written before the code
 *
 * 1. `insertMany` duplicates a row on a repeat, or resets a `published`/`dropped` row.
 * 2. `updateStatus` moves a `published` or `dropped` row, ignores the run/topic filter, or ignores
 *    the optional `itemIds`.
 * 3. `listByRun` leaks another run's or another topic's rows, or loses the plan order.
 * 4. An empty input writes a row or throws.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('SelectionsDao', () => {
    it('inserts a row per selection, idempotently on (topic, item, run)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'selections.db');
        const written = await store.selections.insertMany(
            [
                { topic: 'ai-news', itemId: 'i1', runId: 'run-1', storyId: 'i1', rank: 1, status: 'selected' },
                { topic: 'ai-news', itemId: 'i2', runId: 'run-1', storyId: 'i2', rank: 2, status: 'selected' },
            ],
            1_000,
        );
        expect(written).toBe(2);

        // A repeat writes nothing and does not reset a promoted row.
        expect(await store.selections.updateStatus('run-1', 'ai-news', 'published')).toBe(2);
        expect(
            await store.selections.insertMany([
                { topic: 'ai-news', itemId: 'i1', runId: 'run-1', storyId: 'i1', rank: 1, status: 'selected' },
            ]),
        ).toBe(0);

        const rows = await store.selections.listByRun('run-1');
        expect(rows).toHaveLength(2);
        expect(rows.map((row) => row.status)).toEqual(['published', 'published']);
        expect(rows[0]?.publishedAt).not.toBeNull();
        expect(rows[0]?.selectedAt).toBe(1_000);

        // An empty input is a no-op.
        expect(await store.selections.insertMany([])).toBe(0);
    });

    it('lists one run in plan order, optionally narrowed to a topic', async () => {
        const { store } = await openTempStore(makeTempDir(), 'selections-list.db');
        await store.selections.insertMany([
            { topic: 'ai-news', itemId: 'i2', runId: 'run-1', storyId: 'i2', rank: 2 },
            { topic: 'ai-news', itemId: 'i1', runId: 'run-1', storyId: 'i1', rank: 1 },
            { topic: 'ai-research', itemId: 'r1', runId: 'run-1', storyId: 'r1', rank: 1 },
            { topic: 'ai-news', itemId: 'i9', runId: 'run-2', storyId: 'i9', rank: 1 },
        ]);

        expect((await store.selections.listByRun('run-1')).map((row) => row.itemId)).toEqual(['i1', 'i2', 'r1']);
        expect((await store.selections.listByRun('run-1', 'ai-news')).map((row) => row.itemId)).toEqual(['i1', 'i2']);
        expect(await store.selections.listByRun('missing')).toEqual([]);
    });

    it('updates only a run’s selected rows, honoring an item filter', async () => {
        const { store } = await openTempStore(makeTempDir(), 'selections-status.db');
        await store.selections.insertMany([
            { topic: 'ai-news', itemId: 'i1', runId: 'run-1', storyId: 'i1' },
            { topic: 'ai-news', itemId: 'i2', runId: 'run-1', storyId: 'i2' },
            { topic: 'ai-news', itemId: 'i3', runId: 'run-2', storyId: 'i3' },
        ]);

        expect(await store.selections.updateStatus('run-1', 'ai-news', 'published', ['i1'])).toBe(1);
        const rows = await store.selections.listByRun('run-1');
        expect(rows.find((row) => row.itemId === 'i1')?.status).toBe('published');
        expect(rows.find((row) => row.itemId === 'i2')?.status).toBe('selected');
        // Another run is untouched; an empty item filter changes nothing.
        expect((await store.selections.listByRun('run-2'))[0]?.status).toBe('selected');
        expect(await store.selections.updateStatus('run-1', 'ai-news', 'dropped', [])).toBe(0);
    });
});
