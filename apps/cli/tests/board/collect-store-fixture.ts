/**
 * The shared seeded store for the Collect store-view tests (0307): real DAOs, real rows.
 *
 * It is a TEST fixture, never product code: the reader tests and the route probe both seed the
 * same three items, two runs and three label observations so the expected numbers stay one story.
 */

import type { Doc } from '@gobing-ai/kk-core';
import { itemId, type Store } from '@gobing-ai/kk-store';

/** The ids and stamps a seeded store exposes to the assertions. */
export interface SeededFixture {
    /** The run whose row and items the store views serve. */
    runId: string;
    finishedAt: number;
    /** Items first seen in `runId`. */
    publishedItemId: string;
    selectedItemId: string;
    plainItemId: string;
    publishedUrl: string;
}

/** One item's Doc; every fixture item is http(s)-canonical and `source`-tagged. */
function doc(key: string, source: string): Doc {
    return {
        id: key,
        title: `Fixture ${key}`,
        body: `Body ${key}`,
        sourceUri: `https://example.com/${key}`,
        metadata: { source },
    };
}

/**
 * Seed two run rows and three items: one published, one selected, one never selected. The
 * published item carries a heuristic AND a model observation in `runId` (two observations, one
 * item), the selected item one heuristic row.
 */
export async function collectStoreTestSeeded(store: Store): Promise<SeededFixture> {
    const runId = 'run-2';
    const finishedAt = 1_700_000_000_000;
    await store.collectRuns.start({ runId: 'run-1', startedAt: finishedAt - 10_000 });
    await store.collectRuns.finish('run-1', { status: 'done', finishedAt: finishedAt - 5_000 });
    await store.collectRuns.start({ runId, startedAt: finishedAt });
    await store.collectRuns.finish(runId, {
        status: 'done',
        inserted: 3,
        updated: 1,
        sourceCounts: { rss: 2, hackernews: 1 },
        finishedAt,
    });

    const published = doc('published', 'rss');
    const selected = doc('selected', 'rss');
    const plain = doc('plain', 'hackernews');
    await store.items.upsertDocs(runId, [published, selected, plain]);

    const hashOf = async (key: Doc): Promise<string> => (await store.items.findById(itemId(key)))?.contentHash ?? '';
    for (const [key, source, value] of [
        [published, 'heuristic', 'ai-news'],
        [published, 'model', 'ai-news'],
        [selected, 'heuristic', 'ai-news'],
    ] as const) {
        await store.labels.recordObservation({
            itemId: itemId(key),
            decisionId: 'kk-item-category',
            value,
            maker: source === 'model' ? 'fm-local' : 'heuristic',
            source,
            runId,
            confidence: source === 'model' ? 'HIGH' : null,
            rawConfidence: source === 'model' ? 0.95 : null,
            contentHash: await hashOf(key),
        });
    }
    const base = { runId, storyId: 'story-1', selectedAt: finishedAt };
    await store.selections.insertMany([
        { ...base, topic: 'ai-news', itemId: itemId(published), status: 'selected' },
        { ...base, topic: 'ai-news', itemId: itemId(selected), status: 'selected' },
    ]);
    await store.selections.updateStatus(runId, 'ai-news', 'published', [itemId(published)]);

    return {
        runId,
        finishedAt,
        publishedItemId: itemId(published),
        selectedItemId: itemId(selected),
        plainItemId: itemId(plain),
        publishedUrl: 'https://example.com/published',
    };
}
