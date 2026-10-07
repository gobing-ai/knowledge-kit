import type { DbAdapter } from '@gobing-ai/ts-db';
import { KK_STORE_V1_SQL } from './schema';

/** One append-only store migration: an id (the journal key) and its SQL body. */
export interface KkMigration {
    id: string;
    /** `;`-separated statements; executed one at a time by {@link applyKkMigrations}. */
    sql: string;
}

/** Isolation journal for store migrations — separate from any other journal in the same file. */
export const KK_MIGRATION_JOURNAL = '__kk_store_migrations';

/**
 * Every store migration, in apply order. Append-only: a released id is never
 * edited, so an already-migrated database always matches a fresh one.
 */
export const KK_MIGRATIONS: readonly KkMigration[] = [{ id: '0001_kk_store_init', sql: KK_STORE_V1_SQL }];

/** Split a `;`-separated SQL body into individual statements (the adapter executes one per `exec`). */
export function splitSqlStatements(sql: string): string[] {
    return sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}

/** True when `name` is an existing table or index in this database. */
async function schemaObjectExists(adapter: DbAdapter, name: string): Promise<boolean> {
    const row = await adapter.queryFirst<{ name: string }>(
        'SELECT name FROM sqlite_master WHERE name = ? LIMIT 1',
        name,
    );
    return row != null;
}

/**
 * True when the journal table exists and already lists every migration id — i.e.
 * {@link applyKkMigrations} has nothing to write. Pure reads, so routine opens
 * (every `kk store` verb) never take a write lock on the store database.
 */
async function allMigrationsJournaled(adapter: DbAdapter, migrations: readonly KkMigration[]): Promise<boolean> {
    if (migrations.length === 0) return true;
    if (!(await schemaObjectExists(adapter, KK_MIGRATION_JOURNAL))) return false;
    const placeholders = migrations.map(() => '?').join(', ');
    const row = await adapter.queryFirst<{ n: number }>(
        `SELECT COUNT(*) AS n FROM "${KK_MIGRATION_JOURNAL}" WHERE id IN (${placeholders})`,
        ...migrations.map((migration) => migration.id),
    );
    return (row?.n ?? 0) === migrations.length;
}

/**
 * Apply the store's embedded migrations, journaling each applied id in
 * `__kk_store_migrations`.
 *
 * @returns the number applied by this call (0 when the journal was already complete).
 */
export async function applyKkMigrations(
    adapter: DbAdapter,
    migrations: readonly KkMigration[] = KK_MIGRATIONS,
): Promise<number> {
    if (await allMigrationsJournaled(adapter, migrations)) return 0;

    await adapter.exec(
        `CREATE TABLE IF NOT EXISTS "${KK_MIGRATION_JOURNAL}" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`,
    );

    let applied = 0;
    for (const migration of migrations) {
        const existing = await adapter.queryFirst<{ id: string }>(
            `SELECT id FROM "${KK_MIGRATION_JOURNAL}" WHERE id = ?`,
            migration.id,
        );
        if (existing != null) continue;

        for (const statement of splitSqlStatements(migration.sql)) {
            await adapter.exec(statement);
        }
        // Journal with ON CONFLICT DO NOTHING: two processes may migrate the same file
        // concurrently (`kk store migrate` runs before the collect lock is held), and
        // every statement above is idempotent — so losing the race must mean "the other
        // process applied it", not a UNIQUE-constraint failure. `RETURNING id` is empty
        // when this call lost, which keeps `applied` an exact count for the caller.
        const journaled = await adapter.queryFirst<{ id: string }>(
            `INSERT INTO "${KK_MIGRATION_JOURNAL}" (id, applied_at) VALUES (?, ?)
             ON CONFLICT(id) DO NOTHING RETURNING id`,
            migration.id,
            Date.now(),
        );
        if (journaled != null) applied += 1;
    }
    return applied;
}
