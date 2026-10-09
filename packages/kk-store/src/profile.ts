/**
 * Topic profiles: `plugins/kk/decisions/extract/<topic>.yaml` parsed into a
 * parameterized query spec (task 0210 R1/R2).
 *
 * A profile is data, not code — a new topic is a new YAML file. This module owns
 * the parse/validate half (`parseProfile`) and the merge with per-call options
 * (`compileProfile`); `ItemsDao.selectByProfile` owns the SQL, so no SQL leaves
 * `packages/kk-store` (ADR-030).
 */

/**
 * Decision ids the kk item-label catalog declares
 * (`plugins/kk/decisions/kk-items.yaml`) — the only keys a profile may name.
 *
 * Kept in lockstep with the catalog on purpose: these are exactly the ids
 * `kk store label` writes — the original five (`CATEGORY_DECISION_ID` + the four
 * `kk-item-<dimension>` score decisions) plus the three judgment decisions
 * (`kk-item-china-politics`/`kk-item-sensitivity` score 0–3 and `kk-item-audience`
 * choice, task 0229 R6) — so a profile referencing anything else would silently
 * select nothing.
 */
export const ITEM_DECISION_IDS: readonly string[] = [
    'kk-item-category',
    'kk-item-quality',
    'kk-item-importance',
    'kk-item-urgency',
    'kk-item-impact',
    'kk-item-china-politics',
    'kk-item-sensitivity',
    'kk-item-audience',
];

/** The item's own first-seen stamp — the one non-decision key `order` may name. */
const FIRST_SEEN_AT = 'first_seen_at';

/**
 * Default pool cap when neither the profile nor `--limit` names one: episode-plan-gen's
 * `EPISODE_PLAN_MAX_ITEMS` default (20) is the current episode cap.
 */
export const DEFAULT_EXTRACT_LIMIT = 20;

/** Every top-level profile key the schema allows; anything else is a typo, not an extension. */
const PROFILE_KEYS = new Set(['topic', 'where', 'order', 'limit']);

/** One `where` predicate: a decision value set, or a numeric bound on a score decision. */
export type ProfilePredicate =
    | { decisionId: string; op: 'in'; values: readonly string[] }
    | { decisionId: string; op: 'gte' | 'lte'; value: number };

/** One `order` term: the item's first-seen stamp, or a decision value ordered numerically. */
export type ProfileOrder =
    | { column: typeof FIRST_SEEN_AT; direction: 'asc' | 'desc' }
    | { decisionId: string; direction: 'asc' | 'desc' };

/** A parsed topic profile — pure data, no SQL and no store handle. */
export interface ExtractProfile {
    topic: string;
    /** Decision predicates, ANDed; each compiles to one `labels` self-join. */
    where: ProfilePredicate[];
    /** Order terms, most significant first; empty when the profile omits `order`. */
    order: ProfileOrder[];
    /** Pool cap from the profile; `--limit` overrides it (see {@link compileProfile}). */
    limit: number;
}

/** Per-call options {@link compileProfile} merges over the parsed profile. */
export interface CompileProfileOptions {
    /** Only items first seen at or after `now - windowMs` are pool candidates. */
    windowMs: number;
    /** Injected clock (epoch ms) so extraction is deterministic for a fixed database. */
    now: number;
    /** When set, items whose story is already selected/published for this topic are excluded. */
    excludeTopic?: string;
    /** `--limit` override; falls back to the profile's own cap. */
    limit?: number;
}

/**
 * The parameterized query spec {@link ItemsDao.selectByProfile} executes.
 *
 * Values are parameters, never string-interpolated — the only SQL text a profile
 * can influence is which known decision id a join binds.
 */
export interface ProfileQuery {
    where: ProfilePredicate[];
    order: ProfileOrder[];
    windowMs: number;
    now: number;
    limit: number;
    excludeTopic?: string;
}

/**
 * A profile the compiler cannot honour: an unknown key, an unknown decision id,
 * or a malformed predicate. `kk store extract` maps it to exit 1
 * `kk.store.profile.invalid` (R1).
 */
export class ProfileInvalidError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProfileInvalidError';
    }
}

/** A YAML/JSON value as a plain record, or `undefined` when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

/** A profile decision key, or the failure that names it (R1). */
function requireDecisionId(key: string, context: string): string {
    if (!ITEM_DECISION_IDS.includes(key)) {
        throw new ProfileInvalidError(
            `${context}: unknown decision id '${key}' (expected one of ${ITEM_DECISION_IDS.join(', ')})`,
        );
    }
    return key;
}

/** Parse one `where` value (`{ in: [...] }` / `{ gte: n }` / `{ lte: n }`) for `decisionId`. */
function parsePredicate(decisionId: string, raw: unknown): ProfilePredicate {
    const spec = asRecord(raw);
    if (spec === undefined) {
        throw new ProfileInvalidError(`where.${decisionId}: expected an object, got ${JSON.stringify(raw)}`);
    }
    const operators = Object.keys(spec);
    if (operators.length !== 1 || (operators[0] !== 'in' && operators[0] !== 'gte' && operators[0] !== 'lte')) {
        throw new ProfileInvalidError(
            `where.${decisionId}: expected exactly one of 'in', 'gte', 'lte', got ${JSON.stringify(operators)}`,
        );
    }
    const [operator] = operators;
    const value = spec[operator as string];
    if (operator === 'in') {
        if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== 'string')) {
            throw new ProfileInvalidError(`where.${decisionId}.in: expected a non-empty array of strings`);
        }
        return { decisionId, op: 'in', values: value as string[] };
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ProfileInvalidError(
            `where.${decisionId}.${operator}: expected an integer, got ${JSON.stringify(value)}`,
        );
    }
    return { decisionId, op: operator as 'gte' | 'lte', value };
}

/** Parse one `order` entry (`<decision-id> asc|desc` or `first_seen_at asc|desc`). */
function parseOrderTerm(entry: unknown, index: number): ProfileOrder {
    if (typeof entry !== 'string') {
        throw new ProfileInvalidError(`order[${index}]: expected a string, got ${JSON.stringify(entry)}`);
    }
    const parts = entry.trim().split(/\s+/);
    if (parts.length !== 2) {
        throw new ProfileInvalidError(`order[${index}]: expected '<key> asc|desc', got '${entry}'`);
    }
    const [key, rawDirection] = parts as [string, string];
    if (rawDirection !== 'asc' && rawDirection !== 'desc') {
        throw new ProfileInvalidError(`order[${index}]: direction must be 'asc' or 'desc', got '${rawDirection}'`);
    }
    if (key === FIRST_SEEN_AT) return { column: FIRST_SEEN_AT, direction: rawDirection };
    return { decisionId: requireDecisionId(key, `order[${index}]`), direction: rawDirection };
}

/**
 * Parse and validate one profile document (R1).
 *
 * Unknown top-level keys, unknown decision ids, malformed predicates and a
 * non-positive `limit` all throw {@link ProfileInvalidError}: a profile typo must
 * fail loud rather than quietly widen or empty the pool.
 */
export function parseProfile(yaml: string): ExtractProfile {
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(yaml);
    } catch (error) {
        throw new ProfileInvalidError(`not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
    }
    const document = asRecord(parsed);
    if (document === undefined) {
        throw new ProfileInvalidError('expected a YAML mapping with topic/where/order/limit');
    }
    for (const key of Object.keys(document)) {
        if (!PROFILE_KEYS.has(key)) {
            throw new ProfileInvalidError(`unknown key '${key}' (expected ${[...PROFILE_KEYS].join(', ')})`);
        }
    }
    const topic = document.topic;
    if (typeof topic !== 'string' || topic.trim() === '') {
        throw new ProfileInvalidError('topic: expected a non-empty string');
    }
    const whereSpec = asRecord(document.where);
    if (whereSpec === undefined || Object.keys(whereSpec).length === 0) {
        throw new ProfileInvalidError('where: expected a non-empty mapping of decision id to predicate');
    }
    const where = Object.entries(whereSpec).map(([key, value]) =>
        parsePredicate(requireDecisionId(key, 'where'), value),
    );

    let order: ProfileOrder[] = [];
    if (document.order !== undefined) {
        if (!Array.isArray(document.order)) {
            throw new ProfileInvalidError('order: expected an array of "<key> asc|desc" strings');
        }
        order = document.order.map(parseOrderTerm);
    }

    let limit = DEFAULT_EXTRACT_LIMIT;
    if (document.limit !== undefined) {
        if (typeof document.limit !== 'number' || !Number.isInteger(document.limit) || document.limit < 1) {
            throw new ProfileInvalidError(`limit: expected a positive integer, got ${JSON.stringify(document.limit)}`);
        }
        limit = document.limit;
    }
    return { topic: topic.trim(), where, order, limit };
}

/**
 * Merge a parsed profile with one call's window, clock, exclusion and limit into
 * the query spec the DAO executes (R2).
 */
export function compileProfile(profile: ExtractProfile, options: CompileProfileOptions): ProfileQuery {
    return {
        where: profile.where,
        order: profile.order,
        windowMs: options.windowMs,
        now: options.now,
        limit: options.limit ?? profile.limit,
        ...(options.excludeTopic === undefined ? {} : { excludeTopic: options.excludeTopic }),
    };
}
