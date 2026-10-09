import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';

/** One append-only store migration: an id (the journal key) and its SQL body. */
export interface KkMigration {
    id: string;
    /** `;`-separated statements; executed one at a time by {@link applyKkMigrations}. */
    sql: string;
    /**
     * Apply the whole migration — journal row plus every statement — in one `adapter.batch`
     * transaction. Required for a table rebuild, which is not idempotent statement-by-statement; a
     * racing migrator then rolls back whole instead of rebuilding twice (see
     * {@link applyKkMigrations}).
     */
    atomic?: boolean;
}

/** Isolation journal for store migrations — separate from any other journal in the same file. */
export const KK_MIGRATION_JOURNAL = '__kk_store_migrations';

/**
 * The frozen v1 schema — `0001_kk_store_init`'s DDL, copied verbatim from what the `defineTable`
 * builders produced when the store shipped (it already carried the two columns `0002` adds,
 * because the old `0001` derived from the live builders).
 *
 * It must never derive from the builders again. That derivation trick relied on `0001` already
 * carrying a later migration's columns, so only ADD COLUMN paths converged; `0003_store_v2` widens
 * `labels`' identity with a rebuild, which it cannot express. Freezing the v1 shape is what lets a
 * fresh database and a pre-v2 database reach the same v2 schema (ADR-030, amendment 2026-10-09).
 */
export const KK_STORE_V1_SQL_FROZEN = `CREATE TABLE IF NOT EXISTS "items" (
  "id" text PRIMARY KEY NOT NULL,
  "canonical_url" text UNIQUE,
  "content_hash" text NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "source" text NOT NULL DEFAULT '',
  "media_type" text,
  "metadata_json" text NOT NULL DEFAULT '{}',
  "first_seen_run" text NOT NULL,
  "last_seen_run" text NOT NULL,
  "first_seen_at" integer NOT NULL,
  "published_at" integer,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "collect_runs" (
  "run_id" text PRIMARY KEY NOT NULL,
  "started_at" integer NOT NULL,
  "finished_at" integer,
  "status" text NOT NULL,
  "source_counts_json" text NOT NULL DEFAULT '{}',
  "inserted" integer NOT NULL DEFAULT 0,
  "updated" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "labels" (
  "item_id" text NOT NULL,
  "decision_id" text NOT NULL,
  "value" text NOT NULL,
  "score" integer,
  "maker" text NOT NULL,
  "source" text NOT NULL,
  "confidence" text,
  "run_id" text,
  "labeled_at" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "episode_usage" (
  "item_id" text NOT NULL,
  "workflow" text NOT NULL,
  "run_id" text NOT NULL,
  "used_at" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "locks" (
  "name" text PRIMARY KEY NOT NULL,
  "owner_run" text NOT NULL,
  "acquired_at" integer NOT NULL,
  "ttl_ms" integer NOT NULL,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "labels_item_decision_unique" ON "labels" ("item_id", "decision_id");
CREATE INDEX IF NOT EXISTS "episode_usage_workflow_item_idx" ON "episode_usage" ("workflow", "item_id");
CREATE UNIQUE INDEX IF NOT EXISTS "episode_usage_identity_unique" ON "episode_usage" ("item_id", "workflow", "run_id")`;

/**
 * `0003_store_v2`'s `labels` DDL — frozen literal, matching `labelsTable.createTableSql`'s columns
 * (a test pins the `(name, type)` pairs together). The rebuild renames the v1 table aside and
 * creates this one under the final name, so `sqlite_master.sql` equals the builder's DDL plus the
 * `confidence` CHECK below.
 *
 * The CHECK closes the `HIGH | MEDIUM | LOW` vocabulary at the storage boundary (G31 R14): a
 * `defineTable(name, columns)` table constraint cannot be expressed, so it lives here, exactly as
 * `selections.status` does.
 */
const LABELS_V2_DDL = `CREATE TABLE IF NOT EXISTS "labels" (
  "item_id" text NOT NULL,
  "decision_id" text NOT NULL,
  "value" text NOT NULL,
  "score" integer,
  "maker" text NOT NULL,
  "source" text NOT NULL,
  "confidence" text,
  "run_id" text NOT NULL,
  "labeled_at" integer NOT NULL,
  "raw_value" text,
  "raw_confidence" real,
  "reason" text,
  "duration_ms" integer,
  "catalog_version" text,
  "content_hash" text,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0,
  CHECK ("confidence" IN ('HIGH','MEDIUM','LOW') OR "confidence" IS NULL)
)
`;

/**
 * `0003_store_v2`'s `selections` DDL — frozen literal. The `status` CHECK is a table constraint a
 * two-argument `defineTable` cannot express, so it lives here (a test pins the columns to
 * `selectionsTable.createTableSql` and asserts the CHECK rejects an unknown status).
 */
const SELECTIONS_V2_DDL = `CREATE TABLE IF NOT EXISTS "selections" (
  "topic" text NOT NULL,
  "item_id" text NOT NULL,
  "run_id" text NOT NULL,
  "story_id" text NOT NULL,
  "workflow" text,
  "rank" integer,
  "reason" text,
  "status" text NOT NULL CHECK ("status" IN ('selected', 'published', 'dropped')),
  "selected_at" integer NOT NULL,
  "published_at" integer,
  "created_at" integer NOT NULL DEFAULT 0,
  "updated_at" integer NOT NULL DEFAULT 0
)
`;

/** The `;`-separated body of `0003_store_v2` (no statement may contain a literal `;`). */
const STORE_V2_SQL = [
    // (a) labels: rebuild with the 4-column observation identity and the raw-evidence columns.
    'ALTER TABLE labels RENAME TO labels_v1',
    LABELS_V2_DDL,
    // `content_hash` is the item's current hash; `run_id` gains NOT NULL, legacy nulls become 'legacy'.
    // The `confidence` CASE keeps a level verbatim (and a hand-seeded NULL as NULL) while a legacy
    // value outside the vocabulary — the pre-0213 numeric payload, which v1's TEXT affinity stored as
    // the string '0.87' — becomes NULL rather than a bogus level the new CHECK would reject.
    `INSERT INTO labels ("item_id", "decision_id", "value", "score", "maker", "source", "confidence", "run_id",
        "labeled_at", "raw_value", "raw_confidence", "reason", "duration_ms", "catalog_version", "content_hash",
        "created_at", "updated_at")
     SELECT l."item_id", l."decision_id", l."value", l."score", l."maker", l."source",
        CASE WHEN l."confidence" IN ('HIGH', 'MEDIUM', 'LOW') THEN l."confidence" ELSE NULL END,
        COALESCE(l."run_id", 'legacy'), l."labeled_at", NULL, NULL, NULL, NULL, NULL, i."content_hash",
        l."created_at", l."updated_at"
     FROM labels_v1 l LEFT JOIN items i ON i.id = l."item_id"`,
    'DROP TABLE labels_v1',
    'CREATE UNIQUE INDEX IF NOT EXISTS "labels_observation_unique" ON "labels" ("item_id", "decision_id", "maker", "run_id")',
    'CREATE INDEX IF NOT EXISTS "labels_item_decision_idx" ON "labels" ("item_id", "decision_id")',
    // (b) items: typed fact columns; values stay NULL until 0227's backfill-facts, except story_id.
    'ALTER TABLE items ADD COLUMN engagement REAL',
    'ALTER TABLE items ADD COLUMN body_chars INTEGER',
    'ALTER TABLE items ADD COLUMN source_tier TEXT',
    'ALTER TABLE items ADD COLUMN lang TEXT',
    'ALTER TABLE items ADD COLUMN domain TEXT',
    'ALTER TABLE items ADD COLUMN story_id TEXT',
    'CREATE INDEX IF NOT EXISTS "items_story_idx" ON "items" ("story_id")',
    'UPDATE items SET story_id = id WHERE story_id IS NULL',
    'UPDATE items SET body_chars = length(body) WHERE body_chars IS NULL',
    // (c) selections: the topic-scoped ledger that replaces episode_usage.
    SELECTIONS_V2_DDL,
    'CREATE UNIQUE INDEX IF NOT EXISTS "selections_identity_unique" ON "selections" ("topic", "item_id", "run_id")',
    'CREATE INDEX IF NOT EXISTS "selections_topic_story_status_idx" ON "selections" ("topic", "story_id", "status")',
    // (d) episode_usage: every row is an ai-news published selection; then the table goes.
    `INSERT INTO selections ("topic", "item_id", "run_id", "story_id", "workflow", "rank", "reason", "status",
        "selected_at", "published_at", "created_at", "updated_at")
     SELECT 'ai-news', "item_id", "run_id", "item_id", "workflow", NULL, NULL, 'published', "used_at", "used_at",
        "created_at", "updated_at"
     FROM episode_usage`,
    'DROP TABLE episode_usage',
].join(';\n');

/**
 * Every store migration, in apply order. Append-only: a released id is never edited, so an
 * already-migrated database always matches a fresh one.
 *
 * `0001` holds the frozen v1 literal ({@link KK_STORE_V1_SQL_FROZEN}) — it no longer derives from
 * the builders, because `0003` rebuilds `labels` and that rebuild cannot converge a fresh database
 * through the duplicate-column trick. `0002` is unchanged; on a fresh `0001` it still repeats a
 * column and is skipped. `0003` is `atomic`: one transaction of journal row plus statements, so a
 * concurrent migrator either wins whole or rolls back whole.
 */
export const KK_MIGRATIONS: readonly KkMigration[] = [
    { id: '0001_kk_store_init', sql: KK_STORE_V1_SQL_FROZEN },
    {
        id: '0002_labels_confidence_run_id',
        // `confidence` is TEXT, matching the frozen `0001` DDL, so on a fresh database the ALTER
        // repeats a column and is skipped (duplicate column) while a database built by the shipped
        // pre-0213 `0001` gets TEXT here — the two then converge, which the oracle compares by TYPE.
        sql: 'ALTER TABLE labels ADD COLUMN confidence TEXT; ALTER TABLE labels ADD COLUMN run_id TEXT;',
    },
    { id: '0003_store_v2', sql: STORE_V2_SQL, atomic: true },
];

/**
 * True when `error` is SQLite's `ALTER TABLE … ADD COLUMN` rejection of a column that already
 * exists. Only the non-atomic migrations tolerate it: the frozen `0001` already carries the columns
 * `0002` adds, but `0003`'s statements are never already-satisfied and must fail closed. Matched on
 * the message because bun:sqlite (the only driver here) exposes no error code across drivers.
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
 * {@link applyKkMigrations} has nothing to write. Pure reads, so routine opens (every `kk store`
 * verb) never take a write lock on the store database.
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
 * Apply one atomic migration as a single transaction: a plain journal `INSERT` (no `ON CONFLICT`,
 * so a loser fails rather than re-running the body) followed by every statement in order.
 * `adapter.batch` is one transaction, so a failure anywhere rolls the whole migration back, journal
 * row included.
 *
 * When the batch throws, the journal is re-read: an id that is now present means a concurrent
 * migrator won the race, which is the successful outcome, not this call's failure. Any other error
 * is rethrown.
 *
 * @returns true when this call applied the migration.
 */
async function applyAtomicMigration(adapter: DbAdapter, migration: KkMigration): Promise<boolean> {
    const operations: DbBatchOp[] = [
        {
            sql: `INSERT INTO "${KK_MIGRATION_JOURNAL}" (id, applied_at) VALUES (?, ?)`,
            params: [migration.id, Date.now()],
        },
        ...splitSqlStatements(migration.sql).map((sql) => ({ sql, params: [] as unknown[] })),
    ];
    try {
        await adapter.batch(operations);
        return true;
    } catch (error) {
        const winner = await adapter.queryFirst<{ id: string }>(
            `SELECT id FROM "${KK_MIGRATION_JOURNAL}" WHERE id = ?`,
            migration.id,
        );
        if (winner != null) return false;
        throw error;
    }
}

/**
 * Apply the store's embedded migrations, journaling each applied id in `__kk_store_migrations`.
 *
 * One statement class is tolerated on the per-statement path: a `duplicate column name` from
 * `ALTER TABLE … ADD COLUMN` means the column is already present (the frozen `0001` carries the
 * columns `0002` adds), so the statement is skipped — and reported to `onSkippedStatement` when
 * given — while every other error still fails closed. An `atomic` migration never uses that path:
 * it is one `adapter.batch` transaction, with its journal row written first (see
 * {@link applyAtomicMigration}).
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

        if (migration.atomic === true) {
            if (await applyAtomicMigration(adapter, migration)) applied += 1;
            continue;
        }

        for (const statement of splitSqlStatements(migration.sql)) {
            try {
                await adapter.exec(statement);
            } catch (error) {
                if (!isDuplicateColumnError(error)) throw error;
                onSkippedStatement?.(statement);
            }
        }
        // Journal with ON CONFLICT DO NOTHING: two processes may migrate the same file concurrently
        // (`kk store migrate` runs before the collect lock is held), and every statement above is
        // idempotent — so losing the race must mean "the other process applied it", not a
        // UNIQUE-constraint failure. `RETURNING id` is empty when this call lost, which keeps
        // `applied` an exact count for the caller.
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
