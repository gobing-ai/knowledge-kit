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

import { Database } from 'bun:sqlite';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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

/**
 * Run `fn` with the process cwd inside `dir`. `kk daily prepare` writes its anchor to the
 * cwd-relative `.spur/runs/<workflow>/work-dir.txt` and `daily-publish-partial` writes
 * `.spur/run/<marker>.txt`, so a test that asserted them from the repo root wrote — and then
 * DELETED — the real files; on 2026-10-12 that clobbered a live run's anchor mid-session. The
 * corrupt-config test below already chdirs for the same isolation reason.
 */
async function inCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const previous = process.cwd();
    process.chdir(dir);
    try {
        return await fn();
    } finally {
        process.chdir(previous);
    }
}

/**
 * Point every in-process `kk` call at a throwaway store (0242 R6). `kk daily prepare` resolves
 * `store.db_path` through `KK_CONFIG`; with no `--db` flag and no config, the store falls back to
 * the cwd-relative `.works/kk.db`, which is the operator's LIVE store when the suite runs from the
 * repo root. That is exactly how the 10:16:07 migration happened: the probe opened the live store
 * and `openStore` migrated it. Each test now gets its own config and its own store path.
 */
let prevKkConfig: string | undefined;
beforeEach(() => {
    const dir = tempDir('kk-store-isolation-');
    const config = join(dir, 'kk.yaml');
    writeFileSync(config, `store:\n  db_path: ${join(dir, 'kk.db')}\n`);
    prevKkConfig = process.env.KK_CONFIG;
    process.env.KK_CONFIG = config;
});
afterEach(() => {
    if (prevKkConfig === undefined) delete process.env.KK_CONFIG;
    else process.env.KK_CONFIG = prevKkConfig;
    prevKkConfig = undefined;
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
        const result = await inCwd(dir, () =>
            run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']),
        );
        expect(result.code).toBe(0);
        const workDir = join(dir, 'works/kk-daily-ai-voice2/20261007');
        expect(JSON.parse(result.out).workDir).toBe(workDir);
        expect(readFileSync(join(workDir, 'run-date.txt'), 'utf-8')).toBe('20261007\n');
        expect(readFileSync(join(workDir, '.safety-revise-count'), 'utf-8')).toBe('0\n');
        expect(existsSync(join(workDir, '10-ingest/source.json'))).toBe(true);
        // The anchor the DAG's file.read.into-var node reads, cwd-relative to the run.
        const anchor = join(dir, '.spur', 'runs', 'kk-daily-ai-voice2', 'work-dir.txt');
        expect(readFileSync(anchor, 'utf-8')).toBe(`${workDir}\n`);
    });

    it('a digits-only run date re-derives the directory a dashed date named', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        const { dashed, digits } = await inCwd(dir, async () => ({
            dashed: JSON.parse(
                (await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07'])).out,
            ).workDir as string,
            digits: JSON.parse(
                (await run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '20261007'])).out,
            ).workDir as string,
        }));
        expect(digits).toBe(dashed);
    });

    it('warns instead of failing when the ledger sync cannot run', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        // A `spur` that is not there at all: the sync must degrade to a warning, never abort the run.
        process.env.KK_SPUR_BIN = join(dir, 'no-such-spur');
        try {
            const result = await inCwd(dir, () =>
                run([
                    'daily',
                    'prepare',
                    '--workflow',
                    'kk-daily-ai-voice2',
                    '--run-date',
                    '2026-10-07',
                    '--ledger-sync',
                    '--work-dir',
                    join(dir, 'w'),
                ]),
            );
            expect(result.code).toBe(0);
            expect(result.err).toContain('kk.daily.prepare.ledger-sync-failed');
            expect(existsSync(join(dir, 'w/run-date.txt'))).toBe(true);
        } finally {
            delete process.env.KK_SPUR_BIN;
        }
    });

    it('prepare uses default run-date formatRunDate() when omitted', async () => {
        const dir = tempDir();
        process.env.KK_WORKS_DIR = join(dir, 'works');
        const result = await inCwd(dir, () => run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2']));
        expect(result.code).toBe(0);
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

    it('0266 R3 — with no refusal artifact the fallback line stays byte-identical', async () => {
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
        expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toBe(
            'no-content: content QC admitted zero of the pooled items\n',
        );
    });

    it('0266 R3 — names the pre-spend floor refusal: estimate, floor and pool/kept counts', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        const candidates = join(dir, 'candidates.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [] } }));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20261007_04_quality-control-content_floor-refusal.json'),
            JSON.stringify({
                estimatedMinutes: 9.4,
                minMinutes: 15,
                candidateChars: 2400,
                expansion: 1.4,
                charRate: 5.4,
                ids: ['a', 'b', 'c'],
                reason: 'fixture',
            }),
        );
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
        expect(JSON.parse(result.out).noContent).toBe(true);
        const summary = readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8');
        expect(summary).toContain('a 3-item pool estimated 9.4 min of speech');
        expect(summary).toContain('below the 15 min floor');
        expect(summary).toContain('pre-spend refusal (pool 3, kept 3)');
    });

    it('0266 R2/R3 — names the post-spend duration refusal, which wins over the floor artifact', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        const candidates = join(dir, 'candidates.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [] } }));
        mkdirSync(join(dir, '21-plan'), { recursive: true });
        writeFileSync(
            join(dir, '21-plan', '20261007_04_quality-control-content_floor-refusal.json'),
            JSON.stringify({
                estimatedMinutes: 16.1,
                minMinutes: 15,
                candidateChars: 4000,
                expansion: 1.4,
                charRate: 5.4,
                ids: ['a', 'b', 'c', 'd'],
                reason: 'fixture',
            }),
        );
        mkdirSync(join(dir, '30-audio'), { recursive: true });
        writeFileSync(
            join(dir, '30-audio', '20261007_11_generate_content_duration-refusal.json'),
            JSON.stringify({
                measuredMinutes: 12.3,
                estimatedMinutes: 16.1,
                minMinutes: 15,
                keptCount: 9,
                candidateChars: 4000,
                reason: 'fixture',
            }),
        );
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
        expect(JSON.parse(result.out).noContent).toBe(true);
        const summary = readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8');
        expect(summary).toContain('the episode ran 12.3 min (pre-spend estimate 16.1 min)');
        expect(summary).toContain('below the 15 min floor');
        expect(summary).toContain('duration refusal after synthesis (pool 4, kept 9)');
        expect(summary).not.toContain('pre-spend refusal');
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

    it('treats a result file without a targets array as unpublished', async () => {
        const dir = tempDir();
        const publish = publishFixtures(
            dir,
            { targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] },
            null,
        );
        // Malformed podcast result: JSON but no `targets` — the channel is unknown, never crash.
        writeFileSync(join(publish, '20261007_16_publish-podcast_result.json'), JSON.stringify({ ok: true }));
        const result = await run(['daily', 'publish-classify', '--work-dir', dir, '--run-date', '20261007']);
        expect(result.code).toBe(0);
        // The channel folds on `ok`, not on the targets detail — an ok:true result publishes.
        expect(JSON.parse(result.out).status).toBe('full');
    });

    it('folds the tail: a partial outcome records its marker, and an absent checkout skips the patch', async () => {
        const dir = tempDir();
        publishFixtures(
            dir,
            { targets: [{ target: 'surfdash-pub', ok: true, status: 'published' }] },
            { targets: [{ target: 'podcast-pub', ok: false, status: 'failed' }] },
        );
        const result = await inCwd(dir, () =>
            run([
                'daily',
                'publish-classify',
                '--work-dir',
                dir,
                '--run-date',
                '20261007',
                '--fold-tail',
                '--surfdash-root',
                join(dir, 'no-checkout'),
            ]),
        );
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).status).toBe('partial');
        const markerPath = join(dir, '.spur/run/publish-partial-20261007.txt');
        expect(existsSync(markerPath)).toBe(true);
        const marker = readFileSync(markerPath, 'utf-8');
        expect(marker).toContain('podcast-pub');
        // The patch stage is plugin-owned and stays where it is: the fold only sequences it.
        expect(existsSync(join(REPO, 'plugins/kk/scripts/kk-workflow-stages.ts'))).toBe(true);
    });
});

describe('kk daily works-dir resolution and report edges', () => {
    it('resolves works_dir from KK_CONFIG, expanding ~ and $HOME prefixes', async () => {
        // Bun's homedir() reads the passwd entry and ignores $HOME, so expansion lands in the real
        // home — assert against homedir() and clean up the composed dirs.
        const dir = tempDir();
        const prevConfig = process.env.KK_CONFIG;
        const prevWorks = process.env.KK_WORKS_DIR;
        delete process.env.KK_WORKS_DIR;
        const config = join(dir, 'kk.yaml');
        writeFileSync(config, `works_dir: ~/works-from-config\nstore:\n  db_path: ${join(dir, 'kk.db')}\n`);
        process.env.KK_CONFIG = config;
        try {
            const tilde = await inCwd(dir, () =>
                run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']),
            );
            expect(tilde.code).toBe(0);
            expect(JSON.parse(tilde.out).workDir).toBe(
                join(homedir(), 'works-from-config/kk-daily-ai-voice2/20261007'),
            );
            writeFileSync(config, `works_dir: $HOME/works-home-prefix\nstore:\n  db_path: ${join(dir, 'kk.db')}\n`);
            const dollar = await inCwd(dir, () =>
                run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']),
            );
            expect(dollar.code).toBe(0);
            expect(JSON.parse(dollar.out).workDir).toBe(
                join(homedir(), 'works-home-prefix/kk-daily-ai-voice2/20261007'),
            );
        } finally {
            rmSync(join(homedir(), 'works-from-config'), { recursive: true, force: true });
            rmSync(join(homedir(), 'works-home-prefix'), { recursive: true, force: true });
            if (prevConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = prevConfig;
            if (prevWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = prevWorks;
        }
    });

    it('falls through to the compiled default works dir when the config is corrupt', async () => {
        const dir = tempDir();
        const prevConfig = process.env.KK_CONFIG;
        const prevWorks = process.env.KK_WORKS_DIR;
        const prevCwd = process.cwd();
        delete process.env.KK_WORKS_DIR;
        const config = join(dir, 'kk.yaml');
        writeFileSync(config, `works_dir: {unclosed\nstore:\n  db_path: ${join(dir, 'kk.db')}\n`);
        process.env.KK_CONFIG = config;
        // A CORRUPT config is the one case isolation cannot redirect: `store.db_path` is unreadable,
        // so the store resolver falls back to the cwd-relative default. Move the cwd into the temp
        // dir so that fallback lands on a throwaway store instead of the repo's live `.works/kk.db`
        // (0242 R6). `migrate: false` already keeps that probe read-only; this keeps it off the
        // operator's store entirely.
        process.chdir(dir);
        try {
            const result = await run([
                'daily',
                'prepare',
                '--workflow',
                'kk-daily-ai-voice2',
                '--run-date',
                '2026-10-07',
            ]);
            expect(result.code).toBe(0);
            expect(JSON.parse(result.out).workDir).toBe(
                join(homedir(), '.config/kk/works/kk-daily-ai-voice2/20261007'),
            );
        } finally {
            process.chdir(prevCwd);
            rmSync(join(homedir(), '.config/kk/works/kk-daily-ai-voice2/20261007'), { recursive: true, force: true });
            if (prevConfig === undefined) delete process.env.KK_CONFIG;
            else process.env.KK_CONFIG = prevConfig;
            if (prevWorks === undefined) delete process.env.KK_WORKS_DIR;
            else process.env.KK_WORKS_DIR = prevWorks;
        }
    });

    it('records no-content when the pool has items but no candidates file was ever written', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }]));
        const result = await run(['daily', 'run-report', '--work-dir', dir, '--run-date', '20261007', '--pool', pool]);
        expect(result.code).toBe(0);
        expect(JSON.parse(result.out).noContent).toBe(true);
        expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain('no candidates.json');
    });

    it('serves a cached report when the body already exists', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        const candidates = join(dir, 'candidates.json');
        writeFileSync(pool, JSON.stringify([{ id: 'a' }]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [{ id: 'a' }] } }));
        writeFileSync(join(dir, '20261007_19_run-report_report.md'), '# cached body\n');
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
        expect(JSON.parse(result.out).cached).toBe(true);
    });

    /**
     * The empty-pool branch and the content branch both write `reportMd`, so the file's existence
     * cannot authorise a cache hit. A same-day retry after an empty-pool attempt must regenerate:
     * otherwise the published run's report (and the ledger's Result cell) claims "no content"
     * (2026-10-12).
     */
    it('does not serve the empty-pool report as the cache hit of a run that has a pool', async () => {
        const dir = tempDir();
        const pool = join(dir, 'pool.json');
        const candidates = join(dir, 'candidates.json');
        const pooledDoc = { id: 'a', title: 'a', body: 'a body', metadata: { source: 'fixture' } };
        writeFileSync(pool, JSON.stringify([pooledDoc]));
        writeFileSync(candidates, JSON.stringify({ metadata: { docs: [pooledDoc] } }));
        // What an earlier attempt on the same work_dir left behind: the no-content pair.
        writeFileSync(join(dir, '20261007_19_run-report_report.md'), '# Daily run 20261007 — no content\n\nstale\n');
        writeFileSync(join(dir, 'run-report.summary.txt'), 'no-content: the store pool was empty\n');
        const plugins = tempDir();
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
                'await Bun.write(out, JSON.stringify({ body: "regenerated body" }));',
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
            ]);
            expect(result.code).toBe(0);
            expect(JSON.parse(result.out).cached).toBeUndefined();
            expect(readFileSync(join(dir, '20261007_19_run-report_report.md'), 'utf-8')).toBe('regenerated body');
            expect(readFileSync(join(dir, 'run-report.summary.txt'), 'utf-8')).toContain('1 items planned');
        } finally {
            delete process.env.KK_PLUGIN_PATH;
        }
    });
});

describe('kk daily prepare never migrates the store it only reads (0242 R6/AC6)', () => {
    function behindStore(dbPath: string): void {
        const db = new Database(dbPath);
        try {
            db.run('CREATE TABLE __kk_store_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
            db.run("INSERT INTO __kk_store_migrations (id, applied_at) VALUES ('0001_kk_store_init', 1)");
        } finally {
            db.close();
        }
    }

    function journal(dbPath: string): string[] {
        const db = new Database(dbPath, { readonly: true });
        try {
            return (db.query('SELECT id FROM __kk_store_migrations ORDER BY id').all() as Array<{ id: string }>).map(
                (row) => row.id,
            );
        } finally {
            db.close();
        }
    }

    it('leaves a behind store’s journal untouched end to end, and still exits 0', async () => {
        const dir = tempDir('kk-behind-store-');
        const dbPath = join(dir, 'kk.db');
        // A journal that is BEHIND this binary, in SQLite's own terms: a real `0001_kk_store_init`
        // and no `0003_store_v2`. The load-bearing control for `migrate: false` — the same journal
        // advancing under a DEFAULT open — is in `packages/kk-store/tests/migrations.test.ts`
        // ('openStore({ migrate: false }) reads a behind store without upgrading it'), which has the
        // real v1 fixture; this test pins the USER-FACING path (`kk daily prepare`) to that rule.
        behindStore(dbPath);
        const before = journal(dbPath);
        expect(before).toEqual(['0001_kk_store_init']);

        const config = join(dir, 'kk.yaml');
        writeFileSync(config, `works_dir: ${dir}\nstore:\n  db_path: ${dbPath}\n`);
        process.env.KK_CONFIG = config;

        const result = await inCwd(dir, () =>
            run(['daily', 'prepare', '--workflow', 'kk-daily-ai-voice2', '--run-date', '2026-10-07']),
        );
        // The probe is best-effort: the behind store's missing `selections` table is swallowed, so
        // `prepare` still succeeds — but it must NOT have upgraded the store to make itself work.
        expect(result.code).toBe(0);
        expect(journal(dbPath)).toEqual(before);
    });
});
