/**
 * Task 0317 R4 — the labels × selections signal report (`scripts/decision-signal-report.ts`).
 *
 * Failure-first list:
 *  1. AUC rewards an ordering instead of measuring overlap (a constant dimension must read 0.5).
 *  2. A handful of rows reports `signal`, so the maker/prune decision rests on noise.
 *  3. The report silently counts items whose outcome is still `selected` (not yet published/dropped).
 *  4. A malformed `--window` is treated as "no window".
 */

import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    AUC_MARGIN,
    aucOf,
    formatTable,
    MIN_ITEMS,
    parseWindow,
    runReportCli,
    signalRows,
} from '../decision-signal-report';

/** An in-memory store with just the two tables the report reads. */
function fixtureDb(rows: { item: string; decision: string; maker: string; value: number; status: string }[]): Database {
    const db = new Database(':memory:');
    db.run(
        'CREATE TABLE labels (item_id TEXT, decision_id TEXT, maker TEXT, value TEXT, score INTEGER, labeled_at INTEGER)',
    );
    db.run('CREATE TABLE selections (item_id TEXT, status TEXT)');
    for (const row of rows) {
        db.run('INSERT INTO labels VALUES (?, ?, ?, ?, ?, ?)', [
            row.item,
            row.decision,
            row.maker,
            String(row.value),
            row.value,
            1000,
        ]);
        db.run('INSERT INTO selections VALUES (?, ?)', [row.item, row.status]);
    }
    return db;
}

/** Captures the CLI's writers, so the suite asserts on the report instead of printing it. */
function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, writers: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } };
}

describe('decision signal report (0317 R4)', () => {
    it('AUC is the Mann-Whitney overlap: 1.0 separated, 0.5 constant, ties at half', () => {
        expect(aucOf([3, 4, 5], [0, 0, 1])).toBe(1);
        expect(aucOf([2, 2, 2], [2, 2])).toBe(0.5);
        expect(aucOf([], [1])).toBeNull();
    });

    it('reads signal only when the separation clears the margin on enough items', () => {
        const strong = Array.from({ length: MIN_ITEMS }, (_, index) => ({
            item: `s${index}`,
            decision: 'kk-item-importance',
            maker: 'heuristic',
            value: 5,
            status: 'published',
        }));
        const weak = Array.from({ length: MIN_ITEMS }, (_, index) => ({
            item: `w${index}`,
            decision: 'kk-item-importance',
            maker: 'heuristic',
            value: 1,
            status: 'dropped',
        }));
        const db = fixtureDb([...strong, ...weak]);
        const [row] = signalRows(db, 0);
        expect(row?.verdict).toBe('signal');
        expect(row?.auc).toBe(1);
        expect(Math.abs((row?.auc ?? 0) - 0.5)).toBeGreaterThanOrEqual(AUC_MARGIN);
        db.close();
    });

    it('a small sample is `insufficient`, never `signal`', () => {
        const rows = [
            { item: 'a', decision: 'kk-item-importance', maker: 'heuristic', value: 5, status: 'published' },
            { item: 'b', decision: 'kk-item-importance', maker: 'heuristic', value: 1, status: 'dropped' },
        ];
        const db = fixtureDb(rows);
        expect(signalRows(db, 0)[0]?.verdict).toBe('insufficient');
        db.close();
    });

    it('ignores items whose outcome is still pending', () => {
        const rows = [
            { item: 'a', decision: 'kk-item-importance', maker: 'heuristic', value: 5, status: 'selected' },
            { item: 'b', decision: 'kk-item-importance', maker: 'heuristic', value: 4, status: 'published' },
        ];
        const db = fixtureDb(rows);
        const [row] = signalRows(db, 0);
        expect(row?.items).toBe(1);
        expect(row?.published).toBe(1);
        expect(row?.dropped).toBe(0);
        db.close();
    });

    it('renders the rows as a tab-separated table a human can read', () => {
        const table = formatTable([
            {
                decisionId: 'kk-item-quality',
                maker: 'heuristic',
                items: 30,
                published: 20,
                dropped: 10,
                publishedMean: 2.1,
                droppedMean: 2,
                auc: 0.512,
                verdict: 'none',
            },
        ]);
        const [header, row] = table.split('\n');
        expect(header).toContain('decision\tmaker\titems');
        expect(row).toBe('kk-item-quality\theuristic\t30\t20\t10\t2.1\t2\t0.512\tnone');
    });

    it('fails loud on a missing database and prints the report for a real one', () => {
        const missing = capture();
        expect(runReportCli(['--db', '/nonexistent/kk.db'], missing.writers)).toBe(1);
        expect(missing.err.join('\n')).toContain('decision-signal-report: database not found: /nonexistent/kk.db');

        const dir = mkdtempSync(join(tmpdir(), 'kk-signal-report-'));
        const dbPath = join(dir, 'kk.db');
        const db = fixtureDb([
            { item: 'a', decision: 'kk-item-importance', maker: 'heuristic', value: 4, status: 'published' },
            { item: 'b', decision: 'kk-item-importance', maker: 'heuristic', value: 2, status: 'dropped' },
        ]);
        db.exec(`VACUUM INTO '${dbPath}'`);
        db.close();
        try {
            const json = capture();
            expect(runReportCli(['--db', dbPath, '--window', '100000d', '--json'], json.writers)).toBe(0);
            const parsed = JSON.parse(json.out.join('\n'));
            expect(parsed.dbPath).toBe(dbPath);
            expect(parsed.rows[0].decisionId).toBe('kk-item-importance');
            const table = capture();
            expect(runReportCli(['--db', dbPath, '--window', '100000d'], table.writers)).toBe(0);
            expect(table.out[0]).toContain('# decision signal report');
            expect(table.out.at(-1)).toContain('decision\tmaker\titems');
            expect(() => runReportCli(['--db', dbPath, '--window', 'nonsense'], capture().writers)).toThrow(
                '--window must be',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('parses the window into an epoch-ms bound and rejects a malformed one', () => {
        expect(parseWindow('2d', 10 * 86_400_000)).toBe(8 * 86_400_000);
        expect(() => parseWindow('2')).toThrow();
        expect(() => parseWindow('d2')).toThrow();
    });
});
