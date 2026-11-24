/**
 * The in-binary launch supervisor (task 0365, ADR-053 §3, design `content-pipeline-consolidation` §3).
 *
 * One plain verb launches and supervises exactly one `spur workflow run` child. This module is that
 * supervisor: resolve → lock → preflight → receipt → spawn → cleanup. It is a port of
 * the retired daily-scheduler runner (kept running until 0369), minus the parts the design's
 * line map moves elsewhere (the generation inspection becomes `status`, the publish heuristics are
 * replaced by the separate `publish` verb).
 *
 * Every external effect goes through {@link LaunchDeps} so the four exit paths of the task's AC3 —
 * green, failed, timeout, interrupted — are provable without the real engine, a real store or a real
 * probe:
 *
 * | seam | effect |
 * | --- | --- |
 * | `spawn` | `spur workflow run`, `spur workflow cancel`, the dirty/divergence git+diff probes, the executor probe |
 * | `now` | the receipt's `startedAt`/`finishedAt` and the default `runId` |
 * | `fs` | the receipt, the run report, the probe working directory |
 * | `lock` | `<workflow>-<run>` single-flight (the same store DAO `kk lock acquire` calls, 0360) |
 * | `signals` | SIGINT/SIGTERM subscription |
 * | `recycleRun` / `ledgerSync` | the two `kk` cleanup steps the legacy supervisor spawned as children |
 */
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { RunCaptureInput, WorkflowName } from '@gobing-ai/kk-board/contracts';
import { openStore, resolveStorePath } from '@gobing-ai/kk-store';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import { setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { CaptureOutcome } from './board/capture';
import { captureRun, isSafeRunId, isSafeStamp, parseSetting } from './board/capture';
import { allowlistedKeys, WORKFLOW_NAMES } from './board/manifest';
import { syncLedger } from './commands/ledger';
import { resolveKkConfigPath } from './invoke';
import { consoleOutput } from './output';
import { findPackageRoot } from './package-root';
import { resolveBundlePath } from './publish-matrix';

/** Wall-clock deadline for one workflow child: 13 500 000 ms (3 h 45 m) — the legacy default. */
export const DEFAULT_TIMEOUT_MS = 13_500_000;

/** The shared publish workflow name: it owns no run directory of its own (design §4.3). */
export const PUBLISH_WORKFLOW = 'kk-publish';

/** Terminal and intermediate states a launch receipt can carry (design §3). */
export type LaunchStatus = 'running' | 'done' | 'no-content' | 'incomplete' | 'failed' | 'refused' | 'timeout';

/**
 * `schedule-receipt.json` (design §3) plus the three fields this port must carry:
 * `exitCode` (the verb's exit mapping — the legacy receipt carried it too, so receipts stay
 * comparable across the cut-over), `writerSkill` (0365 R4, design §2.2) and `dryRun` (0365 R9).
 */
export interface LaunchReceipt {
    schemaVersion: 1;
    workflow: string;
    type: string;
    run: string;
    runId: string;
    status: LaunchStatus;
    executor: string;
    checkoutCommit: string | null;
    startedAt: string;
    finishedAt?: string;
    workDir: string;
    window?: string;
    reason?: string;
    exitCode: number;
    writerSkill?: { dir: string; sha256: string };
    dryRun?: { workflowPath: string; vars: Record<string, string>; argv: string[]; chained?: PlannedLaunch[] };
}

/**
 * One launch a dry run planned but did not perform. A `publish --unattended --dry-run` plans the
 * `generate` it would run first, and reports it here instead of running it (R9).
 */
export interface PlannedLaunch {
    workflow: string;
    workflowPath: string;
    vars: Record<string, string>;
    argv: string[];
}

/** Outcome of one single-flight claim: held means another run owns the name. */
export interface LockClaim {
    acquired: boolean;
    holder?: string;
    detail?: string;
}

/** The `<workflow>-<run>` single-flight seam (0360 R7). */
export interface LaunchLockPort {
    acquire(name: string, run: string, ttlMs: number): Promise<LockClaim>;
    release(name: string, run: string): Promise<boolean>;
}

/** SIGINT/SIGTERM subscription seam; the returned function unsubscribes. */
export interface LaunchSignalPort {
    subscribe(handler: (signal: 'SIGINT' | 'SIGTERM') => void): () => void;
}

/** Every external effect the supervisor performs, injectable as a whole or field by field. */
export interface LaunchDeps {
    /** Engine seam: one buffered child per launch, plus cancel and the preflight probes. */
    spawn: ProcessExecutor;
    /** Clock for the receipt timestamps and the default run id. */
    now: () => Date;
    /** File seam for the receipt and the run report. */
    fs: FileSystem;
    /** `<workflow>-<run>` single-flight lock. */
    lock: LaunchLockPort;
    /** SIGINT/SIGTERM subscription. */
    signals: LaunchSignalPort;
    /** `kk store release`: return a failed run's selected rows to the pool. */
    recycleRun: (runId: string) => Promise<{ released: number }>;
    /** `kk ledger sync` for the launched workflow and run directory. */
    ledgerSync: (settings: { workflow: string; worksDir: string; workDir: string }) => Promise<void>;
    /**
     * Package root the running binary belongs to — the install side of the checkout-vs-install
     * divergence probe (R3). `null` means it cannot be established, which only warns.
     */
    installRoot: () => Promise<string | null>;
    /**
     * Board capture binding (task 0391): bind the attempt to its workspace through the shared
     * `captureRun` seam while the launch lock is held. Optional so legacy call sites and tests
     * stay hermetic; the default binds the real `captureRun` against this launch's works root
     * (the `kk daily prepare` posture). Callers only exercise it for Board workflows.
     */
    capture?: (input: RunCaptureInput) => Promise<CaptureOutcome>;
}

/** One supervised launch: the resolved run plus the posture flags of the launching verb. */
export interface LaunchWorkflowOptions {
    /** Content type this launch belongs to (`news`, `itc`, …) — receipt field only. */
    type: string;
    /** Resolved workflow name (`content_types.<type>.workflow`, or {@link PUBLISH_WORKFLOW}). */
    workflow: string;
    /** Absolute path of the workflow YAML handed to `spur workflow run`. */
    workflowPath: string;
    /** Run identifier: `<YYYYMMDD>` for a dated cadence, the slug for a topic cadence. */
    run: string;
    /** Absolute run directory (the receipt's `workDir`). */
    workDir: string;
    /** Works root that owns this workflow's ledger. */
    worksDir: string;
    /** Checkout the preflight dirty-tree and divergence checks read. */
    harnessRoot?: string;
    /** Skip the dirty-harness-path refusal (R3); the divergence and probe checks always run. */
    allowDirty?: boolean;
    /** Workflow variables (design §5); `work_dir`, the identity var, `run_id` and `agent` win over these. */
    vars?: Record<string, string>;
    /** Executor named on the receipt and probed before launch; `inline` probes role `scribe`. */
    agent?: string;
    /** Publish window, recorded on the receipt and passed as `window` (design §1.1). */
    window?: string;
    /** Deadline for the workflow child in ms ({@link DEFAULT_TIMEOUT_MS} when absent). */
    timeoutMs?: number;
    /** Resolved run id; defaults to `<workflow>-<run>-<epoch ms>`. */
    runId?: string;
    /** Steps 1 + 3 only: no lock, no write, no child; the planned argv is returned under `dryRun` (R9). */
    dryRun?: boolean;
    /** Writer-skill audit values recorded on the receipt (generate only, design §2.2). */
    writerSkill?: { dir: string; sha256: string };
    /** Refusal reasons the launching verb already established (e.g. a missing writer skill, R4). */
    preflightReasons?: string[];
    /**
     * Which workflow variable carries the run identity: `run_date`, `slug`, or `null` for a verb that
     * supplies both itself (`publish`). Defaults to `run_date` for `news`, `slug` otherwise.
     */
    identityVar?: 'run_date' | 'slug' | null;
    /** Receipt path; defaults to `<workDir>/schedule-receipt.json`. */
    receiptPath?: string;
    /** The `spur` binary (default `KK_SPUR_BIN`, then `spur` on PATH). */
    spurBin?: string;
    /** Field-level overrides over {@link createLaunchDeps}. */
    deps?: Partial<LaunchDeps>;
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');

const DETAIL_BUDGET = 240;

/**
 * The last two non-empty stderr lines (the port of the legacy `named` truncation), capped at 240
 * chars. A cut is marked with a leading `…`: an unmarked tail slice once turned the registry line
 * `…workflow.action.output` into a receipt that read `workflow failed: tput"}`, hiding the cause
 * (2026-11-18).
 */
function refusalDetail(stdout: string, stderr: string, exitCode: number | null): string {
    const text = `${stderr}${stdout}`.replace(ANSI_RE, '').trim();
    const named = text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .slice(-2)
        .join(' | ');
    const detail = named.length > DETAIL_BUDGET ? `…${named.slice(-(DETAIL_BUDGET - 1))}` : named;
    return detail !== '' ? detail : `exit ${exitCode ?? '?'}`;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function readOptional(fs: FileSystem, path: string): Promise<string | null> {
    try {
        if (!(await fs.exists(path))) return null;
        return (await fs.readFile(path)).trim();
    } catch {
        return null;
    }
}

async function writeReceipt(fs: FileSystem, path: string, receipt: LaunchReceipt): Promise<void> {
    await fs.ensureDir(dirname(path));
    await fs.writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
}

/** The commit the launch ran from (0360 R8): a stale job line must be visible in the receipt. */
async function readCheckoutCommit(deps: LaunchDeps, harnessRoot: string): Promise<string | null> {
    const result = await deps.spawn.run({
        command: 'git',
        args: ['-C', harnessRoot, 'rev-parse', 'HEAD'],
        timeout: 5_000,
    });
    const sha = result.stdout.trim();
    return result.exitCode === 0 && sha !== '' ? sha : null;
}

/** Dirty harness paths as full `git status --porcelain` lines (XY + path), or none when git refuses. */
async function harnessDirtyPaths(deps: LaunchDeps, harnessRoot: string): Promise<string[]> {
    const result = await deps.spawn.run({
        command: 'git',
        args: ['status', '--porcelain', '--', 'plugins/kk', '.spur/workflows'],
        cwd: harnessRoot,
        timeout: 10_000,
    });
    if (result.exitCode !== 0) return [];
    return result.stdout
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line !== '');
}

/**
 * Package root the running binary belongs to: walk up from the entry script
 * (`<pkg>/dist/index.js` → `<pkg>`, `<checkout>/apps/cli/src/index.ts` → `<checkout>`).
 *
 * A `command -v kk` probe would answer the same question on a shell PATH but not under a Bun
 * runtime, which reorders PATH for its children; the entry script is the runtime's own answer and
 * therefore deterministic.
 */
async function runningPackageRoot(fs: FileSystem): Promise<string | null> {
    const entry = process.argv[1];
    if (entry === undefined || entry.trim() === '') return null;
    return (await findPackageRoot(fs, dirname(resolve(entry)))) ?? null;
}

/** First five differences between two trees; `[]` whenever the probe cannot answer (never false-refuse). */
async function diffDirs(deps: LaunchDeps, checkout: string, install: string): Promise<string[]> {
    if (!(await deps.fs.exists(checkout)) || !(await deps.fs.exists(install))) return [];
    const diff = await deps.spawn.run({ command: 'diff', args: ['-rq', checkout, install], timeout: 20_000 });
    if (diff.exitCode === 0) return [];
    if (diff.exitCode !== 1) return [];
    return diff.stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => line.split(checkout).join('checkout').split(install).join('install'))
        .slice(0, 5);
}

/**
 * One minimal real agent round-trip. `spur agent doctor` reports `usable: true` for accounts whose
 * quota is exhausted (2026-11-09), so executor health is proven with traffic, not a probe (0360 R5).
 */
async function executorProbe(
    deps: LaunchDeps,
    spurBin: string,
    target: string,
): Promise<{ ok: boolean; detail: string }> {
    const probeCwd = join(tmpdir(), `kk-preflight-${process.pid}-${deps.now().getTime()}`);
    await deps.fs.ensureDir(probeCwd);
    try {
        const probe = await deps.spawn.run({
            command: spurBin,
            args: ['agent', 'run', '--agent', target, '--mode', 'text', '--json', 'Reply with exactly: OK'],
            cwd: probeCwd,
            timeout: 120_000,
        });
        if (probe.exitCode === 0) return { ok: true, detail: 'ok' };
        return { ok: false, detail: refusalDetail(probe.stdout, probe.stderr, probe.exitCode) };
    } finally {
        try {
            await deps.fs.deleteFile(probeCwd);
        } catch {
            // A probe scratch directory that outlives a refused preflight is noise, not a refusal.
        }
    }
}

interface PreflightOutcome {
    reasons: string[];
    warnings: string[];
}

/** Step 3: dirty harness paths, checkout-vs-install divergence, and the executor probe (R3). */
async function runPreflight(
    deps: LaunchDeps,
    context: {
        agent: string;
        allowDirty: boolean;
        harnessRoot: string;
        spurBin: string;
        reasons?: string[];
    },
): Promise<PreflightOutcome> {
    const reasons = [...(context.reasons ?? [])];
    const warnings: string[] = [];
    if (!context.allowDirty) {
        const dirty = await harnessDirtyPaths(deps, context.harnessRoot);
        if (dirty.length > 0) {
            reasons.push(
                `working tree dirty on harness paths (git status --porcelain):\n  ${dirty.slice(0, 10).join('\n  ')}`,
            );
        }
    }
    const install = await deps.installRoot();
    if (install === null) {
        warnings.push('running package root not found; executed-vs-installed sync not checked');
    } else {
        const diffs = [
            ...(await diffDirs(
                deps,
                join(context.harnessRoot, 'plugins', 'kk', 'workflows'),
                join(install, 'plugins', 'kk', 'workflows'),
            )),
            ...(await diffDirs(
                deps,
                join(context.harnessRoot, 'plugins', 'kk', 'scripts'),
                join(install, 'plugins', 'kk', 'scripts'),
            )),
        ];
        if (diffs.length > 0) {
            // The fix is a one-liner and the bare list of differing files does not say it. In a
            // worktree the stale side is usually the bundled copy (`apps/cli/plugins`, gitignored and
            // produced by `scripts/bundle-plugins.ts`); outside one it is the install, refreshed by
            // reinstalling the package.
            reasons.push(
                `checkout diverges from installed kk (${install}): ${diffs.join('; ')} — refresh the stale side: \`bun scripts/bundle-plugins.ts\` in a checkout, or reinstall the package when the install is behind`,
            );
        }
    }
    // The default posture (agent: inline) is proven through the probe node's own role.
    const target = context.agent === 'inline' ? 'scribe' : context.agent;
    const probe = await executorProbe(deps, context.spurBin, target);
    if (!probe.ok) reasons.push(`executor probe failed for '${target}': ${probe.detail}`);
    return { reasons, warnings };
}

/** The `spur workflow run` argv: one child, one `--vars` set, run id pinned (design §3.1 lines 213–293). */
function workflowArgv(workflowPath: string, runId: string, vars: Record<string, string>): string[] {
    return ['--no-logo', 'workflow', 'run', workflowPath, '--run-id', runId, '--vars', JSON.stringify(vars), '--quiet'];
}

/** The workflow variables: the run identity, the run id and the executor, then the verb's own set. */
function launchVars(
    options: LaunchWorkflowOptions,
    runId: string,
    agent: string | undefined,
    identityVar: 'run_date' | 'slug' | null,
): Record<string, string> {
    const vars: Record<string, string> = { work_dir: options.workDir };
    if (identityVar !== null) vars[identityVar] = options.run;
    vars.run_id = runId;
    if (agent !== undefined) vars.agent = agent;
    if (options.window !== undefined && options.window !== '') vars.window = options.window;
    return { ...vars, ...(options.vars ?? {}) };
}

/**
 * Store-backed single-flight lock: the same DAO calls the `kk lock acquire` action makes (0360 R7),
 * so the in-binary launcher and the legacy script exclude each other on the same name.
 */
export function storeLockPort(): LaunchLockPort {
    const database = (): Promise<string> => resolveStorePath(resolveKkConfigPath());
    return {
        async acquire(name, run, ttlMs): Promise<LockClaim> {
            const store = await openStore({ path: await database() });
            try {
                if (await store.locks.acquire(name, run, ttlMs)) return { acquired: true };
                const holder = await store.locks.current(name);
                return holder?.ownerRun === undefined
                    ? { acquired: false }
                    : { acquired: false, holder: holder.ownerRun };
            } finally {
                await store.close();
            }
        },
        async release(name, run): Promise<boolean> {
            const store = await openStore({ path: await database() });
            try {
                return await store.locks.release(name, run);
            } finally {
                await store.close();
            }
        },
    };
}

/** `kk store release` in process: drop the run's `selected` rows so its items re-enter the pool. */
function storeRecycle(): (runId: string) => Promise<{ released: number }> {
    return async (runId) => {
        const store = await openStore({ path: await resolveStorePath(resolveKkConfigPath()) });
        try {
            let released = 0;
            const topics = new Set(
                (await store.selections.listByRun(runId))
                    .filter((row) => row.status === 'selected')
                    .map((row) => row.topic),
            );
            for (const topic of topics) {
                released += await store.selections.updateStatus(runId, topic, 'dropped');
            }
            return { released };
        } finally {
            await store.close();
        }
    };
}

/** SIGINT/SIGTERM subscription on the real process. */
function processSignals(): LaunchSignalPort {
    return {
        subscribe(handler) {
            const onInt = (): void => handler('SIGINT');
            const onTerm = (): void => handler('SIGTERM');
            process.once('SIGINT', onInt);
            process.once('SIGTERM', onTerm);
            return () => {
                process.removeListener('SIGINT', onInt);
                process.removeListener('SIGTERM', onTerm);
            };
        },
    };
}

/** Wire the real seams: node process executor, wall clock, node file system, store lock and cleanup. */
export function createLaunchDeps(): LaunchDeps {
    return {
        spawn: new NodeProcessExecutor(),
        now: () => new Date(),
        fs: createNodeFileSystem(),
        lock: storeLockPort(),
        signals: processSignals(),
        recycleRun: storeRecycle(),
        // The ledger command prints its own JSON line; the launching verb owns stdout, so the
        // cleanup step runs with the output seam silenced (same pattern as `new`'s itc-prepare).
        installRoot: async () => runningPackageRoot(createNodeFileSystem()),
        ledgerSync: async (settings) => {
            const restore = setDefaultOutputTargets({ stdout: { write() {} }, stderr: { write() {} } });
            try {
                await syncLedger(settings);
            } finally {
                restore();
            }
        },
    };
}

/**
 * Supervise one workflow launch and return its receipt (design §3 steps 1–6).
 *
 * Steps: resolve (done by the caller, `resolveRun`) → lock → preflight → running receipt → one
 * `spur workflow run` child → cleanup (`spur workflow cancel` when the child is not green,
 * `kk store release`, `kk ledger sync`, lock release, final receipt). The lock is released on every
 * path, including a throw from inside the cleanup body. A lost lock writes no receipt at all, so the
 * holder's receipt stays byte-identical (R2).
 *
 * `--dry-run` runs the preflight only: it takes no lock, writes nothing, and returns the step-4
 * receipt (status `running`) with the planned argv under `dryRun` (R9).
 */
/** The capture binding result: an optional refusal reason plus bounded receipt notes. */
interface BoardCaptureResult {
    refusal?: string;
    notes: string[];
}

/**
 * Bind the launching attempt to its run workspace through the shared `captureRun` seam (task 0391,
 * legacy capture authorization model): revocation of a previous owner's marker, the trust check of
 * the workspace against this project's works root, and the record/marker write — all while the
 * launch lock is held and BEFORE the running receipt or the child spawn, so a workspace is never
 * mutated by a run the Board cannot bind.
 *
 * `kk-publish` owns no run workspace and is never captured. An unsafe capture identity (an
 * article slug outside the capture alphabet, say) SKIPS the binding with a receipt note rather
 * than refusing a launch the verb itself admitted. A refused revocation or a workspace-shape
 * throw REFUSES the launch (exit 5) before any mutation; the optional record write after a
 * successful revocation only warns (the capture seam's own contract) and never blocks.
 */
async function captureForLaunch(
    capture: (input: RunCaptureInput) => Promise<CaptureOutcome>,
    options: LaunchWorkflowOptions,
    runId: string,
    vars: Record<string, string>,
): Promise<BoardCaptureResult> {
    if (!WORKFLOW_NAMES.includes(options.workflow as WorkflowName)) return { notes: [] };
    if (!isSafeRunId(runId) || !isSafeStamp(options.run)) {
        return {
            notes: [`board capture skipped: run id or stamp is outside the capture alphabet for run '${runId}'`],
        };
    }
    // The settings snapshot is the launch's effective vars intersected with the workflow's
    // allowlist — never free text. A var whose value the capture rule rejects (a duration spelled
    // oddly, say) is simply not snapshotted; the reader reports the gap via `unavailableKeys`.
    const settings: Record<string, string> = {};
    for (const key of allowlistedKeys(options.workflow as WorkflowName)) {
        const value = vars[key];
        if (value === undefined) continue;
        try {
            const parsed = parseSetting(options.workflow as WorkflowName, `${key}=${value}`);
            if (parsed !== null) settings[parsed.key] = parsed.value;
        } catch {
            // not snapshot-able under the capture rules — skip the key, keep launching
        }
    }
    try {
        const outcome = await capture({
            workflow: options.workflow as WorkflowName,
            runId,
            workDir: options.workDir,
            stamp: options.run,
            settings,
        });
        const notes = outcome.diagnostics.map((diagnostic) => `board capture: ${diagnostic.message}`);
        if (!outcome.captured) {
            notes.push('board capture: the attempt record was not written; the Board serves it uncaptured');
        }
        return { notes };
    } catch (error) {
        return { refusal: `board capture refused: ${errorText(error)}`, notes: [] };
    }
}

/**
 * Launch one workflow attempt end-to-end (design §3): preflight, store lock, board capture
 * binding, spawn of `spur workflow run` and the running/terminal receipt. A refusal before spawn
 * still writes a `refused` receipt — except a held lock, where the holder's receipt stays
 * byte-identical; lock release runs in `finally` even when a cleanup step throws.
 */
export async function launchWorkflow(options: LaunchWorkflowOptions): Promise<LaunchReceipt> {
    const deps: LaunchDeps = { ...createLaunchDeps(), ...options.deps };
    // Default capture binding files under this launch's works root — the same posture as
    // `kk daily prepare`'s captureForBoard. An injected seam keeps every test hermetic.
    const capture =
        deps.capture ?? ((input: RunCaptureInput) => captureRun(input, { trustedWorksRoot: options.worksDir }));
    const now = deps.now();
    const startedAt = now.toISOString();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const runId = options.runId ?? `${options.workflow}-${options.run}-${now.getTime()}`;
    const agent = options.agent !== undefined && options.agent.trim() !== '' ? options.agent.trim() : undefined;
    const executor = agent ?? 'inline';
    const harnessRoot = options.harnessRoot ?? process.cwd();
    const spurBin = options.spurBin ?? process.env.KK_SPUR_BIN ?? 'spur';
    const receiptPath = options.receiptPath ?? join(options.workDir, 'schedule-receipt.json');
    const identityVar =
        options.identityVar === undefined ? (options.type === 'news' ? 'run_date' : 'slug') : options.identityVar;
    const vars = launchVars(options, runId, agent, identityVar);
    const argv = workflowArgv(options.workflowPath, runId, vars);
    const checkoutCommit = await readCheckoutCommit(deps, harnessRoot);
    const base = {
        schemaVersion: 1 as const,
        workflow: options.workflow,
        type: options.type,
        run: options.run,
        runId,
        executor,
        checkoutCommit,
        startedAt,
        workDir: options.workDir,
        ...(options.window === undefined ? {} : { window: options.window }),
        ...(options.writerSkill === undefined ? {} : { writerSkill: options.writerSkill }),
    };

    const preflight = (): Promise<PreflightOutcome> =>
        runPreflight(deps, {
            agent: executor,
            allowDirty: options.allowDirty === true,
            harnessRoot,
            spurBin,
            ...(options.preflightReasons === undefined ? {} : { reasons: options.preflightReasons }),
        });

    if (options.dryRun === true) {
        const planned = await preflight();
        for (const warning of planned.warnings) consoleOutput.error(`  ~ ${warning}`);
        if (planned.reasons.length > 0) {
            consoleOutput.error(`${options.workflow} ${options.run} launch refused`);
            for (const reason of planned.reasons) consoleOutput.error(`  ! ${reason}`);
            return { ...base, status: 'refused', exitCode: 5, reason: planned.reasons[0] ?? 'preflight refused' };
        }
        return { ...base, status: 'running', exitCode: 0, dryRun: { workflowPath: options.workflowPath, vars, argv } };
    }

    const lockName = `${options.workflow}-${options.run}`;
    const claim = await deps.lock.acquire(lockName, runId, timeoutMs);
    if (!claim.acquired) {
        consoleOutput.error(`${options.workflow} ${options.run} already running (holder ${claim.holder ?? 'unknown'})`);
        if (claim.detail !== undefined) consoleOutput.error(`  ! ${claim.detail}`);
        // No receipt write: this launch owns nothing, and the holder's receipt must stay byte-identical.
        return { ...base, status: 'refused', exitCode: 6, reason: `lock held by ${claim.holder ?? 'unknown'}` };
    }

    let lockHeld = true;
    const notes: string[] = [];
    const releaseLock = async (): Promise<void> => {
        if (!lockHeld) return;
        lockHeld = false;
        try {
            await deps.lock.release(lockName, runId);
        } catch (error) {
            // A lost lock release never overrides the launch outcome; the TTL covers it.
            notes.push(`lock release failed: ${errorText(error)}`);
            consoleOutput.error(`  ! lock release failed: ${errorText(error)}`);
        }
    };

    let unsubscribe: (() => void) | undefined;
    try {
        const refusal = await preflight();
        if (refusal.reasons.length > 0) {
            const refused: LaunchReceipt = {
                ...base,
                status: 'refused',
                exitCode: 5,
                finishedAt: deps.now().toISOString(),
                reason: refusal.reasons[0] ?? 'preflight refused',
            };
            await writeReceipt(deps.fs, receiptPath, refused);
            consoleOutput.error(`${options.workflow} ${options.run} launch refused run ${runId}`);
            for (const reason of refusal.reasons) consoleOutput.error(`  ! ${reason}`);
            for (const warning of refusal.warnings) consoleOutput.error(`  ~ ${warning}`);
            return refused;
        }
        for (const warning of refusal.warnings) consoleOutput.error(`  ~ ${warning}`);

        // Board capture binding (task 0391) runs while the lock is held, before the running
        // receipt: a refused binding refuses the launch before anything is written; notes ride
        // the terminal receipt.
        const bound = await captureForLaunch(capture, options, runId, vars);
        if (bound.refusal !== undefined) {
            // Same fold as the terminal receipt: refusal first, any earlier note after it.
            const refused: LaunchReceipt = {
                ...base,
                status: 'refused',
                exitCode: 5,
                finishedAt: deps.now().toISOString(),
                reason: [bound.refusal, ...notes].filter((part) => part !== undefined).join('; '),
            };
            await writeReceipt(deps.fs, receiptPath, refused);
            consoleOutput.error(`${options.workflow} ${options.run} launch refused run ${runId}`);
            consoleOutput.error(`  ! ${bound.refusal}`);
            return refused;
        }
        notes.push(...bound.notes);

        await writeReceipt(deps.fs, receiptPath, { ...base, status: 'running', exitCode: 1 });

        let interrupted = false;
        const controller = new AbortController();
        // Installed for the whole run — through cleanup, lock release and the terminal receipt — so a
        // signal in that window cannot take the default disposition and strand the lock for its TTL
        // with the receipt still `running` (the ported daily-scheduler posture).
        unsubscribe = deps.signals.subscribe((signal) => {
            interrupted = true;
            consoleOutput.error(`  ! ${signal} received; stopping run ${runId}`);
            controller.abort();
        });
        const result: ProcessResult = await deps.spawn.run({
            command: spurBin,
            args: argv,
            timeout: timeoutMs,
            signal: controller.signal,
            label: `${options.workflow} ${options.run}`,
        });

        const timedOut = !interrupted && result.outcome === 'timeout';
        const spawnFailed = result.outcome === 'error';
        let status: LaunchStatus = interrupted || spawnFailed ? 'failed' : timedOut ? 'timeout' : 'failed';
        if (!interrupted && !timedOut && !spawnFailed && result.exitCode === 0) {
            const summary = await readOptional(deps.fs, join(options.workDir, 'run-report.summary.txt'));
            status = summary?.startsWith('no-content:') === true ? 'no-content' : 'done';
        }
        const exitCode =
            status === 'done' || status === 'no-content'
                ? 0
                : interrupted
                  ? 143
                  : timedOut
                    ? 124
                    : result.exitCode === null || result.exitCode === 0
                      ? 1
                      : result.exitCode;
        const failureReason =
            status === 'done' || status === 'no-content'
                ? undefined
                : interrupted
                  ? 'launch interrupted by a signal'
                  : timedOut
                    ? `workflow exceeded --timeout-ms ${timeoutMs}`
                    : `workflow ${status === 'failed' ? 'failed' : 'ended'}: ${refusalDetail(result.stdout, result.stderr, result.exitCode)}`;

        // Cleanup (design §3.1 lines 294–423): each step is isolated so one failure cannot skip the
        // next, and the lock release in `finally` still runs when all three throw.
        if (status === 'failed' || status === 'timeout') {
            // The generation workflow starts the safety review as a nested run named `<runId>-safety`
            // (design §5.1 nodes 12/19), and a failed parent leaves it running: cancel both, the
            // nested one best-effort because most workflows never create it.
            for (const target of [runId, `${runId}-safety`]) {
                const cancel = await deps.spawn
                    .run({ command: spurBin, args: ['workflow', 'cancel', target, '--json'], timeout: 20_000 })
                    .catch((error: unknown) => {
                        notes.push(`workflow cancel ${target} failed: ${errorText(error)}`);
                        return null;
                    });
                const missing = target !== runId && cancel !== null && cancel.exitCode !== 0;
                if (cancel !== null && cancel.exitCode !== 0 && !missing) {
                    notes.push(`workflow cancel ${target} exited ${cancel.exitCode ?? '?'}`);
                }
            }
        }
        // Only a launch that cannot have sent anything recycles reservations: `kk-publish` sends, and a
        // send may have landed, so its rows are `publish-settle`'s to reconcile (design §5.3 node 8).
        // A green generate that froze no bundle is the same case — nothing a later publish window could
        // settle. 2026-11-13 finished `done` with the duration gate refusing, and its 13 selected rows
        // kept 20 of the next day's 26 moderated stories out of every pool.
        const greenWithBundle =
            status === 'done' && (await deps.fs.exists(await resolveBundlePath(deps.fs, options.workDir)));
        // A `no-content` generate recycles too (0393 R2): a late floor/duration refusal lands AFTER
        // store-select reserved the pool, and an early empty pool reserved nothing (a no-op release).
        if (options.workflow !== PUBLISH_WORKFLOW && !greenWithBundle) {
            try {
                await deps.recycleRun(runId);
            } catch (error) {
                notes.push(`store release failed: ${errorText(error)}`);
            }
        }
        try {
            await deps.ledgerSync({ workflow: options.workflow, worksDir: options.worksDir, workDir: options.workDir });
        } catch (error) {
            notes.push(`ledger sync failed: ${errorText(error)}`);
        }

        const receipt: LaunchReceipt = {
            ...base,
            status,
            exitCode,
            finishedAt: deps.now().toISOString(),
            ...(failureReason === undefined && notes.length === 0
                ? {}
                : { reason: [failureReason, ...notes].filter((part) => part !== undefined).join('; ') }),
        };
        await writeReceipt(deps.fs, receiptPath, receipt);
        return receipt;
    } finally {
        // The signal handler outlives cleanup; it is dropped only once the terminal receipt is out.
        unsubscribe?.();
        await releaseLock();
    }
}
