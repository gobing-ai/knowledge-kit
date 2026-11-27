import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    appendLedger,
    assertBudget,
    CCU_PER_HOUR,
    DEFAULT_MAX_MONTHLY_CCU,
    estimateCcu,
    LEDGER_FILE_NAME,
    LEDGER_WINDOW_DAYS,
    readRolling30d,
    resolveLedgerPath,
} from '../src/ccu-ledger';

/**
 * AC2 (R3) — the rolling compute-unit ledger: burn rates, the 30-day window, malformed-line
 * tolerance, and the pre-launch budget refusal.
 */

const fs = createNodeFileSystem();
const DAY_MS = 24 * 60 * 60 * 1000;

function ledgerPath(): string {
    return join(mkdtempSync(join(tmpdir(), 'kk-ccu-')), 'works', 'colab-ccu-ledger.jsonl');
}

describe('CCU estimate', () => {
    it('uses the conservative hourly burn rates', () => {
        expect(CCU_PER_HOUR).toEqual({ T4: 2, L4: 3, A100: 7 });
        expect(estimateCcu('A100', 3600)).toBe(7);
        expect(estimateCcu('L4', 1800)).toBe(1.5);
        expect(estimateCcu('T4', 0)).toBe(0);
        expect(estimateCcu('A100', -60)).toBe(0);
    });
});

describe('rolling 30-day ledger', () => {
    it('reads nothing from a missing file', async () => {
        expect(await readRolling30d(ledgerPath(), Date.now(), fs)).toEqual({ totalCcu: 0, entries: 0 });
    });

    it('sums only the entries inside the window and skips malformed lines', async () => {
        const path = ledgerPath();
        const now = Date.parse('2026-11-27T12:00:00.000Z');
        const entry = (timestamp: string, ccu: number) =>
            JSON.stringify({
                timestamp,
                gpu: 'A100',
                durationSec: 600,
                estimatedCcu: ccu,
                jobType: 'wan21-i2v',
                status: 'ok',
            });
        await appendLedger(path, JSON.parse(entry(new Date(now - 2 * DAY_MS).toISOString(), 1.2)), fs);
        await appendLedger(path, JSON.parse(entry(new Date(now - 20 * DAY_MS).toISOString(), 3.4)), fs);
        // Older than the window, malformed, and missing fields — all ignored.
        await appendLedger(
            path,
            JSON.parse(entry(new Date(now - (LEDGER_WINDOW_DAYS + 1) * DAY_MS).toISOString(), 9)),
            fs,
        );
        await fs.appendFile(path, 'not json\n');
        await fs.appendFile(path, `${JSON.stringify({ timestamp: 'nope', estimatedCcu: 5 })}\n`);

        expect(await readRolling30d(path, now, fs)).toEqual({ totalCcu: 4.6, entries: 2 });
    });
});

describe('budget guard (R3)', () => {
    it('passes under the cap and refuses over it', () => {
        expect(assertBudget({ rollingCcu: 170, projectedCcu: 5, maxMonthlyCcu: 180 })).toEqual({ ok: true });
        const refused = assertBudget({ rollingCcu: 179, projectedCcu: 2.4, maxMonthlyCcu: 180 });
        expect('error' in refused && refused.error).toContain('budget exhausted');
        expect('error' in refused && refused.error).toContain('180 CCU cap');
    });

    it('refuses a nonsensical cap instead of treating it as unlimited', () => {
        const refused = assertBudget({ rollingCcu: 0, projectedCcu: 1, maxMonthlyCcu: 0 });
        expect('error' in refused && refused.error).toContain('not a positive number');
        expect(DEFAULT_MAX_MONTHLY_CCU).toBe(180);
    });
});

describe('ledger location (P2-2)', () => {
    it('lives under the works root, never the per-run directory', () => {
        // `<works>/<workflow>/<run>` (ADR-042): the parent is the workflow's works dir, so the
        // rolling window accumulates across daily runs instead of resetting every day.
        expect(resolveLedgerPath('/works/kk-daily-ai-voice/20261126')).toBe(
            `/works/kk-daily-ai-voice/${LEDGER_FILE_NAME}`,
        );
        expect(resolveLedgerPath('/works/kk-daily-ai-voice/20261126', { KK_WORKS_DIR: '/explicit/works' })).toBe(
            `/explicit/works/${LEDGER_FILE_NAME}`,
        );
        // A blank override is not an override.
        expect(resolveLedgerPath('/works/run', { KK_WORKS_DIR: '  ' })).toBe(`/works/${LEDGER_FILE_NAME}`);
    });
});

describe('ledger append', () => {
    it('creates the parent directory and appends one JSON line per job', async () => {
        const path = ledgerPath();
        const entry = {
            timestamp: '2026-11-27T12:00:00.000Z',
            gpu: 'A100' as const,
            durationSec: 480,
            estimatedCcu: estimateCcu('A100', 480),
            jobType: 'wan21-i2v',
            status: 'ok' as const,
        };
        await appendLedger(path, entry, fs);
        await appendLedger(path, { ...entry, status: 'failed' }, fs);
        const lines = (await fs.readFile(path)).trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0] as string)).toMatchObject({ gpu: 'A100', status: 'ok' });
        expect(JSON.parse(lines[1] as string)).toMatchObject({ status: 'failed' });
        writeFileSync(join(tmpdir(), 'kk-ccu-touch'), 'ok');
    });
});
