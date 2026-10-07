import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { locks } from '../schema/locks';

/** One `locks` row as stored. */
export type LockRecord = typeof locks.$inferSelect;

/**
 * Acquire iff the lock is free, held by the same run, or past its TTL. The
 * `WHERE` on the upsert's `DO UPDATE` is what makes the whole acquire ONE
 * statement: two concurrent claimers can never both see "free" and both win,
 * and a stale holder (crashed process) is stolen past `acquired_at + ttl_ms`.
 * `RETURNING name` is empty when the guard rejects the update.
 */
const ACQUIRE_LOCK_SQL = `INSERT INTO locks (name, owner_run, acquired_at, ttl_ms, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
        owner_run = excluded.owner_run,
        acquired_at = excluded.acquired_at,
        ttl_ms = excluded.ttl_ms,
        updated_at = excluded.updated_at
    WHERE locks.owner_run = excluded.owner_run
       OR locks.acquired_at + locks.ttl_ms <= excluded.acquired_at
    RETURNING name`;

/**
 * DAO for `locks` — single-flight guards over the store's workflows.
 *
 * `LocksDao` is the reason a scheduled `kk-collect` tick cannot overlap its
 * predecessor: the loser gets `false`, records the skip, and exits 0.
 */
export class LocksDao extends EntityDao<typeof locks, typeof locks.name> {
    constructor(adapter: DbAdapter) {
        super(adapter, locks, [locks.name], 'locks');
    }

    /**
     * Try to take `name` for `runId` (re-entrant for the same run).
     *
     * @param ttlMs how long the claim stays valid for a dead holder; a later
     *   `acquire` steals it once `acquired_at + ttlMs` has passed.
     * @returns `true` when this call owns the lock.
     */
    async acquire(name: string, runId: string, ttlMs: number, now = Date.now()): Promise<boolean> {
        const row = await this.adapter.queryFirst<{ name: string }>(
            ACQUIRE_LOCK_SQL,
            name,
            runId,
            now,
            ttlMs,
            now,
            now,
        );
        return row != null;
    }

    /** Release `name` iff `runId` still owns it. Returns whether a row was removed. */
    async release(name: string, runId: string): Promise<boolean> {
        const row = await this.adapter.queryFirst<{ name: string }>(
            'DELETE FROM locks WHERE name = ? AND owner_run = ? RETURNING name',
            name,
            runId,
        );
        return row != null;
    }

    /** The current claim on `name`, or `undefined` when unlocked. */
    current(name: string): Promise<LockRecord | undefined> {
        return super.findById(name);
    }
}
