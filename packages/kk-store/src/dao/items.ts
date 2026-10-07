import type { Doc } from '@gobing-ai/kk-core';
import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { canonicalUrlForDoc, itemId } from '../canonical-url';
import { items } from '../schema/items';

/** One `items` row as stored. */
export type ItemRecord = typeof items.$inferSelect;

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
