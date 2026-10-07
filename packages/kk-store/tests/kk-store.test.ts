/**
 * E2E: `@gobing-ai/kk-store` against a real SQLite file in a temp dir — the store the
 * collect/daily-voice workflows open — plus the repeatable evidence artifact.
 *
 * The module-level unit suites live next to their sources (`canonical-url.test.ts`,
 * `config.test.ts`, `dao/*.test.ts`); this file is the integration surface: open →
 * migrate → write → read, with WAL/busy-timeout behavior and a real file on disk.
 *
 * ## Failure-first list — every way this unit can fail (written before the code)
 *
 * 1. `openStore` on an unwritable/missing parent dir does not reject (it hangs or
 *    silently opens elsewhere) — the CLI must fail loudly, not write to cwd.
 * 2. A corrupt (non-SQLite) DB file opens successfully and the failure surfaces later,
 *    far from the cause.
 * 3. `openStore` leaks the adapter when the pragmas/migration throw — a rejected open
 *    must not keep the store file handle.
 * 4. Migration 0001 is not idempotent: a second open reports a non-zero count, or
 *    re-running its DDL fails (`CREATE TABLE` without IF NOT EXISTS).
 * 5. The already-migrated fast path takes a write lock on a shared file.
 * 6. Two concurrent openers of the same fresh file both journal `0001` — one wins on
 *    the UNIQUE journal key and the other open rejects.
 * 7. `PRAGMA journal_mode` is not `wal`, or `busy_timeout` is not raised: a second
 *    writer gets SQLITE_BUSY instead of waiting for the lock holder.
 * 8. `upsertDocs` is not atomic — a failed batch leaves part of a run stored.
 * 9. `upsertDocs` miscounts inserted/updated/unchanged, or counts one id twice when a
 *    batch repeats it.
 * 10. A `content_hash` change does NOT clear that item's labels — labels answer text
 *     that no longer exists and are never re-run.
 * 11. Upsert does not refresh provenance (`last_seen_run`, `canonical_url`) or
 *     overwrites `first_seen_run`/`first_seen_at`.
 * 12. `canonicalUrl` throws on a scheme-less URL, an IDN host, a query-only-tracking
 *     URL, a fragment-only input, or a non-URL string.
 * 13. `canonicalUrl` keeps tracking params, keeps query order, keeps the fragment, or
 *     strips the root slash — the same page then hashes to different ids.
 * 14. `itemId` is URL-only, or ignores `metadata.originalUrl`, so two URLs for one page
 *     (or two URL-less Docs with different text) collide or split.
 * 15. `resolveStorePath` mis-resolves `store.db_path`: `~` not expanded, a relative path
 *     resolved against the config file instead of cwd, blank/non-string/unparseable
 *     values not falling back, missing config file not falling back, or the parent
 *     directory left uncreated.
 * 16. `LocksDao.acquire` hands one lock to two runs, is not re-entrant for the holder,
 *     never steals an expired claim, or `release` deletes another run's row.
 * 17. `EpisodeUsageDao.markUsed` duplicates a row on a retried run, or `usedItemIds`
 *     leaks another workflow's rows.
 * 18. `kk store migrate` prints a non-JSON line or the wrong shape, is not idempotent
 *     across two runs, or exits 0 when the database cannot be opened.
 */
import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalUrl, itemId, openStore, type Store } from '../src/index';
import {
    ARTIFACT_DIR,
    cleanupTempState,
    DOC_WITH_URL,
    DOC_WITHOUT_URL,
    makeTempDir,
    openTempStore,
    readRaw,
} from './helpers';

afterAll(cleanupTempState);

describe('openStore', () => {
    it('applies migration 0001 once, journals it, and keeps the schema', async () => {
        const dir = makeTempDir();
        const { store, dbPath } = await openTempStore(dir);
        expect(store.appliedMigrations).toBe(1);
        await store.close();

        const raw = readRaw(dbPath);
        const journal = raw.query('SELECT id FROM __kk_store_migrations').all() as Array<{ id: string }>;
        const tables = raw.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{
            name: string;
        }>;
        const indexes = raw
            .query("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all() as Array<{ name: string }>;
        raw.close();

        expect(journal.map((row) => row.id)).toEqual(['0001_kk_store_init']);
        expect(tables.map((row) => row.name)).toEqual([
            '__kk_store_migrations',
            'collect_runs',
            'episode_usage',
            'items',
            'labels',
            'locks',
        ]);
        expect(indexes.map((row) => row.name)).toEqual([
            'episode_usage_identity_unique',
            'episode_usage_workflow_item_idx',
            'labels_item_decision_unique',
        ]);

        const reopened = await openStore({ path: dbPath });
        expect(reopened.appliedMigrations).toBe(0);
        await reopened.close();
    });

    it('enables WAL and waits past ts-db default timeout for a competing writer instead of failing on SQLITE_BUSY', async () => {
        const dir = makeTempDir();
        const { store, dbPath } = await openTempStore(dir);
        await store.items.upsertDocs('run-warm', [DOC_WITHOUT_URL]);

        const raw = readRaw(dbPath);
        const mode = raw.query('PRAGMA journal_mode').get() as { journal_mode: string };
        raw.close();
        expect(mode.journal_mode).toBe('wal');

        // `busy_timeout` is per-connection and the Store interface deliberately hides the
        // adapter, so it is proven behaviorally: a second PROCESS holds the write lock for
        // longer than ts-db's own 5000 ms default. The store's write still succeeds (and the
        // elapsed time shows it waited), which only holds with the 30000 ms this package sets;
        // at the default it would have thrown SQLITE_BUSY at ~5 s.
        const holdMs = 5_400;
        const marker = join(dir, 'lock-holder.ready');
        const lockerPath = join(dir, 'lock-holder.ts');
        writeFileSync(
            lockerPath,
            [
                "import { Database } from 'bun:sqlite';",
                "import { writeFileSync } from 'node:fs';",
                'const [dbPath, markerPath, holdMs] = process.argv.slice(2);',
                'const holder = new Database(dbPath as string);',
                "holder.run('BEGIN IMMEDIATE');",
                "writeFileSync(markerPath as string, 'locked');",
                'const until = Date.now() + Number(holdMs);',
                'while (Date.now() < until) {}',
                "holder.run('COMMIT');",
                'holder.close();',
            ].join('\n'),
        );
        const holder = Bun.spawn({
            cmd: [process.execPath, lockerPath, dbPath, marker, String(holdMs)],
            stdout: 'ignore',
            stderr: 'pipe',
        });
        const deadline = Date.now() + 5_000;
        while (!existsSync(marker) && Date.now() < deadline) {
            await Bun.sleep(20);
        }
        expect(existsSync(marker)).toBe(true);

        const started = Date.now();
        const result = await store.items.upsertDocs('run-wait', [{ id: 'doc-3', body: 'waits for the lock' }]);
        const elapsed = Date.now() - started;
        expect(result.inserted).toBe(1);
        expect(elapsed).toBeGreaterThan(5_000);
        await holder.exited;
    }, 30_000);

    it('rejects a corrupt database file', async () => {
        const dir = makeTempDir();
        const dbPath = join(dir, 'corrupt.db');
        writeFileSync(dbPath, 'this is not a sqlite database');

        await expect(openStore({ path: dbPath })).rejects.toThrow();
    });

    it('rejects a store path that cannot be opened', async () => {
        await expect(openStore({ path: makeTempDir() })).rejects.toThrow();
    });

    it('rejects a database it opened but cannot migrate, instead of reporting success', async () => {
        const dir = makeTempDir();
        const dbPath = join(dir, 'foreign.db');
        const foreign = new Database(dbPath);
        // A file that already carries the journal's name but not its shape: v1's DDL
        // succeeds against it and the journal write is what fails, so the rejection comes
        // from inside openStore after the adapter exists (the close-before-rethrow path).
        foreign.run('CREATE TABLE __kk_store_migrations (id TEXT PRIMARY KEY)');
        foreign.close();

        await expect(openStore({ path: dbPath })).rejects.toThrow(/applied_at/);
    });

    it('lets two concurrent openers of one fresh file both succeed, journaling 0001 once', async () => {
        const dir = makeTempDir();
        const dbPath = join(dir, 'race.db');
        const [a, b] = await Promise.all([openStore({ path: dbPath }), openStore({ path: dbPath })]);

        expect(a.appliedMigrations + b.appliedMigrations).toBe(1);
        const raw = readRaw(dbPath);
        const journal = raw.query('SELECT COUNT(*) AS n FROM __kk_store_migrations').get() as { n: number };
        raw.close();
        expect(journal.n).toBe(1);
        await a.close();
        await b.close();
    });
});

describe('one collect run end to end', () => {
    const runId = '2026-10-07T13:00';
    let store: Store;
    let dbPath: string;

    beforeAll(async () => {
        const opened = await openTempStore(makeTempDir(), 'e2e-flow.db');
        store = opened.store;
        dbPath = opened.dbPath;
    });

    it('takes the run lock, ingests both Docs, labels them, and marks usage', async () => {
        expect(await store.locks.acquire('collect', runId, 7_200_000)).toBe(true);
        await store.collectRuns.start({ runId, sourceCounts: { 'web-search': 1 } });

        const ingested = await store.items.upsertDocs(runId, [DOC_WITH_URL, DOC_WITHOUT_URL]);
        expect(ingested.inserted).toBe(2);
        await store.collectRuns.finish(runId, {
            status: 'done',
            inserted: ingested.inserted,
            updated: ingested.updated,
            sourceCounts: { 'web-search': 1 },
        });

        for (const id of ingested.newIds) {
            await store.labels.upsertLabel({
                itemId: id,
                decisionId: 'kk-item-category',
                value: 'ai-news',
                maker: 'heuristic',
                source: 'heuristic',
            });
        }
        await store.usage.markUsed({ itemId: ingested.newIds[0] as string, workflow: 'kk-daily-ai-voice2', runId });

        const run = await store.collectRuns.findById(runId);
        expect(run?.status).toBe('done');
        expect(run?.inserted).toBe(2);
        expect(await store.labels.listForItem(ingested.newIds[0] as string)).toHaveLength(1);
        expect(await store.usage.usedItemIds('kk-daily-ai-voice2')).toEqual([ingested.newIds[0] as string]);
        expect((await store.items.findAll()).map((row) => row.lastSeenRun)).toEqual([runId, runId]);

        // A second run re-ingesting the same Docs is unchanged, and re-labelling is skipped
        // because the stored labels are still answerable (no content_hash change).
        const again = await store.items.upsertDocs('2026-10-07T17:00', [DOC_WITH_URL, DOC_WITHOUT_URL]);
        expect(again).toEqual({ inserted: 0, updated: 0, unchanged: 2, newIds: [] });
        expect(await store.labels.listForItem(ingested.newIds[0] as string)).toHaveLength(1);
    });

    it('leaves the store DB, schema and journal evidence under .works/test-artifacts/0206', async () => {
        mkdirSync(ARTIFACT_DIR, { recursive: true });
        await store.close();

        copyFileSync(dbPath, join(ARTIFACT_DIR, 'kk-store.db'));
        const raw = readRaw(dbPath);
        const schema = raw
            .query("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
            .all();
        const journal = raw.query('SELECT id, applied_at FROM __kk_store_migrations ORDER BY id').all();
        const items = raw.query('SELECT id, canonical_url, source, content_hash FROM items ORDER BY id').all();
        const mode = raw.query('PRAGMA journal_mode').get();
        raw.close();

        writeFileSync(
            join(ARTIFACT_DIR, 'kk-store.json'),
            `${JSON.stringify(
                {
                    task: '0206',
                    dbPath,
                    journalMode: mode,
                    journal,
                    schema,
                    items,
                    canonicalUrlSamples: {
                        campaign: canonicalUrl(DOC_WITH_URL.sourceUri ?? ''),
                        idn: canonicalUrl('https://例え.テスト/パス'),
                        schemeLess: canonicalUrl('example.com/x?utm_source=a#f'),
                    },
                    itemIds: { withUrl: itemId(DOC_WITH_URL), withoutUrl: itemId(DOC_WITHOUT_URL) },
                },
                null,
                2,
            )}\n`,
        );
        writeFileSync(
            join(ARTIFACT_DIR, 'README.md'),
            [
                '# 0206 — kk-store evidence',
                '',
                'Reproduced by `bun test packages/kk-store` (the E2E suite is',
                '`packages/kk-store/tests/kk-store.test.ts`).',
                '',
                '| File | What it is |',
                '| --- | --- |',
                '| `kk-store.db` | the store after one collect run (WAL) — `items`, `labels`, `collect_runs`, journal |',
                '| `kk-store.json` | journal mode, migration journal, `sqlite_master` (tables + indexes), canonical URL samples |',
                '| `kk-store-cli.db` | the database written by the spawned `kk store migrate --db …` runs |',
                '| `kk-store-migrate.json` | stdout of both `kk store migrate` runs (`applied` 1, then 0) |',
                '| `kk-store-migrate-error.txt` | stderr + exit code of `kk store migrate` against an unopenable path |',
                '',
                'Reproduce end to end: `bun test packages/kk-store apps/cli/tests/commands/store.test.ts`.',
                '',
            ].join('\n'),
        );

        const artifacts = ['kk-store.db', 'kk-store.json'];
        for (const name of artifacts) {
            const file = join(ARTIFACT_DIR, name);
            expect(existsSync(file)).toBe(true);
            expect(readFileSync(file).byteLength).toBeGreaterThan(0);
        }
    });
});
