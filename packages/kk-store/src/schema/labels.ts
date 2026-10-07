import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * One decision's answer for one item — a row per (item, decision) so a new
 * decision is a new row, never a schema change.
 *
 * `(item_id, decision_id)` identity is a UNIQUE INDEX in migration 0001 rather
 * than a column-level primary key: `defineTable(name, columns)` takes only
 * column builders, so a composite key cannot be expressed as table DDL.
 */
export const labelsTable = defineTable('labels', {
    itemId: text('item_id').notNull(),
    decisionId: text('decision_id').notNull(),
    value: text('value').notNull(),
    score: integer('score'),
    maker: text('maker').notNull(),
    source: text('source').notNull(),
    labeledAt: integer('labeled_at').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `labelsTable`. */
export const labels = labelsTable.table;
