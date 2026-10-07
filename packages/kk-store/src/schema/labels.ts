import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * One decision's answer for one item — a row per (item, decision) so a new
 * decision is a new row, never a schema change.
 *
 * `(item_id, decision_id)` identity is a UNIQUE INDEX in migration 0001 rather
 * than a column-level primary key: `defineTable(name, columns)` takes only
 * column builders, so a composite key cannot be expressed as table DDL.
 *
 * `confidence` and `run_id` arrive in migration `0002`; they are declared here
 * too because `0001`'s DDL is derived from this builder (see `migrations.ts` for
 * why a fresh `0001` and the `0002` ALTER converge).
 */
export const labelsTable = defineTable('labels', {
    itemId: text('item_id').notNull(),
    decisionId: text('decision_id').notNull(),
    value: text('value').notNull(),
    score: integer('score'),
    maker: text('maker').notNull(),
    source: text('source').notNull(),
    /** Decision confidence 0–1 for a model answer; `null` for heuristic rows or an absent payload. */
    confidence: integer('confidence'),
    /** The collect run the pass belongs to (`kk store label --run`). */
    runId: text('run_id'),
    labeledAt: integer('labeled_at').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `labelsTable`. */
export const labels = labelsTable.table;
