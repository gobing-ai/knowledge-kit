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
 *
 * `0001`'s DDL is derived from the live `defineTable(...).createTableSql`, so a
 * fresh database's `0001` already carries every column a later migration adds.
 * The later `ALTER TABLE … ADD COLUMN` therefore repeats a column on a fresh
 * database and adds it on an older one; {@link applyKkMigrations} tolerates the
 * duplicate, which is what makes the two paths converge.
 */
export const KK_MIGRATIONS: readonly KkMigration[] = [
    { id: '0001_kk_store_init', sql: KK_STORE_V1_SQL },
    {
        id: '0002_labels_confidence_run_id',
        // `confidence` is TEXT, matching the live `defineTable` DDL: `0001`'s SQL is derived from the
        // schema, so a fresh database already creates the column as TEXT and this ALTER is skipped
        // (duplicate column). A database migrated from the pre-0213 shape gets TEXT here, so fresh and
        // migrated converge — the oracle in tests/migrations.test.ts compares column TYPES.
        sql: 'ALTER TABLE labels ADD COLUMN confidence TEXT; ALTER TABLE labels ADD COLUMN run_id TEXT;',
    },
];

/**
 * True when `error` is SQLite's `ALTER TABLE … ADD COLUMN` rejection of a column
 * that already exists. Column DDL is derived from the live schema, so a fresh
 * `0001` creates a column a later migration's `ALTER` then tries to add — the
 * statement is already-satisfied, not a failure. Matched on the message because
 * bun:sqlite (the only driver here) exposes no error code across drivers.
 */
function isDuplicateColumnError(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('duplicate column name');
}

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
 * One statement class is tolerated: a `duplicate column name` from `ALTER TABLE …
 * ADD COLUMN` means the column is already present (a fresh `0001` derives its DDL
 * from the live schema, so it carries a later migration's columns too), so the
 * statement is skipped — and reported to `onSkippedStatement` when given — while
 * every other error still fails closed.
 *
 * @returns the number applied by this call (0 when the journal was already complete).
 */
export async function applyKkMigrations(
    adapter: DbAdapter,
    migrations: readonly KkMigration[] = KK_MIGRATIONS,
    onSkippedStatement?: (statement: string) => void,
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
            try {
                await adapter.exec(statement);
            } catch (error) {
                if (!isDuplicateColumnError(error)) throw error;
                onSkippedStatement?.(statement);
            }
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
