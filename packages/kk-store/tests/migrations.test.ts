/**
 * Store migrations `0001_kk_store_init` (frozen v1 literal), `0002_labels_confidence_run_id` and
 * the atomic `0003_store_v2` — the schema cut-over of task 0225.
 *
 * ## Failure-first list — every way this unit can fail (written before the code)
 *
 * 1. `0001` derives from the v2 builders again, so a fresh database never holds the v1 shape and
 *    the renamed-aside table the labels rebuild expects does not exist.
 * 2. The labels rebuild loses a row: a maker's answer disappears, or a pre-identity NULL `run_id`
 *    fails the new NOT NULL column instead of backfilling to the literal `legacy`.
 * 3. `content_hash` is not backfilled, so an observation made before the cut-over has no item hash.
 * 4. The rebuild leaves the v1 `labels` table (or its `labels_item_decision_unique` index) behind —
 *    fresh and migrated databases then disagree on `sqlite_master`.
 * 5. `0003` applies statement-by-statement: a mid-rebuild failure leaves a half-migrated database
 *    and a journal row that claims success (not atomic).
 * 6. `0003`'s journal insert uses `ON CONFLICT DO NOTHING`, so a racing migrator re-runs the
 *    rebuild instead of failing and rolling back.
 * 7. `items` fact columns are added with the wrong type, or `story_id` / `body_chars` are not
 *    backfilled.
 * 8. `selections` lacks the CHECK, the composite identity, or the `(topic, story_id, status)` index.
 * 9. `episode_usage` rows are not copied (or are copied with the wrong topic/status/story), or the
 *    table survives the cut-over.
 * 10. Re-running the migrator on an already-migrated database applies anything or throws.
 * 11. A fresh database (`0001`→`0003`) and a v1 database carrying data end with different
 *     `sqlite_master` definitions — AC1.
 * 12. The confidence level is lost or coerced by the rebuild: a `HIGH | MEDIUM | LOW` row comes back
 *     as the raw 0–1 payload, as a number, or as `null` (G31 R14 reads this column).
 * 13. The closed confidence vocabulary is not enforced at the storage boundary: a raw write of a value
 *     outside `HIGH | MEDIUM | LOW` is accepted and read back as a level.
 * 14. A legacy confidence outside the vocabulary (the pre-0213 numeric `0.87`) migrates as the
 *     bogus string `'0.87'` instead of `NULL`, so a consumer reads it as a level.
 */

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { openStore } from '../src/index';
import { applyKkMigrations, KK_MIGRATIONS, KK_STORE_V1_SQL_FROZEN } from '../src/migrations';
import { itemsTable, labelsTable, selectionsTable } from '../src/schema';
import { cleanupTempState, makeTempDir, readRaw } from './helpers';

afterAll(cleanupTempState);

/** `0001` + `0002` only — the v1 store a pre-cut-over database holds. */
const V1_MIGRATIONS = KK_MIGRATIONS.slice(0, 2);

/** One table column reduced to the schema contract (order dropped; SQLite appends ADD COLUMN). */
interface ColumnInfo {
    name: string;
    type: string;
    notnull: number;
    pk: number;
    dfltValue: string | null;
}

/** `PRAGMA table_info(<table>)` as a canonical, name-sorted column list. */
function tableColumns(dbPath: string, table: string): ColumnInfo[] {
    const raw = readRaw(dbPath);
    const rows = raw.query(`PRAGMA table_info(${table})`).all() as Array<{
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

/** The `CREATE TABLE` SQL SQLite stored for `name` (`undefined` when absent). */
function schemaSql(dbPath: string, name: string): string | undefined {
    const raw = readRaw(dbPath);
    const row = raw.query('SELECT sql FROM sqlite_master WHERE name = ? LIMIT 1').get(name) as { sql: string } | null;
    raw.close();
    return row?.sql ?? undefined;
}

/** Table and non-internal index names, sorted. */
function schemaObjects(dbPath: string, type: 'table' | 'index'): string[] {
    const raw = readRaw(dbPath);
    const rows = raw
        .query("SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all(type) as Array<{ name: string }>;
    raw.close();
    return rows.map((row) => row.name);
}

/** The ids the store journal holds, in apply order. */
function journalIds(dbPath: string): string[] {
    const raw = readRaw(dbPath);
    const rows = raw.query('SELECT id FROM __kk_store_migrations ORDER BY id').all() as Array<{ id: string }>;
    raw.close();
    return rows.map((row) => row.id);
}

/** The `{name, type, notnull, dflt_value}` an entity builder's `createTableSql` declares, in DDL order. */
function declaredColumns(createTableSql: string): Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
}> {
    return [...createTableSql.matchAll(/^ {2}"([^"]+)" (\w+)(.*?)$/gm)].map((match) => {
        const rest = match[3] ?? '';
        const notnull = rest.includes('NOT NULL') ? 1 : 0;
        const defaultMatch = rest.match(/DEFAULT\s+([^,]+)/);
        const dflt_value = defaultMatch ? (defaultMatch[1] as string).trim() : null;
        return {
            name: match[1] as string,
            type: (match[2] as string).toUpperCase(),
            notnull,
            dflt_value,
        };
    });
}

/** `(name, type, notnull, dflt_value)` from a live table, in DDL order. */
function liveColumns(
    dbPath: string,
    table: string,
): Array<{ name: string; type: string; notnull: number; dflt_value: string | null }> {
    const raw = readRaw(dbPath);
    const rows = raw.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
    }>;
    raw.close();
    return rows.map((row) => ({
        name: row.name,
        type: row.type.toUpperCase(),
        notnull: row.notnull,
        dflt_value: row.dflt_value ?? null,
    }));
}

/**
 * Build a v1 store (`0001` + `0002`) and put one item, two labels (one with a NULL `run_id`) and
 * one `episode_usage` row in it — the data a pre-cut-over database carries.
 */
async function seedV1Store(dbPath: string): Promise<void> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
    try {
        expect(await applyKkMigrations(adapter, V1_MIGRATIONS)).toBe(2);
    } finally {
        adapter.close();
    }
    const raw = new Database(dbPath);
    raw.run(
        `INSERT INTO items (id, canonical_url, content_hash, title, body, source, media_type, metadata_json,
            first_seen_run, last_seen_run, first_seen_at, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            'item-1',
            'https://example.com/a',
            'hash-1',
            'Title',
            'body text',
            '',
            null,
            '{}',
            'run-1',
            'run-1',
            1_000,
            null,
            0,
            0,
        ],
    );
    raw.run(
        `INSERT INTO labels (item_id, decision_id, value, score, maker, source, confidence, run_id, labeled_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['item-1', 'kk-item-quality', '4', 4, 'fm-local', 'model', 'HIGH', null, 1_000, 0, 0],
    );
    raw.run(
        `INSERT INTO labels (item_id, decision_id, value, score, maker, source, confidence, run_id, labeled_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['item-1', 'kk-item-category', 'ai-news', null, 'heuristic', 'heuristic', null, 'run-1', 1_000, 0, 0],
    );
    raw.run(
        `INSERT INTO episode_usage (item_id, workflow, run_id, used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['item-1', 'kk-daily-ai-voice2', 'run-9', 2_000, 0, 0],
    );
    raw.close();
}

describe('applyKkMigrations', () => {
    it('applies 0001–0003 on a fresh database, skipping 0002’s duplicate ALTERs', async () => {
        const dbPath = join(makeTempDir(), 'fresh.db');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        const skipped: string[] = [];
        let applied: number;
        try {
            applied = await applyKkMigrations(adapter, KK_MIGRATIONS, (statement) => skipped.push(statement));
            // Re-running is a no-op: the journal is complete, so nothing is applied and no statement runs.
            expect(await applyKkMigrations(adapter, KK_MIGRATIONS, (statement) => skipped.push(statement))).toBe(0);
        } finally {
            adapter.close();
        }

        expect(applied).toBe(3);
        // The frozen 0001 already carries the two columns 0002 adds, so both ALTERs are skipped.
        expect(skipped).toEqual([
            'ALTER TABLE labels ADD COLUMN confidence TEXT',
            'ALTER TABLE labels ADD COLUMN run_id TEXT',
        ]);
        expect(journalIds(dbPath)).toEqual(['0001_kk_store_init', '0002_labels_confidence_run_id', '0003_store_v2']);
    });

    it('rolls an atomic migration back whole when a statement fails', async () => {
        const dbPath = join(makeTempDir(), 'atomic.db');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        try {
            expect(await applyKkMigrations(adapter, V1_MIGRATIONS)).toBe(2);
            await expect(
                applyKkMigrations(adapter, [
                    ...V1_MIGRATIONS,
                    {
                        id: '0003_broken',
                        sql: 'ALTER TABLE labels RENAME TO labels_v1; SELECT nope FROM missing_table',
                        atomic: true,
                    },
                ]),
            ).rejects.toThrow(/missing_table/);
        } finally {
            adapter.close();
        }

        // The journal row went back with the body: the database stays at v1 and can retry.
        expect(journalIds(dbPath)).toEqual(['0001_kk_store_init', '0002_labels_confidence_run_id']);
        expect(schemaObjects(dbPath, 'table')).not.toContain('labels_v1');
        expect(tableColumns(dbPath, 'labels').map((column) => column.name)).not.toContain('raw_value');
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

    it('freezes 0001 at the v1 shape (five tables, the v1 labels columns, the v1 indexes)', async () => {
        const dbPath = join(makeTempDir(), 'v1-only.db');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: dbPath });
        try {
            expect(await applyKkMigrations(adapter, [KK_MIGRATIONS[0] as (typeof KK_MIGRATIONS)[number]])).toBe(1);
            // `0001` already carries the 0002 columns, because the shipped 0001 derived from builders.
        } finally {
            adapter.close();
        }

        expect(schemaObjects(dbPath, 'table')).toEqual([
            '__kk_store_migrations',
            'collect_runs',
            'episode_usage',
            'items',
            'labels',
            'locks',
        ]);
        expect(schemaObjects(dbPath, 'index')).toEqual([
            'episode_usage_identity_unique',
            'episode_usage_workflow_item_idx',
            'labels_item_decision_unique',
        ]);
        expect(tableColumns(dbPath, 'labels').map((column) => column.name)).toEqual([
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
        expect(tableColumns(dbPath, 'labels').find((column) => column.name === 'run_id')?.notnull).toBe(0);
        expect(KK_STORE_V1_SQL_FROZEN).toContain('episode_usage');
        expect(KK_STORE_V1_SQL_FROZEN).not.toContain('raw_value');
    });
});

describe('0003_store_v2 cut-over', () => {
    it('converges a fresh database and a v1 database carrying data (AC1)', async () => {
        const dir = makeTempDir();
        const freshPath = join(dir, 'fresh.db');
        const fresh = await openStore({ path: freshPath });
        expect(fresh.appliedMigrations).toBe(3);
        await fresh.close();

        const v1Path = join(dir, 'v1.db');
        await seedV1Store(v1Path);
        const migrated = await openStore({ path: v1Path });
        // Only 0003 was pending: a v1 database keeps its 0001/0002 journal rows.
        expect(migrated.appliedMigrations).toBe(1);
        await migrated.close();

        for (const table of ['collect_runs', 'items', 'labels', 'locks', 'selections']) {
            expect(tableColumns(v1Path, table)).toEqual(tableColumns(freshPath, table));
        }
        expect(schemaObjects(v1Path, 'table')).toEqual(schemaObjects(freshPath, 'table'));
        expect(schemaObjects(v1Path, 'index')).toEqual(schemaObjects(freshPath, 'index'));
        expect(journalIds(v1Path)).toEqual(journalIds(freshPath));
        // The rebuilt tables' stored SQL matches too — both paths run the same frozen DDL.
        expect(schemaSql(v1Path, 'labels')).toBe(schemaSql(freshPath, 'labels'));
        expect(schemaSql(v1Path, 'selections')).toBe(schemaSql(freshPath, 'selections'));

        const raw = readRaw(v1Path);
        const labels = raw
            .query('SELECT decision_id, maker, run_id, confidence, content_hash FROM labels ORDER BY decision_id')
            .all();
        const selections = raw
            .query(
                'SELECT topic, item_id, run_id, story_id, workflow, status, selected_at, published_at FROM selections',
            )
            .all();
        const items = raw.query('SELECT id, story_id, body_chars, engagement, domain FROM items').all();
        raw.close();

        // Both observations survived; the pre-identity NULL run_id became the literal 'legacy', each
        // row carries the item's content_hash, and the closed confidence level is untouched — 'HIGH'
        // stays the level text, a row written outside the label pass stays NULL (G31 R14).
        expect(labels).toEqual([
            {
                decision_id: 'kk-item-category',
                maker: 'heuristic',
                run_id: 'run-1',
                confidence: null,
                content_hash: 'hash-1',
            },
            {
                decision_id: 'kk-item-quality',
                maker: 'fm-local',
                run_id: 'legacy',
                confidence: 'HIGH',
                content_hash: 'hash-1',
            },
        ]);
        // The episode_usage row became an ai-news published selection with the item as its story.
        expect(selections).toEqual([
            {
                topic: 'ai-news',
                item_id: 'item-1',
                run_id: 'run-9',
                story_id: 'item-1',
                workflow: 'kk-daily-ai-voice2',
                status: 'published',
                selected_at: 2_000,
                published_at: 2_000,
            },
        ]);
        // story_id and body_chars are backfilled; the other facts wait for 0227.
        expect(items).toEqual([{ id: 'item-1', story_id: 'item-1', body_chars: 9, engagement: null, domain: null }]);
        expect(schemaObjects(v1Path, 'table')).not.toContain('episode_usage');
    });

    it('keeps the closed HIGH | MEDIUM | LOW confidence domain across the rebuild (G31 R14)', async () => {
        const dbPath = join(makeTempDir(), 'confidence.db');
        await seedV1Store(dbPath);
        const raw = new Database(dbPath);
        // One v1 observation per remaining enum level; the seed already carries 'HIGH' and NULL.
        for (const [decisionId, level] of [
            ['kk-item-importance', 'MEDIUM'],
            ['kk-item-urgency', 'LOW'],
        ] as const) {
            raw.run(
                `INSERT INTO labels (item_id, decision_id, value, maker, source, confidence, run_id, labeled_at,
                    created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ['item-1', decisionId, '4', 'fm-local', 'model', level, 'run-1', 1_000, 0, 0],
            );
        }
        raw.close();

        const store = await openStore({ path: dbPath });
        await store.close();

        // The column is still TEXT holding the closed enum, not the raw 0–1 payload.
        expect(tableColumns(dbPath, 'labels').find((column) => column.name === 'confidence')?.type).toBe('TEXT');
        const read = readRaw(dbPath);
        const levels = read.query('SELECT decision_id, confidence FROM labels ORDER BY decision_id').all();
        read.close();
        expect(levels).toEqual([
            { decision_id: 'kk-item-category', confidence: null },
            { decision_id: 'kk-item-importance', confidence: 'MEDIUM' },
            { decision_id: 'kk-item-quality', confidence: 'HIGH' },
            { decision_id: 'kk-item-urgency', confidence: 'LOW' },
        ]);
    });

    it('migrates a legacy confidence outside the vocabulary to NULL, keeping levels verbatim', async () => {
        const dbPath = join(makeTempDir(), 'legacy-confidence.db');
        await seedV1Store(dbPath);
        const raw = new Database(dbPath);
        // A pre-0213 numeric payload and a lowercase spelling: neither is in the closed vocabulary.
        for (const [decisionId, legacy] of [
            ['kk-item-sentiment', 0.87],
            ['kk-item-flag', 'high'],
        ] as const) {
            raw.run(
                `INSERT INTO labels (item_id, decision_id, value, maker, source, confidence, run_id, labeled_at,
                    created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                ['item-1', decisionId, '4', 'fm-local', 'model', legacy, 'run-1', 1_000, 0, 0],
            );
        }
        // The reproduction: the v1 TEXT column stores the number as the string '0.87'.
        const before = raw
            .query("SELECT confidence, typeof(confidence) AS type FROM labels WHERE decision_id = 'kk-item-sentiment'")
            .get();
        raw.close();
        expect(before).toEqual({ confidence: '0.87', type: 'text' });

        const store = await openStore({ path: dbPath });
        await store.close();

        const read = readRaw(dbPath);
        const rows = read.query('SELECT decision_id, confidence FROM labels ORDER BY decision_id').all();
        read.close();
        expect(rows).toEqual([
            { decision_id: 'kk-item-category', confidence: null },
            { decision_id: 'kk-item-flag', confidence: null },
            { decision_id: 'kk-item-quality', confidence: 'HIGH' },
            { decision_id: 'kk-item-sentiment', confidence: null },
        ]);
    });

    it('enforces the selections status CHECK', async () => {
        const dir = makeTempDir();
        const dbPath = join(dir, 'check.db');
        const store = await openStore({ path: dbPath });
        await store.close();

        const raw = new Database(dbPath);
        expect(() =>
            raw.run(
                `INSERT INTO selections (topic, item_id, run_id, story_id, status, selected_at, created_at, updated_at)
                 VALUES ('t', 'i', 'r', 'i', 'bogus', 1, 0, 0)`,
            ),
        ).toThrow(/CHECK/);
        raw.close();
    });

    it('enforces the labels confidence vocabulary at the storage boundary', async () => {
        const dbPath = join(makeTempDir(), 'confidence-check.db');
        const store = await openStore({ path: dbPath });
        await store.close();

        const raw = new Database(dbPath);
        // A fresh run id per write: the observation identity is (item, decision, maker, run).
        let run = 0;
        const insert = (confidence: string | null) =>
            raw.run(
                `INSERT INTO labels (item_id, decision_id, value, maker, source, confidence, run_id, labeled_at,
                    created_at, updated_at)
                 VALUES ('i', 'd', '4', 'm', 'model', ?, ?, 1, 0, 0)`,
                [confidence, `run-${run++}`],
            );
        // Out of vocabulary, in any spelling, is rejected by the schema itself.
        expect(() => insert('BOGUS')).toThrow(/CHECK/);
        expect(() => insert('high')).toThrow(/CHECK/);
        // The vocabulary and the pre-level NULL stay writable.
        expect(() => insert('HIGH')).not.toThrow();
        expect(() => insert('MEDIUM')).not.toThrow();
        expect(() => insert('LOW')).not.toThrow();
        expect(() => insert(null)).not.toThrow();
        raw.close();
    });

    it('migrates a v1 store with colliding episode_usage rows deterministically (0239 R1)', async () => {
        const dbPath = join(makeTempDir(), 'colliding-usage.db');
        await seedV1Store(dbPath);
        const raw = new Database(dbPath);
        // Insert a second row for item-1 and run-9 under a different workflow and later used_at.
        raw.run(`INSERT INTO episode_usage (item_id, workflow, run_id, used_at, created_at, updated_at)
            VALUES ('item-1', 'other-wf', 'run-9', 3000, 3000, 3000)`);
        raw.close();

        const store = await openStore({ path: dbPath });
        const selections = await store.selections.findAll();
        await store.close();

        // Exactly one selections row survived: earliest used_at (2000, workflow 'kk-daily-ai-voice2')
        expect(selections).toEqual([
            {
                topic: 'ai-news',
                itemId: 'item-1',
                runId: 'run-9',
                storyId: 'item-1',
                workflow: 'kk-daily-ai-voice2',
                rank: null,
                reason: null,
                status: 'published',
                selectedAt: 2_000,
                publishedAt: 2_000,
                createdAt: 0,
                updatedAt: 0,
            },
        ]);
    });

    it('keeps the v2 builders and the migrated DDL in lockstep (0239 R2)', async () => {
        const dbPath = join(makeTempDir(), 'parity.db');
        const store = await openStore({ path: dbPath });
        await store.close();

        const builders = [
            ['items', itemsTable],
            ['labels', labelsTable],
            ['selections', selectionsTable],
        ] as const;
        for (const [table, builder] of builders) {
            const declared = declaredColumns(builder.createTableSql);
            expect(liveColumns(dbPath, table)).toEqual(declared);
        }
    });

    it('rejects duplicate (item_id, decision_id, maker, run_id) via labels_observation_unique (0239 R2)', async () => {
        const dbPath = join(makeTempDir(), 'label-unique.db');
        const store = await openStore({ path: dbPath });
        await store.close();

        const raw = new Database(dbPath);
        raw.run(`INSERT INTO labels (item_id, decision_id, value, maker, source, run_id, labeled_at)
            VALUES ('item-1', 'kk-item-quality', 'HIGH', 'fm-local', 'heuristic', 'run-1', 1000)`);
        expect(() => {
            raw.run(`INSERT INTO labels (item_id, decision_id, value, maker, source, run_id, labeled_at)
                VALUES ('item-1', 'kk-item-quality', 'LOW', 'fm-local', 'heuristic', 'run-1', 2000)`);
        }).toThrow(/UNIQUE constraint failed/);
        raw.close();
    });

    it('rejects a store whose journal holds an unknown migration id (0242 R1 / AC1)', async () => {
        const dbPath = join(makeTempDir(), 'future-schema.db');
        const store = await openStore({ path: dbPath });
        await store.close();

        const raw = new Database(dbPath);
        raw.run("INSERT INTO __kk_store_migrations (id, applied_at) VALUES ('9999_future_migration', 999999)");
        const beforeJournal = raw.query('SELECT id FROM __kk_store_migrations ORDER BY id').all();
        raw.close();

        await expect(openStore({ path: dbPath })).rejects.toThrow(/kk\.store\.schema-newer.*9999_future_migration/);

        const rawAfter = readRaw(dbPath);
        const afterJournal = rawAfter.query('SELECT id FROM __kk_store_migrations ORDER BY id').all();
        rawAfter.close();
        expect(afterJournal).toEqual(beforeJournal);
    });

    it('openStore({ migrate: false }) reads a behind store without upgrading it (0242 R6 / AC6)', async () => {
        const dbPath = join(makeTempDir(), 'read-only-open.db');
        await seedV1Store(dbPath);
        const v1Journal = ['0001_kk_store_init', '0002_labels_confidence_run_id'];
        expect(journalIds(dbPath)).toEqual(v1Journal);

        // The read-only open: no DDL, no journal write, nothing reported as applied.
        const reading = await openStore({ path: dbPath, migrate: false });
        expect(reading.appliedMigrations).toBe(0);
        await reading.close();
        expect(journalIds(dbPath)).toEqual(v1Journal);

        // Control — the assertion above is only load-bearing if the SAME store would otherwise be
        // upgraded. The default open applies exactly `0003_store_v2` and journals it.
        const migrating = await openStore({ path: dbPath });
        expect(migrating.appliedMigrations).toBe(1);
        await migrating.close();
        expect(journalIds(dbPath)).toEqual([...v1Journal, '0003_store_v2']);
    });
});
