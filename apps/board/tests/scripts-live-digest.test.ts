/**
 * The live check's before/after store verdicts (G81 / task 0313).
 *
 * A read-only reader can still move bytes: SQLite folds the WAL into the main file when the last
 * connection closes. Treating that as drift produced a misleading FAIL ("a collect tick may have
 * landed"), so the classifier must name a checkpoint and keep the run green — while real drift,
 * or a content change with a changed schema/count, still fails.
 */
import { describe, expect, it } from 'bun:test';
import { classifyStoreChange, type StoreFilePrints } from '../scripts/verify-collect-live';

const prints = (db: string, dbBytes: number, wal: string | null, walBytes = 0): StoreFilePrints => ({
    db: { sha256: db, bytes: dbBytes },
    wal: wal === null ? null : { sha256: wal, bytes: walBytes },
});

describe('classifyStoreChange', () => {
    it('reports an unchanged store as identical and not checkpointed', () => {
        const before = prints('db-a', 100, 'wal-a', 50);
        expect(classifyStoreChange(before, { ...before }, true)).toEqual({
            identical: true,
            checkpointed: false,
            reason: null,
        });
    });

    it('classifies a WAL folded into the store as a checkpoint, not drift', () => {
        const before = prints('db-a', 100, 'wal-a', 50);
        const after = prints('db-b', 150, null);
        const verdict = classifyStoreChange(before, after, true);
        expect(verdict.identical).toBe(false);
        expect(verdict.checkpointed).toBe(true);
        expect(verdict.reason).toContain('WAL checkpointed');
    });

    it('treats an emptied WAL file as folded too', () => {
        const verdict = classifyStoreChange(
            prints('db-a', 100, 'wal-a', 50),
            prints('db-b', 150, 'wal-empty', 0),
            true,
        );
        expect(verdict.checkpointed).toBe(true);
    });

    it('keeps a content change with a changed schema/count as unexplained drift', () => {
        const verdict = classifyStoreChange(prints('db-a', 100, 'wal-a', 50), prints('db-b', 150, null), false);
        expect(verdict.checkpointed).toBe(false);
        expect(verdict.reason).toContain('without a matching schema/count change');
    });

    it('does not excuse a WAL change that leaves the db the same size', () => {
        const verdict = classifyStoreChange(prints('db-a', 100, 'wal-a', 50), prints('db-a', 100, null), true);
        expect(verdict.checkpointed).toBe(false);
    });
});
