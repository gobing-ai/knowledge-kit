/**
 * Task 0209 R4 — the `labels` columns migration: `0002_labels_confidence_run_id`.
 *
 * A fresh database's `0001` derives its DDL from the live `defineTable(...)` schema,
 * so it already carries `confidence`/`run_id` while a database the shipped `0001`
 * built does not. The same `0002` therefore runs its `ADD COLUMN` against columns
 * that exist (fresh) and columns that do not (migrated); the migrator must skip the
 * duplicate and fail closed on anything else.
 *
 * Failure-first list (written before the runner change):
 *  1. A fresh open applies `0001` + `0002` but the duplicate-column `ALTER` throws,
 *     so an empty store cannot be created at all.
 *  2. The duplicate skip is silent — not reported to the caller.
 *  3. A genuine migration error (no such table) is swallowed instead of failing closed,
 *     leaving a half-migrated database journaled.
 *  4. A fresh database and a rewound 0206-era database (journal back to `0001`) end
 *     with different `labels` columns.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { openStore } from '../src/index';
import { applyKkMigrations, KK_MIGRATIONS } from '../src/migrations';
import { cleanupTempState, makeTempDir, REPO_ROOT, readRaw } from './helpers';

afterAll(cleanupTempState);

const ARTIFACT_DIR = join(REPO_ROOT, '.works/test-artifacts/0209');

/** One `labels` column reduced to what the schema contract covers (order-independent). */
interface LabelColumn {
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dfltValue: string | null;
}

/**
 * `PRAGMA table_info(labels)` as a canonical, name-sorted column list — the oracle for
 * "the two databases converged". Column order is deliberately dropped: SQLite appends
 * an `ADD COLUMN` at the end while `0001` declares it mid-table, and DAO access binds
 * by name, so order carries no contract.
 */
function labelColumns(dbPath: string): LabelColumn[] {
    const raw = readRaw(dbPath);
    const rows = raw.query('PRAGMA table_info(labels)').all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
        dflt_value: string | null;
    }>;
    raw.close();
    return rows
        .map((row) => ({
            name: row.name,
            type: row.type.toUpperCase(),
            notnull: row.notnull,
            pk: row.pk,
            dfltValue: row.dflt_value,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** The ids the store journal holds, in apply order. */
function journalIds(dbPath: string): string[] {
    const raw = readRaw(dbPath);
    const rows = raw.query('SELECT id FROM __kk_store_migrations ORDER BY id').all() as Array<{ id: string }>;
    raw.close();
    return rows.map((row) => row.id);
}

describe('applyKkMigrations (0209 R4)', () => {
    it('skips and reports the duplicate-column ALTER a fresh 0001 already carries', async () => {
        const dbPath = join(makeTempDir(), 'tolerance.db');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        const skipped: string[] = [];
        let applied: number;
        try {
            applied = await applyKkMigrations(adapter, KK_MIGRATIONS, (statement) => skipped.push(statement));
        } finally {
            adapter.close();
        }

        // Both apply, because a fresh 0001 derives its DDL from the live schema and
        // therefore already holds the two columns 0002 adds.
        expect(applied).toBe(2);
        expect(skipped).toEqual([
            'ALTER TABLE labels ADD COLUMN confidence INTEGER',
            'ALTER TABLE labels ADD COLUMN run_id TEXT',
        ]);
        expect(journalIds(dbPath)).toEqual(['0001_kk_store_init', '0002_labels_confidence_run_id']);
    });

    it('still fails closed on a migration error that is not a duplicate column', async () => {
        const dbPath = join(makeTempDir(), 'fail-closed.db');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        try {
            await expect(
                applyKkMigrations(adapter, [
                    { id: '0001_kk_store_init', sql: 'CREATE TABLE items (id TEXT)' },
                    { id: '0002_broken', sql: 'SELECT nope FROM missing_table' },
                ]),
            ).rejects.toThrow(/missing_table/);
        } finally {
            adapter.close();
        }

        // The failure is not journaled: the database stays at 0001, so a retry re-runs 0002.
        expect(journalIds(dbPath)).toEqual(['0001_kk_store_init']);
    });

    it('converges a fresh database and a 0206-era database rewound to migration 0001', async () => {
        const dir = makeTempDir();

        // Fresh: 0001 (its DDL already carries the columns) + 0002 (both ALTERs skipped).
        const freshPath = join(dir, 'fresh.db');
        const fresh = await openStore({ path: freshPath });
        expect(fresh.appliedMigrations).toBe(2);
        await fresh.close();

        // 0206 era: the same file with the two columns dropped (SQLite removes the trailing
        // columns 0002 added, leaving the exact shape the shipped 0001 produced) and the
        // 0002 journal row deleted — then reopened so 0002's ALTERs run for real.
        const migratedPath = join(dir, 'migrated.db');
        const migrated = await openStore({ path: migratedPath });
        await migrated.close();
        const rewind = new Database(migratedPath);
        rewind.run('ALTER TABLE labels DROP COLUMN confidence');
        rewind.run('ALTER TABLE labels DROP COLUMN run_id');
        rewind.run("DELETE FROM __kk_store_migrations WHERE id = '0002_labels_confidence_run_id'");
        rewind.close();
        expect(journalIds(migratedPath)).toEqual(['0001_kk_store_init']);
        expect(labelColumns(migratedPath).some((column) => column.name === 'confidence')).toBe(false);

        const reopened = await openStore({ path: migratedPath });
        expect(reopened.appliedMigrations).toBe(1);
        await reopened.close();

        const freshColumns = labelColumns(freshPath);
        const migratedColumns = labelColumns(migratedPath);
        expect(migratedColumns).toEqual(freshColumns);
        expect(freshColumns.map((column) => column.name)).toEqual([
            'confidence',
            'created_at',
            'decision_id',
            'item_id',
            'labeled_at',
            'maker',
            'run_id',
            'score',
            'source',
            'updated_at',
            'value',
        ]);

        mkdirSync(ARTIFACT_DIR, { recursive: true });
        writeFileSync(
            join(ARTIFACT_DIR, 'kk-store-labels-convergence.json'),
            `${JSON.stringify(
                {
                    task: '0209',
                    invariant:
                        'fresh 0001 + 0002 and a 0206-era database rewound to 0001 end with the same labels columns',
                    fresh: { journal: journalIds(freshPath), columns: freshColumns },
                    migrated: { journal: journalIds(migratedPath), columns: migratedColumns },
                },
                null,
                2,
            )}\n`,
        );
    });
});
