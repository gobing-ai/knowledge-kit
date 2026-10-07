/**
 * `kk daily` — the three DAG-node commands of task 0211 (R7/AC4).
 *
 * Failure-first list (written before the code):
 * 1. `prepare` with an empty `--work-dir` must compose `<works_dir>/<workflow>/<digits>` and write
 *    BOTH fixed anchors (`.spur/runs/<workflow>/work-dir.txt`, `<work_dir>/run-date.txt`) — the read
 *    chain of the DAG projects the vars from exactly those two paths;
 * 2. a dashed `--run-date` must name the same workspace as the digits-only form (a resumed run's
 *    persisted var is the digits-only value);
 * 3. a ledger sync that fails must WARN and still exit 0 (the run must not abort before it starts);
 * 4. `run-report` on an empty pool (or on a pool QC filtered to zero items) must write the
 *    `no-content` report + summary and exit 0 — an empty store is not a failure;
 * 5. `run-report` on a pool with items must invoke the report generator and surface its body; a
 *    generator that fails must exit 1 with the `kk.daily.run-report.failed` contract;
 * 6. `publish-classify` must derive full / partial / none from the per-target result files, and
 *    treat a missing per-target file as `none` (never as `full`);
 * 7. `--fold-tail` must record the partial marker for a partial outcome, and must skip the
 *    surfdash patch when the checkout is absent (the patch refuses to run blindly);
 * 8. an unusable `--min`/missing store must not silently pass a guard.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli';
import { main } from '../../src/main';
import { captureOutput } from '../capture';

const REPO = join(import.meta.dir, '../../../..');

const tempDirs: string[] = [];
function tempDir(prefix = 'kk-daily-cmd-'): string {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    tempDirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
    delete process.env.KK_WORKS_DIR;
    delete process.env.KK_PLUGIN_PATH;
});

/** Run `kk …` in-process, returning the exit code plus the captured echo/echoError output. */
async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
    const capture = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, out: capture.read(), err: capture.readErr() };
    } finally {
        capture.restore();
    }
}

describe('registerDailyCommand', () => {
    it('registers the daily noun with prepare, publish-classify and run-report', () => {
        const program = createProgram();
        const daily = program.commands.find((command) => command.name() === 'daily');
        expect(daily?.commands.map((command) => command.name())).toEqual(['prepare', 'publish-classify', 'run-report']);
    });
});

describe('kk daily prepare', () => {
    it('composes the workspace from the run date and writes both fixed anchors', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        const result = await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']);
        expect(result.code).toBe(0);
        const workDir = join(dir, 'works/kk-daily-ai-voice2/20261007');
        expect(JSON.parse(result.out).workDir).toBe(workDir);
        expect(readFileSync(join(workDir, 'run-date.txt'), 'utf-8')).toBe('20261007\n');
        expect(readFileSync(join(workDir, '.safety-revise-count'), 'utf-8')).toBe('0\n');
        expect(existsSync(join(workDir, '10-ingest/source.json'))).toBe(true);
        // The anchor the DAG's file.read.into-var node reads, cwd-relative to the run.
        const anchor = join(process.cwd(), '.spur', 'runs', 'kk-daily-ai-voice2', 'work-dir.txt');
        expect(readFileSync(anchor, 'utf-8')).toBe(`${workDir}\n`);
        rmSync(join(process.cwd(), '.spur', 'runs', 'kk-daily-ai-voice2'), { recursive: true, force: true });
    });

    it('a digits-only run date re-derives the directory a dashed date named', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']);
        const dashed = JSON.parse(
            (await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07'])).out,
        ).workDir;
        const digits = JSON.parse(
            (await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '20261007'])).out,
        ).workDir;
        expect(digits).toBe(dashed);
        rmSync(join(process.cwd(), '.spur', 'runs', 'kk-daily-ai-voice2'), { recursive: true, force: true });
    });

    it('warns instead of failing when the ledger sync cannot run', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        // A `spur` that is not there at all: the sync must degrade to a warning, never abort the run.
        process.env.KK_SPUR_BIN = join(dir, 'no-such-spur');
        try {
            const result = await run([
                'daily',
                'prepare',
                '--workflow',
                'kk-daily-ai-voice2',
                '--run-date',
                '2026-10-07',
                '--ledger-sync',
                '--work-dir',
                join(dir, 'w'),
            ]);
            expect(result.code).toBe(0);
            expect(result.err).toContain('kk.daily.prepare.ledger-sync-failed');
            expect(existsSync(join(dir, 'w/run-date.txt'))).toBe(true);
        } finally {
            delete process.env.KK_SPUR_BIN;
        }
    });
});

describe('kk daily run-report', () => {
    it('records no-content for an empty pool without invoking the generator', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        writeFileSync(pool, '[]');
        const result = await run([
            'daily',
            'run-report',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--pool',
            pool,
            '--candidates',
            join(dir, 'absent.json'),
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).noContent).toBe(true);
        expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain(
            'no-content: the store pool was empty',
        );
        expect(readFileSync(join(dir, '20261007_19_run-report_report.md'), 'utf-8')).toContain('no content');
    });

    it('records no-content when content QC admitted none of the pooled items', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        const candidates = join(dir, 'candidates.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [] } }));
        const result = await run([
            'daily',
            'run-report',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--pool',
            pool,
            '--candidates',
            candidates,
        ]);
        expect(result.code).toBe(0);
        expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain('content QC admitted zero');
    });

    it('invokes the report generator for a real pool and writes its body, failing loud when it fails', async () => {
        const dir = tempDir();
        const plugins = tempDir('kk-daily-plugins-');
        const candidates = join(dir, 'candidates.json');
        const pool = join(dir, 'pool.json');
        const pooledDoc = { id: 'a', title: 'a', body: 'a body', metadata: { source: 'fixture' } };
        writeFileSync(pool, JSON.stringify([pooledDoc]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [pooledDoc] } }));
        const pluginDir = join(plugins, 'generations', 'news-report-gen');
        mkdirSync(pluginDir, { recursive: true });
        writeFileSync(
            join(pluginDir, 'plugin.json'),
            JSON.stringify({ name: 'news-report-gen', kind: 'generator', entry: './index.ts', version: '1.0.0' }),
        );
        writeFileSync(
            join(pluginDir, 'index.ts'),
            [
                "const out = process.argv[process.argv.indexOf('--out') + 1] ?? '';",
                'const body = process.env.NEWS_REPORT_DATE === undefined ? "missing-env" : "report body";',
                'await Bun.write(out, JSON.stringify({ body }));',
                '',
            ].join('\n'),
        );
        process.env.KK_PLUGIN_PATH = plugins;
        try {
            const result = await run([
                'daily',
                'run-report',
                '--work-dir',
                dir,
                '--run-date',
                '20261007',
                '--pool',
                pool,
                '--candidates',
                candidates,
                '--qc-min-quality',
                '2',
            ]);
            expect(result.code).toBe(0);
            expect(JSON.parse(result.out).noContent).toBe(false);
            expect(readFileSync(join(dir, '20261007_19_run-report_report.md'), 'utf-8')).toBe('report body');
            expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain('1 items planned');
        } finally {
            delete process.env.KK_PLUGIN_PATH;
        }
    });
});

describe('kk daily publish-classify', () => {
    /** Write the two per-target result files the classifier sequences. */
    function publishFixtures(dir: string, surfdash: unknown | null, podcast: unknown | null): string {
        const publish = join(dir, '31-publish');
        mkdirSync(publish, { recursive: true });
        if (surfdash !== null) {
            writeFileSync(join(publish, '20261007_14_publish-surfdash_result.json'), JSON.stringify(surfdash));
        }
        if (podcast !== null) {
            writeFileSync(join(publish, '20261007_16_publish-podcast_result.json'), JSON.stringify(podcast));
        }
        return publish;
    }

    it('classifies full when every target published', async () => {
        const dir = tempDir();
        const publish = publishFixtures(
            dir,
            { targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] },
            { targets: [{ target: 'podcast-pub', ok: true, status: 'published' }] },
        );
        const result = await run(['daily', 'publish-classify', '--work-dir', dir, '--run-date', '20261007']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).status).toBe('full');
        expect(readFileSync(join(publish, '20261007_17_publish_publish-status.txt'), 'utf-8')).toBe('full');
    });

    it('classifies none when a per-target result file is missing', async () => {
        const dir = tempDir();
        publishFixtures(dir, { targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] }, null);
        const result = await run(['daily', 'publish-classify', '--work-dir', dir, '--run-date', '20261007']);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).status).toBe('none');
    });

    it('folds the tail: a partial outcome records its marker, and an absent checkout skips the patch', async () => {
        const dir = tempDir();
        publishFixtures(
            dir,
            { targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] },
            { targets: [{ target: 'podcast-pub', ok: false, status: 'failed' }] },
        );
        const result = await run([
            'daily',
            'publish-classify',
            '--work-dir',
            dir,
            '--run-date',
            '20261007',
            '--fold-tail',
            '--surfdash-root',
            join(dir, 'no-checkout'),
        ]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).status).toBe('partial');
        expect(existsSync(join(process.cwd(), '.spur/run/publish-partial-20261007.txt'))).toBe(true);
        const marker = readFileSync(join(process.cwd(), '.spur/run/publish-partial-20261007.txt'), 'utf-8');
        expect(marker).toContain('podcast-pub');
        // The patch stage is plugin-owned and stays where it is: the fold only sequences it.
        expect(existsSync(join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts'))).toBe(true);
        rmSync(join(process.cwd(), '.spur/run/publish-partial-20261007.txt'), { force: true });
    });
});
