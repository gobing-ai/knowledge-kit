import type { DbAdapter, Predicate } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { selections } from '../schema/selections';

/** The closed status domain `selections.status` holds (the migration's CHECK enforces it). */
export const SELECTION_STATUSES = ['selected', 'published', 'dropped'] as const;

/** One selection's lifecycle status. */
export type SelectionStatus = (typeof SELECTION_STATUSES)[number];

/** One `selections` row as stored, with `status` narrowed from `string` to the closed domain. */
export type SelectionRecord = Omit<typeof selections.$inferSelect, 'status'> & { status: SelectionStatus };

/** Input accepted by {@link SelectionsDao.insertMany}. */
export interface SelectionInput {
    topic: string;
    itemId: string;
    runId: string;
    /** The item's story key; equals the item id until clustering lands (task 0227). */
    storyId: string;
    /** Defaults to `selected`. */
    status?: SelectionStatus;
    /** Provenance only — the workflow that made the selection. */
    workflow?: string | null;
    rank?: number | null;
    reason?: string | null;
    selectedAt?: number;
    publishedAt?: number | null;
}

/**
 * One multi-row insert statement: every row carries the identity, and a repeat of
 * `(topic, item_id, run_id)` writes nothing (`RETURNING` then counts only the rows actually
 * inserted, never resets a `published`/`dropped` row, and never duplicates).
 */
const INSERT_SELECTIONS_SQL = `INSERT INTO selections
    (topic, item_id, run_id, story_id, workflow, rank, reason, status, selected_at, published_at, created_at, updated_at)
    VALUES `;

/**
 * DAO for `selections` — the topic-scoped dedup ledger that replaces `episode_usage`
 * (G32 D4).
 *
 * A selection is written when a run commits to its set and promoted at publish. Exclusion
 * reads `excludedStories`, which is topic- and story-scoped: one item may still serve
 * another topic, and a re-reported story under a new URL is still excluded (task 0228).
 */
export class SelectionsDao extends EntityDao<typeof selections, typeof selections.itemId> {
    constructor(adapter: DbAdapter) {
        super(adapter, selections, [selections.topic, selections.itemId, selections.runId], 'selections');
    }

    /**
     * Write one row per input, idempotently: a row whose `(topic, item_id, run_id)`
     * identity already exists is left untouched.
     *
     * @returns the number of rows actually inserted (0 for an all-duplicate or empty input).
     */
    async insertMany(inputs: readonly SelectionInput[], now = Date.now()): Promise<number> {
        if (inputs.length === 0) return 0;
        const placeholders = inputs.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const params = inputs.flatMap((input) => {
            const selectedAt = input.selectedAt ?? now;
            return [
                input.topic,
                input.itemId,
                input.runId,
                input.storyId,
                input.workflow ?? null,
                input.rank ?? null,
                input.reason ?? null,
                input.status ?? 'selected',
                selectedAt,
                input.publishedAt ?? null,
                selectedAt,
                selectedAt,
            ];
        });
        const rows = await this.adapter.queryAll<{ item_id: string }>(
            `${INSERT_SELECTIONS_SQL}${placeholders} ON CONFLICT(topic, item_id, run_id) DO NOTHING RETURNING item_id`,
            ...params,
        );
        return rows.length;
    }

    /**
     * Move a run's `selected` rows to `status` (task 0228): `published` also stamps
     * `published_at`. A `published` or `dropped` row is never touched, and an
     * optional `itemIds` narrows the set.
     *
     * @returns the number of rows changed.
     */
    async updateStatus(
        runId: string,
        topic: string,
        status: SelectionStatus,
        itemIds?: readonly string[],
        now = Date.now(),
    ): Promise<number> {
        if (itemIds !== undefined && itemIds.length === 0) return 0;
        const params: unknown[] = [status, status === 'published' ? now : null, now, runId, topic];
        let sql = `UPDATE selections SET status = ?, published_at = ?, updated_at = ?
            WHERE run_id = ? AND topic = ? AND status = 'selected'`;
        if (itemIds !== undefined) {
            sql += ` AND item_id IN (${itemIds.map(() => '?').join(', ')})`;
            params.push(...itemIds);
        }
        await this.adapter.run(sql, ...params);
        const row = await this.adapter.queryFirst<{ n: number }>('SELECT changes() AS n');
        return row?.n ?? 0;
    }

    /** Every selection of one run, optionally narrowed to one topic, in plan order. */
    async listByRun(runId: string, topic?: string): Promise<SelectionRecord[]> {
        const conditions: Predicate[] = [{ col: selections.runId, op: 'eq', value: runId }];
        if (topic !== undefined) conditions.push({ col: selections.topic, op: 'eq', value: topic });
        const rows = await super.list({
            where: { and: conditions },
            orderBy: [{ col: selections.topic }, { col: selections.rank }, { col: selections.itemId }],
        });
        return rows.map((row) => ({ ...row, status: row.status as SelectionStatus }));
    }

    /**
     * The run ids that still hold `selected` rows for `workflow` — the runs that did not reach
     * `mark-published` (task 0228 R7). `kk daily prepare` names each one so the operator can free
     * its items with `kk store release --run <id>`; the read is side-effect free.
     */
    async selectedRuns(workflow: string): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ run_id: string }>(
            `SELECT DISTINCT run_id FROM selections
             WHERE workflow = ? AND status = 'selected'
             ORDER BY run_id`,
            workflow,
        );
        return rows.map((row) => row.run_id);
    }

    /**
     * The story ids already selected or published for `topic` — the extraction
     * exclusion set (task 0228). `dropped` rows are free to re-enter.
     */
    async excludedStories(topic: string): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ story_id: string }>(
            `SELECT DISTINCT story_id FROM selections
             WHERE topic = ? AND status IN ('selected', 'published')
             ORDER BY story_id`,
            topic,
        );
        return rows.map((row) => row.story_id);
    }
}
