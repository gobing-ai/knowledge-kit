import { afterAll, describe, expect, it } from 'bun:test';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('LabelsDao', () => {
    it('replaces a decision answer in place, one row per (item, decision)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels.db');
        await store.labels.upsertLabel(
            { itemId: 'i1', decisionId: 'kk-item-quality', value: '2', score: 2, maker: 'fm-local', source: 'model' },
            1_000,
        );
        await store.labels.upsertLabel(
            { itemId: 'i1', decisionId: 'kk-item-quality', value: '4', score: 4, maker: 'fm-local', source: 'model' },
            2_000,
        );
        await store.labels.upsertLabel({
            itemId: 'i1',
            decisionId: 'kk-item-category',
            value: 'ai-news',
            maker: 'heuristic',
            source: 'default',
        });

        const rows = await store.labels.listForItem('i1');
        expect(rows).toHaveLength(2);
        const quality = rows.find((row) => row.decisionId === 'kk-item-quality');
        expect(quality?.value).toBe('4');
        expect(quality?.score).toBe(4);
        expect(quality?.labeledAt).toBe(2_000);
        const category = rows.find((row) => row.decisionId === 'kk-item-category');
        expect(category?.score).toBeNull();
        expect(category?.source).toBe('default');
        expect(await store.labels.listForItem('other')).toEqual([]);
    });
});
