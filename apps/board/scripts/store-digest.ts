/**
 * Store file fingerprints and the before/after verdict for the live Collect check (G81 / task 0313).
 *
 * A read-only reader can still move bytes: SQLite folds the WAL back into the main file when the
 * last connection closes. That is a checkpoint, not a collect tick — it must not read as drift.
 */
import { existsSync, readFileSync } from 'node:fs';

/** One store file's sha256 and byte size (size is what distinguishes a checkpoint from a write). */
export interface StoreFilePrint {
    sha256: string;
    bytes: number;
}

/** The store file (and its WAL when present) as sha256 + size — a content fingerprint, not just counts. */
export interface StoreFilePrints {
    db: StoreFilePrint;
    wal: StoreFilePrint | null;
}

function printOf(path: string): StoreFilePrint {
    const bytes = readFileSync(path);
    return { sha256: Bun.CryptoHasher.hash('sha256', bytes, 'hex'), bytes: bytes.byteLength };
}

/** Fingerprint the store (and its WAL when present). */
export function storeFiles(path: string): StoreFilePrints {
    const walPath = `${path}-wal`;
    return { db: printOf(path), wal: existsSync(walPath) ? printOf(walPath) : null };
}

/**
 * What a before/after file pair means.
 *
 * Anything that changes content without a matching schema/count change is real, unexplained drift
 * and stays a failure; only a WAL folded into a grown db with an unchanged schema/count is excused.
 */
export function classifyStoreChange(
    before: StoreFilePrints,
    after: StoreFilePrints,
    digestIdentical: boolean,
): { identical: boolean; checkpointed: boolean; reason: string | null } {
    const identical = before.db.sha256 === after.db.sha256 && before.wal?.sha256 === after.wal?.sha256;
    if (identical) return { identical: true, checkpointed: false, reason: null };
    const walFolded = after.wal === null || after.wal.bytes === 0;
    const dbGrew = after.db.bytes > before.db.bytes;
    if (walFolded && dbGrew && digestIdentical) {
        return {
            identical: false,
            checkpointed: true,
            reason: `WAL checkpointed into the store (db ${before.db.bytes} → ${after.db.bytes} bytes, WAL emptied); rows, schema and journal unchanged`,
        };
    }
    return {
        identical: false,
        checkpointed: false,
        reason: 'store content changed without a matching schema/count change',
    };
}
