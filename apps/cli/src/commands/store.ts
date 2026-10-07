import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { type Command, CommanderError } from 'commander';
import { resolveKkConfigPath } from '../invoke';
import { consoleOutput } from '../output';

/** Options accepted by `kk store migrate`. */
interface MigrateOptions {
    db?: string;
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
        const cause = error instanceof Error ? error.message : String(error);
        const message = `kk.store.migrate.failed: ${cause}`;
        // main() maps the CommanderError to the exit code but does not print it
        // (unlike commander's own errors), so the operator-facing line is written here.
        consoleOutput.error(message);
        throw new CommanderError(1, 'kk.store.migrate.failed', message);
    }
}

/**
 * Register the `store` command group — the kk SQLite store surface.
 *
 * `store migrate` is the only verb here today; the ingest/label/extract verbs land
 * on the same noun as their store DAOs ship.
 */
export function registerStoreCommand(program: Command): void {
    const store = program.command('store').description('Operate the knowledge-kit store (SQLite)');

    store
        .command('migrate')
        .description('Apply pending store migrations (idempotent)')
        .option('--db <path>', 'Store database path (default: kk config store.db_path, else .works/kk.db)')
        .action(migrateAction);
}
