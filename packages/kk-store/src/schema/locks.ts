import { defineTable, integer, standardColumns, text } from '@gobing-ai/ts-db/schema';

/**
 * Single-flight lock row (one row per lock name). `acquired_at + ttl_ms` is the
 * expiry the acquire guard steals past, so a crashed holder never blocks a
 * later run forever.
 */
export const locksTable = defineTable('locks', {
    name: text('name').primaryKey(),
    ownerRun: text('owner_run').notNull(),
    acquiredAt: integer('acquired_at').notNull(),
    ttlMs: integer('ttl_ms').notNull(),
    ...standardColumns,
});

/** The Drizzle table for DAOs/queries. DDL + zod schemas derive from `locksTable`. */
export const locks = locksTable.table;
