/**
 * Read-only AI-news extraction-supply diagnostic (task 0337).
 *
 * bun scripts/ai-news-supply-report.ts --db <existing.db> --config <config.yaml> \
 *   --profile plugins/kk/decisions/extract/ai-news.yaml --at <ISO-8601-with-offset> [--hours 24,72,168]
 *
 * The default windows include 72h because production voice3 extracts with `--window 72h`.
 *
 * The script never opens a store writer, migrates, labels, reserves or calls a model/network.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const { compileProfile, labelsCurrentSql, parseProfile, readStoreConfig } = await import(
    Bun.resolveSync('@gobing-ai/kk-store', resolve(import.meta.dir, '../packages/kk-store'))
);

const TOPIC = 'ai-news';
const REQUIRED_PREDICATES = [
    'kk-item-category',
    'kk-item-quality',
    'kk-item-importance',
    'kk-item-china-politics',
] as const;
const STAGE_NAMES = ['seen', 'category', 'quality', 'importance', 'moderation', 'reservationExclusion'] as const;
const BODY_BUCKETS = ['<300', '300..1499', '>=1500'] as const;
const DEFAULT_HOURS = '24,72,168';

interface LabelPolicy {
    priority: readonly string[];
    decisionPriority: Record<string, readonly string[]>;
    minConfidence: number;
}

type ProfilePredicate =
    | { decisionId: string; op: 'in'; values: readonly string[] }
    | { decisionId: string; op: 'gte' | 'lte'; value: number };
type ProfileOrder =
    | { column: 'first_seen_at'; direction: 'asc' | 'desc' }
    | { decisionId: string; direction: 'asc' | 'desc' };

interface ExtractProfile {
    topic: string;
    where: ProfilePredicate[];
    order: ProfileOrder[];
    limit: number;
}

interface ProfileQuery {
    where: ProfilePredicate[];
    order: ProfileOrder[];
    windowMs: number;
    now: number;
    limit: number;
    excludeTopic?: string;
}

interface CountRow {
    items: number;
    stories: number;
    nullStoryItems: number;
}

interface GateReport extends CountRow {
    name: string;
    removedItems: number;
}

interface IdRow {
    id: string;
    story_id: string | null;
}

interface SourceRow {
    id: string;
    source: string;
    body: string;
    qualityMaker: string | null;
}

interface SourceReport {
    source: string;
    items: number;
    bodyBuckets: Record<(typeof BODY_BUCKETS)[number], number>;
    qualityMakers: Record<string, number>;
}

interface WindowReport {
    hours: number;
    since: string;
    gates: GateReport[];
    cappedItemIds: string[];
    sources: SourceReport[];
    labelCoverage: Record<string, { current: number; staleOnly: number; missing: number }>;
    blockedStories: { published: number; selectedOnly: number };
}

interface QueryParts {
    from: string;
    conditions: string[];
    params: unknown[];
    labelsCurrent: string;
    aliases: Record<string, string>;
}

function parseArgs(args: readonly string[]): Record<string, string> {
    const required = ['--db', '--config', '--profile', '--at'];
    const allowed = new Set([...required, '--hours']);
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index];
        if (flag === undefined || !allowed.has(flag)) throw new Error(`unknown argument '${flag ?? ''}'`);
        if (values.has(flag)) throw new Error(`duplicate flag '${flag}'`);
        const value = args[index + 1];
        if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
        values.set(flag, value);
    }
    for (const flag of required) {
        if (!values.has(flag)) throw new Error(`missing required flag ${flag}`);
    }
    return Object.fromEntries(values);
}

function parseHours(raw: string): number[] {
    const hours = raw.split(',').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
    if (hours.some((value) => !Number.isSafeInteger(value) || value <= 0) || new Set(hours).size !== hours.length) {
        throw new Error(`--hours must be distinct positive integers, comma-separated, got '${raw}'`);
    }
    return hours;
}

function existingPath(raw: string, what: string): string {
    const path = resolve(raw);
    if (!existsSync(path)) throw new Error(`${what} not found: ${path}`);
    return path;
}

async function validateConfigSyntax(path: string): Promise<void> {
    try {
        const parsed: unknown = Bun.YAML.parse(await Bun.file(path).text());
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('expected a YAML mapping');
        }
    } catch (error) {
        // readStoreConfig defaults malformed files for normal operation; this diagnostic must fail closed.
        throw new Error(`config is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function validateProfile(profile: ExtractProfile): void {
    if (profile.topic !== TOPIC) throw new Error(`profile contract: topic must be '${TOPIC}', got '${profile.topic}'`);
    const actual = profile.where.map((predicate) => predicate.decisionId).sort();
    const expected = [...REQUIRED_PREDICATES].sort();
    if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
        throw new Error(`profile contract: expected exactly these predicates: ${expected.join(', ')}`);
    }
}

function predicateSql(predicate: ProfilePredicate, alias: string, params: unknown[]): string {
    if (predicate.op === 'in') {
        params.push(...predicate.values);
        return `${alias}.value IN (${predicate.values.map(() => '?').join(', ')})`;
    }
    params.push(predicate.value);
    return `CAST(${alias}.value AS INTEGER) ${predicate.op === 'gte' ? '>=' : '<='} ?`;
}

/** Build one cumulative gate without joining labels whose owning gate has not yet run. */
function queryParts(
    query: ProfileQuery,
    policy: LabelPolicy,
    predicateCount: number,
    excludeReserved: boolean,
    includeOrder = false,
): QueryParts {
    const { sql: labelsCurrent, params: labelsParams } = labelsCurrentSql(policy);
    const params: unknown[] = [...labelsParams];
    const joins: string[] = [];
    const aliases = new Map<string, string>();
    const applied = new Set(query.where.slice(0, predicateCount).map((predicate) => predicate.decisionId));
    const aliasFor = (decisionId: string): string => {
        const existing = aliases.get(decisionId);
        if (existing !== undefined) return existing;
        const alias = `l${aliases.size}`;
        aliases.set(decisionId, alias);
        joins.push(
            `${applied.has(decisionId) ? 'JOIN' : 'LEFT JOIN'} labels_current ${alias} ` +
                `ON ${alias}.item_id = i.id AND ${alias}.decision_id = ?`,
        );
        params.push(decisionId);
        return alias;
    };
    for (const predicate of query.where.slice(0, predicateCount)) aliasFor(predicate.decisionId);
    if (includeOrder) {
        for (const term of query.order) if (!('column' in term)) aliasFor(term.decisionId);
    }

    const conditions: string[] = [];
    for (const predicate of query.where.slice(0, predicateCount)) {
        conditions.push(predicateSql(predicate, aliasFor(predicate.decisionId), params));
    }
    conditions.push('i.first_seen_at >= ?');
    params.push(query.now - query.windowMs);
    if (excludeReserved) {
        conditions.push(
            `NOT EXISTS (SELECT 1 FROM selections s WHERE s.topic = ? AND s.story_id = i.story_id ` +
                `AND s.status IN ('selected', 'published'))`,
        );
        params.push(TOPIC);
    }
    return {
        from: `FROM items i\n${joins.join('\n')}`,
        conditions,
        params,
        labelsCurrent,
        aliases: Object.fromEntries(aliases),
    };
}

function countRows(
    db: Database,
    query: ProfileQuery,
    policy: LabelPolicy,
    predicateCount: number,
    exclude: boolean,
): CountRow {
    const parts = queryParts(query, policy, predicateCount, exclude);
    return db
        .query(
            `WITH ${parts.labelsCurrent}\nSELECT COUNT(DISTINCT i.id) AS items, ` +
                `COUNT(DISTINCT CASE WHEN i.story_id IS NOT NULL THEN i.story_id END) AS stories, ` +
                `COUNT(DISTINCT CASE WHEN i.story_id IS NULL THEN i.id END) AS nullStoryItems\n` +
                `${parts.from}\nWHERE ${parts.conditions.join(' AND ')}`,
        )
        .get(...parts.params) as CountRow;
}

function cappedRows(db: Database, query: ProfileQuery, policy: LabelPolicy): IdRow[] {
    const parts = queryParts(query, policy, query.where.length, true, true);
    const params = [...parts.params];
    const order = query.order.map((term) => {
        const direction = term.direction === 'desc' ? 'DESC' : 'ASC';
        if ('column' in term) return `i.${term.column} ${direction}`;
        return `CAST(${parts.aliases[term.decisionId]}.value AS INTEGER) ${direction}`;
    });
    order.push('i.id ASC');
    params.push(query.limit);
    return db
        .query(
            `WITH ${parts.labelsCurrent}\nSELECT i.id, i.story_id\n${parts.from}\n` +
                `WHERE ${parts.conditions.join(' AND ')}\nORDER BY ${order.join(', ')}\nLIMIT ?`,
        )
        .all(...params) as IdRow[];
}

function sourceReport(db: Database, query: ProfileQuery, policy: LabelPolicy): SourceReport[] {
    const { sql: labelsCurrent, params } = labelsCurrentSql(policy);
    const rows = db
        .query(
            `WITH ${labelsCurrent}\nSELECT i.id, i.source, i.body, q.maker AS qualityMaker FROM items i\n` +
                `LEFT JOIN labels_current q ON q.item_id = i.id AND q.decision_id = 'kk-item-quality'\n` +
                `WHERE i.first_seen_at >= ? ORDER BY i.id`,
        )
        .all(...params, query.now - query.windowMs) as SourceRow[];
    const sources = new Map<
        string,
        { items: Set<string>; bodyBuckets: Record<string, number>; qualityMakers: Map<string, number> }
    >();
    for (const row of rows) {
        const source = sources.get(row.source) ?? {
            items: new Set<string>(),
            bodyBuckets: Object.fromEntries(BODY_BUCKETS.map((bucket) => [bucket, 0])),
            qualityMakers: new Map<string, number>(),
        };
        source.items.add(row.id);
        const length = row.body.trim().length;
        const bucket = length < 300 ? '<300' : length < 1500 ? '300..1499' : '>=1500';
        source.bodyBuckets[bucket] = (source.bodyBuckets[bucket] ?? 0) + 1;
        if (row.qualityMaker !== null) {
            source.qualityMakers.set(row.qualityMaker, (source.qualityMakers.get(row.qualityMaker) ?? 0) + 1);
        }
        sources.set(row.source, source);
    }
    return [...sources.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, source]) => ({
            source: name,
            items: source.items.size,
            bodyBuckets: Object.fromEntries(BODY_BUCKETS.map((bucket) => [bucket, source.bodyBuckets[bucket] ?? 0])),
            qualityMakers: Object.fromEntries(
                [...source.qualityMakers.entries()].sort(([a], [b]) => a.localeCompare(b)),
            ),
        }));
}

function labelCoverage(
    db: Database,
    query: ProfileQuery,
    policy: LabelPolicy,
): Record<string, { current: number; staleOnly: number; missing: number }> {
    const since = query.now - query.windowMs;
    const itemIds = (
        db.query('SELECT id FROM items WHERE first_seen_at >= ? ORDER BY id').all(since) as { id: string }[]
    ).map((row) => row.id);
    const placeholders = REQUIRED_PREDICATES.map(() => '?').join(', ');
    const { sql: labelsCurrent, params } = labelsCurrentSql(policy);
    const currentRows = db
        .query(
            `WITH ${labelsCurrent}\nSELECT i.id AS itemId, lc.decision_id AS decisionId FROM items i\n` +
                `JOIN labels_current lc ON lc.item_id = i.id\n` +
                `WHERE i.first_seen_at >= ? AND lc.decision_id IN (${placeholders})`,
        )
        .all(...params, since, ...REQUIRED_PREDICATES) as { itemId: string; decisionId: string }[];
    const current = new Set(currentRows.map((row) => `${row.itemId}\0${row.decisionId}`));
    const observations = db
        .query(
            `SELECT l.item_id AS itemId, l.decision_id AS decisionId, COUNT(*) AS observations, ` +
                `MAX(CASE WHEN l.content_hash = i.content_hash THEN 1 ELSE 0 END) AS hasCurrentHash\n` +
                `FROM labels l JOIN items i ON i.id = l.item_id\n` +
                `WHERE i.first_seen_at >= ? AND l.decision_id IN (${placeholders})\n` +
                `GROUP BY l.item_id, l.decision_id`,
        )
        .all(since, ...REQUIRED_PREDICATES) as {
        itemId: string;
        decisionId: string;
        observations: number;
        hasCurrentHash: number;
    }[];
    const observationMap = new Map(observations.map((row) => [`${row.itemId}\0${row.decisionId}`, row]));
    return Object.fromEntries(
        REQUIRED_PREDICATES.map((decisionId) => {
            let currentCount = 0;
            let staleOnly = 0;
            let missing = 0;
            for (const itemId of itemIds) {
                const key = `${itemId}\0${decisionId}`;
                if (current.has(key)) {
                    currentCount += 1;
                    continue;
                }
                const observation = observationMap.get(key);
                if (observation !== undefined && observation.observations > 0 && observation.hasCurrentHash === 0) {
                    staleOnly += 1;
                } else {
                    missing += 1;
                }
            }
            return [decisionId, { current: currentCount, staleOnly, missing }];
        }),
    );
}

function blockedStories(
    db: Database,
    query: ProfileQuery,
    policy: LabelPolicy,
): { published: number; selectedOnly: number } {
    const parts = queryParts(query, policy, query.where.length, false);
    const storyIds = (
        db
            .query(
                `WITH ${parts.labelsCurrent}\nSELECT DISTINCT i.story_id AS storyId\n${parts.from}\n` +
                    `WHERE ${parts.conditions.join(' AND ')} AND i.story_id IS NOT NULL ORDER BY i.story_id`,
            )
            .all(...parts.params) as { storyId: string }[]
    ).map((row) => row.storyId);
    if (storyIds.length === 0) return { published: 0, selectedOnly: 0 };
    const placeholders = storyIds.map(() => '?').join(', ');
    const rows = db
        .query(
            `SELECT DISTINCT story_id AS storyId, status FROM selections\n` +
                `WHERE topic = ? AND story_id IN (${placeholders}) AND status IN ('selected', 'published')`,
        )
        .all(TOPIC, ...storyIds) as { storyId: string; status: 'selected' | 'published' }[];
    const published = new Set(rows.filter((row) => row.status === 'published').map((row) => row.storyId));
    const selected = new Set(rows.filter((row) => row.status === 'selected').map((row) => row.storyId));
    return {
        published: published.size,
        selectedOnly: [...selected].filter((storyId) => !published.has(storyId)).length,
    };
}

function buildWindow(
    db: Database,
    profile: ExtractProfile,
    policy: LabelPolicy,
    now: number,
    hours: number,
): WindowReport {
    const query = compileProfile(profile, {
        now,
        windowMs: hours * 3_600_000,
        excludeTopic: TOPIC,
    }) as ProfileQuery;
    // STAGE_NAMES are positional; profile `where` keeps YAML key order, so pin the ladder order.
    query.where = [...query.where].sort(
        (a, b) =>
            REQUIRED_PREDICATES.indexOf(a.decisionId as (typeof REQUIRED_PREDICATES)[number]) -
            REQUIRED_PREDICATES.indexOf(b.decisionId as (typeof REQUIRED_PREDICATES)[number]),
    );
    const gates: GateReport[] = [];
    let previous = 0;
    for (let index = 0; index < STAGE_NAMES.length; index += 1) {
        const predicateCount = index === 0 ? 0 : index;
        const count = countRows(db, query, policy, predicateCount, index === STAGE_NAMES.length - 1);
        gates.push({
            name: STAGE_NAMES[index] as string,
            ...count,
            removedItems: index === 0 ? 0 : previous - count.items,
        });
        previous = count.items;
    }
    const capped = cappedRows(db, query, policy);
    gates.push({
        name: 'cap',
        items: capped.length,
        stories: new Set(capped.map((row) => row.story_id).filter((id): id is string => id !== null)).size,
        nullStoryItems: capped.filter((row) => row.story_id === null).length,
        removedItems: previous - capped.length,
    });
    return {
        hours,
        since: new Date(now - hours * 3_600_000).toISOString(),
        gates,
        cappedItemIds: capped.map((row) => row.id),
        sources: sourceReport(db, query, policy),
        labelCoverage: labelCoverage(db, query, policy),
        blockedStories: blockedStories(db, query, policy),
    };
}

function requireSchema(db: Database): void {
    const required = ['items', 'labels', 'selections'];
    const rows = db
        .query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'labels', 'selections')`)
        .all() as { name: string }[];
    const present = new Set(rows.map((row) => row.name));
    const missing = required.filter((name) => !present.has(name));
    if (missing.length > 0) throw new Error(`schema unavailable: missing table(s): ${missing.join(', ')}`);
}

async function main(): Promise<void> {
    const args = parseArgs(Bun.argv.slice(2));
    const hours = parseHours(args['--hours'] ?? DEFAULT_HOURS);
    const dbPath = existingPath(args['--db'] as string, 'database');
    const configPath = existingPath(args['--config'] as string, 'config');
    const profilePath = existingPath(args['--profile'] as string, 'profile');
    const rawAt = args['--at'] as string;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(rawAt)) {
        throw new Error('--at must be ISO-8601 with an explicit offset');
    }
    const now = Date.parse(rawAt);
    if (!Number.isFinite(now)) throw new Error(`--at is not a valid timestamp: '${rawAt}'`);
    await validateConfigSyntax(configPath);
    const config = await readStoreConfig(configPath);
    const profile = parseProfile(await Bun.file(profilePath).text()) as ExtractProfile;
    validateProfile(profile);
    const labelPolicy: LabelPolicy = {
        priority: config.labels.priority,
        decisionPriority: config.labels.decisionPriority,
        minConfidence: config.labels.minConfidence,
    };

    const db = new Database(dbPath, { readonly: true });
    let transactionOpen = false;
    try {
        requireSchema(db);
        db.exec('BEGIN');
        transactionOpen = true;
        const windows = hours.map((window) => buildWindow(db, profile, labelPolicy, now, window));
        const report = {
            version: 1,
            at: new Date(now).toISOString(),
            dbPath,
            profilePath,
            profile,
            labelPolicy,
            windows,
            limitations: [
                'Extraction eligibility only; downstream QC and episode-duration checks are not predicted.',
                'Body length is a source-depth fact, not a model quality judgment.',
                'This diagnostic executes no enrichment, labeling, reservation or gate-policy remedy.',
            ],
        };
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        if (transactionOpen) db.exec('ROLLBACK');
        db.close();
    }
}

if (import.meta.main) {
    try {
        await main();
    } catch (error) {
        process.stderr.write(`ai-news-supply-report: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
