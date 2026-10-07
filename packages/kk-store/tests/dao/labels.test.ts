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

    it('stores the decision confidence and the collect run id (0209 R4)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-confidence.db');
        const stored = await store.labels.upsertLabel({
            itemId: 'i1',
            decisionId: 'kk-item-quality',
            value: '4',
            score: 4,
            confidence: 0.95,
            runId: '2026-10-07T13:00',
            maker: 'fm-local',
            source: 'model',
        });
        expect(stored.confidence).toBe(0.95);
        expect(stored.runId).toBe('2026-10-07T13:00');

        // A heuristic row has neither a confidence nor a model answer, but still carries the run.
        const heuristic = await store.labels.upsertLabel({
            itemId: 'i1',
            decisionId: 'kk-item-category',
            value: 'ai-news',
            maker: 'heuristic',
            source: 'heuristic',
            runId: '2026-10-07T13:00',
        });
        expect(heuristic.confidence).toBeNull();
        expect(heuristic.runId).toBe('2026-10-07T13:00');

        const rows = await store.labels.listForItem('i1');
        expect(rows.find((row) => row.decisionId === 'kk-item-quality')?.confidence).toBe(0.95);
        expect(rows.find((row) => row.decisionId === 'kk-item-category')?.runId).toBe('2026-10-07T13:00');
    });
});
