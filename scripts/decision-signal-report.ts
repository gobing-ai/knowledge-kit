/**
 * Task 0317 R4 — outcome-driven signal report: does a label dimension predict survival?
 *
 * Joins `labels` (the observation table `kk store label` writes) to `selections` (the outcome
 * ledger `kk store select` / `mark-published` / `release` write) and, per decision × maker,
 * reports how well the stored value separates `published` from `dropped` items.
 *
 * The split is **survival after selection**, not selection itself: `selections` only holds items a
 * run planned, so a candidate rejected during ranking never appears here. Read the AUC as
 * "picked-and-aired vs picked-and-pulled", never as "would the ranker have picked it".
 *
 *   bun scripts/decision-signal-report.ts [--db .works/kk.db] [--window 30d] [--json]
 *
 * AUC is the Mann-Whitney probability that a `published` item outranks a `dropped` one on this
 * dimension (0.5 = no signal, ties counted as half). `MIN_ITEMS` keeps a handful of rows from
 * masquerading as a finding.
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** One decision × maker's separation of the two outcomes. */
export interface SignalRow {
    decisionId: string;
    maker: string;
    /** Items carrying this observation that also carry an outcome. */
    items: number;
    published: number;
    dropped: number;
    /** Mean stored value per outcome, rounded to 2dp; `null` when that outcome is empty. */
    publishedMean: number | null;
    droppedMean: number | null;
    /** Mann-Whitney AUC; `null` when either outcome has no rows. */
    auc: number | null;
    /** `signal` | `none` | `insufficient` — `MIN_ITEMS` and `AUC_MARGIN` decide. */
    verdict: 'signal' | 'none' | 'insufficient';
}

/** Below this many outcome-bearing items a dimension's numbers are noise, not a finding. */
export const MIN_ITEMS = 20;
/** |AUC − 0.5| at or above this counts as separation worth acting on. */
export const AUC_MARGIN = 0.15;

const WINDOW_UNITS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** `30d` → the epoch-ms lower bound for `labels.labeled_at`. No unit is a caller mistake. */
export function parseWindow(raw: string, now = Date.now()): number {
    const match = /^(\d+)([smhd])$/.exec(raw.trim());
    const amount = match?.[1];
    const unit = match?.[2];
    if (amount === undefined || unit === undefined) {
        throw new Error(`--window must be <n><s|m|h|d>, got '${raw}'`);
    }
    return now - Number(amount) * WINDOW_UNITS[unit];
}

/**
 * Mean-ranks the two groups and returns the Mann-Whitney AUC. Ties take the average rank, so a
 * constant dimension scores exactly 0.5 instead of favouring whichever group sorted first.
 */
export function aucOf(published: readonly number[], dropped: readonly number[]): number | null {
    if (published.length === 0 || dropped.length === 0) return null;
    const all = [...published, ...dropped].sort((a, b) => a - b);
    const rankOf = (value: number): number => {
        let first = all.indexOf(value);
        while (first > 0 && all[first - 1] === value) first -= 1;
        let last = first;
        while (last + 1 < all.length && all[last + 1] === value) last += 1;
        return (first + 1 + last + 1) / 2;
    };
    const publishedRank = published.reduce((sum, value) => sum + rankOf(value), 0);
    const u = publishedRank - (published.length * (published.length + 1)) / 2;
    return u / (published.length * dropped.length);
}

function meanOf(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

/**
 * The report rows, ordered by decision then maker. Only numeric scores are ranked: a choice
 * dimension (category, audience) has no ordering, so it reports its counts and a `none` verdict
 * rather than an invented ordinal distance.
 */
export function signalRows(db: Database, since: number): SignalRow[] {
    const rows = db
        .query(
            `SELECT l.decision_id AS decisionId, l.maker AS maker, l.value AS value, l.score AS score,
                    s.status AS status
             FROM labels l
             JOIN selections s ON s.item_id = l.item_id
             WHERE s.status IN ('published', 'dropped') AND l.labeled_at >= ?
             ORDER BY l.decision_id, l.maker`,
        )
        .all(since) as { decisionId: string; maker: string; value: string; score: number | null; status: string }[];

    const groups = new Map<string, SignalRow & { publishedValues: number[]; droppedValues: number[] }>();
    for (const row of rows) {
        const key = `${row.decisionId}\u0000${row.maker}`;
        let group = groups.get(key);
        if (group === undefined) {
            group = {
                decisionId: row.decisionId,
                maker: row.maker,
                items: 0,
                published: 0,
                dropped: 0,
                publishedMean: null,
                droppedMean: null,
                auc: null,
                verdict: 'insufficient',
                publishedValues: [],
                droppedValues: [],
            };
            groups.set(key, group);
        }
        group.items += 1;
        const numeric = row.score ?? (Number.isFinite(Number(row.value)) ? Number(row.value) : null);
        if (row.status === 'published') {
            group.published += 1;
            if (numeric !== null) group.publishedValues.push(numeric);
        } else {
            group.dropped += 1;
            if (numeric !== null) group.droppedValues.push(numeric);
        }
    }

    return [...groups.values()].map((group) => {
        const auc = aucOf(group.publishedValues, group.droppedValues);
        const publishedMean = meanOf(group.publishedValues);
        const droppedMean = meanOf(group.droppedValues);
        let verdict: SignalRow['verdict'] = 'insufficient';
        if (group.items >= MIN_ITEMS) {
            verdict = auc !== null && Math.abs(auc - 0.5) >= AUC_MARGIN ? 'signal' : 'none';
        }
        return {
            decisionId: group.decisionId,
            maker: group.maker,
            items: group.items,
            published: group.published,
            dropped: group.dropped,
            publishedMean,
            droppedMean,
            auc: auc === null ? null : Math.round(auc * 1000) / 1000,
            verdict,
        };
    });
}

export function formatTable(rows: readonly SignalRow[]): string {
    const header = ['decision', 'maker', 'items', 'pub', 'drop', 'pub_mean', 'drop_mean', 'auc', 'verdict'];
    const lines = [header.join('\t')];
    for (const row of rows) {
        lines.push(
            [
                row.decisionId,
                row.maker,
                String(row.items),
                String(row.published),
                String(row.dropped),
                row.publishedMean === null ? '-' : String(row.publishedMean),
                row.droppedMean === null ? '-' : String(row.droppedMean),
                row.auc === null ? '-' : row.auc.toFixed(3),
                row.verdict,
            ].join('\t'),
        );
    }
    return lines.join('\n');
}

/** Where the report's stdout/stderr go; injected so an in-process suite run does not print. */
export interface ReportWriters {
    out: (line: string) => void;
    err: (line: string) => void;
}

/**
 * The CLI entry, returning the process exit code instead of exiting: the suite drives it in-process
 * (a spawned child's coverage is not attributed to the run), and `import.meta.main` below is the
 * only place that terminates.
 */
export function runReportCli(
    args: readonly string[],
    writers: ReportWriters = { out: console.log, err: console.error },
): number {
    const flagValue = (flag: string, fallback?: string): string => {
        const index = args.indexOf(flag);
        const value = index === -1 ? undefined : args[index + 1];
        if (value === undefined) {
            if (fallback !== undefined) return fallback;
            throw new Error(`${flag} requires a value`);
        }
        return value;
    };
    const dbPath = resolve(flagValue('--db', '.works/kk.db'));
    if (!existsSync(dbPath)) {
        writers.err(`decision-signal-report: database not found: ${dbPath}`);
        return 1;
    }
    const since = parseWindow(flagValue('--window', '365d'));
    const db = new Database(dbPath, { readonly: true });
    try {
        const rows = signalRows(db, since);
        if (args.includes('--json')) {
            writers.out(JSON.stringify({ dbPath, since, minItems: MIN_ITEMS, aucMargin: AUC_MARGIN, rows }, null, 2));
        } else {
            writers.out(`# decision signal report — ${dbPath} (labeled_at >= ${new Date(since).toISOString()})`);
            writers.out(
                `# AUC = P(published outranks dropped); signal when |AUC-0.5| >= ${AUC_MARGIN} and items >= ${MIN_ITEMS}`,
            );
            writers.out(formatTable(rows));
        }
    } finally {
        db.close();
    }
    return 0;
}

if (import.meta.main) {
    const code = runReportCli(Bun.argv.slice(2));
    if (code !== 0) process.exit(code);
}
