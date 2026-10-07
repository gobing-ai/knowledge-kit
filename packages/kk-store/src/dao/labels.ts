import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { labels } from '../schema/labels';

/** One `labels` row as stored. */
export type LabelRecord = typeof labels.$inferSelect;

/** Who produced a label value — a decision run, the keyword heuristic, or the degraded default. */
export type LabelSource = 'model' | 'heuristic' | 'default';

/** Input accepted by {@link LabelsDao.upsertLabel}. */
export interface LabelInput {
    itemId: string;
    decisionId: string;
    value: string;
    maker: string;
    source: LabelSource;
    /** Score decisions only; `null` for choice decisions. */
    score?: number | null;
    /** The model answer's confidence 0–1; `null` for a heuristic row or an absent payload. */
    confidence?: number | null;
    /** The collect run the pass belongs to (`kk store label --run`). */
    runId?: string | null;
    labeledAt?: number;
}

/**
 * DAO for `labels` — one row per (item, decision), so adding a decision never
 * changes the schema.
 */
export class LabelsDao extends EntityDao<typeof labels, typeof labels.itemId> {
    constructor(adapter: DbAdapter) {
        super(adapter, labels, [labels.itemId, labels.decisionId], 'labels');
    }

    /**
     * Write one decision's answer for an item, replacing a previous answer for the
     * same (item, decision). Only the answer columns update on conflict — the row's
     * `created_at` stays the first labelling, which is what an audit read wants.
     */
    upsertLabel(input: LabelInput, now = Date.now()): Promise<LabelRecord> {
        const labeledAt = input.labeledAt ?? now;
        const score = input.score ?? null;
        const confidence = input.confidence ?? null;
        const runId = input.runId ?? null;
        return super.upsert(
            {
                itemId: input.itemId,
                decisionId: input.decisionId,
                value: input.value,
                score,
                maker: input.maker,
                source: input.source,
                confidence,
                runId,
                labeledAt,
            },
            [labels.itemId, labels.decisionId],
            { value: input.value, score, maker: input.maker, source: input.source, confidence, runId, labeledAt },
        );
    }

    /** Every decision answer stored for one item, in decision-id order. */
    listForItem(itemId: string): Promise<LabelRecord[]> {
        return super.findAllBy(labels.itemId, itemId);
    }
}
