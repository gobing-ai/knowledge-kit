import { CollectRunsDao } from './dao/collect-runs';
import { ItemsDao } from './dao/items';
import { LabelsDao } from './dao/labels';
import { LocksDao } from './dao/locks';
import { SelectionsDao } from './dao/selections';
import { applyKkMigrations } from './migrations';

/** Options for {@link openStore}. */
export interface OpenStoreOptions {
    /** Absolute path to the SQLite store file (see `resolveStorePath`). */
    path: string;
}

/** An open, migrated store: the DAOs plus the connection lifecycle. */
export interface Store {
    items: ItemsDao;
    collectRuns: CollectRunsDao;
    labels: LabelsDao;
    selections: SelectionsDao;
    locks: LocksDao;
    /** Migrations applied by this open (`0` when the journal was already complete). */
    appliedMigrations: number;
    close(): Promise<void>;
}

/**
 * SQLite busy timeout for the store database. A DAG fan-out and the publishing
 * stages of one run open the same WAL file while a scheduled sibling commits, so
 * a writer retries within this ceiling instead of failing on SQLITE_BUSY
 * immediately. 30s bounds that contention without an unbounded wait.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 30_000;

/**
 * Open (creating if absent) and migrate the kk store database.
 *
 * `@gobing-ai/ts-db` is imported LAZILY so importing `@gobing-ai/kk-store` does
 * not load the Bun-native SQLite driver until a store is actually opened.
 *
 * WAL is set on every open: readers (extract, the ledger) must not block on the
 * collector's write transaction. `busy_timeout` goes through `exec` because
 * ts-db's typed `pragmas` option accepts only journalMode/synchronous/foreignKeys.
 *
 * A failed migration closes the adapter before rethrowing, so a rejected open
 * never leaves the store file's handle behind.
 */
export async function openStore(options: OpenStoreOptions): Promise<Store> {
    const { createDbAdapter } = await import('@gobing-ai/ts-db');
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: options.path });
    try {
        await adapter.exec('PRAGMA journal_mode = WAL');
        await adapter.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
        const appliedMigrations = await applyKkMigrations(adapter);
        return {
            items: new ItemsDao(adapter),
            collectRuns: new CollectRunsDao(adapter),
            labels: new LabelsDao(adapter),
            selections: new SelectionsDao(adapter),
            locks: new LocksDao(adapter),
            appliedMigrations,
            close: async () => {
                adapter.close();
            },
        };
    } catch (error) {
        try {
            adapter.close();
        } catch {
            /* Preserve the open failure. */
        }
        throw error;
    }
}
