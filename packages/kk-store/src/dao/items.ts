import type { Doc } from '@gobing-ai/kk-core';
import type { DbAdapter, DbBatchOp } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { canonicalUrlForDoc, itemId, outboundUrls } from '../canonical-url';
import { type ItemFacts, itemFacts } from '../facts';
import type { ProfileQuery } from '../profile';
import { items } from '../schema/items';
import {
    DEFAULT_STORY_POLICY,
    type StoryCandidate,
    type StoryPolicy,
    type StoryUrlIdentity,
    storyIdFor,
    storyIdForUrls,
} from '../story';
import { LABELS_CURRENT, type LabelPolicy, labelsCurrentSql } from './labels';

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
    /** Known ids whose content changed — the next label pass re-labels them. */
    updated: number;
    /** Known ids whose content hash is unchanged (only `last_seen_run` moved). */
    unchanged: number;
    /** The ids this call inserted — the input to labelling (`new-ids.json`). */
    newIds: string[];
}

/** A Doc reduced to its `items` row values (all identity/hash/fact work done once). */
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
    /** The typed fact columns this Doc's row carries (0227 R1). */
    facts: ItemFacts;
}

/** One already-stored item the upsert compares against: hash, story root and first-seen stamp. */
interface ExistingItem {
    contentHash: string;
    /** `items.story_id`; `null` only on a row the 0225 backfill has not touched (treated as `id`). */
    storyId: string | null;
    firstSeenAt: number;
}

/** One `items` row as `backfillFacts` reads it: every fact column plus the clustering inputs. */
interface BackfillRow {
    id: string;
    title: string;
    body: string;
    canonical_url: string | null;
    metadata_json: string;
    first_seen_at: number;
    engagement: number | null;
    body_chars: number | null;
    source_tier: string | null;
    lang: string | null;
    domain: string | null;
    story_id: string | null;
}

const INSERT_ITEM_SQL = `INSERT INTO items
    (id, canonical_url, content_hash, title, body, source, media_type, metadata_json,
     first_seen_run, last_seen_run, first_seen_at, published_at, created_at, updated_at,
     engagement, body_chars, source_tier, lang, domain, story_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** The update path refreshes the facts but never `story_id`: a story root is chosen once (R3). */
const UPDATE_ITEM_SQL = `UPDATE items
    SET canonical_url = ?, content_hash = ?, title = ?, body = ?, source = ?, media_type = ?,
        metadata_json = ?, published_at = ?, last_seen_run = ?, updated_at = ?,
        engagement = ?, body_chars = ?, source_tier = ?, lang = ?, domain = ?
    WHERE id = ?`;

const TOUCH_ITEM_SQL = 'UPDATE items SET last_seen_run = ?, updated_at = ? WHERE id = ?';

/** `backfillFacts` writes the facts and the causal story root; `updated_at` is left alone (idempotent run). */
const BACKFILL_ITEM_SQL = `UPDATE items
    SET engagement = ?, body_chars = ?, source_tier = ?, lang = ?, domain = ?, story_id = ?
    WHERE id = ?`;

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
        facts: itemFacts(doc),
    };
}

/** An item's URL identity: `outboundUrls` canonicalizes, so a tracking-decorated link still matches. */
function itemUrls(ownUrl: string | null, body: string): StoryUrlIdentity {
    return {
        canonicalUrl: ownUrl === null || ownUrl === '' ? undefined : ownUrl,
        bodyUrls: outboundUrls(body),
    };
}

/** A stored row as a clustering candidate; a `null` `story_id` reads as the item's own id. */
function toCandidate(
    id: string,
    storyId: string | null,
    title: string,
    firstSeenAt: number,
    urls: StoryUrlIdentity = { bodyUrls: [] },
): StoryCandidate {
    return {
        id,
        storyId: storyId ?? id,
        title,
        firstSeenAt,
        ...(urls.canonicalUrl === undefined ? {} : { canonicalUrl: urls.canonicalUrl }),
        ...(urls.bodyUrls.length === 0 ? {} : { bodyUrls: urls.bodyUrls }),
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
     * A `content_hash` change no longer deletes the item's `labels` rows (R5/G32 D1): every
     * observation keeps the `content_hash` it was made against, so an edited item's past answers
     * stay attributable. The item still counts as `updated`, so the label pass re-labels it.
     *
     * Facts (0227 R1) are filled for every INSERTED or UPDATED row from the same `PreparedItem`, so
     * the batch stays one atomic `adapter.batch`. `story_id` (R2/R3) is chosen once, for an inserted
     * item only: the candidates are the rows inside `story.windowHours` of `now` plus the docs that
     * precede this one IN THIS BATCH (a duplicate the DB has not seen yet), and an existing item
     * keeps the story root it already has. A later item never re-roots a story.
     */
    async upsertDocs(
        runId: string,
        docs: readonly Doc[],
        now = Date.now(),
        story: StoryPolicy = DEFAULT_STORY_POLICY,
    ): Promise<UpsertDocsResult> {
        const byId = new Map<string, PreparedItem>();
        for (const doc of docs) {
            const prepared = prepareItem(doc);
            byId.set(prepared.id, prepared);
        }
        if (byId.size === 0) return { inserted: 0, updated: 0, unchanged: 0, newIds: [] };

        const known = await this.existingItems([...byId.keys()]);
        const recent = await this.storyCandidates(now - story.windowHours * 3_600_000);
        const batchCandidates: StoryCandidate[] = [];
        const operations: DbBatchOp[] = [];
        const newIds: string[] = [];
        let inserted = 0;
        let updated = 0;
        let unchanged = 0;

        for (const item of byId.values()) {
            const previous = known.get(item.id);
            if (previous === undefined) {
                inserted += 1;
                newIds.push(item.id);
                const pool = [...recent, ...batchCandidates];
                const urls = itemUrls(item.canonicalUrl, item.body);
                // URL identity first (0316 R1): a link post and its primary source share one story
                // even though their titles share no token, which the Jaccard pass cannot see.
                const storyId = storyIdForUrls(urls, pool) ?? storyIdFor(item.title, pool, story.threshold) ?? item.id;
                batchCandidates.push(toCandidate(item.id, storyId, item.title, now, urls));
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
                        item.facts.engagement,
                        item.facts.bodyChars,
                        item.facts.sourceTier,
                        item.facts.lang,
                        item.facts.domain,
                        storyId,
                    ],
                });
                continue;
            }
            batchCandidates.push(toCandidate(item.id, previous.storyId, item.title, previous.firstSeenAt));
            if (previous.contentHash !== item.contentHash) {
                updated += 1;
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
                        item.facts.engagement,
                        item.facts.bodyChars,
                        item.facts.sourceTier,
                        item.facts.lang,
                        item.facts.domain,
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
     * Recompute the typed facts and the CAUSAL story clustering for every item (0227 R4).
     *
     * Rows are walked in `first_seen_at, id` order and each item clusters only against EARLIER
     * items inside `policy.windowHours` of its own `first_seen_at` — the sliding candidate list,
     * so the pass never re-roots a story on a later item. The facts are pure functions of the row,
     * so a second run changes nothing and returns `0`. Returns the count of rows whose values
     * actually changed.
     */
    async backfillFacts(policy: StoryPolicy = DEFAULT_STORY_POLICY): Promise<number> {
        const rows = await this.adapter.queryAll<BackfillRow>(
            `SELECT id, title, body, canonical_url, metadata_json, first_seen_at,
                    engagement, body_chars, source_tier, lang, domain, story_id
             FROM items ORDER BY first_seen_at, id`,
        );
        const windowMs = policy.windowHours * 3_600_000;
        const candidates: StoryCandidate[] = [];
        const operations: DbBatchOp[] = [];
        let updated = 0;

        for (const row of rows) {
            const facts = itemFacts({
                id: row.id,
                body: row.body,
                title: row.title,
                ...(row.canonical_url === null ? {} : { sourceUri: row.canonical_url }),
                metadata: parseMetadataJson(row.metadata_json),
            });
            // Rows arrive in ascending `first_seen_at`, so the candidates older than the window are
            // always its prefix — drop them before matching, keeping the list causal.
            while (
                candidates.length > 0 &&
                (candidates[0] as StoryCandidate).firstSeenAt < row.first_seen_at - windowMs
            ) {
                candidates.shift();
            }
            const urls = itemUrls(row.canonical_url, row.body);
            // URL identity first (0316 R1), then the fuzzy title fallback that still owns the
            // URL-less pair the token pass was built for.
            const storyId =
                storyIdForUrls(urls, candidates) ?? storyIdFor(row.title, candidates, policy.threshold) ?? row.id;
            candidates.push(toCandidate(row.id, storyId, row.title, row.first_seen_at, urls));

            if (
                row.engagement !== facts.engagement ||
                row.body_chars !== facts.bodyChars ||
                row.source_tier !== facts.sourceTier ||
                row.lang !== facts.lang ||
                row.domain !== facts.domain ||
                row.story_id !== storyId
            ) {
                updated += 1;
                operations.push({
                    sql: BACKFILL_ITEM_SQL,
                    params: [
                        facts.engagement,
                        facts.bodyChars,
                        facts.sourceTier,
                        facts.lang,
                        facts.domain,
                        storyId,
                        row.id,
                    ],
                });
            }
        }

        if (operations.length > 0) await this.adapter.batch(operations);
        return updated;
    }

    /** The stored items a batch may cluster against: those first seen at or after `sinceMs`. */
    private async storyCandidates(sinceMs: number): Promise<StoryCandidate[]> {
        const rows = await this.adapter.queryAll<{
            id: string;
            story_id: string | null;
            title: string;
            first_seen_at: number;
            canonical_url: string | null;
            body: string;
        }>(
            `SELECT id, story_id, title, first_seen_at, canonical_url, body
             FROM items WHERE first_seen_at >= ? ORDER BY first_seen_at, id`,
            sinceMs,
        );
        return rows.map((row) =>
            toCandidate(row.id, row.story_id, row.title, row.first_seen_at, itemUrls(row.canonical_url, row.body)),
        );
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
    async selectByProfile(query: ProfileQuery, policy: LabelPolicy): Promise<StoredDoc[]> {
        const whereDecisions = new Set(query.where.map((predicate) => predicate.decisionId));
        const aliases = new Map<string, string>();
        const joins: string[] = [];
        // The `labels_current` CTE leads the statement, so its binds precede every join/WHERE bind.
        const { sql: labelsCurrent, params: labelsParams } = labelsCurrentSql(policy);
        const params: unknown[] = [...labelsParams];
        const aliasFor = (decisionId: string): string => {
            const existing = aliases.get(decisionId);
            if (existing !== undefined) return existing;
            const alias = `l${aliases.size}`;
            aliases.set(decisionId, alias);
            joins.push(
                `${whereDecisions.has(decisionId) ? 'JOIN' : 'LEFT JOIN'} ${LABELS_CURRENT} ${alias} ` +
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
        if (query.excludeTopic !== undefined) {
            // Story-scoped, topic-scoped exclusion (task 0228): an item selected or published for
            // `excludeTopic` is out of the pool, and one story shared by several items excludes them
            // all. `dropped` selections are free to re-enter.
            conditions.push(
                `NOT EXISTS (SELECT 1 FROM selections s WHERE s.topic = ? AND s.story_id = i.story_id ` +
                    `AND s.status IN ('selected', 'published'))`,
            );
            params.push(query.excludeTopic);
        }
        params.push(query.limit);

        const rows = await this.adapter.queryAll<ItemRow>(
            `WITH ${labelsCurrent}\n` +
                `SELECT i.id, i.title, i.body, i.canonical_url, i.media_type, i.metadata_json FROM items i\n` +
                `${joins.join('\n')}\nWHERE ${conditions.join(' AND ')}\n` +
                `ORDER BY ${order.join(', ')}\nLIMIT ?`,
            ...params,
        );
        if (rows.length === 0) return [];

        const labelsByItem = await this.labelsFor(
            rows.map((row) => row.id),
            policy,
        );
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

    /**
     * Every CURRENT decision answer for `ids`, keyed by item id, in decision-id order — the same
     * `labels_current` CTE the profile joins use, so the inlined labels and the `where` predicates
     * can never disagree (R4).
     */
    private async labelsFor(ids: readonly string[], policy: LabelPolicy): Promise<Map<string, Record<string, string>>> {
        if (ids.length === 0) return new Map();
        const { sql: labelsCurrent, params: labelsParams } = labelsCurrentSql(policy);
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await this.adapter.queryAll<{ item_id: string; decision_id: string; value: string }>(
            `WITH ${labelsCurrent}\nSELECT item_id, decision_id, value FROM ${LABELS_CURRENT} ` +
                `WHERE item_id IN (${placeholders}) ORDER BY item_id, decision_id`,
            ...labelsParams,
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

    /** Ids whose `first_seen_run` or `last_seen_run` is `runId` (R6's `run:` replay selector). */
    async idsByRun(runId: string): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ id: string }>(
            'SELECT id FROM items WHERE first_seen_run = ? OR last_seen_run = ? ORDER BY id',
            runId,
            runId,
        );
        return rows.map((row) => row.id);
    }

    /** Ids first seen at or after `sinceMs` (R6's `since:` replay selector). */
    async idsSince(sinceMs: number): Promise<string[]> {
        const rows = await this.adapter.queryAll<{ id: string }>(
            'SELECT id FROM items WHERE first_seen_at >= ? ORDER BY id',
            sinceMs,
        );
        return rows.map((row) => row.id);
    }

    /** Id → `{ contentHash, storyId, firstSeenAt }` for the ids that already exist. */
    private async existingItems(ids: readonly string[]): Promise<Map<string, ExistingItem>> {
        const placeholders = ids.map(() => '?').join(', ');
        const rows = await this.adapter.queryAll<{
            id: string;
            content_hash: string;
            story_id: string | null;
            first_seen_at: number;
        }>(`SELECT id, content_hash, story_id, first_seen_at FROM items WHERE id IN (${placeholders})`, ...ids);
        return new Map(
            rows.map((row) => [
                row.id,
                { contentHash: row.content_hash, storyId: row.story_id, firstSeenAt: row.first_seen_at },
            ]),
        );
    }
}
