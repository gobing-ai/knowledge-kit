import { collectRunsTable } from './collect-runs';
import { episodeUsageTable } from './episode-usage';
import { itemsTable } from './items';
import { labelsTable } from './labels';
import { locksTable } from './locks';

export { collectRuns, collectRunsTable } from './collect-runs';
export { episodeUsage, episodeUsageTable } from './episode-usage';
export { items, itemsTable } from './items';
export { labels, labelsTable } from './labels';
export { locks, locksTable } from './locks';

/**
 * Version 1 store DDL — the single source of truth for the five tables.
 *
 * Each `CREATE TABLE` is DERIVED from its `defineTable` definition via
 * `createTableSql`; there is no hand-written table DDL to keep in sync. The
 * statements after the tables are the identities `defineTable` cannot express
 * (composite keys need SQLite table constraints, which its two-argument
 * signature has no route to) plus the workflow lookup index:
 *
 * - `labels (item_id, decision_id)` — one decision answer per item (UNIQUE).
 * - `episode_usage (workflow, item_id)` — the workflow's usage lookup.
 * - `episode_usage (item_id, workflow, run_id)` — the row identity (UNIQUE), so
 *   `INSERT … ON CONFLICT` dedups a repeated mark-used call.
 *
 * Statements are `;`-separated and unsplit by this module; the migrator splits
 * and executes them one at a time (the adapter's `exec` runs one statement).
 */
export const KK_STORE_V1_SQL = [
    itemsTable.createTableSql,
    collectRunsTable.createTableSql,
    labelsTable.createTableSql,
    episodeUsageTable.createTableSql,
    locksTable.createTableSql,
    'CREATE UNIQUE INDEX IF NOT EXISTS "labels_item_decision_unique" ON "labels" ("item_id", "decision_id")',
    'CREATE INDEX IF NOT EXISTS "episode_usage_workflow_item_idx" ON "episode_usage" ("workflow", "item_id")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "episode_usage_identity_unique" ON "episode_usage" ("item_id", "workflow", "run_id")',
].join(';\n');
