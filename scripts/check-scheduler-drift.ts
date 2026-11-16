/**
 * Scheduler drift report — what the running scheduler actually issues vs what `.spur/config.yaml` says.
 *
 * WHY (task 0382, incident 2026-11-15): `spur self serve` reads the schedule at startup and keeps it
 * in memory. `.spur/config.yaml` had already moved the daily jobs to the `kk news` verbs, but the
 * process serving the 04:30 and 07:00 ticks still held the retired `bun scripts/daily-ai-news.ts`
 * payloads, so both died with `Module not found` and the day produced no episode. Nothing compared
 * the two, and the failure surfaced a day later, by hand, out of `queue_jobs`.
 *
 * Read-only. It parses the checked-in jobs, reads the most recent `scheduler.custom` payload per job
 * out of the spur db, and reports one row per job:
 *
 *   in-sync           the last issued command is the configured one and its entry point exists
 *   drift             the last issued command differs — the server predates the config edit
 *   never-issued      the job is configured but the db holds no tick for it yet
 *   missing-entry     the configured command names a path that is not in the tree
 *   unreadable        the db cannot be read (the report never guesses in its place)
 *
 * Exit 1 on drift / missing-entry / unreadable, so a cron entry or an operator can gate on it.
 *
 * Usage:
 *   bun scripts/check-scheduler-drift.ts [--config <path>] [--db <path>] [--json]
 */
import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One configured scheduler job, as the config declares it. */
interface ConfiguredJob {
    name: string;
    command: string;
    cron: string;
}

/** The verdict for one configured job. */
export type DriftVerdict = 'in-sync' | 'drift' | 'never-issued' | 'missing-entry' | 'unreadable';

export interface DriftRow {
    name: string;
    cron: string;
    configured: string;
    /** The last command the scheduler actually enqueued, or null when it never fired. */
    issued: string | null;
    verdict: DriftVerdict;
    detail: string;
}

/** Verdicts that must fail the check: a stale payload or a command that cannot run. */
const FAILING: ReadonlySet<DriftVerdict> = new Set(['drift', 'missing-entry', 'unreadable']);

/**
 * Parse `bootstrap.scheduler.jobs` out of the checked-in config. Only `name`/`cron`/`command` are
 * read: this is a drift report, not a schema validator (spur owns that).
 */
export function configuredJobs(configPath: string): ConfiguredJob[] {
    const parsed = Bun.YAML.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown> | null;
    const jobs = (
        (parsed?.bootstrap as Record<string, unknown> | undefined)?.scheduler as Record<string, unknown> | undefined
    )?.jobs;
    if (!Array.isArray(jobs)) return [];
    return jobs.flatMap((entry) => {
        const job = entry as Record<string, unknown>;
        const name = typeof job.name === 'string' ? job.name : '';
        const command = typeof job.command === 'string' ? job.command : '';
        const cron = typeof job.cron === 'string' ? job.cron : '';
        return name !== '' && command !== '' ? [{ name, command, cron }] : [];
    });
}

/** The most recent issued command per job name, straight out of the scheduler's queue. */
export function lastIssued(dbPath: string): { issued: Map<string, string>; error: string | null } {
    const issued = new Map<string, string>();
    if (!existsSync(dbPath)) return { issued, error: `no spur db at ${dbPath}` };
    let db: Database | null = null;
    try {
        db = new Database(dbPath, { readonly: true });
        const rows = db
            .query<{ payload: string }, []>(
                "SELECT payload FROM queue_jobs WHERE type = 'scheduler.custom' ORDER BY created_at ASC",
            )
            .all();
        // Ascending order + last write wins: the newest payload per job name survives.
        for (const row of rows) {
            try {
                const payload = JSON.parse(row.payload) as { name?: unknown; command?: unknown };
                if (typeof payload.name === 'string' && typeof payload.command === 'string') {
                    issued.set(payload.name, payload.command);
                }
            } catch {
                // A malformed historical payload is not this report's finding.
            }
        }
        return { issued, error: null };
    } catch (error) {
        return { issued, error: error instanceof Error ? error.message : String(error) };
    } finally {
        db?.close();
    }
}

/** The first `scripts/…`-shaped token in a command, or null when the command names none. */
export function entryScript(command: string): string | null {
    const match = /(?:^|\s)(scripts\/[^\s"']+)/.exec(command);
    return match?.[1] ?? null;
}

/** One row per configured job, in config order. */
export function driftRows(
    jobs: ConfiguredJob[],
    issued: Map<string, string>,
    root: string,
    error: string | null,
): DriftRow[] {
    return jobs.map((job) => {
        const script = entryScript(job.command);
        const base = { name: job.name, cron: job.cron, configured: job.command };
        if (error !== null) {
            return {
                ...base,
                issued: null,
                verdict: 'unreadable' as const,
                detail: `cannot read the scheduler db: ${error}`,
            };
        }
        if (script !== null && !existsSync(join(root, script))) {
            return {
                ...base,
                issued: issued.get(job.name) ?? null,
                verdict: 'missing-entry' as const,
                detail: `${script} is not in the tree — this tick cannot run`,
            };
        }
        const last = issued.get(job.name) ?? null;
        if (last === null) {
            return {
                ...base,
                issued: null,
                verdict: 'never-issued' as const,
                detail: 'no tick recorded in the db yet',
            };
        }
        if (last === job.command) {
            return {
                ...base,
                issued: last,
                verdict: 'in-sync' as const,
                detail: 'the last tick issued the configured command',
            };
        }
        return {
            ...base,
            issued: last,
            verdict: 'drift' as const,
            detail: 'the running scheduler issued a different command — it predates this config edit; restart the scheduler host',
        };
    });
}

function flag(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
}

/** Run the report; returns the exit code (1 when anything needs attention). */
export function main(argv: string[]): number {
    const root = resolve(flag(argv, '--root') ?? process.cwd());
    const configPath = resolve(flag(argv, '--config') ?? join(root, '.spur', 'config.yaml'));
    const dbPath = resolve(flag(argv, '--db') ?? join(root, '.spur', 'spur.db'));
    const { issued, error } = lastIssued(dbPath);
    const rows = driftRows(configuredJobs(configPath), issued, root, error);

    if (argv.includes('--json')) {
        process.stdout.write(
            `${JSON.stringify({ rows, ok: rows.every((row) => !FAILING.has(row.verdict)) }, null, 2)}\n`,
        );
    } else {
        for (const row of rows) process.stdout.write(`${row.verdict.padEnd(14)} ${row.name} — ${row.detail}\n`);
        const failing = rows.filter((row) => FAILING.has(row.verdict)).length;
        process.stdout.write(`${rows.length} configured job(s), ${failing} needing attention\n`);
    }
    return rows.some((row) => FAILING.has(row.verdict)) ? 1 : 0;
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)));
