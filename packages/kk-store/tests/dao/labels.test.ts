/**
 * `LabelsDao` v2 — observations, not one verdict per (item, decision) (task 0225 R4).
 *
 * ## Failure-first list — written before the code
 *
 * 1. A second maker's observation overwrites the first — the identity is not the 4 columns — so
 *    cross-maker evidence is lost (AC2).
 * 2. The same (item, decision, maker, run) repeated inserts a duplicate row instead of updating in
 *    place.
 * 3. The same maker in a later run supersedes the earlier observation instead of adding a row.
 * 4. The raw evidence (`rawValue`, `rawConfidence`, `reason`, `durationMs`, `catalogVersion`,
 *    `contentHash`) is dropped at the write, or an observation stores the wrong item hash.
 * 5. `observations` ignores a filter or over-applies it (decisionId / maker / runId / since).
 * 6. A `null` `run_id` is accepted, so a later `labels_current` read cannot identify the run.
 * 7. The enum `confidence` derivation changes (G31 R14 must be untouched).
 * 8. An out-of-range or non-finite model payload (a percent-style `50`, `1.5`, `Infinity`) mints
 *    `HIGH`/`MEDIUM` where the 0–1 domain says the payload is unreadable evidence (G31 R14).
 */

import { afterAll, describe, expect, it } from 'bun:test';
import type { Doc } from '@gobing-ai/kk-core';
import {
    LABEL_CONFIDENCE_LEVELS,
    type LabelPolicy,
    type LabelSource,
    labelConfidence,
    labelsCurrentSql,
    verdictConfidence,
} from '../../src/dao/labels';
import { itemId, type Store } from '../../src/index';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('LabelsDao', () => {
    it('updates one maker’s answer in place for the same (item, decision, maker, run)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels.db');
        const input = {
            itemId: 'i1',
            decisionId: 'kk-item-quality',
            maker: 'fm-local',
            source: 'model' as const,
            runId: 'run-1',
        };
        await store.labels.recordObservation({ ...input, value: '2', score: 2 }, 1_000);
        const stored = await store.labels.recordObservation({ ...input, value: '4', score: 4 }, 2_000);

        const rows = await store.labels.listForItem('i1');
        expect(rows).toHaveLength(1);
        expect(stored.value).toBe('4');
        expect(stored.score).toBe(4);
        expect(stored.labeledAt).toBe(2_000);
        // The row identity is written once: no duplicate row appeared for the repeat.
        expect(stored.maker).toBe('fm-local');
        expect(stored.runId).toBe('run-1');
    });

    it('keeps observations from different makers on one item, and adds a row per run (AC2)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-makers.db');
        const base = { itemId: 'i1', decisionId: 'kk-item-category', value: 'ai-news', source: 'heuristic' as const };
        await store.labels.recordObservation({ ...base, maker: 'heuristic', runId: 'run-1' }, 1_000);
        await store.labels.recordObservation({ ...base, maker: 'fm-local', runId: 'run-1' }, 1_100);
        // The same maker in a later run is a third observation, not an overwrite of the first.
        await store.labels.recordObservation(
            { ...base, value: 'ai-industry', maker: 'heuristic', runId: 'run-2' },
            1_200,
        );

        const rows = await store.labels.listForItem('i1');
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => `${row.maker}:${row.runId}`).sort()).toEqual([
            'fm-local:run-1',
            'heuristic:run-1',
            'heuristic:run-2',
        ]);
        const firstHeuristic = rows.find((row) => row.maker === 'heuristic' && row.runId === 'run-1');
        expect(firstHeuristic?.value).toBe('ai-news');
        expect(await store.labels.listForItem('other')).toEqual([]);
    });

    it('stores the raw evidence, the item hash and the verdict level', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-raw.db');
        const stored = await store.labels.recordObservation({
            itemId: 'i1',
            decisionId: 'kk-item-quality',
            value: '4',
            score: 4,
            confidence: 'HIGH',
            rawValue: '0.87',
            rawConfidence: 0.87,
            reason: 'explicit benchmark result',
            durationMs: 1_234,
            catalogVersion: '1',
            contentHash: 'hash-1',
            maker: 'fm-local',
            source: 'model',
            runId: 'run-1',
        });

        expect(stored.rawValue).toBe('0.87');
        expect(stored.rawConfidence).toBe(0.87);
        expect(stored.reason).toBe('explicit benchmark result');
        expect(stored.durationMs).toBe(1_234);
        expect(stored.catalogVersion).toBe('1');
        expect(stored.contentHash).toBe('hash-1');
        // The enum level round-trips as stored text, not the raw 0–1 payload.
        expect(stored.confidence).toBe('HIGH');

        // A row written outside the label pass carries no level; a consumer must refuse it.
        const heuristic = await store.labels.recordObservation({
            itemId: 'i1',
            decisionId: 'kk-item-category',
            value: 'ai-news',
            maker: 'heuristic',
            source: 'heuristic',
            runId: 'run-1',
        });
        expect(heuristic.confidence).toBeNull();
        expect(heuristic.rawConfidence).toBeNull();
    });

    it('stores every closed HIGH | MEDIUM | LOW level verbatim (G31 R14)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-levels.db');
        for (const level of LABEL_CONFIDENCE_LEVELS) {
            const row = await store.labels.recordObservation({
                itemId: 'i1',
                decisionId: 'kk-item-quality',
                value: '4',
                score: 4,
                confidence: level,
                maker: 'fm-local',
                source: 'model',
                runId: `run-${level}`,
            });
            // The level round-trips as the enum text — never the raw 0–1 payload, never a coerced
            // number, and never a level outside the closed vocabulary.
            expect(row.confidence).toBe(level);
        }

        const rows = await store.labels.listForItem('i1');
        expect(rows).toHaveLength(LABEL_CONFIDENCE_LEVELS.length);
        expect(new Set(rows.map((row) => row.confidence))).toEqual(new Set(LABEL_CONFIDENCE_LEVELS));
    });

    it('filters observations by decision, maker, run and since', async () => {
        const { store } = await openTempStore(makeTempDir(), 'labels-filter.db');
        const obs = (decisionId: string, maker: string, runId: string, labeledAt: number) =>
            store.labels.recordObservation(
                { itemId: 'i1', decisionId, value: 'v', maker, source: 'heuristic', runId },
                labeledAt,
            );
        await obs('kk-item-category', 'heuristic', 'run-1', 1_000);
        await obs('kk-item-category', 'fm-local', 'run-1', 1_100);
        await obs('kk-item-quality', 'heuristic', 'run-2', 1_200);

        expect((await store.labels.observations()).length).toBe(3);
        expect((await store.labels.observations({ decisionId: 'kk-item-category' })).map((r) => r.maker)).toEqual([
            'fm-local',
            'heuristic',
        ]);
        expect((await store.labels.observations({ maker: 'heuristic' })).map((r) => r.decisionId)).toEqual([
            'kk-item-category',
            'kk-item-quality',
        ]);
        expect((await store.labels.observations({ runId: 'run-1' })).length).toBe(2);
        expect((await store.labels.observations({ since: 1_150 })).map((r) => r.runId)).toEqual(['run-2']);
        expect(await store.labels.observations({ decisionId: 'kk-item-quality', maker: 'fm-local' })).toEqual([]);
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
        // The payload is the JSON of `spur decision run` cast to `number | null`, so its domain is
        // not enforced upstream: anything outside the documented 0–1 range — or non-finite — is
        // unreadable evidence and fails closed, exactly like a payload that carried no number.
        // Spur's own `confidenceLevel` banding reads the same inputs as LOW.
        for (const unreadable of [50, 1.5, 1.0000001, Infinity, -Infinity, -1, NaN]) {
            expect(labelConfidence('model', unreadable), `payload=${String(unreadable)}`).toBe('LOW');
        }

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

/**
 * `labels_current` — the R4 read every production consumer uses (task 0226).
 *
 * ## Failure-first list — written before the code
 *
 * 1. An unlisted maker is ranked last instead of EXCLUDED, so it wins wherever no listed maker has a
 *    row (a replay maker on a model-only decision is exactly this case).
 * 2. A tie on `labeled_at` picks the smaller `run_id`; the tiebreak must be the greatest one.
 * 3. An observation made against a stale `content_hash` is still current for the edited item.
 * 4. A below-threshold `source 'model'` row becomes current — and with no other row the pair has NO
 *    current label at all (fail-closed), which is what keeps extraction from trusting it.
 * 5. An empty priority list admits every maker instead of none.
 * 6. A degraded `source 'default'` row becomes the current label.
 * 7. `'*'` admits a `replay-*` row, so a replay displaces production selection.
 * 8. A `store.labels.decisions.<id>.priority` override is ignored, so the global list decides.
 * 9. The bind parameters are out of order relative to the `?` placeholders.
 */
describe('LabelsDao.currentFor — the labels_current read (0226 R4)', () => {
    const DOC_A: Doc = { id: 'cur-a', title: 'Item A', body: 'body a', sourceUri: 'https://example.com/cur-a' };
    const DOC_B: Doc = { id: 'cur-b', title: 'Item B', body: 'body b', sourceUri: 'https://example.com/cur-b' };
    const DEFAULT_POLICY: LabelPolicy = { priority: ['*', 'heuristic'], decisionPriority: {}, minConfidence: 0.8 };

    /** Seed one item and return its id plus the content hash every observation must carry. */
    async function seedItem(store: Store, doc: Doc): Promise<{ id: string; hash: string }> {
        const id = itemId(doc);
        await store.items.upsertDocs('run-1', [doc]);
        const row = await store.items.findById(id);
        return { id, hash: row?.contentHash ?? '' };
    }

    /** Record one observation; `contentHash` defaults to the item's current hash. */
    async function observe(
        store: Store,
        item: { id: string; hash: string },
        input: {
            maker: string;
            source: LabelSource;
            value: string;
            runId: string;
            labeledAt: number;
            decisionId?: string;
            rawConfidence?: number | null;
            contentHash?: string | null;
        },
    ): Promise<void> {
        await store.labels.recordObservation({
            itemId: item.id,
            decisionId: input.decisionId ?? 'kk-item-category',
            value: input.value,
            maker: input.maker,
            source: input.source,
            runId: input.runId,
            rawConfidence: input.rawConfidence ?? null,
            contentHash: input.contentHash === undefined ? item.hash : input.contentHash,
            labeledAt: input.labeledAt,
        });
    }

    it('keeps the highest-priority listed maker and EXCLUDES an unlisted one', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-priority.db');
        const item = await seedItem(store, DOC_A);
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'non-ai',
            runId: 'run-1',
            labeledAt: 1_000,
        });
        await observe(store, item, {
            maker: 'fm-local',
            source: 'model',
            value: 'ai-news',
            runId: 'run-1',
            rawConfidence: 0.9,
            labeledAt: 1_100,
        });
        // The unlisted maker's row is the LATEST and the most confident: ranking it last would still
        // let it win on an item where no listed maker has a row.
        await observe(store, item, {
            maker: 'unlisted',
            source: 'model',
            value: 'ai-industry',
            runId: 'run-1',
            rawConfidence: 0.99,
            labeledAt: 1_200,
        });

        const listedOnly: LabelPolicy = {
            priority: ['fm-local', 'heuristic'],
            decisionPriority: {},
            minConfidence: 0.8,
        };
        expect((await store.labels.currentFor([item.id], listedOnly)).map((row) => row.maker)).toEqual(['fm-local']);

        // A policy naming only a maker with NO row yields nothing for the item — the other two are
        // excluded, not ranked behind it.
        const absent = await store.labels.currentFor([item.id], {
            priority: ['absent-maker'],
            decisionPriority: {},
            minConfidence: 0.8,
        });
        expect(absent).toEqual([]);

        // The wildcard is not an exclusion rule: '*' admits every maker at its own position, so the
        // latest of the two wildcard-matched rows is current.
        expect((await store.labels.currentFor([item.id], DEFAULT_POLICY)).map((row) => row.maker)).toEqual([
            'unlisted',
        ]);
    });

    it('breaks a labeled_at tie with the greatest run id', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-tie.db');
        const item = await seedItem(store, DOC_A);
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'first',
            runId: 'run-a',
            labeledAt: 5_000,
        });
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'second',
            runId: 'run-b',
            labeledAt: 5_000,
        });

        const rows = await store.labels.currentFor([item.id], DEFAULT_POLICY);
        expect(rows.map((row) => [row.runId, row.value])).toEqual([['run-b', 'second']]);
    });

    it('ignores an observation made against a stale content hash', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-stale.db');
        const item = await seedItem(store, DOC_A);
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'non-ai',
            runId: 'run-1',
            labeledAt: 1_000,
        });
        // The item was edited since this answer: the row keeps its own hash and is no longer current.
        await observe(store, item, {
            maker: 'fm-local',
            source: 'model',
            value: 'ai-news',
            runId: 'run-1',
            rawConfidence: 0.99,
            contentHash: 'stale-hash',
            labeledAt: 2_000,
        });

        const rows = await store.labels.currentFor([item.id], DEFAULT_POLICY);
        expect(rows.map((row) => [row.maker, row.value])).toEqual([['heuristic', 'non-ai']]);
    });

    it('drops a below-threshold model answer — and has NO current label when it was the only row', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-threshold.db');
        const item = await seedItem(store, DOC_B);
        await observe(store, item, {
            maker: 'fm-local',
            source: 'model',
            value: 'ai-news',
            runId: 'run-1',
            rawConfidence: 0.4,
            labeledAt: 1_000,
        });

        expect(await store.labels.currentFor([item.id], DEFAULT_POLICY)).toEqual([]);
        // The threshold is the only gate: lower it and the SAME row is current.
        const lowered = await store.labels.currentFor([item.id], {
            priority: ['*'],
            decisionPriority: {},
            minConfidence: 0.2,
        });
        expect(lowered.map((row) => row.maker)).toEqual(['fm-local']);
    });

    it('admits nothing for an empty priority list, and never a source: default row', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-empty.db');
        const item = await seedItem(store, DOC_A);
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'non-ai',
            runId: 'run-1',
            labeledAt: 1_000,
        });
        await observe(store, item, {
            maker: 'fm-local',
            source: 'default',
            value: 'non-ai',
            runId: 'run-1',
            labeledAt: 2_000,
        });

        expect(
            await store.labels.currentFor([item.id], { priority: [], decisionPriority: {}, minConfidence: 0.8 }),
        ).toEqual([]);
        // A degraded row is never a label, whatever its priority or recency.
        expect(
            await store.labels.currentFor([item.id], {
                priority: ['fm-local'],
                decisionPriority: {},
                minConfidence: 0.8,
            }),
        ).toEqual([]);
    });

    it('admits a replay row only when its maker is listed by name — never through the wildcard', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-replay.db');
        const item = await seedItem(store, DOC_A);
        await observe(store, item, {
            maker: 'heuristic',
            source: 'heuristic',
            value: 'non-ai',
            runId: 'run-1',
            labeledAt: 1_000,
        });
        await observe(store, item, {
            maker: 'other',
            source: 'model',
            value: 'ai-news',
            runId: 'replay-1',
            rawConfidence: 0.99,
            labeledAt: 2_000,
        });

        // Production stays current: the replay row would win on priority AND recency, but '*' never
        // admits one.
        expect((await store.labels.currentFor([item.id], DEFAULT_POLICY)).map((row) => row.maker)).toEqual([
            'heuristic',
        ]);
        // Wildcard-only: the replay row would win on both priority and recency, but '*' never
        // admits one — so the heuristic row stays current.
        const wildcardOnly: LabelPolicy = { priority: ['*'], decisionPriority: {}, minConfidence: 0.8 };
        expect((await store.labels.currentFor([item.id], wildcardOnly)).map((row) => row.maker)).toEqual(['heuristic']);
        // Named by name, the replay row is exactly what a backtest reads.
        const named = await store.labels.currentFor([item.id], {
            priority: ['other'],
            decisionPriority: {},
            minConfidence: 0.8,
        });
        expect(named.map((row) => [row.maker, row.value, row.runId])).toEqual([['other', 'ai-news', 'replay-1']]);
    });

    it('replaces the global priority with store.labels.decisions.<id>.priority for that decision', async () => {
        const { store } = await openTempStore(makeTempDir(), 'current-override.db');
        const item = await seedItem(store, DOC_A);
        for (const [decisionId, heuristicValue, modelValue] of [
            ['kk-item-category', 'non-ai', 'ai-news'],
            ['kk-item-quality', '1', '5'],
        ] as const) {
            await observe(store, item, {
                decisionId,
                maker: 'heuristic',
                source: 'heuristic',
                value: heuristicValue,
                runId: 'run-1',
                labeledAt: 1_000,
            });
            await observe(store, item, {
                decisionId,
                maker: 'fm-local',
                source: 'model',
                value: modelValue,
                runId: 'run-1',
                rawConfidence: 0.9,
                labeledAt: 1_100,
            });
        }

        const rows = await store.labels.currentFor([item.id], {
            priority: ['*'],
            decisionPriority: { 'kk-item-category': ['heuristic'] },
            minConfidence: 0.8,
        });
        expect(rows.map((row) => [row.decisionId, row.maker, row.value])).toEqual([
            ['kk-item-category', 'heuristic', 'non-ai'],
            ['kk-item-quality', 'fm-local', '5'],
        ]);
    });

    it('binds one parameter per placeholder, in statement order', () => {
        const { sql, params } = labelsCurrentSql({
            priority: ['fm-local', '*', 'heuristic'],
            decisionPriority: { 'kk-item-category': ['heuristic'] },
            minConfidence: 0.8,
        });
        expect(sql.startsWith('labels_current AS (')).toBe(true);
        expect(sql).toContain('ROW_NUMBER() OVER');
        expect(sql).toContain('it.content_hash = l.content_hash');
        expect(sql.split('?').length - 1).toBe(params.length);
        expect(params).toContain(0.8);
        expect(params).toContain('kk-item-category');
        expect(params).toContain('replay-%');
    });

    it('treats migrated v1 model rows and model rows with NULL raw_confidence as non-current (0239 R4)', async () => {
        const { store } = await openTempStore(makeTempDir(), 'legacy-model-rows.db');
        const item = await seedItem(store, DOC_A);
        // 1. Migrated heuristic row (source='heuristic', rawConfidence=null) -> current
        await observe(store, item, {
            decisionId: 'kk-item-category',
            maker: 'heuristic',
            source: 'heuristic',
            value: 'ai-news',
            runId: 'legacy',
            rawConfidence: null,
            labeledAt: 1_000,
        });
        // 2. Migrated model row (source='model', rawConfidence=null) -> NOT current
        await observe(store, item, {
            decisionId: 'kk-item-quality',
            maker: 'fm-local',
            source: 'model',
            value: 'HIGH',
            runId: 'legacy',
            rawConfidence: null,
            labeledAt: 1_000,
        });
        // 3. New model row with NULL raw_confidence -> NOT current
        await observe(store, item, {
            decisionId: 'kk-item-importance',
            maker: 'fm-local',
            source: 'model',
            value: 'HIGH',
            runId: 'run-new',
            rawConfidence: null,
            labeledAt: 2_000,
        });

        const policy: LabelPolicy = { priority: ['*'], decisionPriority: {}, minConfidence: 0.8 };
        const current = await store.labels.currentFor([item.id], policy);
        const decisions = current.map((r) => r.decisionId);
        expect(decisions).toContain('kk-item-category');
        expect(decisions).not.toContain('kk-item-quality');
        expect(decisions).not.toContain('kk-item-importance');
    });
});
