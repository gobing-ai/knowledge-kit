import type { DbAdapter, Predicate } from '@gobing-ai/ts-db';
import { EntityDao } from '@gobing-ai/ts-db';
import { labels } from '../schema/labels';

/**
 * The closed confidence enum a label verdict carries (G31 R14) — the only values
 * `labels.confidence` may hold, and the same vocabulary the judge-verdict guards use.
 */
export const LABEL_CONFIDENCE_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;

/** One label verdict's confidence level. */
export type LabelConfidence = (typeof LABEL_CONFIDENCE_LEVELS)[number];

/** A model answer's confidence at or above this is `HIGH` (`kk store label`'s boundary contract). */
export const HIGH_CONFIDENCE_MIN = 0.8;

/** A model answer's confidence at or above this (and below {@link HIGH_CONFIDENCE_MIN}) is `MEDIUM`. */
export const MEDIUM_CONFIDENCE_MIN = 0.5;

/** One `labels` row as stored. */
export type LabelRecord = Omit<typeof labels.$inferSelect, 'confidence'> & {
    /**
     * The verdict level stored for this decision. `null` marks a row no `kk store label` pass
     * wrote (a hand-seeded or pre-0209-era row): a consumer must refuse it, never read it as a
     * pass.
     */
    confidence: LabelConfidence | null;
};

/** Who produced a label value — a decision run, the keyword heuristic, or the degraded default. */
export type LabelSource = 'model' | 'heuristic' | 'default';

/**
 * The confidence level a label verdict earns: the numeric model payload 0–1 maps into the closed
 * enum at the emit boundary, and only a `model` answer can earn more than `LOW` — a keyword
 * heuristic row or a degraded `source: default` row has no model evidence to cite.
 */
export function labelConfidence(source: LabelSource, confidence: number | null): LabelConfidence {
    // The payload is untrusted JSON cast to a number at `kk store label`, so the documented 0–1
    // domain is enforced at this boundary: an out-of-range or non-finite value is unreadable
    // evidence and fails closed like a missing payload, never a level nothing evidences.
    if (source !== 'model' || confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        return 'LOW';
    }
    if (confidence >= HIGH_CONFIDENCE_MIN) return 'HIGH';
    if (confidence >= MEDIUM_CONFIDENCE_MIN) return 'MEDIUM';
    return 'LOW';
}

/**
 * The level of a whole label pass: the weakest level among its verdicts, so a pass can never
 * claim more certainty than its least certain decision; a pass with no rows at all is `LOW`.
 */
export function verdictConfidence(levels: readonly LabelConfidence[]): LabelConfidence {
    if (levels.includes('LOW') || levels.length === 0) return 'LOW';
    if (levels.includes('MEDIUM')) return 'MEDIUM';
    return 'HIGH';
}

/**
 * The maker-priority policy {@link labelsCurrentSql} ranks and filters by (R4). `kk-store` never
 * reads the operator config itself — `readStoreConfig` yields this shape and the caller passes it
 * in, so no second config reader exists beside that one.
 */
export interface LabelPolicy {
    /** Maker names, best first; `'*'` matches any maker at its own position. */
    priority: readonly string[];
    /** Decision id → priority that replaces `priority` for that decision id. */
    decisionPriority: Record<string, readonly string[]>;
    /** A `source 'model'` row below this raw confidence is not a current label. */
    minConfidence: number;
}

/** The CTE name {@link labelsCurrentSql} defines: one current row per `(item_id, decision_id)`. */
export const LABELS_CURRENT = 'labels_current';

/** A `labels_current` CTE definition plus its bind parameters, in statement text order. */
export interface LabelsCurrentSql {
    /** `<name> AS ( … )`; a consumer prepends `WITH ` to make it a statement. */
    sql: string;
    params: unknown[];
}

/** Run ids at or after this prefix are replay observations (R6); only a named maker may win one. */
const REPLAY_RUN_PREFIX = 'replay-';

/** The columns `labels_current` exposes — every consumer joins or reads exactly these. */
const LABELS_CURRENT_COLUMNS = 'item_id, decision_id, value, score, maker, source, confidence, run_id, labeled_at';

/**
 * SQL for `l.maker`'s priority rank under one priority list, appending that list's maker binds to
 * `params`. A named maker ranks at its own index; a maker matched only by `'*'` (the `ELSE`) ranks
 * at the wildcard's index; an unmatched maker is `NULL`. An empty list is all-`NULL`, so nothing is
 * eligible — the fail-closed read a typo must produce.
 */
function makerRank(priority: readonly string[], params: unknown[]): string {
    const wildcard = priority.indexOf('*');
    const branches: string[] = [];
    priority.forEach((maker, index) => {
        if (maker === '*') return;
        params.push(maker);
        branches.push(`WHEN ? THEN ${index}`);
    });
    const fallback = wildcard === -1 ? 'NULL' : String(wildcard);
    if (branches.length === 0) return fallback;
    return `CASE l.maker ${branches.join(' ')} ELSE ${fallback} END`;
}

/**
 * The rank expression for a decision: a `store.labels.decisions.<id>.priority` override REPLACES the
 * global list for that id, everything else falls to the global CASE (R4).
 */
function rankExpression(policy: LabelPolicy, params: unknown[]): string {
    const overrides = Object.entries(policy.decisionPriority);
    if (overrides.length === 0) return makerRank(policy.priority, params);
    const branches = overrides.map(([decisionId, priority]) => {
        params.push(decisionId);
        return `WHEN l.decision_id = ? THEN (${makerRank(priority, params)})`;
    });
    return `CASE ${branches.join(' ')} ELSE (${makerRank(policy.priority, params)}) END`;
}

/** Every maker named explicitly (never `'*'`) across the global and per-decision priorities. */
function namedMakers(policy: LabelPolicy): string[] {
    const names = new Set<string>();
    const add = (priority: readonly string[]): void => {
        for (const maker of priority) if (maker !== '*') names.add(maker);
    };
    add(policy.priority);
    for (const priority of Object.values(policy.decisionPriority)) add(priority);
    return [...names];
}

/**
 * The `labels_current` CTE (R4): for every `(item_id, decision_id)` the one eligible,
 * highest-priority observation. A row is eligible when its `content_hash` is the item's current
 * hash (the JOIN), its `source` is not `'default'` (a degraded row is not a label), a
 * `source 'model'` row clears `minConfidence`, its maker is in the effective priority (`'*'` matches
 * at the wildcard's position) and — for a `run_id` starting `replay-` — its maker is listed BY NAME,
 * never by `'*'`, so a replay can never displace production selection. Unlisted makers are filtered
 * in `WHERE`, never ranked last. Kept rows rank by priority position, then latest `labeled_at`, then
 * greatest `run_id`.
 */
export function labelsCurrentSql(policy: LabelPolicy): LabelsCurrentSql {
    const params: unknown[] = [];
    // The rank CASE sits in the SELECT list, so its binds precede every WHERE bind.
    const rank = rankExpression(policy, params);
    const conditions = ["l.source <> 'default'"];
    conditions.push("(l.source <> 'model' OR l.raw_confidence >= ?)");
    params.push(policy.minConfidence);
    conditions.push(`(${rankExpression(policy, params)}) IS NOT NULL`);
    const named = namedMakers(policy);
    params.push(`${REPLAY_RUN_PREFIX}%`);
    conditions.push(
        named.length === 0
            ? 'l.run_id NOT LIKE ?'
            : `(l.run_id NOT LIKE ? OR l.maker IN (${named.map(() => '?').join(', ')}))`,
    );
    params.push(...named);
    const sql = `${LABELS_CURRENT} AS (
    SELECT ${LABELS_CURRENT_COLUMNS}
    FROM (
        SELECT l.*, ROW_NUMBER() OVER (
            PARTITION BY l.item_id, l.decision_id
            ORDER BY ${rank}, l.labeled_at DESC, l.run_id DESC
        ) AS rn
        FROM labels l
        JOIN items it ON it.id = l.item_id AND it.content_hash = l.content_hash
        WHERE ${conditions.join('\n            AND ')}
    )
    WHERE rn = 1
)`;
    return { sql, params };
}

/** One current label row — the `labels_current` columns, in the DAO's camelCase shape. */
export interface CurrentLabelRecord {
    itemId: string;
    decisionId: string;
    value: string;
    score: number | null;
    maker: string;
    source: LabelSource;
    confidence: LabelConfidence | null;
    runId: string;
    labeledAt: number;
}

/** Input accepted by {@link LabelsDao.recordObservation}. */
export interface LabelInput {
    itemId: string;
    decisionId: string;
    value: string;
    maker: string;
    source: LabelSource;
    /** The collect run the observation belongs to — part of the row identity, never null. */
    runId: string;
    /** Score decisions only; `null` for choice decisions. */
    score?: number | null;
    /**
     * The verdict's `HIGH` | `MEDIUM` | `LOW` level; `null` only for a row written outside the
     * `kk store label` pass, which a consumer must refuse.
     */
    confidence?: LabelConfidence | null;
    /** The maker's answer verbatim, before vocabulary mapping (task 0226). */
    rawValue?: string | null;
    /** The model's raw 0–1 payload (task 0226). */
    rawConfidence?: number | null;
    /** The maker's stated reason, when it gives one (task 0226). */
    reason?: string | null;
    /** The consult's own duration in milliseconds (task 0226). */
    durationMs?: number | null;
    /** The decision catalog version the answer came from (task 0226). */
    catalogVersion?: string | null;
    /** The item's `content_hash` when the answer was made — an edited item keeps its answers. */
    contentHash?: string | null;
    labeledAt?: number;
}

/** Filter accepted by {@link LabelsDao.observations}; every field is an ANDed equality/bound. */
export interface LabelObservationFilter {
    decisionId?: string;
    maker?: string;
    runId?: string;
    /** Only observations labelled at or after this epoch-ms stamp. */
    since?: number;
}

/**
 * DAO for `labels` — one observation per (item, decision, maker, run), so a second
 * maker never overwrites the first (R1/G32 D1).
 *
 * `recordObservation` upserts on the 4-column identity and writes only the owning
 * row: a different maker, or the same maker in a later run, is a new row, and an
 * edit to the item does not delete past observations (they keep their own
 * `content_hash`).
 *
 * `labels.confidence` is declared `text` and carries exactly one of the `HIGH | MEDIUM | LOW`
 * levels (task 0213). The column type and the value domain therefore agree, and `toLabelRecord`
 * below is the single seam that narrows a plain `string` to the enum type — no other cast touches
 * the level, and the enum is never coerced to a number.
 */
export class LabelsDao extends EntityDao<typeof labels, typeof labels.itemId> {
    constructor(adapter: DbAdapter) {
        super(adapter, labels, [labels.itemId, labels.decisionId], 'labels');
    }

    /**
     * Record one observation, replacing only the row with the same (item, decision,
     * maker, run) identity. The row's `created_at` stays the first write of that
     * identity, which is what an audit read wants.
     */
    async recordObservation(input: LabelInput, now = Date.now()): Promise<LabelRecord> {
        const labeledAt = input.labeledAt ?? now;
        const score = input.score ?? null;
        const confidence = input.confidence ?? null;
        const rawValue = input.rawValue ?? null;
        const rawConfidence = input.rawConfidence ?? null;
        const reason = input.reason ?? null;
        const durationMs = input.durationMs ?? null;
        const catalogVersion = input.catalogVersion ?? null;
        const contentHash = input.contentHash ?? null;
        const row = await super.upsert(
            {
                itemId: input.itemId,
                decisionId: input.decisionId,
                value: input.value,
                score,
                maker: input.maker,
                source: input.source,
                confidence,
                runId: input.runId,
                labeledAt,
                rawValue,
                rawConfidence,
                reason,
                durationMs,
                catalogVersion,
                contentHash,
            },
            [labels.itemId, labels.decisionId, labels.maker, labels.runId],
            {
                value: input.value,
                score,
                source: input.source,
                confidence,
                labeledAt,
                rawValue,
                rawConfidence,
                reason,
                durationMs,
                catalogVersion,
                contentHash,
            },
        );
        return toLabelRecord(row);
    }

    /** Every observation stored for one item, in decision-id order. */
    async listForItem(itemId: string): Promise<LabelRecord[]> {
        const rows = await super.findAllBy(labels.itemId, itemId);
        return rows.map(toLabelRecord);
    }

    /**
     * Every observation matching `filter` (ANDed), in identity order — the
     * backtesting read (task 0226) and the `observations` handoff.
     */
    async observations(filter: LabelObservationFilter = {}): Promise<LabelRecord[]> {
        const conditions: Predicate[] = [];
        if (filter.decisionId !== undefined) {
            conditions.push({ col: labels.decisionId, op: 'eq', value: filter.decisionId });
        }
        if (filter.maker !== undefined) conditions.push({ col: labels.maker, op: 'eq', value: filter.maker });
        if (filter.runId !== undefined) conditions.push({ col: labels.runId, op: 'eq', value: filter.runId });
        if (filter.since !== undefined) conditions.push({ col: labels.labeledAt, op: 'gte', value: filter.since });
        const rows = await super.list({
            ...(conditions.length === 0 ? {} : { where: { and: conditions } }),
            orderBy: [{ col: labels.itemId }, { col: labels.decisionId }, { col: labels.maker }, { col: labels.runId }],
        });
        return rows.map(toLabelRecord);
    }

    /**
     * The current observation per `(item_id, decision_id)` for `itemIds`, under `policy` (R4) — the
     * same `labels_current` CTE `ItemsDao.selectByProfile`'s joins use, so the two reads can never
     * disagree about which label is current. Row order is `(item_id, decision_id)`.
     */
    async currentFor(itemIds: readonly string[], policy: LabelPolicy): Promise<CurrentLabelRecord[]> {
        if (itemIds.length === 0) return [];
        const { sql, params } = labelsCurrentSql(policy);
        const placeholders = itemIds.map(() => '?').join(', ');
        const rows = await this.adapter.queryAll<CurrentLabelRow>(
            `WITH ${sql}\nSELECT ${LABELS_CURRENT_COLUMNS} FROM ${LABELS_CURRENT}` +
                `\nWHERE item_id IN (${placeholders})\nORDER BY item_id, decision_id`,
            ...params,
            ...itemIds,
        );
        return rows.map(toCurrentLabelRecord);
    }
}

/** The raw `labels_current` row: SQLite's own snake_case column names, not the select type. */
interface CurrentLabelRow {
    item_id: string;
    decision_id: string;
    value: string;
    score: number | null;
    maker: string;
    source: string;
    confidence: string | null;
    run_id: string;
    labeled_at: number;
}

/** A `labels_current` row with `source`/`confidence` narrowed to their closed domains. */
function toCurrentLabelRecord(row: CurrentLabelRow): CurrentLabelRecord {
    return {
        itemId: row.item_id,
        decisionId: row.decision_id,
        value: row.value,
        score: row.score,
        maker: row.maker,
        source: row.source as LabelSource,
        confidence: row.confidence as LabelConfidence | null,
        runId: row.run_id,
        labeledAt: row.labeled_at,
    };
}

/** The row shape the DDL declares — `confidence` is TEXT, holding the verdict enum. */
type StoredLabelRow = typeof labels.$inferSelect;

/** A stored row with `confidence` narrowed from `string` to the enum type it actually holds. */
function toLabelRecord(row: StoredLabelRow): LabelRecord {
    return { ...row, confidence: row.confidence as LabelConfidence | null };
}
