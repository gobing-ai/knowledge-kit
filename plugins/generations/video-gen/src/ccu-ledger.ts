import { dirname, join, resolve } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/**
 * Rolling Colab compute-unit ledger (`0451 R3`).
 *
 * The numbers are an *estimate* by design: Google exposes no per-job CCU query, so the ledger
 * multiplies wall-clock GPU time by a conservative hourly burn rate. It lives under the works dir
 * (ADR-042: disposable, not mission-critical config) — losing it costs the operator a manual
 * re-estimate, nothing more.
 */

/** Conservative burn factors per accelerator, in compute units per hour. */
export const CCU_PER_HOUR = { T4: 2, L4: 3, A100: 7 } as const;

/** Accelerators this plugin can request. */
export type ColabGpu = keyof typeof CCU_PER_HOUR;

/** One ledger line. */
export interface CcuLedgerEntry {
    timestamp: string;
    gpu: ColabGpu;
    durationSec: number;
    estimatedCcu: number;
    jobType: string;
    status: 'ok' | 'failed' | 'timeout';
}

/** Ledger file name under the works root. */
export const LEDGER_FILE_NAME = 'colab-ccu-ledger.jsonl';

/**
 * Where the ledger lives: the works root, never the per-run directory.
 *
 * WHY the works root: the rolling 30-day window only means anything if consecutive daily runs append
 * to the SAME file. A ledger inside `<works>/<run>/` resets every day, so the cap would never guard a
 * launch. `KK_WORKS_DIR` wins when the caller knows the root; otherwise the run dir's parent is used
 * (ADR-042 layout: `<works_dir>/<workflow>/<run>`).
 */
export function resolveLedgerPath(workDir: string, env: Record<string, string | undefined> = {}): string {
    const explicit = env.KK_WORKS_DIR;
    if (typeof explicit === 'string' && explicit.trim() !== '') {
        return join(resolve(explicit.trim()), LEDGER_FILE_NAME);
    }
    return join(resolve(workDir, '..'), LEDGER_FILE_NAME);
}

/** Rolling window the cap is measured over. */
export const LEDGER_WINDOW_DAYS = 30;

/** Default monthly cap, leaving headroom under Google AI Pro's ~200 CCU/month. */
export const DEFAULT_MAX_MONTHLY_CCU = 180;

/** Estimate one job's compute units from its wall clock and accelerator. */
export function estimateCcu(gpu: ColabGpu, durationSec: number): number {
    const hours = Math.max(durationSec, 0) / 3600;
    return Number((hours * CCU_PER_HOUR[gpu]).toFixed(4));
}

function asEntry(raw: unknown): CcuLedgerEntry | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const estimated = record.estimatedCcu;
    if (typeof estimated !== 'number' || !Number.isFinite(estimated)) return null;
    const timestamp = typeof record.timestamp === 'string' ? record.timestamp : '';
    if (Number.isNaN(Date.parse(timestamp))) return null;
    return {
        timestamp,
        gpu: (typeof record.gpu === 'string' ? record.gpu : 'T4') as ColabGpu,
        durationSec: typeof record.durationSec === 'number' ? record.durationSec : 0,
        estimatedCcu: estimated,
        jobType: typeof record.jobType === 'string' ? record.jobType : 'unknown',
        status: record.status === 'ok' || record.status === 'timeout' ? record.status : 'failed',
    };
}

/**
 * Sum the ledger's estimate over the rolling 30 days ending at `now`. A missing file reads as 0; a
 * malformed line is skipped rather than failing the run (the ledger is an estimate, not evidence).
 */
export async function readRolling30d(
    path: string,
    now: number = Date.now(),
    fs: FileSystem,
): Promise<{ totalCcu: number; entries: number }> {
    if (!(await fs.exists(path))) return { totalCcu: 0, entries: 0 };
    const text = await fs.readFile(path);
    const cutoff = now - LEDGER_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    let totalCcu = 0;
    let entries = 0;
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed) as unknown;
        } catch {
            continue;
        }
        const entry = asEntry(parsed);
        if (entry === null) continue;
        if (Date.parse(entry.timestamp) < cutoff) continue;
        totalCcu += entry.estimatedCcu;
        entries += 1;
    }
    return { totalCcu: Number(totalCcu.toFixed(4)), entries };
}

/** Append one ledger line, creating the directory when needed. */
export async function appendLedger(path: string, entry: CcuLedgerEntry, fs: FileSystem): Promise<void> {
    await fs.ensureDir(dirname(path));
    await fs.appendFile(path, `${JSON.stringify(entry)}\n`);
}

/**
 * Refuse a job whose projection would exceed the monthly cap. The refusal is returned (not thrown)
 * so the caller can fall back to the local provider with a named warning.
 */
export function assertBudget(args: {
    rollingCcu: number;
    projectedCcu: number;
    maxMonthlyCcu: number;
}): { ok: true } | { error: string } {
    const total = args.rollingCcu + args.projectedCcu;
    if (!Number.isFinite(args.maxMonthlyCcu) || args.maxMonthlyCcu <= 0) {
        return { error: `colab budget cap ${args.maxMonthlyCcu} is not a positive number of CCU` };
    }
    if (total > args.maxMonthlyCcu) {
        return {
            error: `colab CCU budget exhausted: ${args.rollingCcu.toFixed(1)} used in 30d + ${args.projectedCcu.toFixed(2)} projected exceeds the ${args.maxMonthlyCcu} CCU cap`,
        };
    }
    return { ok: true };
}
