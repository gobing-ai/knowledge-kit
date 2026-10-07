import type { DbAdapter } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { episodeUsage } from '../schema/episode-usage';

/** One `episode_usage` row as stored. */
export type EpisodeUsageRecord = typeof episodeUsage.$inferSelect;

/** Input accepted by {@link EpisodeUsageDao.markUsed}. */
export interface EpisodeUsageInput {
    itemId: string;
    workflow: string;
    runId: string;
    usedAt?: number;
}

/**
 * DAO for `episode_usage` — the cross-day dedup ledger (which items a workflow
 * already published, in which run).
 */
export class EpisodeUsageDao extends EntityDao<typeof episodeUsage, typeof episodeUsage.itemId> {
    constructor(adapter: DbAdapter) {
        super(adapter, episodeUsage, [episodeUsage.itemId, episodeUsage.workflow, episodeUsage.runId], 'episode_usage');
    }

    /**
     * Record that `workflow` used `itemId` in `runId`. Idempotent on the
     * (item, workflow, run) identity, so a retried `kk store mark-used` re-run
     * neither duplicates the row nor fails.
     */
    markUsed(input: EpisodeUsageInput, now = Date.now()): Promise<EpisodeUsageRecord> {
        const usedAt = input.usedAt ?? now;
        return super.upsert(
            { itemId: input.itemId, workflow: input.workflow, runId: input.runId, usedAt },
            [episodeUsage.itemId, episodeUsage.workflow, episodeUsage.runId],
            { usedAt },
        );
    }

    /** Ids `workflow` has already used — the `--exclude-used` input for extraction. */
    async usedItemIds(workflow: string): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ item_id: string }>(
            'SELECT item_id FROM episode_usage WHERE workflow = ? ORDER BY item_id',
            workflow,
        );
        return rows.map((row) => row.item_id);
    }
}
