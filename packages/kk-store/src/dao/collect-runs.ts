import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { collectRuns } from '../schema/collect-runs';

/** One `collect_runs` provenance row as stored. */
export type CollectRunRecord = typeof collectRuns.$inferSelect;

/** Input for {@link CollectRunsDao.start}. */
export interface CollectRunStart {
    runId: string;
    startedAt?: number;
    /** Defaults to `running`. */
    status?: string;
    /** Per-source document counts, JSON-encoded into `source_counts_json`. */
    sourceCounts?: Record<string, number>;
}

/** Input for {@link CollectRunsDao.finish}. */
export interface CollectRunFinish {
    status: string;
    inserted?: number;
    updated?: number;
    sourceCounts?: Record<string, number>;
    finishedAt?: number;
}

/** DAO for `collect_runs` — run provenance for the store's ingested rows. */
export class CollectRunsDao extends EntityDao<typeof collectRuns, typeof collectRuns.runId> {
    constructor(adapter: DbAdapter) {
        super(adapter, collectRuns, [collectRuns.runId], 'collect_runs');
    }

    /** Insert the run's provenance row. A repeated `runId` fails loudly (one row per run). */
    start(input: CollectRunStart, now = Date.now()): Promise<CollectRunRecord> {
        return super.create({
            runId: input.runId,
            startedAt: input.startedAt ?? now,
            status: input.status ?? 'running',
            sourceCountsJson: JSON.stringify(input.sourceCounts ?? {}),
        });
    }

    /** Close the run's row; `false` when no row carries that `runId`. */
    async finish(runId: string, outcome: CollectRunFinish, now = Date.now()): Promise<boolean> {
        const patch: Partial<typeof collectRuns.$inferInsert> = {
            status: outcome.status,
            finishedAt: outcome.finishedAt ?? now,
        };
        if (outcome.inserted !== undefined) patch.inserted = outcome.inserted;
        if (outcome.updated !== undefined) patch.updated = outcome.updated;
        if (outcome.sourceCounts !== undefined) patch.sourceCountsJson = JSON.stringify(outcome.sourceCounts);
        const updated = await super.update(runId, patch);
        return updated !== undefined;
    }
}
