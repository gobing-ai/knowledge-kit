import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * Cross-day dedup ledger: which items a workflow already used, and in which run.
 * `(item_id, workflow, run_id)` is the row identity (unique index in migration
 * 0001, same `defineTable` composite-key limitation as `labels`).
 */
export const episodeUsageTable = defineTable('episode_usage', {
    itemId: text('item_id').notNull(),
    workflow: text('workflow').notNull(),
    runId: text('run_id').notNull(),
    usedAt: integer('used_at').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `episodeUsageTable`. */
export const episodeUsage = episodeUsageTable.table;
