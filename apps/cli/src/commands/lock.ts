import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { type Command, CommanderError } from 'commander';
import { resolveKkConfigPath } from '../invoke';
import { consoleOutput } from '../output';

/** Default lock TTL for `kk lock acquire`: 2 h (20261006 collection took ~32 min). */
const DEFAULT_LOCK_TTL_MS = 7_200_000;

/** Options accepted by `kk lock acquire` (and the hidden `kk store lock acquire`). */
interface LockAcquireOptions {
    name: string;
    run: string;
    ttl: string;
    db?: string;
}

/** Options accepted by `kk lock release` (and the hidden `kk store lock release`). */
interface LockReleaseOptions {
    name: string;
    run: string;
    db?: string;
}

/**
 * Fail loud: print the `kk.store.lock.failed: <cause>` contract line and throw a
 * `CommanderError` that `main()` maps to exit code 1 (command modules never
 * terminate the process directly). Local to this module, like every sibling
 * `commands/*.ts`; the code string is the route-independent contract both the
 * canonical and the legacy spelling share.
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
 * `kk lock acquire --name <lock> --run <id> [--ttl <ms>] [--db <path>]` — take
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
 * `kk lock release --name <lock> --run <id> [--db <path>]` — free the lock iff this
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
 * Register `acquire`/`release` under a `lock` parent — canonical `kk lock` (visible)
 * and the hidden legacy `kk store lock` share this one registrar and the one pair of
 * SQLite action engines (A22 R3 / ADR-037). `hidden` drops the legacy parent from
 * help without changing a flag, default, JSON line, exit code or DB effect.
 */
export function registerLockCommand(parent: Command, hidden = false): void {
    const lock = parent.command('lock', { hidden }).description('Single-flight locks over the store');

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
}
