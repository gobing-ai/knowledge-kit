/**
 * Task 0227 — ingest v2: typed item facts filled on insert/update (R1) and deterministic
 * `story_id` clustering (R2/R3; AC2), plus the `backfill-facts` recompute (R4).
 *
 * ## Failure-first list — written before the code
 *
 *  1. Ingest stores the facts as NULL (or stale), so every dimension score derived from them is
 *     wrong (AC1).
 *  2. The update path does not refresh the facts, so an edited item keeps the old body length.
 *  3. An unchanged item's facts are rewritten from metadata that `content_hash` does not cover,
 *     silently changing a fact without the item being `updated`.
 *  4. Two near-duplicate titles inside the 72 h window do not share a `story_id` (AC2).
 *  5. A title outside the window still merges, or the window boundary is off by one.
 *  6. Duplicate titles inside ONE ingest batch do not cluster (no DB row exists yet).
 *  7. An existing item is re-clustered on update and loses its `story_id`.
 *  8. `backfillFacts` is not idempotent: a second run reports a change.
 *  9. `backfillFacts` clusters by ingest order instead of causal `first_seen_at, id` order.
 * 10. `backfillFacts` reports a row changed when only `story_id` moved to NULL.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { DEFAULT_STORY_POLICY, itemId, type StoryPolicy } from '../../src/index';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

const HOUR_MS = 3_600_000;

/** Reset the v2 columns to their pre-0227 state: NULL facts, `story_id = id` (0225's interim). */
function stagePreV2(dbPath: string): void {
    const db = new Database(dbPath);
    db.run(
        'UPDATE items SET engagement = NULL, body_chars = NULL, source_tier = NULL, lang = NULL, domain = NULL, story_id = id',
    );
    db.close();
}

/** A Doc with a URL-derived id and a controllable title/metadata. */
function doc(overrides: Partial<Doc> & { id: string }): Doc {
    return { body: 'body', title: 'Title', sourceUri: `https://example.com/${overrides.id}`, ...overrides };
}

describe('ItemsDao.upsertDocs — typed facts (0227 R1, AC1)', () => {
    it('fills every fact column on insert', async () => {
        const { store } = await openTempStore(makeTempDir(), 'facts-insert.db');
        const withUrl = doc({
            id: 'a',
            title: 'OpenAI ships a model',
            body: 'hi 🎉',
            sourceUri: 'https://WWW.Example.com/a',
            metadata: { source: 'rss', lang: 'ja', engagement: { points: 12, comments: '30' } },
        });
        const urlLess = doc({ id: 'b', title: '华为发布新模型', body: '正文', sourceUri: undefined });

        await store.items.upsertDocs('run-1', [withUrl, urlLess]);

        const a = await store.items.findById(itemId(withUrl));
        expect(a?.engagement).toBe(30);
        expect(a?.bodyChars).toBe(4);
        expect(a?.sourceTier).toBe('community');
        expect(a?.lang).toBe('ja');
        expect(a?.domain).toBe('example.com');

        const b = await store.items.findById(itemId(urlLess));
        expect(b?.engagement).toBeNull();
        expect(b?.bodyChars).toBe(2);
        expect(b?.sourceTier).toBe('other');
        expect(b?.lang).toBe('zh');
        expect(b?.domain).toBeNull();
    });

    it('recomputes the facts on the update path', async () => {
        const { store } = await openTempStore(makeTempDir(), 'facts-update.db');
        const original = doc({ id: 'a', title: 'Original', body: 'short', metadata: { source: 'reddit' } });
        await store.items.upsertDocs('run-1', [original]);

        const edited = doc({
            id: 'a',
            title: 'Edited title',
            body: 'a much longer body 🎉',
            metadata: { source: 'aihot', engagement: { stars: 7 } },
        });
        const result = await store.items.upsertDocs('run-2', [edited]);

        expect(result).toEqual({ inserted: 0, updated: 1, unchanged: 0, newIds: [] });
        const stored = await store.items.findById(itemId(edited));
        expect(stored?.bodyChars).toBe(20);
        expect(stored?.sourceTier).toBe('curated');
        expect(stored?.engagement).toBe(7);
    });

    it('leaves the facts alone on the unchanged path (R1 fills inserted/updated only)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'facts-unchanged.db');
        const original = doc({ id: 'a', title: 'Same title', body: 'same body', metadata: { source: 'reddit' } });
        await store.items.upsertDocs('run-1', [original]);

        // Same title + body (so the same content hash) but different metadata: still `unchanged`.
        const remeta = { ...original, metadata: { source: 'aihot', engagement: { stars: 9 } } };
        const result = await store.items.upsertDocs('run-2', [remeta]);

        expect(result.unchanged).toBe(1);
        const stored = await store.items.findById(itemId(original));
        expect(stored?.sourceTier).toBe('other');
        expect(stored?.engagement).toBeNull();
    });
});

describe('ItemsDao.upsertDocs — story clustering (0227 R2/R3, AC2)', () => {
    const POLICY: StoryPolicy = DEFAULT_STORY_POLICY;
    const t0 = 1_000_000;

    it('gives one story to near-duplicate titles within 72h', async () => {
        const { store } = await openTempStore(makeTempDir(), 'story-merge.db');
        const first = doc({ id: 'first', title: 'OpenAI ships GPT-5' });
        const second = doc({ id: 'second', title: 'OpenAI ships GPT-5 | The Verge' });
        const third = doc({ id: 'third', title: 'OpenAI ships GPT-5 - Reuters' });

        await store.items.upsertDocs('run-1', [first], t0, POLICY);
        await store.items.upsertDocs('run-2', [second], t0 + HOUR_MS, POLICY);
        await store.items.upsertDocs('run-3', [third], t0 + 71 * HOUR_MS, POLICY);

        const root = itemId(first);
        for (const d of [first, second, third]) {
            expect((await store.items.findById(itemId(d)))?.storyId, d.id).toBe(root);
        }
    });

    it('does not merge across the 72h boundary', async () => {
        const { store } = await openTempStore(makeTempDir(), 'story-window.db');
        const onTime = doc({ id: 'on-time', title: 'OpenAI ships GPT-5' });
        const atBoundary = doc({ id: 'at-boundary', title: 'OpenAI ships GPT-5' });
        // A second, unrelated family: `late` must not reach `stale`, and must not be absorbed by
        // `at-boundary` either (its title is unrelated).
        const stale = doc({ id: 'stale', title: 'Rust 2.0 release notes' });
        const late = doc({ id: 'late', title: 'Rust 2.0 release notes' });

        await store.items.upsertDocs('run-1', [onTime, stale], t0, POLICY);
        // Exactly 72h later: `first_seen_at >= now - window` holds, so it still merges.
        await store.items.upsertDocs('run-2', [atBoundary], t0 + 72 * HOUR_MS, POLICY);
        await store.items.upsertDocs('run-3', [late], t0 + 72 * HOUR_MS + 1, POLICY);

        expect((await store.items.findById(itemId(atBoundary)))?.storyId).toBe(itemId(onTime));
        expect((await store.items.findById(itemId(late)))?.storyId).toBe(itemId(late));
    });

    it('clusters duplicate titles inside one ingest batch', async () => {
        const { store } = await openTempStore(makeTempDir(), 'story-batch.db');
        const first = doc({ id: 'first', title: 'OpenAI ships GPT-5' });
        const second = doc({ id: 'second', title: 'OpenAI ships GPT-5 — TechCrunch' });

        await store.items.upsertDocs('run-1', [first, second], t0, POLICY);

        expect((await store.items.findById(itemId(second)))?.storyId).toBe(itemId(first));
    });

    it('keeps an existing item’s story_id when its content changes', async () => {
        const { store } = await openTempStore(makeTempDir(), 'story-update.db');
        const first = doc({ id: 'first', title: 'OpenAI ships GPT-5' });
        const second = doc({ id: 'second', title: 'OpenAI ships GPT-5 | The Verge' });
        await store.items.upsertDocs('run-1', [first], t0, POLICY);
        await store.items.upsertDocs('run-2', [second], t0 + HOUR_MS, POLICY);

        const edited = doc({ id: 'second', title: 'An entirely rewritten and unrelated headline', body: 'v2' });
        await store.items.upsertDocs('run-3', [edited], t0 + 2 * HOUR_MS, POLICY);

        const stored = await store.items.findById(itemId(second));
        expect(stored?.storyId).toBe(itemId(first));
        expect(stored?.title).toBe('An entirely rewritten and unrelated headline');
    });

    it('gives an unrelated title its own story id', async () => {
        const { store } = await openTempStore(makeTempDir(), 'story-unrelated.db');
        const first = doc({ id: 'first', title: 'OpenAI ships GPT-5' });
        const other = doc({ id: 'other', title: 'Rust 2.0 release notes' });
        await store.items.upsertDocs('run-1', [first, other], t0, POLICY);

        expect((await store.items.findById(itemId(other)))?.storyId).toBe(itemId(other));
    });
});

describe('ItemsDao.backfillFacts (0227 R4)', () => {
    it('recomputes NULL facts and the story ids, then is idempotent', async () => {
        const { store, dbPath } = await openTempStore(makeTempDir(), 'backfill.db');
        const a = doc({
            id: 'a',
            title: 'OpenAI ships GPT-5',
            body: 'body 🎉',
            metadata: { source: 'aihot', engagement: { points: 11 } },
        });
        const b = doc({ id: 'b', title: 'OpenAI ships GPT-5 | The Verge' });
        await store.items.upsertDocs('run-1', [a, b], 5_000);
        stagePreV2(dbPath);

        expect(await store.items.backfillFacts(DEFAULT_STORY_POLICY)).toBe(2);
        const stored = await store.items.findById(itemId(a));
        expect(stored?.bodyChars).toBe(6);
        expect(stored?.storyId).toBe(itemId(a));
        expect((await store.items.findById(itemId(b)))?.storyId).toBe(itemId(a));

        // A second run changes nothing: the facts are pure and the story pass is deterministic.
        expect(await store.items.backfillFacts(DEFAULT_STORY_POLICY)).toBe(0);
    });

    it('clusters causally in first_seen_at, id order', async () => {
        const { store, dbPath } = await openTempStore(makeTempDir(), 'backfill-causal.db');
        // Ingested oldest-last: without a causal pass this would root the story on `first`.
        const first = doc({ id: 'first', title: 'OpenAI ships GPT-5' });
        const middle = doc({ id: 'middle', title: 'OpenAI ships GPT-5 | The Verge' });
        const earliest = doc({ id: 'earliest', title: 'OpenAI ships GPT-5 - Reuters' });
        await store.items.upsertDocs('run-1', [first], 3_000);
        await store.items.upsertDocs('run-2', [middle], 2_000);
        await store.items.upsertDocs('run-3', [earliest], 1_000);
        stagePreV2(dbPath);

        expect(await store.items.backfillFacts(DEFAULT_STORY_POLICY)).toBe(3);
        const root = itemId(earliest);
        for (const d of [earliest, middle, first]) {
            expect((await store.items.findById(itemId(d)))?.storyId, d.id).toBe(root);
        }
        expect(await store.items.backfillFacts(DEFAULT_STORY_POLICY)).toBe(0);
    });

    it('does not cluster across the window in the causal pass', async () => {
        const { store, dbPath } = await openTempStore(makeTempDir(), 'backfill-window.db');
        const old = doc({ id: 'old', title: 'OpenAI ships GPT-5' });
        const recent = doc({ id: 'recent', title: 'OpenAI ships GPT-5' });
        await store.items.upsertDocs('run-1', [old], 1_000);
        await store.items.upsertDocs('run-2', [recent], 1_000 + 72 * HOUR_MS + 1);
        stagePreV2(dbPath);

        await store.items.backfillFacts(DEFAULT_STORY_POLICY);
        expect((await store.items.findById(itemId(old)))?.storyId).toBe(itemId(old));
        expect((await store.items.findById(itemId(recent)))?.storyId).toBe(itemId(recent));
    });

    it('is a no-op on an empty store', async () => {
        const { store } = await openTempStore(makeTempDir(), 'backfill-empty.db');
        expect(await store.items.backfillFacts(DEFAULT_STORY_POLICY)).toBe(0);
    });
});
