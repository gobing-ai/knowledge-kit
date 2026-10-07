import type { Doc } from '@gobing-ai/kk-core';
import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { canonicalUrlForDoc, itemId } from '../canonical-url';
import type { ProfileQuery } from '../profile';
import { items } from '../schema/items';

/** One `items` row as stored. */
export type ItemRecord = typeof items.$inferSelect;

/**
 * One item selected by a profile query: the stored columns plus every `labels`
 * row for that item, so a caller assembles its pool Doc without a second read.
 */
export interface StoredDoc {
    id: string;
    title: string;
    body: string;
    /** `items.canonical_url` — the Doc's `sourceUri`; `null` for a URL-less item. */
    sourceUri: string | null;
    mediaType: string | null;
    /** Parsed `items.metadata_json` — the Doc metadata as ingested. */
    metadata: Record<string, unknown>;
    /** Decision id → stored value (`kk-item-category`, `kk-item-<dimension>`). */
    labels: Record<string, string>;
}

/**
 * One raw `items` row as the adapter returns it. `queryAll` answers in SQLite's own column
 * names (unlike `EntityDao`, which maps to the camelCase select type), so the snake_case
 * fields here are the contract with the statement above, not a style slip.
 */
interface ItemRow {
    id: string;
    title: string;
    body: string;
    canonical_url: string | null;
    media_type: string | null;
    metadata_json: string;
}

/** `items.metadata_json` as an object; a corrupt cell degrades to `{}` rather than failing a pool read. */
function parseMetadataJson(raw: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

/** Outcome of {@link ItemsDao.upsertDocs} for one run. */
export interface UpsertDocsResult {
    /** Ids first stored by this call. */
    inserted: number;
    /** Known ids whose content changed (their labels were dropped). */
    updated: number;
    /** Known ids whose content hash is unchanged (only `last_seen_run` moved). */
    unchanged: number;
    /** The ids this call inserted — the input to labelling (`new-ids.json`). */
    newIds: string[];
}

/** A Doc reduced to its `items` row values (all identity/hash work done once). */
interface PreparedItem {
    id: string;
    canonicalUrl: string | null;
    contentHash: string;
    title: string;
    body: string;
    source: string;
    mediaType: string | null;
    metadataJson: string;
    publishedAt: number | null;
}

const INSERT_ITEM_SQL = `INSERT INTO items
    (id, canonical_url, content_hash, title, body, source, media_type, metadata_json,
     first_seen_run, last_seen_run, first_seen_at, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_ITEM_SQL = `UPDATE items
    SET canonical_url = ?, content_hash = ?, title = ?, body = ?, source = ?, media_type = ?,
        metadata_json = ?, published_at = ?, last_seen_run = ?, updated_at = ?
    WHERE id = ?`;

const TOUCH_ITEM_SQL = 'UPDATE items SET last_seen_run = ?, updated_at = ? WHERE id = ?';

/** `metadata.source` when it is a string — the ingest plugin that produced the Doc. */
function sourceFromMetadata(metadata: Doc['metadata']): string {
    const value = metadata?.source;
    return typeof value === 'string' ? value : '';
}

/** `metadata.publishedAt` (epoch ms, or a `Date.parse`-able string) as epoch ms. */
function publishedAtFromMetadata(metadata: Doc['metadata']): number | null {
    const value = metadata?.publishedAt;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }
    return null;
}

/**
 * Hash of the Doc's stored content, so a title/body edit is an `updated` item.
 *
 * A NUL separator (not the bare concatenation `itemId` uses for a URL-less Doc)
 * keeps `('ab', 'c')` and `('a', 'bc')` distinct — a collision here would silently
 * classify an edited Doc as unchanged.
 */
function contentHash(doc: Doc): string {
    return new Bun.CryptoHasher('sha256').update(`${doc.title ?? ''}\u0000${doc.body}`).digest('hex');
}

function prepareItem(doc: Doc): PreparedItem {
    return {
        id: itemId(doc),
        canonicalUrl: canonicalUrlForDoc(doc) ?? null,
        contentHash: contentHash(doc),
        title: doc.title ?? '',
        body: doc.body,
        source: sourceFromMetadata(doc.metadata),
        mediaType: doc.mediaType ?? null,
        metadataJson: JSON.stringify(doc.metadata ?? {}),
        publishedAt: publishedAtFromMetadata(doc.metadata),
    };
}

/**
 * DAO for `items` — the ingest upsert.
 *
 * Upsert identity is `id` (content identity, R5); `content_hash` decides whether a
 * known id is `updated` or `unchanged`.
 */
export class ItemsDao extends EntityDao<typeof items, typeof items.id> {
    constructor(adapter: DbAdapter) {
        super(adapter, items, [items.id], 'items');
    }

    /**
     * Store one run's Docs, returning the insert/update/unchanged split.
     *
     * One `adapter.batch` call, so a rejection leaves no partial run: every write
     * (inserts, updates, label invalidation, `last_seen_run` touches) commits or
     * none does. A Doc whose id appears twice in one batch is written once (last
     * occurrence wins) so the counters stay per-item, not per-input-line.
     *
     * A `content_hash` change deletes that item's `labels` rows in the same batch:
     * decisions answer the text they were run on, so a new body invalidates them
     * and the next label pass re-decides.
     */
    async upsertDocs(runId: string, docs: readonly Doc[], now = Date.now()): Promise<UpsertDocsResult> {
        const byId = new Map<string, PreparedItem>();
        for (const doc of docs) {
            const prepared = prepareItem(doc);
            byId.set(prepared.id, prepared);
        }
        if (byId.size === 0) return { inserted: 0, updated: 0, unchanged: 0, newIds: [] };

        const known = await this.existingContentHashes([...byId.keys()]);
        const operations: DbBatchOp[] = [];
        const newIds: string[] = [];
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;

        for (const item of byId.values()) {
            const previousHash = known.get(item.id);
            if (previousHash === undefined) {
                inserted += 1;
                newIds.push(item.id);
                operations.push({
                    sql: INSERT_ITEM_SQL,
                    params: [
                        item.id,
                        item.canonicalUrl,
                        item.contentHash,
                        item.title,
                        item.body,
                        item.source,
                        item.mediaType,
                        item.metadataJson,
                        runId,
                        runId,
                        now,
                        item.publishedAt,
                        now,
                        now,
                    ],
                });
                continue;
            }
            if (previousHash !== item.contentHash) {
                updated += 1;
                operations.push({ sql: 'DELETE FROM labels WHERE item_id = ?', params: [item.id] });
                operations.push({
                    sql: UPDATE_ITEM_SQL,
                    params: [
                        item.canonicalUrl,
                        item.contentHash,
                        item.title,
                        item.body,
                        item.source,
                        item.mediaType,
                        item.metadataJson,
                        item.publishedAt,
                        runId,
                        now,
                        item.id,
                    ],
                });
                continue;
            }
            unchanged += 1;
            operations.push({ sql: TOUCH_ITEM_SQL, params: [runId, now, item.id] });
        }

        await this.adapter.batch(operations);
        return { inserted, updated, unchanged, newIds };
    }

    /**
     * One profile query's pool: the matching `items` rows, each with every stored
     * decision answer inlined and ordered by decision id (R2).
     *
     * One statement, so a pool is a single consistent read of the WAL store — the
     * scheduled collector may be committing beside it. A `where` decision with no
     * `labels` row excludes the item (its join is the predicate); a decision named
     * only by `order` left-joins, so an unlabelled item is sorted, not dropped.
     * `i.id ASC` is the final tiebreak: one database and one `now` yield one order.
     */
    async selectByProfile(query: ProfileQuery): Promise<StoredDoc[]> {
        const whereDecisions = new Set(query.where.map((predicate) => predicate.decisionId));
        const aliases = new Map<string, string>();
        const joins: string[] = [];
        const params: unknown[] = [];
        const aliasFor = (decisionId: string): string => {
            const existing = aliases.get(decisionId);
            if (existing !== undefined) return existing;
            const alias = `l${aliases.size}`;
            aliases.set(decisionId, alias);
            joins.push(
                `${whereDecisions.has(decisionId) ? 'JOIN' : 'LEFT JOIN'} labels ${alias} ` +
                    `ON ${alias}.item_id = i.id AND ${alias}.decision_id = ?`,
            );
            params.push(decisionId);
            return alias;
        };

        // Every join (and its decision-id parameter) is registered before any WHERE parameter is
        // pushed: the join `?`s sit before the WHERE `?`s in the statement, so interleaving the
        // two would bind each value to the wrong placeholder.
        for (const predicate of query.where) aliasFor(predicate.decisionId);
        for (const term of query.order) {
            if (!('column' in term)) aliasFor(term.decisionId);
        }

        const conditions: string[] = [];
        for (const predicate of query.where) {
            const alias = aliasFor(predicate.decisionId);
            if (predicate.op === 'in') {
                conditions.push(`${alias}.value IN (${predicate.values.map(() => '?').join(', ')})`);
                params.push(...predicate.values);
                continue;
            }
            conditions.push(`CAST(${alias}.value AS INTEGER) ${predicate.op === 'gte' ? '>=' : '<='} ?`);
            params.push(predicate.value);
        }

        const order: string[] = query.order.map((term) => {
            const direction = term.direction === 'desc' ? 'DESC' : 'ASC';
            return 'column' in term
                ? `i.${term.column} ${direction}`
                : `CAST(${aliasFor(term.decisionId)}.value AS INTEGER) ${direction}`;
        });
        order.push('i.id ASC');

        conditions.push('i.first_seen_at >= ?');
        params.push(query.now - query.windowMs);
        if (query.excludeWorkflow !== undefined) {
            conditions.push('NOT EXISTS (SELECT 1 FROM episode_usage u WHERE u.item_id = i.id AND u.workflow = ?)');
            params.push(query.excludeWorkflow);
        }
        params.push(query.limit);

        const rows = await this.adapter.queryAll<ItemRow>(
            `SELECT i.id, i.title, i.body, i.canonical_url, i.media_type, i.metadata_json FROM items i\n` +
                `${joins.join('\n')}\nWHERE ${conditions.join(' AND ')}\n` +
                `ORDER BY ${order.join(', ')}\nLIMIT ?`,
            ...params,
        );
        if (rows.length === 0) return [];

        const labelsByItem = await this.labelsFor(rows.map((row) => row.id));
        return rows.map((row) => ({
            id: row.id,
            title: row.title,
            body: row.body,
            sourceUri: row.canonical_url,
            mediaType: row.media_type,
            metadata: parseMetadataJson(row.metadata_json),
            labels: labelsByItem.get(row.id) ?? {},
        }));
    }

    /** Every stored decision answer for `ids`, keyed by item id, in decision-id order. */
    private async labelsFor(ids: readonly string[]): Promise<Map<string, Record<string, string>>> {
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await this.adapter.queryAll<{ item_id: string; decision_id: string; value: string }>(
            `SELECT item_id, decision_id, value FROM labels WHERE item_id IN (${placeholders}) ORDER BY item_id, decision_id`,
            ...ids,
        );
        const byItem = new Map<string, Record<string, string>>();
        for (const row of rows) {
            const labels = byItem.get(row.item_id) ?? {};
            labels[row.decision_id] = row.value;
            byItem.set(row.item_id, labels);
        }
        return byItem;
    }

    /** Id → stored `content_hash` for the ids that already exist. */
    private async existingContentHashes(ids: readonly string[]): Promise<Map<string, string>> {
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await this.adapter.queryAll<{ id: string; content_hash: string }>(
            `SELECT id, content_hash FROM items WHERE id IN (${placeholders})`,
            ...ids,
        );
        return new Map(rows.map((row) => [row.id, row.content_hash]));
    }
}
