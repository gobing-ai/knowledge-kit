import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { labels } from '../schema/labels';

/**
 * The closed confidence enum a label verdict carries (G31 R14) — the only values
 * `labels.confidence` may hold, and the same vocabulary the judge-verdict guards and the
 * `verification-confidence-level` rule already use.
 */
export const LABEL_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** One label verdict's confidence level. */
export type LabelConfidence = (typeof LABEL_CONFIDENCE_LEVELS)[number];

/** A model answer's confidence at or above this is `HIGH` (`kk store label`'s boundary contract). */
export const HIGH_CONFIDENCE_MIN = 0.8;

/** A model answer's confidence at or above this (and below {@link HIGH_CONFIDENCE_MIN}) is `MEDIUM`. */
export const MEDIUM_CONFIDENCE_MIN = 0.5;

/** One `labels` row as stored. */
export type LabelRecord = Omit<typeof labels.$inferSelect, 'confidence'> & {
    /**
     * The verdict level stored for this decision. `null` marks a row no `kk store label` pass
     * wrote (a hand-seeded or pre-0209-era row): a consumer must refuse it, never read it as a
     * pass.
     */
    confidence: LabelConfidence | null;
};

/** Who produced a label value — a decision run, the keyword heuristic, or the degraded default. */
export type LabelSource = 'model' | 'heuristic' | 'default';

/**
 * The confidence level a label verdict earns: the numeric model payload 0–1 maps into the closed
 * enum at the emit boundary, and only a `model` answer can earn more than `LOW` — a keyword
 * heuristic row or a degraded `source: default` row has no model evidence to cite.
 */
export function labelConfidence(source: LabelSource, confidence: number | null): LabelConfidence {
    if (source !== 'model' || confidence === null) return 'LOW';
    if (confidence >= HIGH_CONFIDENCE_MIN) return 'HIGH';
    if (confidence >= MEDIUM_CONFIDENCE_MIN) return 'MEDIUM';
    return 'LOW';
}

/**
 * The level of a whole label pass: the weakest level among its verdicts, so a pass can never
 * claim more certainty than its least certain decision; a pass with no rows at all is `LOW`.
 */
export function verdictConfidence(levels: readonly LabelConfidence[]): LabelConfidence {
    if (levels.includes('LOW') || levels.length === 0) return 'LOW';
    if (levels.includes('MEDIUM')) return 'MEDIUM';
    return 'HIGH';
}

/** Input accepted by {@link LabelsDao.upsertLabel}. */
export interface LabelInput {
    itemId: string;
    decisionId: string;
    value: string;
    maker: string;
    source: LabelSource;
    /** Score decisions only; `null` for choice decisions. */
    score?: number | null;
    /**
     * The verdict's `HIGH` | `MEDIUM` | `LOW` level; `null` only for a row written outside the
     * `kk store label` pass, which a consumer must refuse.
     */
    confidence?: LabelConfidence | null;
    /** The collect run the pass belongs to (`kk store label --run`). */
    runId?: string | null;
    labeledAt?: number;
}

/** The row shape the DDL declares — `confidence` is TEXT, holding the verdict enum. */
type StoredLabelRow = typeof labels.$inferSelect;

/** A stored row with `confidence` narrowed from `string` to the enum type it actually holds. */
function toLabelRecord(row: StoredLabelRow): LabelRecord {
    return { ...row, confidence: row.confidence as LabelConfidence | null };
}

/**
 * DAO for `labels` — one row per (item, decision), so adding a decision never
 * changes the schema.
 *
 * `labels.confidence` is declared `text` and carries exactly one of the `HIGH | MEDIUM | LOW` levels
 * (task 0213; migration `0002` adds it as `TEXT` so a migrated database converges with a fresh one).
 * The column type and the value domain therefore agree, and `toLabelRecord` below is the single seam
 * that narrows a plain `string` to the enum type — no other cast touches the level, and the enum is
 * never coerced to a number.
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
    async upsertLabel(input: LabelInput, now = Date.now()): Promise<LabelRecord> {
        const labeledAt = input.labeledAt ?? now;
        const score = input.score ?? null;
        const confidence = input.confidence ?? null;
        const runId = input.runId ?? null;
        const row = await super.upsert(
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
            {
                value: input.value,
                score,
                maker: input.maker,
                source: input.source,
                confidence,
                runId,
                labeledAt,
            },
        );
        return toLabelRecord(row);
    }

    /** Every decision answer stored for one item, in decision-id order. */
    async listForItem(itemId: string): Promise<LabelRecord[]> {
        const rows = await super.findAllBy(labels.itemId, itemId);
        return rows.map(toLabelRecord);
    }
}
