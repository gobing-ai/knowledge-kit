import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/** Provenance row for one `kk collect` run: when it ran, what it ingested, what it wrote. */
export const collectRunsTable = defineTable('collect_runs', {
    runId: text('run_id').primaryKey(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    status: text('status').notNull(),
    sourceCountsJson: text('source_counts_json').notNull().default('{}'),
    inserted: integer('inserted').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `collectRunsTable`. */
export const collectRuns = collectRunsTable.table;
