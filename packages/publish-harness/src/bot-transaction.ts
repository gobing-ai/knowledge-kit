import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { assertSafeBotName, BotError } from './bot';
import { copyProfileEntry, lstat, mkdirExclusive, rmdir } from './bot-fs';

/**
 * Crash-safe staging/promotion for `kk bot login` (task 0276, design §Transactions). A login
 * writes an isolated `<name>-<uuid>` transaction under
 * `~/.config/kk/browser-transactions/` while holding the logical-profile lease, then promotes
 * the staged profile into place with a single atomic rename and a restorable backup. The
 * previous final profile is never dropped before the new one is safely moved; a broken
 * promotion leaves its evidence intact instead of deleting it (design §Transactions).
 *
 * Ordinary rename/delete/read go through the ts-runtime FileSystem seam; only the exclusive
 * owner-only mkdir, no-follow stat and symlink-refusing copy come from the `bot-fs` adapter.
 */

/** Default transaction root. Injected (`transactionRoot`) in tests/probes — never the real home. */
export const DEFAULT_BOT_TRANSACTION_ROOT = join(homedir(), '.config', 'kk', 'browser-transactions');
const STAGE_DIR = 'stage';
const BACKUP_DIR = 'backup';
const JOURNAL_FILE = 'journal.json';

/** Journal phase, in promotion order. */
export type TransactionPhase = 'prepared' | 'old-moved' | 'new-moved';

/** On-disk journal: only safe local paths, never credential or URL values. */
export interface TransactionJournal {
    schemaVersion: 1;
    name: string;
    token: string;
    phase: TransactionPhase;
    profileDir: string;
    /** Whether a final profile existed to move to `backup/`. */
    profileExisted: boolean;
    createdAt: string;
    updatedAt: string;
}

/** Options for {@link beginBotTransaction}. */
export interface BeginBotTransactionOptions {
    name: string;
    /** Resolved final destination (the bot's logical profile directory). */
    profileDir: string;
    /** Transaction root; default {@link DEFAULT_BOT_TRANSACTION_ROOT}. */
    transactionRoot?: string;
    /** Injected FileSystem for rename/delete/journal IO. */
    fileSystem?: FileSystem;
    /** Token factory for deterministic tests; default `randomUUID`. */
    makeToken?: () => string;
}

/** A live staging transaction. */
export interface BotTransaction {
    readonly name: string;
    readonly token: string;
    /** This invocation's transaction directory. */
    readonly dir: string;
    /** Profile path handed to the browser/login flow. */
    readonly stageDir: string;
    /** Copy an existing final profile into `stage/` (excludes Chromium singleton artifacts; refuses symlinks). */
    copyExistingProfile(): Promise<void>;
    /** Close/flush staged state, then promote `stage/` → final atomically with rollback. */
    commit(closeStaged: () => Promise<void>): Promise<void>;
    /** Remove only this invocation's transaction artifacts; the final profile is never touched. */
    abort(): Promise<void>;
}

/**
 * Begin a new transaction for `name`. Refuses when any earlier transaction for this bot is still
 * on disk (an orphan/incomplete run) and deletes nothing — the operator inspects and removes it.
 * Always allocates a fresh `<name>-<uuid>`; a leftover directory is never reused by name alone.
 */
export async function beginBotTransaction(options: BeginBotTransactionOptions): Promise<BotTransaction> {
    assertSafeBotName(options.name);
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const transactionRoot = resolve(options.transactionRoot ?? DEFAULT_BOT_TRANSACTION_ROOT);
    await assertNoLeftoverTransaction(fileSystem, transactionRoot, options.name);

    const token = (options.makeToken ?? randomUUID)();
    const dir = join(transactionRoot, `${options.name}-${token}`);
    await fileSystem.ensureDir(transactionRoot);
    if (!mkdirExclusive(dir, 0o700)) {
        throw new BotError('persistence', `bot transaction directory ${dir} already exists — refusing to reuse it`);
    }
    const stageDir = join(dir, STAGE_DIR);
    const backupDir = join(dir, BACKUP_DIR);
    mkdirExclusive(stageDir, 0o700);
    mkdirExclusive(backupDir, 0o700);

    const now = new Date().toISOString();
    const journal: TransactionJournal = {
        schemaVersion: 1,
        name: options.name,
        token,
        phase: 'prepared',
        profileDir: options.profileDir,
        profileExisted: lstat(options.profileDir) !== null,
        createdAt: now,
        updatedAt: now,
    };
    await writeJournal(fileSystem, dir, journal);

    let evidenceIntact = false;
    const persist = async (phase: TransactionPhase): Promise<void> => {
        journal.phase = phase;
        journal.updatedAt = new Date().toISOString();
        await writeJournal(fileSystem, dir, journal);
    };

    const rollback = async (cause: unknown): Promise<never> => {
        if (journal.profileExisted && lstat(backupDir) !== null) {
            try {
                await fileSystem.rename(backupDir, options.profileDir);
            } catch (restoreError) {
                evidenceIntact = true;
                throw new BotError(
                    'persistence',
                    `promotion of bot '${options.name}' failed (${describeError(cause)}) and rollback could not restore ${options.profileDir}: ${describeError(restoreError)} — the previous profile is preserved at ${backupDir} and transaction ${dir} is left INTACT; recover manually and do not delete it`,
                );
            }
            throw new BotError(
                'persistence',
                `promotion of bot '${options.name}' failed (${describeError(cause)}); the previous profile at ${options.profileDir} was restored and the failed transaction is left at ${dir}`,
            );
        }
        throw new BotError(
            'persistence',
            `promotion of bot '${options.name}' failed (${describeError(cause)}); no previous profile existed and the staged profile is preserved at ${stageDir}`,
        );
    };

    const promote = async (): Promise<void> => {
        if (journal.profileExisted) {
            // Remove the empty container so the move is a pure create — portable across filesystems.
            rmdir(backupDir);
            try {
                await fileSystem.rename(options.profileDir, backupDir);
            } catch (error) {
                throw new BotError(
                    'persistence',
                    `could not move the existing profile ${options.profileDir} to backup ${backupDir}: ${describeError(error)} — the previous profile is intact and transaction ${dir} is left for inspection`,
                );
            }
            await persist('old-moved');
        }
        // The final profile root may not exist yet on a fresh install; create it so the rename lands.
        await fileSystem.ensureDir(dirname(options.profileDir));
        try {
            await fileSystem.rename(stageDir, options.profileDir);
        } catch (error) {
            await rollback(error);
        }
        await persist('new-moved');
    };

    return {
        name: options.name,
        token,
        dir,
        stageDir,
        async copyExistingProfile(): Promise<void> {
            if (lstat(options.profileDir) === null) return;
            try {
                for (const child of await fileSystem.readDir(options.profileDir)) {
                    if (child.startsWith('Singleton')) continue;
                    copyProfileEntry(join(options.profileDir, child), join(stageDir, child));
                }
            } catch (error) {
                throw new BotError('persistence', `failed to stage the existing bot profile: ${describeError(error)}`);
            }
        },
        async commit(closeStaged: () => Promise<void>): Promise<void> {
            // Ordering: the browser must be closed and staged state flushed before any rename.
            await closeStaged();
            await promote();
            // Success: remove only this invocation's transaction artifacts.
            await fileSystem.deleteFile(dir);
        },
        async abort(): Promise<void> {
            if (evidenceIntact) {
                throw new BotError(
                    'persistence',
                    `transaction ${dir} holds incomplete rollback evidence and is left INTACT — recover manually; nothing was deleted`,
                );
            }
            await fileSystem.deleteFile(dir);
        },
    };
}

/**
 * Locate an on-disk transaction for `name` (by journal or directory-name attribution).
 * Returns its directory, or `null` when the transaction root carries no entry for the bot.
 * Shared by begin (refusal) and logout (0277: a leftover `backup/` may still hold the bot's
 * previous credentials, so an "absent" report would be dishonest).
 */
export async function findLeftoverTransaction(
    fileSystem: FileSystem,
    name: string,
    transactionRoot: string,
): Promise<string | null> {
    if (!(await fileSystem.exists(transactionRoot))) return null;
    let entries: string[];
    try {
        entries = await fileSystem.readDir(transactionRoot);
    } catch {
        return null;
    }
    for (const entry of entries) {
        const dir = join(transactionRoot, entry);
        const journal = await readJournal(fileSystem, dir);
        if (journal?.name === name || nameFromTransactionDir(entry) === name) {
            return dir;
        }
    }
    return null;
}

/** Refuse a new transaction while a prior one for `name` is still on disk; delete nothing. */
async function assertNoLeftoverTransaction(
    fileSystem: FileSystem,
    transactionRoot: string,
    name: string,
): Promise<void> {
    const dir = await findLeftoverTransaction(fileSystem, name, transactionRoot);
    if (dir === null) return;
    const journal = await readJournal(fileSystem, dir);
    const phase = journal?.phase ?? 'unknown';
    throw new BotError(
        'persistence',
        `an incomplete bot transaction for '${name}' is present at ${dir} (phase ${phase}) — inspect it and remove that directory manually before retrying; nothing was deleted`,
    );
}

async function writeJournal(fileSystem: FileSystem, dir: string, journal: TransactionJournal): Promise<void> {
    await fileSystem.writeFile(join(dir, JOURNAL_FILE), `${JSON.stringify(journal, null, 2)}\n`);
}

async function readJournal(fileSystem: FileSystem, dir: string): Promise<TransactionJournal | null> {
    try {
        return JSON.parse(await fileSystem.readFile(join(dir, JOURNAL_FILE))) as TransactionJournal;
    } catch {
        return null;
    }
}

/** Recover the bot name from `<name>-<uuid>` so a journal-less leftover is still attributed. */
function nameFromTransactionDir(entry: string): string | null {
    const match = /^(.+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.exec(entry);
    return match?.[1] ?? null;
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
