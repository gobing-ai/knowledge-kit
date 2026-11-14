/**
 * Task 0366 AC1–AC3 — `kk-publish` end to end, and against the workflow it replaces.
 *
 * Everything is throwaway and offline: a temp project root outside the repository, a `plugins/kk`
 * symlink so the launcher's preflight resolves the checkout without reading this repo's git state,
 * a local publish preset, a `kk` shim that forwards every node command to the real CLI (so the
 * verbs under test are the shipped ones), a `spur` wrapper that answers only the executor probe, and
 * a `data:` URL as the podcast feed, so the RSS gate never touches the network.
 *
 * AC1 runs both content nouns through the launcher (`kk news publish` / `kk article publish`), which
 * is the public surface of R4. AC3 runs both workflows directly (`spur workflow run`), because the
 * comparison is between two YAML graphs, not between two launchers.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { main } from '../src/main';
import { captureOutput } from './capture';

const REPO = resolve(import.meta.dir, '../../..');
const CLI = join(REPO, 'apps/cli/src/index.ts');
const PUBLISH3 = join(REPO, 'plugins/kk/workflows/kk-daily-publish3.yaml');
const PUBLISH = join(REPO, 'plugins/kk/workflows/kk-publish.yaml');
const ARTICLE_FIXTURE = join(import.meta.dir, 'fixtures/article-bundle');
const SUMMARY = join(REPO, '.works/tmp/test-kk-publish/summary.json');
const REAL_SPUR = Bun.which('spur') ?? 'spur';

/** The bundle day every fixture uses, and the podcast episode its gate looks for. */
const RUN_DATE = '2026-11-13';
const EPISODE_GUID = 'episode-1';
const FEED_URL = `data:application/rss+xml,${encodeURIComponent(
    `<?xml version="1.0"?><rss><channel><item><title>每日AI乱炖 · ${RUN_DATE}</title><guid>${EPISODE_GUID}</guid></item></channel></rss>`,
)}`;

const created: string[] = [];
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

interface Project {
    root: string;
    works: string;
    bin: string;
    wrap: string;
    restore(): void;
}

/**
 * A throwaway project root: temp works dir, temp store, local preset, `plugins/kk` symlink.
 *
 * The symlink is what keeps the launch preflight honest on a working tree that is mid-task: the
 * package root becomes this temp dir, whose `git status` fails (it is not a repository), so the
 * dirty-harness check has nothing to refuse — and the checkout-vs-installed diff compares the
 * symlinked tree with itself.
 */
function project(): Project {
    const root = tempDir('kk-publish-e2e-');
    const works = join(root, 'works');
    const bin = join(root, 'bin');
    mkdirSync(join(works), { recursive: true });
    mkdirSync(join(bin), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });
    symlinkSync(join(REPO, 'plugins'), join(root, 'plugins'));

    writeFileSync(
        join(root, '.kk/publish-presets/daily-ai-voice.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                name: 'daily-ai-voice',
                targets: [
                    {
                        plugin: 'surfdash-pub',
                        operation: 'post',
                        variant: 'article',
                        tier: 0,
                        required: true,
                        window: 'after-generate',
                        mode: 'draft',
                    },
                    {
                        plugin: 'podcast-pub',
                        operation: 'episode',
                        variant: 'episode',
                        tier: 0,
                        required: true,
                        window: 'after-generate',
                        mode: 'draft',
                    },
                    {
                        plugin: 'wechatmp-pub',
                        operation: '文章',
                        variant: 'article',
                        tier: 2,
                        window: 'after-generate',
                        mode: 'draft',
                    },
                    {
                        plugin: 'weibo-pub',
                        operation: 'article',
                        variant: 'article',
                        tier: 2,
                        window: 'cn-peak',
                        mode: 'draft',
                    },
                    {
                        plugin: 'x-pub',
                        operation: 'post',
                        variant: 'episode',
                        tier: 3,
                        window: 'overseas-rss',
                        mode: 'draft',
                    },
                ],
            },
            null,
            2,
        )}\n`,
    );
    // The article fixture's own two-row matrix: the article bundle carries one variant, so a
    // news matrix would plan omitted rows and blur AC2's single-channel re-send.
    writeFileSync(
        join(root, '.kk/publish-presets/article-fixture.json'),
        `${JSON.stringify(
            {
                schemaVersion: 1,
                name: 'article-fixture',
                targets: [
                    {
                        plugin: 'surfdash-pub',
                        operation: 'post',
                        variant: 'article',
                        tier: 0,
                        required: true,
                        window: 'after-generate',
                        mode: 'draft',
                    },
                    {
                        plugin: 'wechatmp-pub',
                        operation: '文章',
                        variant: 'article',
                        tier: 2,
                        window: 'after-generate',
                        mode: 'draft',
                    },
                ],
            },
            null,
            2,
        )}\n`,
    );
    writeFileSync(
        join(root, 'config.yaml'),
        [
            `works_dir: ${works}`,
            'store:',
            `  db_path: ${join(root, 'kk.db')}`,
            'content_types:',
            '  news:',
            '    publish_preset: daily-ai-voice',
            '  itc:',
            '    publish_preset: article-fixture',
            '',
        ].join('\n'),
    );

    // `kk`: every node command goes to the shipped CLI; a `publish-plan` runs under a fixed clock so
    // the cn-peak wait-until node is a no-op (its own stage test owns the arithmetic, and a real
    // wait is up to three hours).
    const wrap = join(root, 'wrap.ts');
    writeFileSync(
        wrap,
        [
            `Date.now = () => Date.parse('${RUN_DATE}T02:00:00.000Z');`,
            `process.argv[1] = ${JSON.stringify(CLI)};`,
            `const { main } = await import(${JSON.stringify(join(REPO, 'apps/cli/src/main.ts'))});`,
            `process.exit(await main(['bun', 'kk', ...process.argv.slice(2)]));`,
            '',
        ].join('\n'),
    );
    writeFileSync(
        join(bin, 'kk'),
        [
            '#!/usr/bin/env bash',
            'set -u',
            `printf '%s\\n' "kk $*" >> "\${KK_LOG:-/dev/null}"`,
            `if [ "\${1:-}" = "news" ] || [ "\${1:-}" = "article" ]; then`,
            `  if [ "\${2:-}" = "publish-plan" ]; then exec bun ${JSON.stringify(wrap)} "$@"; fi`,
            'fi',
            `exec bun ${JSON.stringify(CLI)} "$@"`,
            '',
        ].join('\n'),
    );
    // `spur`: the executor probe is answered locally (a suite must never buy a model call); every
    // workflow call is the real engine.
    writeFileSync(
        join(bin, 'spur'),
        [
            '#!/usr/bin/env bash',
            'set -u',
            'case "$*" in',
            '  *"agent run"*) echo "OK"; exit 0 ;;',
            'esac',
            `exec ${JSON.stringify(REAL_SPUR)} "$@"`,
            '',
        ].join('\n'),
    );
    chmodSync(join(bin, 'kk'), 0o755);
    chmodSync(join(bin, 'spur'), 0o755);

    const priorCwd = process.cwd();
    const saved = {
        KK_CONFIG: process.env.KK_CONFIG,
        KK_SPUR_BIN: process.env.KK_SPUR_BIN,
        KK_LOG: process.env.KK_LOG,
        PATH: process.env.PATH,
    };
    process.chdir(root);
    process.env.PATH = `${bin}:${saved.PATH ?? ''}`;
    process.env.KK_CONFIG = join(root, 'config.yaml');
    process.env.KK_SPUR_BIN = join(bin, 'spur');
    return {
        root,
        works,
        bin,
        wrap,
        restore: () => {
            process.chdir(priorCwd);
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        },
    };
}

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    const captured = captureOutput();
    try {
        const code = await main(['node', 'kk', ...args]);
        return { code, stdout: captured.read(), stderr: captured.readErr() };
    } finally {
        captured.restore();
    }
}

/** The verbs a run actually dispatched, in order, read off the `kk` shim's log. */
function dispatchedSteps(logPath: string): string[] {
    const text = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
    return text
        .split('\n')
        .map((line) => /publish-(plan|check|send|settle|report)\b/.exec(line)?.[0])
        .filter((step): step is string => step !== undefined);
}

/** One `spur workflow run`, offline, with this project's shims on PATH. */
function runWorkflow(
    workflow: string,
    runId: string,
    vars: Record<string, string>,
    logPath: string,
): { code: number; stdout: string; stderr: string } {
    const { SPUR_WORKFLOW_RUN_ACTIVE, SPUR_EXPECTED_DEFINITION_DIGEST, ...env } = process.env;
    void SPUR_WORKFLOW_RUN_ACTIVE;
    void SPUR_EXPECTED_DEFINITION_DIGEST;
    writeFileSync(logPath, '');
    const result = Bun.spawnSync(
        [REAL_SPUR, 'workflow', 'run', workflow, '--run-id', runId, '--json', '--vars', JSON.stringify(vars)],
        // `KK_WINDOW_WAIT=skip` is the documented seam: the cn-peak window's 09:00 Shanghai wait
        // would otherwise sleep hours and blow the test budget (it flips with the wall clock).
        {
            cwd: process.cwd(),
            env: { ...env, KK_LOG: logPath, KK_WINDOW_WAIT: 'skip' },
            stdout: 'pipe',
            stderr: 'pipe',
        },
    );
    return {
        code: result.exitCode ?? 1,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
    };
}

function sha256(text: string): string {
    return new Bun.CryptoHasher('sha256').update(text).digest('hex');
}

/**
 * Where a fixture writes its bundle.
 *
 * `frozen` is the layout a real run directory has after the cut-over (`4-publish/bundle.json`, design
 * §4.3) and the only one the launching verb admits; `legacy` is the root-level `bundle.json` that
 * `kk-daily-publish3.yaml` still names and that a pre-cut-over directory keeps (§4.3: "history is not
 * migrated"). AC1/AC2 use the frozen path, AC3 the legacy one, so both are exercised.
 */
type Layout = 'frozen' | 'legacy';

function bundleBase(workDir: string, layout: Layout): string {
    return layout === 'frozen' ? join(workDir, '4-publish') : workDir;
}

/** The news fixture: the two variants publish3 is proven against, plus the episode the gate knows. */
function seedNewsBundle(workDir: string, layout: Layout = 'legacy'): void {
    const base = bundleBase(workDir, layout);
    mkdirSync(join(base, 'variants'), { recursive: true });
    const variants: Record<string, { title: string; format: string; body: string; metadata: object }> = {
        article: { title: '标题', format: 'markdown', body: '正文 {{article_url}}', metadata: {} },
        episode: { title: '标题播客', format: 'markdown', body: '播客 {{podcast_url}}', metadata: {} },
    };
    const entries: Record<string, { path: string; sha256: string }> = {};
    for (const [name, body] of Object.entries(variants)) {
        const text = `${JSON.stringify(body, null, 2)}\n`;
        writeFileSync(join(base, 'variants', `${name}.json`), text);
        entries[name] = { path: `variants/${name}.json`, sha256: sha256(text) };
    }
    writeFileSync(
        join(base, 'bundle.json'),
        `${JSON.stringify({
            schemaVersion: 1,
            runId: 'voice3-run-1',
            runDate: RUN_DATE,
            runs: [],
            contentType: 'news',
            title: `每日AI乱炖 · ${RUN_DATE}`,
            episode: { title: `每日AI乱炖 · ${RUN_DATE}`, guid: EPISODE_GUID },
            variants: entries,
        })}\n`,
    );
}

/**
 * The article fixture (0368 makes generation write one; AC1 proves the publish half now).
 *
 * The fixture directory *is* the contents of `4-publish/`: `bundle.json` beside `variants/`, so the
 * copy lands where the frozen contract puts it and its relative variant paths resolve.
 */
/**
 * Copy the hand-built article bundle, then re-derive every declared variant digest from the bytes
 * that were copied.
 *
 * The seed owns the truth, not the fixture file: with a hard-coded digest, any later edit to a
 * variant body leaves the bundle inconsistent, and the failure is hard to read — `publish-plan` exits
 * 1 with `variant digest mismatch`, the `plan` node's deliberate `onError: continue` swallows it (it
 * exists for a gated RSS miss), and the run only dies one node later at `check` with "no plan".
 */
function seedArticleBundle(workDir: string): void {
    const publishDir = join(workDir, '4-publish');
    mkdirSync(publishDir, { recursive: true });
    cpSync(ARTICLE_FIXTURE, publishDir, { recursive: true });
    const bundlePath = join(publishDir, 'bundle.json');
    const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8')) as {
        variants?: Record<string, { path: string; sha256: string }>;
    };
    const variants = Object.fromEntries(
        Object.entries(bundle.variants ?? {}).map(([name, entry]) => [
            name,
            { ...entry, sha256: sha256(readFileSync(join(publishDir, entry.path), 'utf-8')) },
        ]),
    );
    writeFileSync(bundlePath, `${JSON.stringify({ ...bundle, variants }, null, 2)}\n`);
}

/** Every file under `dir`, repo-relative to it, sorted. */
function filesUnder(dir: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else out.push(relative(dir, path));
        }
    };
    walk(dir);
    return out.sort();
}

/** mtime of every file in the tree, keyed by its work-dir-relative path. */
function mtimes(workDir: string): Map<string, number> {
    const map = new Map<string, number>();
    const walk = (current: string): void => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else map.set(relative(workDir, path), statSync(path).mtimeMs);
        }
    };
    walk(workDir);
    return map;
}

/**
 * A plan read as data, with the one intended difference normalised away.
 *
 * `publish-plan` applies the config switchboard in TypeScript and records each row's
 * `modeSource: 'flag'` (design §2.1, task 0364); publish3's node calls the raw
 * `publish-matrix-plan` stage, which has no switchboard and no mode source. Everything else about
 * the two plans — payloads, digests, tiers, modes, exclusions — must be identical.
 */
function normalisedPlan(path: string): unknown {
    const parsed = normalisedJson(path) as { rows?: Array<Record<string, unknown>> };
    if (Array.isArray(parsed.rows)) {
        parsed.rows = parsed.rows.map(({ modeSource, ...row }) => {
            void modeSource;
            return row;
        });
    }
    return parsed;
}

/** A plan/outcome read as data, with the row and excluded order normalised. */
function normalisedJson(path: string): unknown {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
        rows?: Array<{ id: string }>;
        excluded?: Array<{ id: string }>;
    };
    if (Array.isArray(parsed.rows)) parsed.rows.sort((a, b) => a.id.localeCompare(b.id));
    if (Array.isArray(parsed.excluded)) parsed.excluded.sort((a, b) => a.id.localeCompare(b.id));
    return parsed;
}

describe('kk-publish — AC1 both content nouns publish through one workflow (0366 R1–R4)', () => {
    it('runs the same node ids for a news bundle and a hand-built article bundle, in dummy mode', async () => {
        const sandbox = project();
        try {
            const newsDir = join(sandbox.root, 'news-run');
            seedNewsBundle(newsDir, 'frozen');
            const articleDir = join(sandbox.root, 'article-run');
            seedArticleBundle(articleDir);

            const newsLog = join(sandbox.root, 'news.log');
            process.env.KK_LOG = newsLog;
            const news = await runCli(['news', 'publish', '--work-dir', newsDir, '--dummy']);
            const articleLog = join(sandbox.root, 'article.log');
            process.env.KK_LOG = articleLog;
            const article = await runCli(['article', 'publish', '--work-dir', articleDir, '--dummy']);

            expect(news.stderr).toBe('');
            expect(article.stderr).toBe('');
            expect(news.code).toBe(0);
            expect(article.code).toBe(0);

            // The same graph, the same verbs: the noun only changes the CLI word.
            const steps = ['publish-plan', 'publish-check', 'publish-send', 'publish-settle', 'publish-report'];
            expect(dispatchedSteps(newsLog)).toEqual(steps);
            expect(dispatchedSteps(articleLog)).toEqual(steps);
            expect(readFileSync(newsLog, 'utf-8')).toContain('kk news publish-plan');
            expect(readFileSync(articleLog, 'utf-8')).toContain('kk article publish-plan');

            // Receipts of the same schema, each in its own work dir.
            const newsReceipts = filesUnder(join(newsDir, '4-publish', 'receipts'));
            const articleReceipts = filesUnder(join(articleDir, '4-publish', 'receipts'));
            expect(newsReceipts).toEqual([
                'podcast-pub.episode.json',
                'surfdash-pub.post.json',
                'wechatmp-pub.文章.json',
            ]);
            expect(articleReceipts).toEqual(['surfdash-pub.post.json', 'wechatmp-pub.文章.json']);
            const schemaOf = (workDir: string, name: string): string[] =>
                Object.keys(
                    JSON.parse(readFileSync(join(workDir, '4-publish', 'receipts', name), 'utf-8')) as object,
                ).sort();
            expect(schemaOf(newsDir, 'surfdash-pub.post.json')).toEqual(schemaOf(articleDir, 'surfdash-pub.post.json'));

            for (const workDir of [newsDir, articleDir]) {
                const outcome = normalisedJson(join(workDir, '4-publish', 'outcome.after-generate.json')) as {
                    status: string;
                    rows: Array<{ dummy: boolean }>;
                };
                expect(outcome.status).toBe('dummy');
                expect(outcome.rows.every((row) => row.dummy)).toBe(true);
                expect(existsSync(join(workDir, '5-report', 'publish-after-generate.md'))).toBe(true);
            }

            // The launch receipt names the one shared workflow for both nouns.
            for (const workDir of [newsDir, articleDir]) {
                const receipt = JSON.parse(
                    readFileSync(join(workDir, '4-publish', 'schedule-receipt.after-generate.json'), 'utf-8'),
                ) as { workflow: string; status: string; window: string };
                expect(receipt.workflow).toBe('kk-publish');
                expect(receipt.status).toBe('done');
                expect(receipt.window).toBe('after-generate');
            }
        } finally {
            sandbox.restore();
        }
    }, 240_000);
});

describe('kk-publish — AC2 one channel is re-sent without regenerating (0366 R5)', () => {
    it('dispatches only the named row, records the override, and touches nothing else', async () => {
        const sandbox = project();
        try {
            const workDir = join(sandbox.root, 'article-retry');
            seedArticleBundle(workDir);
            process.env.KK_LOG = join(sandbox.root, 'first.log');
            const first = await runCli(['article', 'publish', '--work-dir', workDir, '--dummy']);
            expect(first.code).toBe(0);

            // A settled bundle whose wechatmp row failed with `effect: none` — the one thing a
            // bounded retry may resend (a live/unknown-effect row is never resent).
            const receiptPath = join(workDir, '4-publish', 'receipts', 'wechatmp-pub.文章.json');
            const settled = JSON.parse(readFileSync(receiptPath, 'utf-8')) as Record<string, unknown>;
            writeFileSync(
                receiptPath,
                `${JSON.stringify(
                    {
                        ...settled,
                        status: 'failed',
                        effect: 'none',
                        error: 'fixture: the channel refused the session',
                        dummy: undefined,
                    },
                    null,
                    2,
                )}\n`,
            );

            const before = mtimes(workDir);
            const bundleBefore = JSON.parse(readFileSync(join(workDir, '4-publish', 'bundle.json'), 'utf-8')) as {
                runs?: string[];
            };

            const log = join(sandbox.root, 'retry.log');
            process.env.KK_LOG = log;
            const retry = await runCli([
                'article',
                'publish',
                '--work-dir',
                workDir,
                '--channels',
                'wechatmp-pub',
                '--retry',
                '--dummy',
            ]);

            expect(retry.code).toBe(0);
            const plan = JSON.parse(readFileSync(join(workDir, '4-publish', 'plan.after-generate.json'), 'utf-8')) as {
                rows: Array<{ id: string }>;
                excluded: Array<{ id: string; plugin: string; reason: string }>;
            };
            expect(plan.rows.map((row) => row.id)).toEqual(['wechatmp-pub.文章']);
            expect(plan.excluded).toEqual([
                { id: 'surfdash-pub.post', plugin: 'surfdash-pub', reason: 'not in --channels list' },
            ]);

            const resent = JSON.parse(readFileSync(receiptPath, 'utf-8')) as { status: string; dummy?: boolean };
            expect(resent.status).toBe('succeeded');
            expect(resent.dummy).toBe(true);

            // Same work dir, nothing regenerated: every file outside 4-publish/ and 5-report/ keeps
            // its mtime, and the frozen bundle's own bytes only grew by the run id `publish-settle`
            // appends to `runs[]` (0333 traceability, §5.3 node 8 — and it lives inside
            // `4-publish/`, so the settlement's bookkeeping stays inside the allowed prefix).
            const after = mtimes(workDir);
            // The verb layer's per-window bookkeeping is not content: the classifier writes the
            // ledger's `<node>.summary.txt` and the stage runner appends `step-timing.json`. Every
            // OTHER file outside 4-publish/ and 5-report/ must be untouched — that is what "nothing
            // was regenerated" means.
            const bookkeeping = /(^|\/)(step-timing\.json|[^/]+\.summary\.txt)$/;
            const moved = [...after]
                .filter(([path]) => !path.startsWith('4-publish') && !path.startsWith('5-report'))
                .filter(([path, mtime]) => !bookkeeping.test(path) && mtime !== before.get(path))
                .map(([path]) => path);
            expect(moved).toEqual([]);
            // The re-send did change the window it owns.
            expect(after.get(join('4-publish', 'receipts', 'wechatmp-pub.文章.json'))).not.toBe(
                before.get(join('4-publish', 'receipts', 'wechatmp-pub.文章.json')),
            );
            const bundleAfter = JSON.parse(readFileSync(join(workDir, '4-publish', 'bundle.json'), 'utf-8')) as {
                runs?: string[];
            };
            // `runs[]` is the bundle's traceability list; nothing else in the bundle may move (a
            // regenerated variant would change a digest here).
            expect(bundleAfter.runs?.length).toBeGreaterThanOrEqual(bundleBefore.runs?.length ?? 0);
            expect(bundleAfter.runs?.length).toBeLessThanOrEqual((bundleBefore.runs?.length ?? 0) + 1);
            expect({ ...bundleAfter, runs: [] }).toEqual({ ...bundleBefore, runs: [] });
        } finally {
            sandbox.restore();
        }
    }, 240_000);
});

describe('kk-publish — AC3 the nine-node workflow matches the eighteen-node one (0366 R7)', () => {
    it('produces the same 4-publish file set and the same outcome per window in dummy mode', () => {
        const sandbox = project();
        try {
            const summary: Array<Record<string, unknown>> = [];
            // One work dir per workflow, the three windows in the order a real day runs them: the
            // cn-peak and overseas rows resolve their tier-2/3 links from the tier-0 receipts the
            // after-generate window left in the same directory, which is what parity must cover.
            const legacyDir = join(sandbox.root, 'publish3-day');
            const nextDir = join(sandbox.root, 'kk-publish-day');
            seedNewsBundle(legacyDir);
            seedNewsBundle(nextDir);
            for (const window of ['after-generate', 'cn-peak', 'overseas-rss']) {
                const legacy = runWorkflow(
                    PUBLISH3,
                    `p3-${window}-1`,
                    {
                        work_dir: legacyDir,
                        run_date: RUN_DATE,
                        window,
                        preset: 'daily-ai-voice',
                        dummy: 'true',
                        live_confirm: 'false',
                        feed: FEED_URL,
                        // No gate miss in this comparison: a hit plans, sends and settles a window.
                        agent: 'no-such-executor',
                    },
                    join(sandbox.root, `p3-${window}.log`),
                );
                const next = runWorkflow(
                    PUBLISH,
                    `kkp-${window}-1`,
                    {
                        work_dir: nextDir,
                        run_date: RUN_DATE,
                        window,
                        preset: 'daily-ai-voice',
                        dummy: '--dummy',
                        feed: FEED_URL,
                        agent: 'no-such-executor',
                    },
                    join(sandbox.root, `kkp-${window}.log`),
                );
                expect({ window, code: legacy.code, stderr: legacy.stderr.slice(-400) }).toEqual({
                    window,
                    code: 0,
                    stderr: legacy.stderr.slice(-400),
                });
                expect({ window, code: next.code, stderr: next.stderr.slice(-400) }).toEqual({
                    window,
                    code: 0,
                    stderr: next.stderr.slice(-400),
                });

                const legacyFiles = filesUnder(join(legacyDir, '4-publish'));
                const nextFiles = filesUnder(join(nextDir, '4-publish'));
                expect(nextFiles).toEqual(legacyFiles);

                const outcomePath = `outcome.${window}.json`;
                expect(nextFiles).toContain(outcomePath);
                expect(normalisedJson(join(nextDir, '4-publish', outcomePath))).toEqual(
                    normalisedJson(join(legacyDir, '4-publish', outcomePath)),
                );
                // The plan is the frozen contract both graphs feed the same send loop.
                expect(normalisedPlan(join(nextDir, '4-publish', `plan.${window}.json`))).toEqual(
                    normalisedPlan(join(legacyDir, '4-publish', `plan.${window}.json`)),
                );
                // Both pages exist and name the window's rows.
                expect(existsSync(join(legacyDir, '5-report', `publish-${window}.md`))).toBe(true);
                expect(existsSync(join(nextDir, '5-report', `publish-${window}.md`))).toBe(true);

                summary.push({
                    window,
                    publish3: {
                        files: legacyFiles,
                        outcome: normalisedJson(join(legacyDir, '4-publish', outcomePath)),
                    },
                    kkPublish: { files: nextFiles, outcome: normalisedJson(join(nextDir, '4-publish', outcomePath)) },
                    steps: dispatchedSteps(join(sandbox.root, `kkp-${window}.log`)),
                });
            }

            mkdirSync(join(SUMMARY, '..'), { recursive: true });
            writeFileSync(SUMMARY, `${JSON.stringify({ runDate: RUN_DATE, windows: summary }, null, 2)}\n`);
            expect(existsSync(SUMMARY)).toBe(true);
            expect(summary).toHaveLength(3);
        } finally {
            sandbox.restore();
        }
    }, 300_000);
});
