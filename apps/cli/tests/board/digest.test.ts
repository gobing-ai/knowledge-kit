/**
 * G83/0439 — `kk news digest` (feature R4, AC2) and the digest renderers.
 *
 * Failure list written before the code:
 * 1. markdown and `--json` report the SAME digest (same status, attention count and window results);
 * 2. a day with no directory exits 1 and names the path it looked up, in both output modes;
 * 3. a malformed `--run-date` exits 2 before any read;
 * 4. a missing `--run-date` exits 2;
 * 5. `--days` lists the recorded range newest-first and refuses a malformed range;
 * 6. an unknown figure renders as `unknown` with its reason — never as `0`, never as `ok`;
 * 7. an empty attention list renders an explicit all-clear;
 * 8. a recipe renders as a copyable command line, and a dry-run variant is shown beside it.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DailyDigest, DaySummary } from '@gobing-ai/kk-board/contracts';
import { renderDaysMarkdown, renderDigestMarkdown } from '../../src/board/digest';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const created: string[] = [];

/** Run the CLI and capture both streams. */
async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: capture.read(), stderr: capture.readErr() };
    } finally {
        capture.restore();
    }
}

function withProject<T>(fn: () => Promise<T>): Promise<T> {
    const beforeConfig = process.env.KK_CONFIG;
    const beforeWorks = process.env.KK_WORKS_DIR;
    const beforeCwd = process.cwd();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'kk-digest-env-')));
    created.push(root);
    const works = join(root, 'works');
    process.env.KK_CONFIG = join(root, 'config.yaml');
    process.env.KK_WORKS_DIR = works;
    writeFileSync(join(root, 'config.yaml'), `works_dir: ${works}\n`);
    const restore = () => {
        if (beforeConfig === undefined) delete process.env.KK_CONFIG;
        else process.env.KK_CONFIG = beforeConfig;
        if (beforeWorks === undefined) delete process.env.KK_WORKS_DIR;
        else process.env.KK_WORKS_DIR = beforeWorks;
        process.chdir(beforeCwd);
    };
    return fn().finally(restore);
}

function seedDay(works: string, day: string, options: { receipt?: string; window?: string } = {}): string {
    const dir = join(works, 'kk-news-generate', day);
    mkdirSync(join(dir, '4-publish'), { recursive: true });
    if (options.receipt !== undefined) {
        writeFileSync(
            join(dir, 'schedule-receipt.json'),
            JSON.stringify({ schemaVersion: 1, runId: `kk-news-generate-${day}-1`, status: options.receipt }),
        );
    }
    if (options.window !== undefined) {
        writeFileSync(
            join(dir, '4-publish', `schedule-receipt.${options.window}.json`),
            JSON.stringify({
                schemaVersion: 1,
                window: options.window,
                runId: `kk-publish-${day}-1`,
                status: 'done',
            }),
        );
    }
    return dir;
}

afterEach(() => {
    for (const root of created.splice(0)) {
        // The temp trees are small and the OS reaps them; deleting keeps a long suite tidy.
        Bun.spawnSync(['rm', '-rf', root]);
    }
});

describe('kk news digest (AC2, R4)', () => {
    it('renders markdown and --json from the same digest', async () => {
        await withProject(async () => {
            const works = process.env.KK_WORKS_DIR as string;
            seedDay(works, '29991215', { receipt: 'done', window: 'after-generate' });

            const text = await runCli(['news', 'digest', '--run-date', '29991215']);
            expect(text.code).toBe(0);
            expect(text.stdout).toContain('# Daily AI Voice — 29991215');
            expect(text.stdout).toContain('Status: **ok**');
            expect(text.stdout).toContain('all clear — nothing needs the operator');

            const json = await runCli(['news', 'digest', '--run-date', '29991215', '--json']);
            expect(json.code).toBe(0);
            const digest = JSON.parse(json.stdout.trim()) as DailyDigest;
            expect(digest.day).toBe('29991215');
            expect(digest.status).toBe('ok');
            expect(digest.generation.launchStatus).toBe('done');
            expect(digest.windows.find((window) => window.window === 'after-generate')?.launchStatus).toBe('done');
            expect(text.stdout).toContain(`attention: ${digest.attention.length}`);
        });
    });

    it('exits 1 naming the looked-up path when the day does not exist', async () => {
        await withProject(async () => {
            const works = process.env.KK_WORKS_DIR as string;
            const result = await runCli(['news', 'digest', '--run-date', '29990101']);
            expect(result.code).toBe(1);
            expect(result.stderr).toContain(join(works, 'kk-news-generate', '29990101'));
            const json = await runCli(['news', 'digest', '--run-date', '29990101', '--json']);
            expect(json.code).toBe(1);
            expect(JSON.parse(json.stdout.trim())).toMatchObject({ notFound: true });
        });
    });

    it('exits 2 on a malformed or missing --run-date', async () => {
        await withProject(async () => {
            expect((await runCli(['news', 'digest', '--run-date', '2026-11-25'])).code).toBe(2);
            expect((await runCli(['news', 'digest'])).code).toBe(2);
        });
    });

    it('lists the recorded days newest-first with --days, and refuses a malformed range', async () => {
        await withProject(async () => {
            const works = process.env.KK_WORKS_DIR as string;
            seedDay(works, '29991214', { receipt: 'done' });
            seedDay(works, '29991215', { receipt: 'done' });
            const listed = await runCli(['news', 'digest', '--days', '--from', '29991201', '--until', '29991231']);
            expect(listed.code).toBe(0);
            expect(listed.stdout.split('\n')[2]).toContain('29991215');
            const json = await runCli([
                'news',
                'digest',
                '--days',
                '--from',
                '29991201',
                '--until',
                '29991231',
                '--json',
            ]);
            expect((JSON.parse(json.stdout.trim()) as DaySummary[]).map((day) => day.day)).toEqual([
                '29991215',
                '29991214',
            ]);
            expect((await runCli(['news', 'digest', '--days', '--from', 'nope', '--until', 'x'])).code).toBe(2);
        });
    });
});

describe('renderDigestMarkdown (AC3/AC4)', () => {
    const digest: DailyDigest = {
        schemaVersion: 1,
        day: '29991213',
        status: 'attention',
        generation: {
            runId: null,
            launchStatus: null,
            exitCode: null,
            startedAt: null,
            finishedAt: null,
            outcome: null,
            attempts: [
                { runId: 'run-1', capturedAt: '2026-11-13T00:00:00Z', status: null },
                { runId: 'run-2', capturedAt: '2026-11-13T01:00:00Z', status: null },
            ],
            bundle: null,
            durations: [{ step: 'voice', startedAt: 'a', endedAt: 'b', durationMs: null }],
            unknownReason: 'no-launch-receipt',
        },
        windows: [
            {
                window: 'after-generate',
                runId: null,
                launchStatus: 'unknown',
                unknownReason: 'no-launch-receipt',
                recordedStatus: null,
                provenance: { dateMatch: null, bundleMatch: null, parentMatch: null, digestMatch: null },
                targets: [
                    {
                        id: 'shipinhao-pub.audio',
                        tier: 0,
                        mode: 'live',
                        target: 'shipinhao-pub',
                        status: 'failed',
                        effect: 'none',
                        url: null,
                        guid: null,
                        finishedAt: null,
                        error: 'upload rejected',
                        evidence: { plan: '4-publish/plan.after-generate.json', receipt: null },
                    },
                ],
            },
        ],
        safety: { verdict: null, judge: null, unknownReason: 'no-safety-decision' },
        actions: { enabled: false, lines: [] },
        attention: [
            {
                severity: 'error',
                kind: 'target-failed',
                subject: 'after-generate',
                message: '1 target(s) failed in after-generate.',
                evidence: '4-publish/plan.after-generate.json',
                recipes: [
                    {
                        kind: 'publish-retry',
                        label: 'retry',
                        params: { day: '29991213', window: 'after-generate' },
                        argv: ['kk', 'news', 'publish', '--retry'],
                        dryRunArgv: ['kk', 'news', 'publish', '--retry', '--dry-run'],
                        live: true,
                    },
                ],
            },
            {
                severity: 'warn',
                kind: 'generation-refused',
                subject: 'generation',
                message: 'no content today',
                evidence: null,
                recipes: [],
            },
        ],
        sources: {},
        diagnostics: [{ code: 'board.day.receipt-invalid', message: 'the receipt is malformed' }],
    };

    it('renders unknowns with their reason and never as a zero', () => {
        const markdown = renderDigestMarkdown(digest);
        expect(markdown).toContain('unknown (no-launch-receipt)');
        expect(markdown).toContain('outcome unknown');
        expect(markdown).toContain('shipinhao-pub.audio: failed effect none — upload rejected');
        expect(markdown).toContain('attempts: run-1, run-2');
        expect(markdown).toContain('unknown (no-safety-decision)');
    });

    it('renders recipes as copyable commands with their dry-run variant', () => {
        const markdown = renderDigestMarkdown(digest);
        expect(markdown).toContain('`kk news publish --retry`');
        expect(markdown).toContain('dry run: `kk news publish --retry --dry-run`');
        expect(markdown).toContain('no recipe — the evidence above names what is missing');
        expect(markdown).toContain('`board.day.receipt-invalid`');
    });

    it('prints an explicit all-clear when nothing needs the operator', () => {
        const quiet = renderDigestMarkdown({ ...digest, attention: [], status: 'ok' });
        expect(quiet).toContain('all clear — nothing needs the operator');
    });

    it('renders the day list, and says so when the range is empty', () => {
        const days: DaySummary[] = [
            {
                day: '29991215',
                status: 'ok',
                runId: 'run-1',
                windows: [{ window: 'after-generate', launchStatus: 'done' }],
                durations: [],
            },
            { day: '29991214', status: 'unknown', runId: null, windows: [], durations: [] },
        ];
        const markdown = renderDaysMarkdown(days);
        expect(markdown).toContain('| 29991215 | ok | run-1 | after-generate: done |');
        expect(markdown).toContain('| 29991214 | unknown | unknown | none |');
        expect(renderDaysMarkdown([])).toContain('No recorded day in the selected range.');
    });
});
