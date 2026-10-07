import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import { itemId } from '../../src/index';
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
