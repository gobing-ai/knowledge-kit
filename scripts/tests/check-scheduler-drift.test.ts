/**
 * Task 0382 — failure-first contract for the scheduler drift report.
 *
 * Failures enumerated before the implementation:
 *  1. A stale in-memory schedule (the 2026-11-15 incident) reads as healthy because only the
 *     configured side is inspected.
 *  2. A job whose command names a deleted entry point reads as healthy.
 *  3. An unreadable db is reported as "no drift" instead of unknown.
 *  4. The newest tick per job is not the one compared (payload order inverted).
 *  5. A job that never fired is confused with drift.
 *  6. Silence on stdout / exit 0 when something needs attention.
 */

import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../check-scheduler-drift';

const SCRIPT = join(import.meta.dir, '..', 'check-scheduler-drift.ts');
let root = '';

interface Job {
    name: string;
    command: string;
}

/** Write `.spur/config.yaml` + a spur db holding the given issued payloads, newest last. */
function scenario(jobs: Job[], issued: Job[]): { config: string; db: string } {
    const spur = join(root, '.spur');
    mkdirSync(spur, { recursive: true });
    const config = join(spur, 'config.yaml');
    const yaml = [
        'bootstrap:',
        '  scheduler:',
        '    jobs:',
        ...jobs.flatMap((job) => [
            `      - name: ${job.name}`,
            '        cron: "0 4 * * *"',
            `        command: ${job.command}`,
        ]),
    ].join('\n');
    writeFileSync(config, `${yaml}\n`);
    const db = join(spur, 'drift.db');
    rmSync(db, { force: true });
    const database = new Database(db, { create: true });
    database.run('CREATE TABLE queue_jobs (id TEXT, type TEXT, payload TEXT, created_at INTEGER)');
    issued.forEach((job, index) => {
        database.run('INSERT INTO queue_jobs VALUES (?, ?, ?, ?)', [
            `job-${index}`,
            'scheduler.custom',
            JSON.stringify({ name: job.name, command: job.command }),
            index + 1,
        ]);
    });
    database.close();
    return { config, db };
}

function run(config: string, db: string): { code: number; stdout: string } {
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--config', config, '--db', db, '--json'], {
        cwd: root,
        encoding: 'utf8',
    });
    return { code: result.status ?? 1, stdout: result.stdout ?? '' };
}

beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'sched-drift-'));
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('check-scheduler-drift (0382)', () => {
    it('reports a stale in-memory schedule as drift, not as healthy', () => {
        const { config, db } = scenario(
            [{ name: 'kk-daily-ai-voice', command: 'kk news generate --publish' }],
            [{ name: 'kk-daily-ai-voice', command: 'bun scripts/daily-ai-news.ts generate --full' }],
        );
        const { code, stdout } = run(config, db);
        expect(code).toBe(1);
        const report = JSON.parse(stdout) as { rows: Array<{ verdict: string; issued: string | null }> };
        expect(report.rows[0]?.verdict).toBe('drift');
        expect(report.rows[0]?.issued).toContain('daily-ai-news');
    });

    it('passes when the last tick issued exactly the configured command', () => {
        const { config, db } = scenario(
            [{ name: 'kk-daily-publish3', command: 'kk news publish --window overseas-rss --unattended' }],
            [{ name: 'kk-daily-publish3', command: 'kk news publish --window overseas-rss --unattended' }],
        );
        expect(run(config, db).code).toBe(0);
    });

    it('compares the newest tick, not the first one recorded', () => {
        const { config, db } = scenario(
            [{ name: 'kk-collect', command: 'spur workflow run plugins/kk/workflows/kk-collect.yaml' }],
            [
                { name: 'kk-collect', command: 'bun scripts/old-collect.ts' },
                { name: 'kk-collect', command: 'spur workflow run plugins/kk/workflows/kk-collect.yaml' },
            ],
        );
        expect(run(config, db).code).toBe(0);
    });

    it('fails a command whose entry script is not in the tree', () => {
        const { config, db } = scenario(
            [{ name: 'kk-legacy', command: 'bun scripts/deleted-thing.ts --go' }],
            [{ name: 'kk-legacy', command: 'bun scripts/deleted-thing.ts --go' }],
        );
        const { code, stdout } = run(config, db);
        expect(code).toBe(1);
        expect(JSON.parse(stdout).rows[0].verdict).toBe('missing-entry');
    });

    it('keeps "never fired" distinct from drift and does not fail it', () => {
        const { config, db } = scenario([{ name: 'kk-new-job', command: 'kk news generate' }], []);
        const { code, stdout } = run(config, db);
        expect(code).toBe(0);
        expect(JSON.parse(stdout).rows[0].verdict).toBe('never-issued');
    });

    it('reports an unreadable db as unreadable and fails instead of claiming health', () => {
        const { config } = scenario([{ name: 'kk-daily-ai-voice', command: 'kk news generate' }], []);
        const { code, stdout } = run(config, join(root, '.spur', 'absent.db'));
        expect(code).toBe(1);
        expect(JSON.parse(stdout).rows[0].verdict).toBe('unreadable');
    });
});

describe('check-scheduler-drift main (0382 R3)', () => {
    it('returns 1 on drift and 0 when in sync, and prints one line per job', () => {
        const drift = scenario(
            [{ name: 'kk-daily-ai-voice', command: 'kk news generate' }],
            [{ name: 'kk-daily-ai-voice', command: 'bun scripts/daily-ai-news.ts generate' }],
        );
        expect(main(['--root', root, '--config', drift.config, '--db', drift.db])).toBe(1);

        const aligned = scenario(
            [{ name: 'kk-daily-ai-voice', command: 'kk news generate' }],
            [{ name: 'kk-daily-ai-voice', command: 'kk news generate' }],
        );
        expect(main(['--root', root, '--config', aligned.config, '--db', aligned.db])).toBe(0);
    });

    it('covers every verdict branch in-process (missing-entry, never-issued, unreadable, json)', () => {
        const missing = scenario(
            [{ name: 'kk-legacy', command: 'bun scripts/deleted-thing.ts' }],
            [{ name: 'kk-legacy', command: 'bun scripts/deleted-thing.ts' }],
        );
        expect(main(['--root', root, '--config', missing.config, '--db', missing.db, '--json'])).toBe(1);

        const never = scenario([{ name: 'kk-fresh', command: 'kk news generate' }], []);
        expect(main(['--root', root, '--config', never.config, '--db', never.db])).toBe(0);

        const unreadable = scenario([{ name: 'kk-fresh', command: 'kk news generate' }], []);
        expect(main(['--root', root, '--config', unreadable.config, '--db', join(root, '.spur', 'gone.db')])).toBe(1);
    });

    it('reads the real config shape (bootstrap.scheduler.jobs) and ignores malformed entries', () => {
        const spur = join(root, '.spur');
        mkdirSync(spur, { recursive: true });
        const config = join(spur, 'shape.yaml');
        writeFileSync(
            config,
            [
                'bootstrap:',
                '  scheduler:',
                '    jobs:',
                '      - name: ok-job',
                '        cron: "0 1 * * *"',
                '        command: spur self maintain',
                '      - cron: "0 2 * * *"',
            ].join('\n'),
        );
        const { stdout } = run(config, join(root, '.spur', 'shape.db'));
        const report = JSON.parse(stdout) as { rows: Array<{ name: string }> };
        expect(report.rows.map((row) => row.name)).toEqual(['ok-job']);
    });
});
