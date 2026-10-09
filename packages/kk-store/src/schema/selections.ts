import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * One topic's decision about one item in one run — the cross-day dedup ledger
 * that replaces `episode_usage`.
 *
 * Identity is `(topic, item_id, run_id)` (UNIQUE, migration `0003_store_v2`), so
 * a repeated call for the same selection is a no-op rather than a duplicate. The
 * ledger is topic-scoped, not workflow-scoped: `workflow` is provenance only, and
 * one item may serve several topics. `story_id` carries the story key so a
 * re-reported event under a new URL is still excluded; extraction excludes by
 * `(topic, story_id)` with status `selected` or `published` (task 0228).
 *
 * `status`'s `CHECK (status IN ('selected','published','dropped'))` lives in the
 * migration DDL: `defineTable(name, columns)` takes only column builders, so a
 * table constraint cannot be expressed here.
 */
export const selectionsTable = defineTable('selections', {
    /** The topic profile the selection belongs to (e.g. `ai-news`). */
    topic: text('topic').notNull(),
    itemId: text('item_id').notNull(),
    runId: text('run_id').notNull(),
    /** The item's story key; equals the item id until clustering lands (task 0227). */
    storyId: text('story_id').notNull(),
    /** Provenance only — the workflow that made the selection. */
    workflow: text('workflow'),
    /** 1-based position in the planned set, when the caller knows one. */
    rank: integer('rank'),
    /** Reserved for future topics; NULL in voice2 (task 0228). */
    reason: text('reason'),
    /** `selected` → `published` | `dropped`; the CHECK constraint enforces the domain. */
    status: text('status').notNull(),
    selectedAt: integer('selected_at').notNull(),
    publishedAt: integer('published_at'),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `selectionsTable`. */
export const selections = selectionsTable.table;
