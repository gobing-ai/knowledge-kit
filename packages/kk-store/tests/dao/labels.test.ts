import { afterAll, describe, expect, it } from 'bun:test';
import { LABEL_CONFIDENCE_LEVELS, labelConfidence, verdictConfidence } from '../../src/dao/labels';
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

    it('stores the verdict confidence level and the collect run id (0209 R4, G31 R14)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-confidence.db');
        const stored = await store.labels.upsertLabel({
            itemId: 'i1',
            decisionId: 'kk-item-quality',
            value: '4',
            score: 4,
            confidence: 'HIGH',
            runId: '2026-10-07T13:00',
            maker: 'fm-local',
            source: 'model',
        });
        // The level round-trips through the `labels.confidence` column as stored — the enum is text,
        // not the model's raw 0–1 payload.
        expect(stored.confidence).toBe('HIGH');
        expect(stored.runId).toBe('2026-10-07T13:00');

        // A row written outside the label pass carries no level; a consumer must refuse it rather
        // than read it as a pass.
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
        expect(rows.find((row) => row.decisionId === 'kk-item-quality')?.confidence).toBe('HIGH');
        expect(rows.find((row) => row.decisionId === 'kk-item-category')?.runId).toBe('2026-10-07T13:00');
    });

    it('derives one level per verdict and reports the weakest one as the pass level (G31 R14)', () => {
        // The boundary contract: the model's 0–1 payload maps into the closed enum here, and only a
        // model answer can earn more than LOW.
        expect(labelConfidence('model', 0.95)).toBe('HIGH');
        expect(labelConfidence('model', 0.8)).toBe('HIGH');
        expect(labelConfidence('model', 0.6)).toBe('MEDIUM');
        expect(labelConfidence('model', 0.5)).toBe('MEDIUM');
        expect(labelConfidence('model', 0.3)).toBe('LOW');
        // A model answer with no numeric payload, the keyword heuristic, and a degraded default all
        // land on LOW — never on a level nothing evidences, and never on `null`.
        expect(labelConfidence('model', null)).toBe('LOW');
        expect(labelConfidence('heuristic', null)).toBe('LOW');
        expect(labelConfidence('default', null)).toBe('LOW');

        expect(verdictConfidence(['HIGH', 'HIGH'])).toBe('HIGH');
        expect(verdictConfidence(['HIGH', 'MEDIUM'])).toBe('MEDIUM');
        expect(verdictConfidence(['HIGH', 'LOW'])).toBe('LOW');
        expect(verdictConfidence(['MEDIUM', 'LOW'])).toBe('LOW');
        expect(verdictConfidence([])).toBe('LOW');
        // Every derivation lands inside the enum — the vocabulary is closed.
        for (const source of ['model', 'heuristic', 'default'] as const) {
            for (const confidence of [0, 0.49, 0.5, 0.79, 0.8, 1, null]) {
                expect([...LABEL_CONFIDENCE_LEVELS]).toContain(labelConfidence(source, confidence));
            }
        }
    });
});
