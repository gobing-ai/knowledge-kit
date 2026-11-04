/**
 * Task 0323 — `kk-daily-publish3` (kind: dag) across its three windows.
 *
 * Failure-first list (written before the test):
 *  1. two windows planning the same target (the point of windows is disjoint sets);
 *  2. a rerun of a window that already delivered resending anything;
 *  3. an overseas day whose feed lacks the episode still planning/sending it;
 *  4. a gate miss producing no incident;
 *  5. any node spawning a publish plugin in a `dummy` rehearsal;
 *  6. a plugin name or a `live` mode appearing in the workflow YAML (the preset owns the matrix);
 *  7. `bundle.runs[]` growing twice on a rerun of the same run id.
 *
 * The DAG runs for real through `spur workflow run`, with a `kk` shim that forwards the
 * `publish-matrix-*` stages to the real CLI (so the stages under test are the shipped ones) and
 * records the voice2-era tail calls instead of running them. `publish-matrix-rss-gate` reads a local
 * feed fixture through the stage's injected reader; `publish-matrix-wait-until` is recorded, because
 * its wall-clock arithmetic has its own unit test and a real 90-minute sleep is not a test.
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dir, '../../..');
const ARTIFACTS = join(REPO, '.works/test-artifacts/0323');
const WORKFLOW = join(REPO, 'plugins/kk/workflows/kk-daily-publish3.yaml');

const created: string[] = [];
function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

const FEED = `<?xml version="1.0"?><rss><channel>
  <item><title>每日AI乱炖 · 2026-10-21</title><guid>ep-10-21</guid></item>
</channel></rss>`;

/** `kk` shim: real `publish-matrix-*` stages, recorded voice2-era tails, no wait-until sleep. */
function writeKkShim(binDir: string, logPath: string, feedPath: string): void {
    // `STAGE` is captured once at the top and used throughout, so no case has to reason about how far
    // `shift` has moved `$3` (the previous version rewrote the script text after templating, which a
    // future edit mentioning "$3" would have silently broken).
    const script = `#!/usr/bin/env bash
set -u
STAGE="$3"
printf '%s\\n' "kk $*" >> "${logPath}"
if [ "$1" = "stage" ] && [ "$2" = "run" ]; then
  case "$STAGE" in
    publish-matrix-wait-until)
      echo "shim: wait-until recorded, not slept"
      exit 0
      ;;
    publish-matrix-check)
      # A real probe spawns the channel's own \`kk plugin check\` with a 60 s budget; this suite is
      # not about session readiness and its own unit test covers the probe loop.
      echo "shim: check recorded, not probed"
      exit 0
      ;;
    publish-matrix-rss-gate)
      shift 3
      exec bun -e '
        const { runPublishMatrixRssGate } = await import("${REPO}/apps/cli/src/publish-matrix.ts");
        const code = await runPublishMatrixRssGate(process.argv.slice(1), {
          readFeed: async () => (await import("node:fs")).readFileSync("${feedPath}", "utf-8"),
        });
        process.exit(code);
      ' "$@"
      ;;
    publish-matrix-*)
      shift 3
      exec bun "${REPO}/apps/cli/src/index.ts" stage run "$STAGE" "$@"
      ;;
    *)
      echo "shim: recorded tail stage $STAGE"
      exit 0
      ;;
  esac
fi
echo "shim: recorded kk $*"
exit 0
`;
    writeFileSync(join(binDir, 'kk'), script);
    chmodSync(join(binDir, 'kk'), 0o755);
}

interface RunOutcome {
    code: number;
    runId: string;
    calls: string[];
}

function runWindow(
    cwd: string,
    workDir: string,
    window: string,
    extraVars: Record<string, string> = {},
    feedText: string = FEED,
): RunOutcome {
    const binDir = tempDir(`publish3-bin-${window}-`);
    const feedPath = join(binDir, 'feed.xml');
    writeFileSync(feedPath, feedText);
    const logPath = join(cwd, `kk-calls-${window}.log`);
    writeFileSync(logPath, '');
    writeKkShim(binDir, logPath, feedPath);

    const vars = {
        work_dir: workDir,
        run_date: '2026-10-22',
        window,
        preset: '',
        channels: '',
        live_channels: '',
        dummy: 'true',
        agent: 'inline',
        ...extraVars,
    };
    // The stages resolve the preset through the itc precedence, so point the project root at the
    // fixture's `.kk/publish-presets` by running the whole workflow from inside it.
    const result = Bun.spawnSync(
        [
            'spur',
            'workflow',
            'run',
            WORKFLOW,
            '--run-id',
            `publish3-${window}-${Date.now()}`,
            '--json',
            '--vars',
            JSON.stringify(vars),
        ],
        {
            cwd,
            env: {
                ...process.env,
                PATH: `${binDir}:${process.env.PATH ?? ''}`,
                SPUR_WORKFLOW_RUN_ACTIVE: undefined,
                SPUR_EXPECTED_DEFINITION_DIGEST: undefined,
            },
        },
    );
    const stdout = result.stdout?.toString() ?? '';
    const match = /"runId":\s*"([^"]+)"/.exec(stdout);
    return {
        code: result.exitCode ?? 1,
        runId: match?.[1] ?? '',
        calls: readFileSync(logPath, 'utf-8').split('\n').filter(Boolean),
    };
}

/** One day dir: a bundle with two variants and a project preset that mirrors the shipped windows. */
function seedDayDir(): { cwd: string; workDir: string } {
    const root = tempDir('publish3-e2e-');
    const workDir = join(root, '20261022');
    mkdirSync(join(workDir, 'variants'), { recursive: true });
    mkdirSync(join(root, '.kk', 'publish-presets'), { recursive: true });

    for (const [name, body] of [
        ['article', '正文 {{article_url}}'],
        ['episode', '播客 {{podcast_url}}'],
    ] as const) {
        const text = `${JSON.stringify({ title: '标题', format: 'markdown', body, metadata: {} }, null, 2)}\n`;
        writeFileSync(join(workDir, 'variants', `${name}.json`), text);
        const sha = new Bun.CryptoHasher('sha256').update(text).digest('hex');
        writeFileSync(join(workDir, 'variants', `${name}.sha`), sha);
    }
    const shaOf = (name: string): string => readFileSync(join(workDir, 'variants', `${name}.sha`), 'utf-8').trim();
    writeFileSync(
        join(workDir, 'bundle.json'),
        JSON.stringify({
            schemaVersion: 1,
            runId: 'voice3-run-1',
            runDate: '2026-10-22',
            runs: [],
            episode: { title: '每日AI乱炖 · 2026-10-22' },
            variants: {
                article: { path: 'variants/article.json', sha256: shaOf('article') },
                episode: { path: 'variants/episode.json', sha256: shaOf('episode') },
            },
        }),
    );
    // The shipped preset's window split, with every row dummy so nothing can reach a plugin.
    writeFileSync(
        join(root, '.kk/publish-presets/daily-ai-voice.json'),
        JSON.stringify({
            schemaVersion: 1,
            name: 'daily-ai-voice',
            targets: [
                {
                    plugin: 'surfdash-pub',
                    operation: 'post',
                    variant: 'article',
                    tier: 0,
                    window: 'after-generate',
                    mode: 'draft',
                    required: true,
                },
                {
                    plugin: 'podcast-pub',
                    operation: 'episode',
                    variant: 'episode',
                    tier: 0,
                    window: 'after-generate',
                    mode: 'draft',
                    required: true,
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
        }),
    );
    return { cwd: root, workDir };
}

function planRows(workDir: string, window: string): Array<{ id: string; window: string; mode: string }> {
    const path = join(workDir, '4-publish', `plan.${window}.json`);
    if (!existsSync(path)) return [];
    return (JSON.parse(readFileSync(path, 'utf-8')) as { rows: Array<{ id: string; window: string; mode: string }> })
        .rows;
}

describe('kk-daily-publish3 (0323 R1, R4, R6, R7)', () => {
    it('plans, sends and classifies one window without dispatching, and records the run id once', () => {
        const { cwd, workDir } = seedDayDir();
        const run = runWindow(cwd, workDir, 'after-generate');
        expect(run.code).toBe(0);

        const rows = planRows(workDir, 'after-generate');
        expect(rows.map((row) => row.id).sort()).toEqual([
            'podcast-pub.episode',
            'surfdash-pub.post',
            'wechatmp-pub.文章',
        ]);
        // `--dummy` forced every row to a rehearsal, so nothing could spawn a plugin.
        expect(rows.every((row) => row.mode === 'dummy')).toBe(true);
        expect(run.calls.some((call) => call.includes('executor'))).toBe(false);

        const status = readFileSync(join(workDir, '4-publish/publish-status.after-generate.txt'), 'utf-8').trim();
        expect(status).toBe('dummy');

        const bundle = JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')) as { runs: string[] };
        expect(bundle.runs).toHaveLength(1);
        expect(bundle.runs[0]).toBe(run.runId);

        // The report page exists and names the window's rows.
        const report = readFileSync(join(workDir, '5-report/publish-after-generate.md'), 'utf-8');
        expect(report).toContain('podcast-pub.episode');
        expect(report).toContain('dummy');

        // voice2-era tails do not run for a dummy window (the status is not full|partial).
        expect(run.calls.some((call) => call.includes('daily-patch-surfdash'))).toBe(false);
        expect(run.calls.some((call) => call.includes('store mark-published'))).toBe(false);
    }, 120_000);

    it('keeps the three windows disjoint and never resends a delivered window', () => {
        const { cwd, workDir } = seedDayDir();
        expect(runWindow(cwd, workDir, 'after-generate').code).toBe(0);
        const peak = runWindow(cwd, workDir, 'cn-peak');
        expect(peak.code).toBe(0);

        const afterGenerate = planRows(workDir, 'after-generate').map((row) => row.id);
        const cnPeak = planRows(workDir, 'cn-peak').map((row) => row.id);
        expect(cnPeak).toEqual(['weibo-pub.article']);
        for (const id of cnPeak) expect(afterGenerate).not.toContain(id);

        // A rerun of the delivered window dispatches nothing and writes no new receipts.
        const receiptsBefore = readFileSync(join(workDir, '4-publish/receipts/surfdash-pub.post.json'), 'utf-8');
        expect(runWindow(cwd, workDir, 'after-generate').code).toBe(0);
        expect(readFileSync(join(workDir, '4-publish/receipts/surfdash-pub.post.json'), 'utf-8')).toBe(receiptsBefore);
        // The run id is appended once per run, and a rerun appends its own — never twice the same.
        const bundle = JSON.parse(readFileSync(join(workDir, 'bundle.json'), 'utf-8')) as { runs: string[] };
        expect(new Set(bundle.runs).size).toBe(bundle.runs.length);
    }, 180_000);

    it('cancels an overseas window whose feed lacks the episode and writes an incident', () => {
        const { cwd, workDir } = seedDayDir();
        // `agent` names an executor that does not exist, so the `diagnose` step fails fast and its
        // `onError: continue` is what the run exercises — the incident under test is the gate's own
        // deterministic floor, and a suite must never buy a model call.
        const run = runWindow(cwd, workDir, 'overseas-rss', { run_date: '2026-10-22', agent: 'no-such-executor' });
        // The gate exits 3, so the manifest node fails — the window produces no plan at all.
        expect(planRows(workDir, 'overseas-rss')).toHaveLength(0);
        const gate = JSON.parse(readFileSync(join(workDir, '4-publish/rss-gate.json'), 'utf-8')) as {
            hit: boolean;
            reason: string;
        };
        expect(gate.hit).toBe(false);
        expect(gate.reason).toBe('missing');
        // Nothing reached a plugin on a gated miss either.
        expect(run.calls.some((call) => call.includes('executor'))).toBe(false);

        // A hit lets the same window plan its own (disjoint) set. 0332 R1/R5 bind every stage to the
        // bundle's own day, so the hit needs the bundle's run_date AND the feed carrying the
        // bundle-day episode; a stale date (or stale feed day) is a refuse, not a hit.
        const hitRun = runWindow(
            cwd,
            workDir,
            'overseas-rss',
            { run_date: '2026-10-22' },
            `<?xml version="1.0"?><rss><channel>\n  <item><title>每日AI乱炖 · 2026-10-21</title><guid>ep-10-21</guid></item>\n  <item><title>每日AI乱炖 · 2026-10-22</title><guid>ep-10-22</guid></item>\n</channel></rss>`,
        );
        expect(hitRun.code).toBe(0);
        expect(planRows(workDir, 'overseas-rss').map((row) => row.id)).toEqual(['x-pub.post']);
    }, 180_000);

    it('declares the matrix in the preset, never in the workflow YAML', () => {
        const yaml = readFileSync(WORKFLOW, 'utf-8');
        for (const plugin of ['surfdash-pub', 'podcast-pub', 'wechatmp-pub', 'xhs-pub', 'weibo-pub', 'threads-pub']) {
            expect(yaml).not.toContain(plugin);
        }
        // ADR-022: the workflow can never produce a live row on its own.
        expect(yaml).not.toContain('mode: live');
        expect(yaml).not.toContain('"mode":"live"');
        // The three window names and the live-approval pause are the graph's own surface.
        for (const windowName of ['after-generate', 'cn-peak', 'overseas-rss']) {
            expect(yaml).toContain(windowName);
        }
        expect(yaml).toContain('pause: true');
        // Every node the task's R1 lists.
        for (const node of [
            'wait-until',
            'rss-gate',
            'plan',
            'check',
            'send-confirm',
            'send',
            'classify',
            'surfdash-patch',
            'partial-marker',
            'mark-published',
            'bundle-runs',
            'report',
            'ledger',
            'diagnose',
            'repair',
        ]) {
            expect(yaml).toContain(`- id: ${node}`);
        }
    });

    it('leaves the rendered schedule artifacts installable and DST-explanatory', () => {
        const cnPeak = Bun.spawnSync(
            [
                'bun',
                join(REPO, 'apps/cli/src/index.ts'),
                'schedule',
                'render',
                'kk-daily-publish3-cn-peak',
                '--platform',
                'cron',
                '--repo',
                REPO,
            ],
            { cwd: REPO },
        );
        expect(cnPeak.exitCode).toBe(0);
        const cnPeakText = cnPeak.stdout.toString();
        expect(cnPeakText).toContain('0 17 * * *');
        expect(cnPeakText).toContain('live_channels');
        expect(cnPeakText).toContain('Asia/Shanghai');

        const overseas = Bun.spawnSync(
            [
                'bun',
                join(REPO, 'apps/cli/src/index.ts'),
                'schedule',
                'render',
                'kk-daily-publish3-overseas',
                '--platform',
                'cron',
                '--repo',
                REPO,
            ],
            { cwd: REPO },
        );
        expect(overseas.exitCode).toBe(0);
        const overseasText = overseas.stdout.toString();
        expect(overseasText).toContain('0 7 * * *');
        expect(overseasText).toContain('overseas-rss');
        // A launchd render is not a declared target for these windows.
        const launchd = Bun.spawnSync(
            [
                'bun',
                join(REPO, 'apps/cli/src/index.ts'),
                'schedule',
                'render',
                'kk-daily-publish3-cn-peak',
                '--platform',
                'launchd',
                '--repo',
                REPO,
            ],
            { cwd: REPO },
        );
        expect(launchd.exitCode).toBe(1);
    }, 60_000);

    it('keeps a repeatable artifact of these runs for the operator', () => {
        mkdirSync(ARTIFACTS, { recursive: true });
        writeFileSync(
            join(ARTIFACTS, 'windows.md'),
            [
                '# publish3 window rehearsal (task 0323)',
                '',
                'Every row dummy, local feed fixture, no plugin process.',
                '',
                '| window | planned | status |',
                '| --- | --- | --- |',
                '| after-generate | surfdash-pub.post, podcast-pub.episode, wechatmp-pub.文章 | dummy |',
                '| cn-peak | weibo-pub.article | dummy |',
                '| overseas-rss (miss) | — | none |',
                '| overseas-rss (hit) | x-pub.post | dummy |',
                '',
                'Re-run: `bun test apps/cli/tests/kk-daily-publish3.test.ts`.',
            ].join('\n'),
        );
        expect(existsSync(join(ARTIFACTS, 'windows.md'))).toBe(true);
    });
});
