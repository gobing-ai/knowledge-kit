import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { WorkflowName } from '@gobing-ai/kk-board/contracts';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import { type Command, CommanderError } from 'commander';
import { captureRun, parseSetting } from '../board/capture';
import { WORKFLOW_NAMES } from '../board/manifest';
import { resolveKkConfigPath, runInvoke } from '../invoke';
import { consoleOutput } from '../output';
import { runStage } from '../stage';

/** JSON parse bound locally: `cli-no-parse-at-module-scope` cannot tell a JSON parse from commander's
 * program parse (same rationale as `store.ts`); `parseJson`/`parseYaml` keep the contract readable. */
const parseJson: (raw: string) => unknown = JSON.parse;
const parseYaml: (raw: string) => unknown = Bun.YAML.parse;

/**
 * The `daily` command group — the deterministic body of the daily AI-voice pipeline, owned by the
 * CLI instead of the shared stage runner (task 0211 R7).
 *
 * `kk-daily-ai-voice2` is a static DAG whose nodes may carry exactly one action each, so the three
 * daily steps that a DAG node needs as ONE `kk` command live here: `prepare` (ledger sync +
 * workspace composition + the fixed anchor files the read chain projects into vars),
 * `publish-classify` (the publish fan-in, including the surfdash post-patching and the
 * partial-publish record the flat workflow ran as separate states) and `run-report` (the run
 * report, plus the `no-content` record an empty store pool produces). Their bodies moved out of
 * `plugins/kk/scripts/kk-workflow-stages.ts`; the voice1 stages of the same names keep their own
 * copies until `kk-daily-ai-voice.yaml` retires (design §8), so nothing about the flat workflow
 * changes here.
 */

/** Artifact directories of a daily run workspace (the same layout the stage runner composes). */
const DAILY_DIRS = [
    '10-ingest',
    '20-facts',
    '21-plan',
    '22-article',
    '23-cover',
    '25-xhs',
    '24-script',
    '30-audio',
    '31-publish',
] as const;

/** Report/QC thresholds `kk daily run-report` forwards to news-report-gen as env. */
const NEWS_REPORT_PLUGIN = 'news-report-gen';

/** Options accepted by `kk daily prepare`. */
interface DailyPrepareOptions {
    workflow: string;
    workDir?: string;
    runDate?: string;
    ledgerSync?: boolean;
    worksDir?: string;
    /** Engine-injected run id; its presence enables Board capture (no flag = current behaviour). */
    run?: string;
    /** Engine-injected definition digest, forwarded to the capture when present. */
    definitionDigest?: string;
    /** Repeatable allowlisted `key=value` effective settings. */
    setting?: string[];
}

/** Options accepted by `kk daily publish-classify`. */
interface PublishClassifyOptions {
    workDir: string;
    runDate: string;
    surfdashRoot?: string;
    pluginsPath?: string;
    foldTail?: boolean;
}

/** Options accepted by `kk daily run-report`. */
interface RunReportOptions {
    workDir: string;
    runDate: string;
    pluginsPath?: string;
    qcMinQuality?: string;
    qcMinImportance?: string;
    qcMinUrgency?: string;
    qcMinImpact?: string;
    pool?: string;
    candidates?: string;
}

/**
 * Fail loud: print the `kk.daily.<reason>` contract line and throw a `CommanderError` that
 * `main()` maps to exit code 1 (command modules never terminate the process directly).
 */
function failLoud(code: string, error: unknown): never {
    const cause = error instanceof Error ? error.message : String(error);
    const message = `${code}: ${cause}`;
    consoleOutput.error(message);
    throw new CommanderError(1, code, message);
}

/** Expand the `~/` and `$HOME/` prefixes the kk config examples use. */
function expandHome(path: string): string {
    if (path.startsWith('~/')) return join(homedir(), path.slice(2));
    if (path.startsWith('$HOME/')) return join(homedir(), path.slice('$HOME/'.length));
    return path;
}

/**
 * works_dir for composed workspaces — `KK_WORKS_DIR` env > config `works_dir` > the compiled
 * default `~/.config/kk/works`. An unreadable config falls through to the default; composition
 * never fails a run. Shared with the ITC Board capture, whose external workspace must be a
 * canonical child of this configured root (§9).
 */
export function resolveWorksDir(): string {
    const fromEnv = process.env.KK_WORKS_DIR;
    if (fromEnv) return fromEnv;
    const configPath = process.env.KK_CONFIG ?? resolveKkConfigPath();
    if (configPath !== '' && existsSync(configPath)) {
        try {
            const parsed = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown> | null;
            const worksDir = parsed !== null && typeof parsed === 'object' ? parsed.works_dir : undefined;
            if (typeof worksDir === 'string' && worksDir !== '') return expandHome(worksDir);
        } catch {
            // fall through to the compiled default
        }
    }
    return join(homedir(), '.config/kk/works');
}

/** `date +%Y%m%d` — the digits-only run-date stamp the artifact names carry. */
function formatRunDate(now: Date = new Date()): string {
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}${month}${day}`;
}

/**
 * Name every OTHER run that still holds `selected` rows for `workflow` (R7) — one stderr line per
 * run, each carrying the exact `kk store release --run <id>` that frees it.
 *
 * A run that promoted its rows with `kk store mark-published` did publish; any run still holding
 * `selected` rows did not, so no spur-trace reading is needed. `prepare` runs before this run's own
 * `select`, so it never names itself. Best-effort and read-only: a store that is missing or fails to
 * open prints nothing and never fails `prepare`.
 *
 * It opens with `migrate: false` so the probe cannot upgrade the store it is only reading (0242 R6).
 * A store whose journal is behind therefore fails its query instead of being migrated, which the
 * catch below already treats as "nothing to warn about".
 */
async function warnUnreleasedRuns(workflow: string): Promise<void> {
    try {
        const dbPath = await resolveStorePath(resolveKkConfigPath());
        if (!existsSync(dbPath)) return;
        const store = await openStore({ path: dbPath, migrate: false });
        try {
            for (const runId of await store.selections.selectedRuns(workflow)) {
                consoleOutput.error(
                    `kk.daily.prepare.unreleased-run: run '${runId}' still holds selected items for '${workflow}' — free them with: kk store release --run ${runId}`,
                );
            }
        } finally {
            await store.close();
        }
    } catch {
        // R7: an unopenable store is not a prepare failure — the workspace is already composed.
    }
}

/**
 * Bind the composing run to its workspace + sanitized settings through the shared `captureRun`
 * seam (§9). Skipped entirely without a run id, so voice1 and direct callers keep their behaviour.
 *
 * A refused revocation or an invalid input THROWS (the caller must not overwrite results); the
 * optional record write after revocation only warns.
 */
async function captureForBoard(
    input: Pick<DailyPrepareOptions, 'workflow' | 'run' | 'definitionDigest' | 'setting'>,
    workDir: string,
    stamp: string,
    worksRoot: string,
): Promise<void> {
    const runId = input.run;
    if (runId === undefined || runId === '') return;
    const settings: Record<string, string> = {};
    if (WORKFLOW_NAMES.includes(input.workflow as WorkflowName)) {
        for (const raw of input.setting ?? []) {
            const parsed = parseSetting(input.workflow as WorkflowName, raw);
            if (parsed !== null) settings[parsed.key] = parsed.value;
        }
    }
    try {
        const outcome = await captureRun(
            {
                workflow: input.workflow as WorkflowName,
                runId,
                workDir,
                stamp,
                settings,
                ...(input.definitionDigest === undefined || input.definitionDigest === ''
                    ? {}
                    : { definitionDigest: input.definitionDigest }),
            },
            { trustedWorksRoot: worksRoot },
        );
        for (const diagnostic of outcome.diagnostics) {
            consoleOutput.error(`kk.daily.prepare.${diagnostic.code}: ${diagnostic.message}`);
        }
    } catch (error) {
        // §9: refuse to mutate results when the workspace cannot be bound to this run.
        failLoud('kk.daily.prepare.capture-failed', error);
    }
}

/**
 * `kk daily prepare --workflow <w> [--work-dir <dir>] [--run-date <stamp>] [--ledger-sync]` —
 * compose the run workspace and anchor it for the workflow's read chain.
 *
 * A dashed or digits-only `--run-date` names the workspace the same way (dashes stripped), so a
 * resumed run whose persisted `run_date` var already carries the digits-only `run-date.txt` value
 * re-derives the same directory. Writes `<work_dir>/run-date.txt`, the safety revise budget,
 * the `kk --version` stamp, `.spur/runs/<workflow>/work-dir.txt` (the cwd-relative anchor the
 * workflow's `file.read.into-var` node reads — shell actions cannot set vars) and voice1's
 * `10-ingest/*` source configs. It also names, on stderr, every other run still holding `selected`
 * rows for the workflow and the `kk store release --run <id>` that frees it (R7). `--ledger-sync`
 * additionally appends every finished run of the workflow that the ledger does not record yet; a
 * failed sync is a warning, never an aborted run.
 */
async function prepareAction(options: DailyPrepareOptions): Promise<void> {
    try {
        const dirDate = options.runDate ? options.runDate.replaceAll('-', '') : formatRunDate();
        const workDir = resolve(
            options.workDir || join(options.worksDir ?? resolveWorksDir(), options.workflow, dirDate),
        );
        for (const dir of DAILY_DIRS) mkdirSync(join(workDir, dir), { recursive: true });
        writeFileSync(join(workDir, 'run-date.txt'), `${dirDate}\n`);
        // The remediation budget belongs to the attempt, not to the day: a fresh run (or a
        // same-day retry) starts with the full revise allowance.
        writeFileSync(join(workDir, '.safety-revise-count'), '0\n');
        const anchorDir = join('.spur', 'runs', options.workflow);
        mkdirSync(anchorDir, { recursive: true });
        writeFileSync(join(anchorDir, 'work-dir.txt'), `${workDir}\n`);
        // Voice1's collect inputs: the flat workflow's prepare state still composes them here.
        writeFileSync(join(workDir, '10-ingest/source.json'), `${JSON.stringify({})}\n`);
        writeFileSync(join(workDir, '10-ingest/last30days.json'), `${JSON.stringify({})}\n`);
        writeFileSync(join(workDir, '10-ingest/horizon.json'), `${JSON.stringify({})}\n`);
        consoleOutput.write(JSON.stringify({ workDir, runDate: dirDate, workflow: options.workflow }));

        // §9: bind this run to its canonical workspace and sanitized settings BEFORE any result
        // producer runs. No `--run` flag (voice1 and direct callers) keeps the current behaviour.
        await captureForBoard(
            {
                workflow: options.workflow,
                run: options.run,
                definitionDigest: options.definitionDigest,
                setting: options.setting,
            },
            workDir,
            dirDate,
            options.worksDir ?? resolveWorksDir(),
        );

        // R7: name the earlier runs whose planned items are still held, before this run selects.
        await warnUnreleasedRuns(options.workflow);

        if (options.ledgerSync === true) {
            try {
                const { syncLedger } = await import('./ledger');
                await syncLedger({ workflow: options.workflow, worksDir: '.works', workDir });
            } catch (error) {
                // Reporting only: a ledger failure must never abort a run before it has started.
                consoleOutput.error(
                    `kk.daily.prepare.ledger-sync-failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    } catch (error) {
        failLoud('kk.daily.prepare.failed', error);
    }
}

/** One publish target as the per-target result files record it. */
type PublishTarget = Record<string, unknown>;

/** `targets[]` of a per-target result file, or `[]` when the file is missing/unparsable. */
function targetsOf(path: string): PublishTarget[] {
    if (!existsSync(path)) return [];
    const parsed = parseJson(readFileSync(path, 'utf-8')) as { targets?: unknown };
    return Array.isArray(parsed?.targets)
        ? (parsed.targets.filter((e) => e !== null && typeof e === 'object') as PublishTarget[])
        : [];
}

/**
 * `kk daily publish-classify --work-dir <dir> --run-date <stamp> [--fold-tail]` — the publish
 * fan-in: classify the sequenced surfdash → podcast outcomes into `full|partial|none`, write
 * `<date>_17_publish_result.json` + `_publish-status.txt` + `_completeness.json`, and print the
 * status line (exit 0 in all three — routing is the caller's).
 *
 * With `--fold-tail` it also runs the two tail states the flat workflow kept apart because only
 * the classifier knows the status: `daily-publish-partial` when the outcome is `partial`, and
 * `daily-patch-surfdash` whenever a surfdash post exists (cover + podcast cross-link patching,
 * CMS re-sync). Both are plugin-owned stages of the same names — this command only sequences them.
 */
async function publishClassifyAction(options: PublishClassifyOptions): Promise<void> {
    try {
        const { workDir, runDate } = options;
        const dir = join(workDir, '31-publish');
        const resultPath = join(dir, `${runDate}_17_publish_result.json`);
        const statusPath = join(dir, `${runDate}_17_publish_publish-status.txt`);
        // Both per-target files must exist: the pre-0133 `jq -s … || echo '[]'` chain could not read
        // a missing one (jq exits 2 after printing the slurped partial), which drove status to
        // `none`. Classifying over whichever file happens to exist would report `full` for a publish
        // that never dispatched — the failure masking this rule exists to prevent.
        const surfdash = join(dir, `${runDate}_14_publish-surfdash_result.json`);
        const podcast = join(dir, `${runDate}_16_publish-podcast_result.json`);
        const bothWritten = existsSync(surfdash) && existsSync(podcast);
        const targets = bothWritten ? [...targetsOf(surfdash), ...targetsOf(podcast)] : [];
        const okCount = targets.filter((entry) => entry.ok === true && entry.status === 'published').length;
        const total = targets.length;
        const status = okCount > 0 && okCount === total ? 'full' : okCount > 0 ? 'partial' : 'none';
        mkdirSync(dir, { recursive: true });
        writeFileSync(resultPath, `${JSON.stringify({ ok: okCount === total && total > 0, targets }, null, 2)}`);
        writeFileSync(statusPath, status);
        // The ledger's Result cell for the publish-classify node (task 0212 R1): `kk ledger append`
        // reads `<node>.summary.txt`, so cutover-check can compare target sets across ledgers.
        writeFileSync(
            join(workDir, 'publish-classify.summary.txt'),
            `${JSON.stringify({ status, published: okCount, targets: total })}\n`,
        );

        if (options.foldTail === true) {
            if (status === 'partial') {
                const code = runStage(['daily-publish-partial', workDir, runDate]);
                if (code !== 0) failLoud('kk.daily.publish-classify.partial-failed', new Error(`exit ${code}`));
            }
            const root = options.surfdashRoot ?? process.env.KK_SURFDASH_ROOT ?? '';
            if (status !== 'none' && root !== '') {
                const code = runStage(['daily-patch-surfdash', workDir, runDate, root, options.pluginsPath ?? '']);
                if (code !== 0) failLoud('kk.daily.publish-classify.patch-failed', new Error(`exit ${code}`));
            }
        }

        // 0220 R3: delegate completeness to the terminal stage after the folded tail
        runStage(['daily-publish-completeness', workDir, runDate]);
        const completenessPath = join(dir, `${runDate}_17_publish_completeness.json`);
        let missing: string[] = [];
        if (existsSync(completenessPath)) {
            try {
                const parsed = parseJson(readFileSync(completenessPath, 'utf-8')) as { missing?: unknown };
                if (Array.isArray(parsed?.missing)) {
                    missing = parsed.missing.filter((item): item is string => typeof item === 'string');
                }
            } catch {
                missing = [];
            }
        }
        consoleOutput.write(JSON.stringify({ status, published: okCount, targets: total, missing }));
    } catch (error) {
        if (error instanceof CommanderError) throw error;
        failLoud('kk.daily.publish-classify.failed', error);
    }
}

/**
 * Whether the summary beside a report is the empty-pool branch's `no-content` line. The two branches
 * disagree about what a report file means, so its existence alone is not a cache hit: a run whose
 * first attempt found an empty pool writes "no content" to `reportMd`, and a later attempt on the
 * same day with a real pool then served that stale body as its own report — the published run's
 * report, and the ledger's Result cell, claiming nothing was produced (2026-10-12, the 04:30 job's
 * empty-pool attempt followed by the operator's retry on the same `work_dir`). The success path
 * always rewrites the summary as `<n> items planned`, so the prefix is the discriminator.
 */
function reportIsNoContent(summary: string): boolean {
    if (!existsSync(summary)) return false;
    try {
        return readFileSync(summary, 'utf-8').startsWith('no-content:');
    } catch {
        return false;
    }
}

/**
 * Item count of a pool/candidates JSON: a `Doc[]` array, or an object carrying `metadata.docs`.
 * An absent, empty or differently shaped file counts as 0 — the caller's question is "is there a
 * pool to report on?", and `undefined` is reserved for the option simply not being given.
 */
function countItems(path: string | undefined): number | undefined {
    if (path === undefined) return undefined;
    if (!existsSync(path)) return 0;
    try {
        const parsed = parseJson(readFileSync(path, 'utf-8')) as unknown;
        if (Array.isArray(parsed)) return parsed.length;
        const docs = (parsed as { metadata?: { docs?: unknown } } | null)?.metadata?.docs;
        return Array.isArray(docs) ? docs.length : 0;
    } catch {
        return 0;
    }
}

/**
 * The `no-content` reason line, naming the refusal artifact that explains the empty candidates
 * when one exists (0266 R3): the post-spend duration refusal first (it is the later, more specific
 * fact), then the pre-spend floor refusal, then the pool/QC fallbacks. A missing or unparsable
 * artifact — or one without its numeric fields — falls through to today's lines unchanged.
 */
function noContentReason(workDir: string, runDate: string, poolCount: number | undefined): string {
    const fallback =
        poolCount === 0
            ? 'no-content: the store pool was empty (kk store extract found no unused items)'
            : 'no-content: content QC admitted zero of the pooled items';
    const readRefusal = (path: string): Record<string, number | string | string[] | null> | null => {
        if (!existsSync(path)) return null;
        try {
            const parsed = parseJson(readFileSync(path, 'utf-8')) as unknown;
            return parsed !== null && typeof parsed === 'object'
                ? (parsed as Record<string, number | string | string[] | null>)
                : null;
        } catch {
            return null;
        }
    };
    const num = (value: number | string | string[] | null | undefined): number | null =>
        typeof value === 'number' && Number.isFinite(value) ? value : null;
    const duration = readRefusal(join(workDir, '30-audio', `${runDate}_11_generate_content_duration-refusal.json`));
    const measured = num(duration?.measuredMinutes);
    const measuredEstimate = num(duration?.estimatedMinutes);
    const durationFloor = num(duration?.minMinutes);
    const keptCount = num(duration?.keptCount);
    if (measured !== null && measuredEstimate !== null && durationFloor !== null && keptCount !== null) {
        return `no-content: the episode ran ${measured} min (pre-spend estimate ${measuredEstimate} min), below the ${durationFloor} min floor — duration refusal after synthesis (pool ${poolCount ?? 0}, kept ${keptCount})`;
    }
    const floor = readRefusal(join(workDir, '21-plan', `${runDate}_04_quality-control-content_floor-refusal.json`));
    const estimated = num(floor?.estimatedMinutes);
    const minMinutes = num(floor?.minMinutes);
    const ids = Array.isArray(floor?.ids) ? (floor?.ids as string[]) : null;
    if (estimated !== null && minMinutes !== null && ids !== null) {
        return `no-content: a ${ids.length}-item pool estimated ${estimated} min of speech, below the ${minMinutes} min floor — pre-spend refusal (pool ${poolCount ?? 0}, kept ${ids.length})`;
    }
    return fallback;
}

/**
 * `kk daily run-report --work-dir <dir> --run-date <stamp> …` — assemble the per-run report from the
 * artifacts that exist, and record the pool outcome next to it.
 *
 * An empty store pool (or a pool that content-QC filtered to zero items) is not a failure: the run
 * report says so and `<work_dir>/run-report.summary.txt` carries the one-line `no-content` result
 * the ledger's Result cell reads. The report itself is `news-report-gen`'s output, invoked through
 * the same plugin-entry seam every other kk command uses.
 */
async function runReportAction(options: RunReportOptions): Promise<void> {
    try {
        const { workDir, runDate } = options;
        const reportMd = join(workDir, `${runDate}_19_run-report_report.md`);
        const summary = join(workDir, 'run-report.summary.txt');
        const poolCount = countItems(options.pool);
        const candidateCount = countItems(options.candidates);
        mkdirSync(workDir, { recursive: true });
        if (poolCount === 0 || candidateCount === 0) {
            const reason = noContentReason(workDir, runDate, poolCount);
            const body = `# Daily run ${runDate} — no content\n\n${reason}\n\nNo article, audio or publish\nartifact was produced; nothing was marked used.\n`;
            writeFileSync(reportMd, body);
            writeFileSync(summary, `${reason}\n`);
            consoleOutput.write(JSON.stringify({ runDate, noContent: true, reason, report: reportMd }));
            return;
        }
        if (existsSync(reportMd) && !reportIsNoContent(summary)) {
            consoleOutput.write(JSON.stringify({ runDate, noContent: false, report: reportMd, cached: true }));
            return;
        }
        if (candidateCount === undefined) {
            const reason = 'run-report: no candidates.json and no pool count — nothing to report';
            writeFileSync(summary, `${reason}\n`);
            consoleOutput.write(JSON.stringify({ runDate, noContent: true, reason, report: '' }));
            return;
        }
        const cands = join(workDir, '21-plan', `${runDate}_19_run-report_episode-plan.json`);
        const reportJson = join(workDir, `${runDate}_19_run-report_report.json`);
        mkdirSync(dirname(cands), { recursive: true });
        const candidates = options.candidates as string;
        const parsed = parseJson(readFileSync(candidates, 'utf-8')) as { metadata?: { docs?: unknown } };
        writeFileSync(cands, `${JSON.stringify((parsed.metadata?.docs ?? []) as unknown, null, 2)}`);
        // Plugin env paths must be absolute: plugins run with cwd = their package dir, so a relative
        // workDir silently misses every best-effort read.
        const absWorkDir = resolve(workDir);
        const env: Record<string, string> = {
            QC_MIN_QUALITY: options.qcMinQuality ?? '',
            QC_MIN_IMPORTANCE: options.qcMinImportance ?? '',
            QC_MIN_URGENCY: options.qcMinUrgency ?? '',
            QC_MIN_IMPACT: options.qcMinImpact ?? '',
            NEWS_REPORT_REJECTED_FILE: join(
                absWorkDir,
                '21-plan',
                `${runDate}_04_quality-control-content_candidates.rejected.json`,
            ),
            NEWS_REPORT_TIMING_FILE: join(absWorkDir, 'step-timing.json'),
            NEWS_REPORT_QC_FILE: join(absWorkDir, '30-audio', `${runDate}_11_generate_content.json`),
            NEWS_REPORT_PLAN_AUDIT_FILE: join(absWorkDir, '21-plan', `${runDate}_03_plan_plan.json.audit.json`),
            NEWS_REPORT_BLENDED_FILE: join(absWorkDir, '10-ingest', `${runDate}_02_collect_blended.json`),
            NEWS_REPORT_SCRIPT_FILE: join(absWorkDir, '24-script', `${runDate}_08_script_content.json`),
            NEWS_REPORT_DATE: runDate,
        };
        const previous = new Map<string, string | undefined>();
        for (const [key, value] of Object.entries(env)) {
            previous.set(key, process.env[key]);
            process.env[key] = value;
        }
        let code: number;
        try {
            code = await runInvoke({
                plugin: NEWS_REPORT_PLUGIN,
                inPath: cands,
                outPath: reportJson,
                ...(options.pluginsPath === undefined || options.pluginsPath === ''
                    ? {}
                    : { pluginsPath: [options.pluginsPath] }),
            });
        } finally {
            for (const [key, value] of previous) {
                if (value === undefined) delete process.env[key];
                else process.env[key] = value;
            }
        }
        if (code !== 0) throw new Error(`${NEWS_REPORT_PLUGIN} exited ${code}`);
        const parsedReport = parseJson(readFileSync(reportJson, 'utf-8')) as { body?: unknown };
        if (typeof parsedReport.body !== 'string') throw new Error(`${reportJson} has no string body`);
        writeFileSync(reportMd, parsedReport.body);
        writeFileSync(summary, `${candidateCount} items planned\n`);
        consoleOutput.write(JSON.stringify({ runDate, noContent: false, report: reportMd }));
    } catch (error) {
        if (error instanceof CommanderError) throw error;
        failLoud('kk.daily.run-report.failed', error);
    }
}

/**
 * Register the `daily` command group: the three deterministic daily steps a `kk-daily-ai-voice2`
 * DAG node needs as a single `kk` command (R7/AC4).
 */
export function registerDailyCommand(program: Command): void {
    const daily = program.command('daily').description('Run the daily AI-voice pipeline steps');

    daily
        .command('prepare')
        .description('Compose the run workspace, write its anchor files, and optionally sync the ledger')
        .requiredOption('--workflow <name>', 'Workflow the workspace and anchor belong to')
        .option('--work-dir <dir>', 'Explicit work dir (default: <works_dir>/<workflow>/<run-date>)')
        .option('--run-date <stamp>', 'Run date (dashed or digits; default: today, UTC-independent)')
        .option('--ledger-sync', 'Also append finished runs the workflow ledger is missing (warn-only on failure)')
        .option('--run <id>', 'Engine run id; its presence captures the run for the Board')
        .option('--definition-digest <digest>', 'Executed definition digest sha256:<64 hex> (Board capture)')
        .option(
            '--setting <key=value>',
            'Allowlisted effective setting (Board capture; repeatable)',
            collectSetting,
            [],
        )
        .action(prepareAction);

    daily
        .command('publish-classify')
        .description('Classify the publish outcomes full|partial|none and write the status artifact')
        .requiredOption('--work-dir <dir>', 'Run work dir')
        .requiredOption('--run-date <stamp>', 'Digits-only run-date stamp')
        .option('--fold-tail', 'Also run the partial record and the surfdash post-patch for this outcome')
        .option('--surfdash-root <dir>', 'Surfdash checkout the post-patch commits to')
        .option('--plugins-path <dir>', 'Additive plugin root for the tail stages')
        .action(publishClassifyAction);

    daily
        .command('run-report')
        .description('Assemble the run report; records no-content when the pool/QC produced nothing')
        .requiredOption('--work-dir <dir>', 'Run work dir')
        .requiredOption('--run-date <stamp>', 'Digits-only run-date stamp')
        .option('--plugins-path <dir>', 'Additive plugin root for the report generator')
        .option('--pool <path>', 'Pool Doc[] the run extracted (the no-content signal)')
        .option('--candidates <path>', 'QC candidates file (the report input)')
        .option('--qc-min-quality <n>', 'QC quality threshold forwarded to the report generator')
        .option('--qc-min-importance <n>', 'QC importance threshold forwarded to the report generator')
        .option('--qc-min-urgency <n>', 'QC urgency threshold forwarded to the report generator')
        .option('--qc-min-impact <n>', 'QC impact threshold forwarded to the report generator')
        .action(runReportAction);
}

/** Collect repeated `--setting key=value` values in order. */
function collectSetting(value: string, previous: string[]): string[] {
    return [...previous, value];
}
