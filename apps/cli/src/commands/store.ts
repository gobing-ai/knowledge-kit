import { dirname } from 'node:path';
import { type Doc, DocListSchema } from '@gobing-ai/kk-core';
import { type ItemsDao, itemId, openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { type Command, CommanderError } from 'commander';
import { resolveKkConfigPath } from '../invoke';
import { consoleOutput } from '../output';
import { readPluginJson } from '../plugin-output';

/** Default lock TTL for `kk store lock acquire`: 2 h (20261006 collection took ~32 min). */
const DEFAULT_LOCK_TTL_MS = 7_200_000;

/** Options accepted by `kk store migrate`. */
interface MigrateOptions {
    db?: string;
}

/** Options accepted by `kk store lock acquire`. */
interface LockAcquireOptions {
    name: string;
    run: string;
    ttl: string;
    db?: string;
}

/** Options accepted by `kk store lock release`. */
interface LockReleaseOptions {
    name: string;
    run: string;
    db?: string;
}

/** Options accepted by `kk store ingest`. */
interface IngestOptions {
    run: string;
    in: string;
    newIds: string;
    db?: string;
}

/**
 * Fail loud: print the `kk.store.<verb>.failed: <cause>` contract line and throw a
 * `CommanderError` that `main()` maps to exit code 1 (command modules never
 * terminate the process directly).
 */
function failLoud(code: string, error: unknown): never {
    const cause = error instanceof Error ? error.message : String(error);
    const message = `${code}: ${cause}`;
    consoleOutput.error(message);
    throw new CommanderError(1, code, message);
}

/** Parse `--ttl <ms>`: a non-negative millisecond count, rejected loudly when it is not. */
function parseTtl(raw: string): number {
    const ttlMs = Number(raw);
    if (!Number.isInteger(ttlMs) || ttlMs < 0) {
        throw new Error(`--ttl must be a non-negative integer (milliseconds), got '${raw}'`);
    }
    return ttlMs;
}

/**
 * `kk store migrate [--db <path>]` — apply pending store migrations, print
 * `{ db, applied }`.
 *
 * Idempotent: a second run against the same database reports `applied: 0` (the
 * migrator answers from the journal without taking a write lock). Any failure
 * throws a `CommanderError` whose exit code is 1 and whose message carries the
 * `kk.store.migrate.failed: <cause>` contract.
 */
async function migrateAction(options: MigrateOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        const applied = store.appliedMigrations;
        await store.close();
        consoleOutput.write(JSON.stringify({ db: dbPath, applied }));
    } catch (error) {
        // main() maps the CommanderError to the exit code but does not print it
        // (unlike commander's own errors), so the operator-facing line is written here.
        failLoud('kk.store.migrate.failed', error);
    }
}

/**
 * `kk store lock acquire --name <lock> --run <id> [--ttl <ms>] [--db <path>]` — take
 * the named single-flight lock, print `{"acquired":true}`, or `{"skipped":"locked",
 * "holder":<run>}` (exit 0) when another run holds a claim inside its TTL.
 *
 * Skipping is a normal outcome, not a failure: the scheduler's next tick retries. The
 * claim is re-entrant for the same `--run` and is stolen once `acquired_at + ttl`
 * passes, which is what covers a crashed holder (see `LocksDao.acquire`).
 */
async function lockAcquireAction(options: LockAcquireOptions): Promise<void> {
    try {
        const ttlMs = parseTtl(options.ttl);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            if (await store.locks.acquire(options.name, options.run, ttlMs)) {
                consoleOutput.write(JSON.stringify({ acquired: true }));
                return;
            }
            const holder = await store.locks.current(options.name);
            consoleOutput.write(JSON.stringify({ skipped: 'locked', holder: holder?.ownerRun ?? null }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.lock.failed', error);
    }
}

/**
 * `kk store lock release --name <lock> --run <id> [--db <path>]` — free the lock iff this
 * run still owns it, print `{released}`.
 *
 * A run that lost the claim (stolen past its TTL) releases nothing — `released: false` is
 * the honest answer, and still exit 0: the workflow's release step must never fail a run
 * whose work is already stored.
 */
async function lockReleaseAction(options: LockReleaseOptions): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            const released = await store.locks.release(options.name, options.run);
            consoleOutput.write(JSON.stringify({ released }));
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.lock.failed', error);
    }
}

/**
 * Read and validate one `Doc[]` input file through the shared plugin-output reader (the
 * ts-runtime file seam plus the executor's DocListSchema wording), so `kk store ingest`
 * rejects the same shapes `kk executor fan-in` rejects.
 */
async function readDocList(fs: FileSystem, path: string): Promise<Doc[]> {
    if (!(await fs.exists(path))) {
        throw new Error(`input file not found: ${path}`);
    }
    return readPluginJson(fs, path, DocListSchema, `Store ingest input '${path}'`, 'is not a Doc[]');
}

/**
 * Ids of already-stored items the incoming Docs change — the half of `--new-ids` that
 * `ItemsDao.upsertDocs` invalidates labels for.
 *
 * `UpsertDocsResult` reports the inserted ids only, so this derives the other half: an
 * existing item whose stored `title`/`body` differ from the incoming Doc — the two fields
 * `content_hash` is computed over, compared directly instead of re-hashing. It must run
 * BEFORE the upsert, which overwrites those columns.
 */
async function invalidatedIds(items: ItemsDao, docs: readonly Doc[]): Promise<string[]> {
    const byId = new Map<string, Doc>();
    for (const doc of docs) {
        byId.set(itemId(doc), doc);
    }
    const invalidated: string[] = [];
    for (const [id, doc] of byId) {
        const stored = await items.findById(id);
        if (stored === undefined) {
            continue;
        }
        if (stored.title !== (doc.title ?? '') || stored.body !== doc.body) {
            invalidated.push(id);
        }
    }
    return invalidated;
}

/** Write the labelling input (`--new-ids`), creating its parent directory. */
async function writeNewIds(fs: FileSystem, path: string, ids: readonly string[]): Promise<void> {
    await fs.ensureDir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify([...new Set(ids)], null, 2)}\n`);
}

/**
 * `kk store ingest --run <id> --in <Doc[].json> --new-ids <path> [--db <path>]` — upsert one
 * run's Docs, record its `collect_runs` provenance row, and print
 * `{inserted, updated, unchanged}`.
 *
 * `--new-ids` receives the ids the next label pass must decide: the inserted items plus the
 * known items whose content changed (their labels were invalidated with the update). One
 * `ItemsDao.upsertDocs` batch, so a rejected write stores nothing — the run's own workflow
 * state routes to its lock-releasing failure path and the next tick retries.
 */
async function ingestAction(options: IngestOptions): Promise<void> {
    try {
        const fs = createNodeFileSystem();
        const docs = await readDocList(fs, options.in);
        const dbPath = await resolveStorePath(resolveKkConfigPath(), options.db);
        const store = await openStore({ path: dbPath });
        try {
            const invalidated = await invalidatedIds(store.items, docs);
            await store.collectRuns.start({ runId: options.run });
            const result = await store.items.upsertDocs(options.run, docs);
            await store.collectRuns.finish(options.run, {
                status: 'done',
                inserted: result.inserted,
                updated: result.updated,
            });
            await writeNewIds(fs, options.newIds, [...result.newIds, ...invalidated]);
            consoleOutput.write(
                JSON.stringify({
                    inserted: result.inserted,
                    updated: result.updated,
                    unchanged: result.unchanged,
                }),
            );
        } finally {
            await store.close();
        }
    } catch (error) {
        failLoud('kk.store.ingest.failed', error);
    }
}

/**
 * Register the `store` command group — the kk SQLite store surface.
 *
 * `migrate` brings the schema up; `lock` is the single-flight guard the scheduled
 * `kk-collect` tick takes before collecting; `ingest` is the write path that turns one run's
 * collected `Doc[]` into `items` rows plus its `collect_runs` provenance. The label/extract/
 * mark-used verbs land on the same noun as their store DAOs ship.
 */
export function registerStoreCommand(program: Command): void {
    const store = program.command('store').description('Operate the knowledge-kit store (SQLite)');

    store
        .command('migrate')
        .description('Apply pending store migrations (idempotent)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(migrateAction);

    const lock = store.command('lock').description('Single-flight locks over the store');

    lock.command('acquire')
        .description('Take the named lock for this run; prints {acquired} or {skipped, holder} (exit 0 both ways)')
        .requiredOption('--name <lock>', 'Lock name (e.g. collect)')
        .requiredOption('--run <id>', 'Owning run id (re-entrant for the same id)')
        .option('--ttl <ms>', 'Claim lifetime for a dead holder, in milliseconds', String(DEFAULT_LOCK_TTL_MS))
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(lockAcquireAction);

    lock.command('release')
        .description('Release the named lock iff this run still owns it; prints {released}')
        .requiredOption('--name <lock>', 'Lock name (e.g. collect)')
        .requiredOption('--run <id>', 'Owning run id')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(lockReleaseAction);

    store
        .command('ingest')
        .description('Upsert one run of collected Docs and record its collect_runs row; prints the counts')
        .requiredOption('--run <id>', 'Collect run id (also the items provenance stamp)')
        .requiredOption('--in <path>', 'Input Doc[] JSON file')
        .requiredOption('--new-ids <path>', 'Output path for the ids the next label pass must decide')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(ingestAction);
}
