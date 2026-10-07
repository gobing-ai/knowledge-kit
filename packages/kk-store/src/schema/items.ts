import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * One ingested document, keyed by its content identity (`id` = sha256 of the
 * canonical URL, or of `title + body` when the Doc carries no URL).
 *
 * `canonical_url` is nullable because URL-less Docs (briefs, local files) have
 * no URL to normalize; `content_hash` is what makes an upsert an update.
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
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `itemsTable`. */
export const items = itemsTable.table;
