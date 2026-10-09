/**
 * The store's `defineTable` builders — one per table, the single source of truth
 * for column shape (the v2 shape after `0003_store_v2`).
 *
 * DDL lives in `src/migrations.ts`: `0001_kk_store_init` is the frozen v1 literal
 * (it must NOT derive from these builders again — see ADR-030's 2026-10-09
 * amendment), and `0003_store_v2` adds the composite identities and the
 * `selections.status` CHECK a two-argument `defineTable` cannot express.
 */
export { collectRuns, collectRunsTable } from './collect-runs';
export { items, itemsTable } from './items';
export { labels, labelsTable } from './labels';
export { locks, locksTable } from './locks';
export { selections, selectionsTable } from './selections';
