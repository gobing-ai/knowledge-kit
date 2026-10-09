import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';
import { real } from 'drizzle-orm/sqlite-core';

/**
 * One ingested document, keyed by its content identity (`id` = sha256 of the
 * canonical URL, or of `title + body` when the Doc carries no URL).
 *
 * `canonical_url` is nullable because URL-less Docs (briefs, local files) have
 * no URL to normalize; `content_hash` is what makes an upsert an update.
 *
 * The fact columns (`engagement`, `body_chars`, `source_tier`, `lang`,
 * `domain`, `story_id`) hold deterministic, maker-independent facts (G32 D2):
 * values a maker could disagree on stay `labels` observations instead. They are
 * added NULL by `0003_store_v2` and derived by task 0227's `backfill-facts`,
 * except `story_id`, which is the item's own id until clustering lands.
 */
export const itemsTable = defineTable('items', {
    id: text('id').primaryKey(),
    canonicalUrl: text('canonical_url').unique(),
    contentHash: text('content_hash').notNull(),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    source: text('source').notNull().default(''),
    mediaType: text('media_type'),
    metadataJson: text('metadata_json').notNull().default('{}'),
    firstSeenRun: text('first_seen_run').notNull(),
    lastSeenRun: text('last_seen_run').notNull(),
    firstSeenAt: integer('first_seen_at').notNull(),
    publishedAt: integer('published_at'),
    ...standardColumns,
    /** Largest finite number in `metadata.engagement`, else NULL (task 0227). */
    engagement: real('engagement'),
    /** `[...body].length`, counted in code points (task 0227). */
    bodyChars: integer('body_chars'),
    /** `curated` (aihot) | `community` (rss/hackernews) | `other` (task 0227). */
    sourceTier: text('source_tier'),
    /** `metadata.lang`, else the title's script (task 0227). */
    lang: text('lang'),
    /** `new URL(canonical_url).hostname`, `www.` stripped (task 0227). */
    domain: text('domain'),
    /** The story this item belongs to; equals `id` until clustering lands (task 0227). */
    storyId: text('story_id'),
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `itemsTable`. */
export const items = itemsTable.table;
