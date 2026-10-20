import type { DbAdapter } from '@gobing-ai/ts-db';
import { BaseDao } from '@gobing-ai/ts-db';
import { unknownKkMigrationIds } from '../migrations';
import { type LabelPolicy, labelsCurrentSql } from './labels';
import type { SelectionStatus } from './selections';

/**
 * Read-only aggregates over the four Collect tables (`collect_runs`, `items`, `labels`,
 * `selections`) for the Board reader's store views (G81, ADR-035 amendment 2026-10-16).
 *
 * A `BaseDao` — the raw/analytics tier — because the reader needs `GROUP BY` totals, not entity
 * CRUD, and widening `Store` with a raw adapter would let any reader write. Every method here is a
 * SELECT: no INSERT, no DDL, no migration.
 */

/** How many items one `itemsPage` returns (design §3). */
export const COLLECT_VIEW_PAGE_SIZE = 25;

/** One run's stored facts, keyed by `collect_runs.run_id`; the ID is the join key across tables. */
export interface CollectViewRunRow {
    runId: string;
    /** `collect_runs.source_counts_json` verbatim: the projection parses (and diagnoses) it. */
    sourceCountsJson: string;
    inserted: number;
    updated: number;
    /** Observations, i.e. one per item × decision × maker (never distinct items). */
    labelRows: number;
    /** Distinct items carrying at least one label row in this run. */
    labeledItems: number;
    labelRowsBySource: Record<string, number>;
    /** Items FIRST seen in this run by their strongest selection status. */
    yield: { selected: number; published: number; dropped: number };
}

/** One decision's value histogram over a single run's own label rows. */
export interface CollectViewLabelQuality {
    decisionId: string;
    /** `none` counts rows with no confidence level (a hand-seeded or pre-0213 row). */
    run: { value: string; HIGH: number; MEDIUM: number; LOW: number; none: number }[];
}

export interface CollectItemLabelDetail {
    value: string;
    confidence: string | null;
    maker: string | null;
    score: number | null;
}

/** Filters accepted by {@link CollectViewDao.itemsPage}; already validated by the caller. */
export interface CollectViewItemsFilter {
    source?: string;
    seen?: 'new' | 'reseen';
    decision?: string;
    value?: string;
    selection?: SelectionStatus | 'none';
    search?: string;
}

/** One item as the store views render it. */
export interface CollectViewItem {
    id: string;
    title: string;
    canonicalUrl: string | null;
    source: string;
    storyId: string | null;
    seen: 'new' | 'reseen';
    /** Effective labels, `decision_id → value` (`labels_current` under the caller's policy). */
    labels: Record<string, string>;
    /** Detailed labels including confidence, maker, and score. */
    labelDetails?: Record<string, CollectItemLabelDetail>;
    /** The item's strongest selection status across topics, `none` when it has no row. */
    selection: SelectionStatus | 'none';
    domain?: string | null;
    lang?: string | null;
    bodyChars?: number | null;
    engagement?: number | null;
    firstSeenAt?: number | null;
    publishedAt?: number | null;
}

/** One page of {@link CollectViewItem}. */
export interface CollectViewItemsPage {
    total: number;
    items: CollectViewItem[];
}

export interface CollectViewSelection {
    topic: string;
    itemId: string;
    runId: string;
    storyId: string;
    workflow: string | null;
    rank: number | null;
    reason: string | null;
    status: SelectionStatus;
    selectedAt: number;
    publishedAt: number | null;
    title: string | null;
    source: string | null;
    canonicalUrl: string | null;
}

export interface CollectViewSelectionsFilter {
    runId?: string;
    topic?: string;
    status?: SelectionStatus;
    search?: string;
}

export interface CollectViewSelectionsPage {
    total: number;
    selections: CollectViewSelection[];
    topics: string[];
}

/**
 * The strongest selection status per item: published (3) > selected (2) > dropped (1), `NULL` when
 * the item has no row at all. One definition, so `yield`, the `selection` filter and the item's own
 * status can never disagree.
 */
const SELECTION_RANK_SQL = `SELECT item_id, MAX(CASE status WHEN 'published' THEN 3 WHEN 'selected' THEN 2 WHEN 'dropped' THEN 1 END) AS rank
    FROM selections GROUP BY item_id`;

/** Raw row shapes (SQLite's snake_case aliases are re-aliased to camelCase in SQL). */
interface RunRow {
    runId: string;
    sourceCountsJson: string;
    inserted: number;
    updated: number;
}

interface LabelAggregateRow {
    runId: string;
    source: string;
    n: number;
}

interface YieldRow {
    runId: string;
    selected: number;
    published: number;
    dropped: number;
}

interface LabelQualityRow {
    decisionId: string;
    value: string;
    confidence: string | null;
    n: number;
}

interface ItemRow {
    id: string;
    title: string;
    canonicalUrl: string | null;
    source: string;
    storyId: string | null;
    firstSeenRun: string;
    lastSeenRun: string;
    domain?: string | null;
    lang?: string | null;
    bodyChars?: number | null;
    engagement?: number | null;
    firstSeenAt?: number | null;
    publishedAt?: number | null;
    selectionRank: number | null;
}

interface CurrentLabelRow {
    itemId: string;
    decisionId: string;
    value: string;
    confidence: string | null;
    maker: string | null;
    score: number | null;
}

/** `?` placeholders for an `IN (…)` list. */
function placeholders(count: number): string {
    return Array.from({ length: count }, () => '?').join(', ');
}

/** `CASE` rank → the status it means; `null` → `none`. */
function statusOf(rank: number | null): SelectionStatus | 'none' {
    if (rank === 3) return 'published';
    if (rank === 2) return 'selected';
    if (rank === 1) return 'dropped';
    return 'none';
}

/** DAO for the Board reader's read-only Collect store views. */
export class CollectViewDao extends BaseDao {
    constructor(adapter: DbAdapter) {
        super(adapter);
    }

    /** The journal ids this build does not know: a non-empty list means the store is NEWER. */
    unknownMigrationIds(): Promise<string[]> {
        return unknownKkMigrationIds(this.adapter);
    }

    /**
     * Stored facts for `runIds` — one entry per run that HAS a `collect_runs` row (a failed tick
     * never writes one). Yield counts items whose `first_seen_run` is the run, by strongest status.
     */
    async runRows(runIds: readonly string[]): Promise<CollectViewRunRow[]> {
        if (runIds.length === 0) return [];
        const list = placeholders(runIds.length);
        const runs = await this.adapter.queryAll<RunRow>(
            `SELECT run_id AS runId, source_counts_json AS sourceCountsJson,
                    inserted AS inserted, updated AS updated
             FROM collect_runs WHERE run_id IN (${list})`,
            ...runIds,
        );
        if (runs.length === 0) return [];
        const labels = await this.adapter.queryAll<LabelAggregateRow>(
            `SELECT run_id AS runId, source AS source, COUNT(*) AS n
             FROM labels WHERE run_id IN (${list})
             GROUP BY run_id, source`,
            ...runIds,
        );
        // Distinct items per RUN, not per (run, source): an item labelled by two makers/sources is
        // still one labelled item (review 0307 P2 — taking the max of the per-source counts
        // undercounts it).
        const labeledItems = await this.adapter.queryAll<{ runId: string; itemCount: number }>(
            `SELECT run_id AS runId, COUNT(DISTINCT item_id) AS itemCount
             FROM labels WHERE run_id IN (${list})
             GROUP BY run_id`,
            ...runIds,
        );
        const yields = await this.adapter.queryAll<YieldRow>(
            `SELECT it.first_seen_run AS runId,
                    COUNT(DISTINCT CASE WHEN sel.rank = 3 THEN it.id END) AS published,
                    COUNT(DISTINCT CASE WHEN sel.rank = 2 THEN it.id END) AS selected,
                    COUNT(DISTINCT CASE WHEN sel.rank = 1 THEN it.id END) AS dropped
             FROM items it
             LEFT JOIN (${SELECTION_RANK_SQL}) sel ON sel.item_id = it.id
             WHERE it.first_seen_run IN (${list})
             GROUP BY it.first_seen_run`,
            ...runIds,
        );
        const labelsOf = new Map<string, { rows: number; items: number; bySource: Record<string, number> }>();
        for (const row of labeledItems) {
            labelsOf.set(row.runId, { rows: 0, items: row.itemCount, bySource: {} });
        }
        for (const row of labels) {
            const entry = labelsOf.get(row.runId) ?? { rows: 0, items: 0, bySource: {} };
            entry.rows += row.n;
            entry.bySource[row.source] = (entry.bySource[row.source] ?? 0) + row.n;
            labelsOf.set(row.runId, entry);
        }
        const yieldOf = new Map(yields.map((row) => [row.runId, row]));
        return runs.map((row) => {
            const label = labelsOf.get(row.runId) ?? { rows: 0, items: 0, bySource: {} };
            const counting = yieldOf.get(row.runId);
            return {
                runId: row.runId,
                sourceCountsJson: row.sourceCountsJson,
                inserted: row.inserted,
                updated: row.updated,
                labelRows: label.rows,
                labeledItems: label.items,
                labelRowsBySource: label.bySource,
                yield: {
                    selected: counting?.selected ?? 0,
                    published: counting?.published ?? 0,
                    dropped: counting?.dropped ?? 0,
                },
            };
        });
    }

    /** The newest `collect_runs.finished_at` as an RFC 3339 stamp, or `null` when none is stored. */
    async lastStoredAt(): Promise<string | null> {
        const row = await this.adapter.queryFirst<{ at: number | null }>(
            'SELECT MAX(finished_at) AS at FROM collect_runs',
        );
        const at = row?.at ?? null;
        return at === null ? null : new Date(at).toISOString();
    }

    /** One run's own label rows, per decision: value × confidence level. */
    async labelQuality(runId: string): Promise<CollectViewLabelQuality[]> {
        const rows = await this.adapter.queryAll<LabelQualityRow>(
            `SELECT decision_id AS decisionId, value AS value, confidence AS confidence, COUNT(*) AS n
             FROM labels WHERE run_id = ?
             GROUP BY decision_id, value, confidence
             ORDER BY decision_id, value`,
            runId,
        );
        const byDecision = new Map<string, Map<string, { HIGH: number; MEDIUM: number; LOW: number; none: number }>>();
        for (const row of rows) {
            const values = byDecision.get(row.decisionId) ?? new Map();
            const entry = values.get(row.value) ?? { HIGH: 0, MEDIUM: 0, LOW: 0, none: 0 };
            if (row.confidence === 'HIGH' || row.confidence === 'MEDIUM' || row.confidence === 'LOW') {
                entry[row.confidence] += row.n;
            } else {
                entry.none += row.n;
            }
            values.set(row.value, entry);
            byDecision.set(row.decisionId, values);
        }
        return [...byDecision.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([decisionId, values]) => ({
                decisionId,
                run: [...values.entries()].map(([value, counts]) => ({ value, ...counts })),
            }));
    }

    /** Distinct items carrying at least one label row in `runId` — the `effective` population. */
    async labeledItemIds(runId: string): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ itemId: string }>(
            'SELECT DISTINCT item_id AS itemId FROM labels WHERE run_id = ? ORDER BY item_id',
            runId,
        );
        return rows.map((row) => row.itemId);
    }

    /** The store's distinct item sources — the `source` filter's domain. */
    async itemSources(): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ source: string }>(
            "SELECT DISTINCT source AS source FROM items WHERE source <> '' ORDER BY source",
        );
        return rows.map((row) => row.source);
    }

    /** The store's distinct selection topics. */
    async selectionTopics(): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ topic: string }>(
            "SELECT DISTINCT topic AS topic FROM selections WHERE topic <> '' ORDER BY topic",
        );
        return rows.map((row) => row.topic);
    }

    /**
     * One page of the run's items: `first_seen_run = runId OR last_seen_run = runId`, filtered in
     * SQL with bound parameters. The decision/value filter matches the item's CURRENT label under
     * `policy` (the same `labels_current` CTE the shipped reads use), never a stale observation.
     */
    async itemsPage(
        runId: string | null | undefined,
        filter: CollectViewItemsFilter,
        page: number,
        policy: LabelPolicy,
    ): Promise<CollectViewItemsPage> {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (runId !== undefined && runId !== null && runId !== '' && runId !== 'all') {
            conditions.push('(it.first_seen_run = ? OR it.last_seen_run = ?)');
            params.push(runId, runId);
            if (filter.seen === 'new') {
                conditions.push('it.first_seen_run = ?');
                params.push(runId);
            } else if (filter.seen === 'reseen') {
                conditions.push('it.last_seen_run = ? AND it.first_seen_run <> ?');
                params.push(runId, runId);
            }
        }
        if (filter.source !== undefined) {
            conditions.push('it.source = ?');
            params.push(filter.source);
        }
        if (filter.search !== undefined && filter.search.trim() !== '') {
            const pattern = `%${filter.search.trim()}%`;
            conditions.push('(it.title LIKE ? OR it.id LIKE ? OR it.canonical_url LIKE ?)');
            params.push(pattern, pattern, pattern);
        }
        const rank =
            filter.selection === undefined || filter.selection === 'none'
                ? undefined
                : { selected: 2, published: 3, dropped: 1 }[filter.selection];
        if (filter.selection === 'none') {
            conditions.push('sel.rank IS NULL');
        } else if (rank !== undefined) {
            conditions.push('sel.rank = ?');
            params.push(rank);
        }
        const current = labelsCurrentSql(policy);
        if (filter.decision !== undefined && filter.value !== undefined) {
            conditions.push(
                `EXISTS (SELECT 1 FROM labels_current WHERE labels_current.item_id = it.id
                         AND labels_current.decision_id = ? AND labels_current.value = ?)`,
            );
            params.push(filter.decision, filter.value);
        }
        // The CTE is only emitted (and only bound) when the decision/value filter needs it.
        const usesCurrent = filter.decision !== undefined && filter.value !== undefined;
        const withClause = usesCurrent ? `WITH ${current.sql}\n` : '';
        const currentParams = usesCurrent ? current.params : [];
        const from = `items it LEFT JOIN (${SELECTION_RANK_SQL}) sel ON sel.item_id = it.id`;
        const where = conditions.length === 0 ? '' : `WHERE ${conditions.join('\n  AND ')}`;
        const totalRow = await this.adapter.queryFirst<{ n: number }>(
            `${withClause}SELECT COUNT(*) AS n FROM ${from} ${where}`,
            ...currentParams,
            ...params,
        );
        const offset = (Math.max(1, page) - 1) * COLLECT_VIEW_PAGE_SIZE;
        const rows = await this.adapter.queryAll<ItemRow>(
            `${withClause}SELECT it.id AS id, it.title AS title, it.canonical_url AS canonicalUrl,
                    it.source AS source, it.story_id AS storyId,
                    it.first_seen_run AS firstSeenRun, it.last_seen_run AS lastSeenRun,
                    it.domain AS domain, it.lang AS lang, it.body_chars AS bodyChars,
                    it.engagement AS engagement, it.first_seen_at AS firstSeenAt,
                    it.published_at AS publishedAt,
                    sel.rank AS selectionRank
             FROM ${from} ${where}
             ORDER BY it.last_seen_run DESC, it.id ASC
             LIMIT ? OFFSET ?`,
            ...currentParams,
            ...params,
            COLLECT_VIEW_PAGE_SIZE,
            offset,
        );
        const labelsData = await this.currentLabels(
            rows.map((row) => row.id),
            policy,
        );
        return {
            total: totalRow?.n ?? 0,
            items: rows.map((row) => ({
                id: row.id,
                title: row.title,
                canonicalUrl: row.canonicalUrl,
                source: row.source,
                storyId: row.storyId,
                seen: row.firstSeenRun === runId ? 'new' : 'reseen',
                labels: labelsData.labels.get(row.id) ?? {},
                labelDetails: labelsData.labelDetails.get(row.id) ?? {},
                selection: statusOf(row.selectionRank),
                domain: row.domain,
                lang: row.lang,
                bodyChars: row.bodyChars,
                engagement: row.engagement,
                firstSeenAt: row.firstSeenAt,
                publishedAt: row.publishedAt,
            })),
        };
    }

    /** One page of selections joined with items. */
    async selectionsPage(filter: CollectViewSelectionsFilter = {}, page = 1): Promise<CollectViewSelectionsPage> {
        const params: unknown[] = [];
        const conditions: string[] = [];
        if (filter.runId !== undefined && filter.runId !== '' && filter.runId !== 'all') {
            conditions.push('s.run_id = ?');
            params.push(filter.runId);
        }
        if (filter.topic !== undefined && filter.topic !== '' && filter.topic !== 'all') {
            conditions.push('s.topic = ?');
            params.push(filter.topic);
        }
        if (filter.status !== undefined && (filter.status as string) !== '' && (filter.status as string) !== 'all') {
            conditions.push('s.status = ?');
            params.push(filter.status);
        }
        if (filter.search !== undefined && filter.search.trim() !== '') {
            const pattern = `%${filter.search.trim()}%`;
            conditions.push('(it.title LIKE ? OR s.item_id LIKE ? OR s.reason LIKE ?)');
            params.push(pattern, pattern, pattern);
        }
        const where = conditions.length === 0 ? '' : `WHERE ${conditions.join('\n  AND ')}`;
        const from = 'selections s LEFT JOIN items it ON it.id = s.item_id';
        const totalRow = await this.adapter.queryFirst<{ n: number }>(
            `SELECT COUNT(*) AS n FROM ${from} ${where}`,
            ...params,
        );
        const offset = (Math.max(1, page) - 1) * COLLECT_VIEW_PAGE_SIZE;
        const rows = await this.adapter.queryAll<{
            topic: string;
            itemId: string;
            runId: string;
            storyId: string;
            workflow: string | null;
            rank: number | null;
            reason: string | null;
            status: string;
            selectedAt: number;
            publishedAt: number | null;
            title: string | null;
            source: string | null;
            canonicalUrl: string | null;
        }>(
            `SELECT s.topic AS topic, s.item_id AS itemId, s.run_id AS runId, s.story_id AS storyId,
                    s.workflow AS workflow, s.rank AS rank, s.reason AS reason, s.status AS status,
                    s.selected_at AS selectedAt, s.published_at AS publishedAt,
                    it.title AS title, it.source AS source, it.canonical_url AS canonicalUrl
             FROM ${from} ${where}
             ORDER BY s.selected_at DESC, s.rank ASC
             LIMIT ? OFFSET ?`,
            ...params,
            COLLECT_VIEW_PAGE_SIZE,
            offset,
        );
        const topics = await this.selectionTopics();
        return {
            total: totalRow?.n ?? 0,
            topics,
            selections: rows.map((r) => ({
                ...r,
                status: r.status as SelectionStatus,
            })),
        };
    }

    /** `item_id → { decision_id: value }` and detail objects for the page's items under `policy`. */
    private async currentLabels(
        itemIds: readonly string[],
        policy: LabelPolicy,
    ): Promise<{
        labels: Map<string, Record<string, string>>;
        labelDetails: Map<string, Record<string, CollectItemLabelDetail>>;
    }> {
        const labels = new Map<string, Record<string, string>>();
        const labelDetails = new Map<string, Record<string, CollectItemLabelDetail>>();
        if (itemIds.length === 0) return { labels, labelDetails };
        const current = labelsCurrentSql(policy);
        const rows = await this.adapter.queryAll<CurrentLabelRow>(
            `WITH ${current.sql}
             SELECT item_id AS itemId, decision_id AS decisionId, value AS value,
                    confidence AS confidence, maker AS maker, score AS score
             FROM labels_current WHERE item_id IN (${placeholders(itemIds.length)})
             ORDER BY item_id, decision_id`,
            ...current.params,
            ...itemIds,
        );
        for (const row of rows) {
            const itemLabels = labels.get(row.itemId) ?? {};
            itemLabels[row.decisionId] = row.value;
            labels.set(row.itemId, itemLabels);

            const itemDetails = labelDetails.get(row.itemId) ?? {};
            itemDetails[row.decisionId] = {
                value: row.value,
                confidence: row.confidence,
                maker: row.maker,
                score: row.score,
            };
            labelDetails.set(row.itemId, itemDetails);
        }
        return { labels, labelDetails };
    }
}
