import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';
import { real } from 'drizzle-orm/sqlite-core';

/**
 * One maker's answer for one (item, decision) — an append-only observation.
 *
 * Identity is `(item_id, decision_id, maker, run_id)` (UNIQUE, migration
 * `0003_store_v2`), so a second maker never overwrites the first and the same
 * maker's later run is a new row, not an update. `(item_id, decision_id)` is a
 * plain lookup index instead.
 *
 * `run_id` is NOT NULL since v2; a row written before the observation identity
 * existed backfills to the literal `'legacy'`. The raw payload columns
 * (`raw_value`, `raw_confidence`, `reason`, `duration_ms`, `catalog_version`)
 * keep the evidence the enum `confidence` used to drop, and `content_hash` is
 * the item hash the answer was made against, so an edited item's old answers
 * stay attributable (task 0226).
 *
 * The composite UNIQUE is a separate `CREATE UNIQUE INDEX` in the migration
 * rather than table DDL: `defineTable(name, columns)` takes only column
 * builders, so a composite key cannot be expressed as a table constraint.
 */
export const labelsTable = defineTable('labels', {
    itemId: text('item_id').notNull(),
    decisionId: text('decision_id').notNull(),
    value: text('value').notNull(),
    score: integer('score'),
    maker: text('maker').notNull(),
    source: text('source').notNull(),
    /**
     * The verdict's confidence level — one of the `HIGH | MEDIUM | LOW` levels, or `null` only for
     * a row written before the level existed. Declared `text` deliberately: the column holds the
     * enum (task 0213), and declaring it `integer` (task 0209) made it a mixed-domain column that
     * silently defeated any numeric query.
     *
     * `CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)` lives in the
     * migration DDL: `defineTable(name, columns)` takes only column builders, so a table constraint
     * cannot be expressed here.
     */
    confidence: text('confidence'),
    /** The collect run the pass belongs to (`kk store label --run`); `'legacy'` for a pre-v2 row. */
    runId: text('run_id').notNull(),
    labeledAt: integer('labeled_at').notNull(),
    /** The maker's answer verbatim, before any vocabulary mapping (task 0226). */
    rawValue: text('raw_value'),
    /** The model's raw 0–1 confidence, before the enum mapping (task 0226). */
    rawConfidence: real('raw_confidence'),
    /** The maker's stated reason, when it gives one (task 0226). */
    reason: text('reason'),
    /** The consult's own duration in milliseconds (task 0226). */
    durationMs: integer('duration_ms'),
    /** The decision catalog version the answer came from (task 0226). */
    catalogVersion: text('catalog_version'),
    /** The item's `content_hash` when the answer was made — an edited item keeps its old answers. */
    contentHash: text('content_hash'),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `labelsTable`. */
export const labels = labelsTable.table;
