import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    appendLedger,
    assertBudget,
    type ColabGpu,
    DEFAULT_MAX_MONTHLY_CCU,
    estimateCcu,
    readRolling30d,
} from './ccu-ledger';
import type { RunProcess } from './process';

/**
 * `google-colab-cli` batch runner (0451 R1/R2).
 *
 * argv frozen from the step-0 spike (`colab --help`, `colab run --help`, verified 2026-11-27):
 * `colab run SCRIPT --gpu <T4|L4|G4|H100|A100> --session NAME --keep --timeout SECONDS
 * --env KEY=VALUE …`. `run` releases the VM on its own, but `--keep` is what makes the CLI's own
 * transfer verb usable (`colab download REMOTE LOCAL --session NAME`), so the session is always
 * stopped in `finally` — success, failure or local kill (R1: no session may outlive a job).
 */

/** Job kinds this runner can dispatch (0452 adds the avatar workers). */
export type ColabJobType = 'wan21-i2v' | 'musetalk' | 'echomimic-v2';

/** One GPU job. */
export interface ColabJob {
    jobType: ColabJobType;
    gpu: ColabGpu;
    /** Local path of the worker script that is uploaded and executed. */
    script: string;
    /** Remote output file names the worker writes under `remoteDir`. */
    outputNames: string[];
    /** Remote directory the worker writes into. */
    remoteDir: string;
    /** Absolute episode run date, used in the session name. */
    runDate: string;
    /** Hard local cap; the CLI also gets `--timeout` and the seam kills the group at this + 60s. */
    timeoutMs: number;
    /** Extra `--env KEY=VALUE` pairs (the cache dir is added by the runner). */
    env?: Record<string, string>;
}

/** Outcome of one job; `ok:false` never throws — the caller falls back (R5). */
export interface ColabJobResult {
    ok: boolean;
    outputs: string[];
    durationSec: number;
    cache: 'drive' | 'local';
    estimatedCcu: number;
    error?: string;
}

/** Everything the runner touches that a test can replace. */
export interface ColabDeps {
    runProcess: RunProcess;
    fs: FileSystem;
    /** `<works_dir>/colab-ccu-ledger.jsonl`. */
    ledgerPath: string;
    /** Local directory downloaded outputs land in. */
    outputDir: string;
    /** Cache directory handed to the worker (Drive path by default). */
    cacheDir?: string;
    maxMonthlyCcu?: number;
    /** Extra wall-clock allowance on top of `timeoutMs` before the group is killed. */
    killGraceMs?: number;
    now?: () => number;
}

/** Default Drive cache path inside a Colab VM (R2). */
export const DEFAULT_COLAB_CACHE_DIR = '/content/drive/MyDrive/kk-video-cache';
/** Local allowance on top of the job deadline before the process group is killed (R1). */
export const LOCAL_KILL_GRACE_MS = 60_000;
/** Marker the worker prints on its last line with its JSON result. */
export const WORKER_RESULT_MARKER = 'KK_COLAB_RESULT ';

/** `kk-video-<runDate>-<jobType>` (R1). */
export function sessionName(job: ColabJob): string {
    return `kk-video-${job.runDate}-${job.jobType}`;
}

/** The frozen `colab run` argv (R1). */
export function buildColabArgv(job: ColabJob, cacheDir: string = DEFAULT_COLAB_CACHE_DIR): string[] {
    const env: Record<string, string> = { KK_COLAB_CACHE_DIR: cacheDir, ...(job.env ?? {}) };
    const envFlags = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    return [
        process.env.KK_COLAB_BIN ?? 'colab',
        'run',
        job.script,
        '--gpu',
        job.gpu,
        '--session',
        sessionName(job),
        '--keep',
        // The CLI's own timeout is an inactivity timeout; it is seconds, and 0 means unlimited.
        '--timeout',
        String(Math.max(1, Math.round(job.timeoutMs / 1000))),
        ...envFlags,
    ];
}

/** The download argv for one output (the CLI's own transfer verb). */
export function buildDownloadArgv(session: string, remotePath: string, localPath: string): string[] {
    return [process.env.KK_COLAB_BIN ?? 'colab', 'download', remotePath, localPath, '--session', session];
}

/** The teardown argv. */
export function buildStopArgv(session: string): string[] {
    return [process.env.KK_COLAB_BIN ?? 'colab', 'stop', '--session', session];
}

/** Parse the worker's `KK_COLAB_RESULT {json}` line; a silent worker reports no result. */
export function parseWorkerResult(stdout: string): { cache: 'drive' | 'local'; outputs?: string[] } | null {
    for (const line of stdout.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith(WORKER_RESULT_MARKER)) continue;
        try {
            const parsed = JSON.parse(trimmed.slice(WORKER_RESULT_MARKER.length)) as Record<string, unknown>;
            const cache = parsed.cache === 'drive' ? 'drive' : 'local';
            const outputs = Array.isArray(parsed.outputs)
                ? parsed.outputs.filter((entry): entry is string => typeof entry === 'string')
                : undefined;
            return outputs === undefined ? { cache } : { cache, outputs };
        } catch {
            return null;
        }
    }
    return null;
}

function bounded(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * Run one GPU job: budget check → `colab run` → download each output → stop the session → ledger.
 * Every failure mode returns `ok:false` with a cause the caller turns into a fallback warning.
 */
export async function runColabJob(job: ColabJob, deps: ColabDeps): Promise<ColabJobResult> {
    const now = deps.now ?? Date.now;
    const cacheDir = deps.cacheDir ?? DEFAULT_COLAB_CACHE_DIR;
    const maxMonthlyCcu = deps.maxMonthlyCcu ?? DEFAULT_MAX_MONTHLY_CCU;
    const plannedCcu = estimateCcu(job.gpu, job.timeoutMs / 1000);
    const rolling = await readRolling30d(deps.ledgerPath, now(), deps.fs);
    const budget = assertBudget({ rollingCcu: rolling.totalCcu, projectedCcu: plannedCcu, maxMonthlyCcu });
    if ('error' in budget) {
        // A budget refusal is not a job: nothing launches, nothing is billed.
        return { ok: false, outputs: [], durationSec: 0, cache: 'local', estimatedCcu: 0, error: budget.error };
    }

    const session = sessionName(job);
    const startedAt = now();
    let outputs: string[] = [];
    let cache: 'drive' | 'local' = 'local';
    let error: string | undefined;
    let status: 'ok' | 'failed' | 'timeout' = 'failed';

    try {
        const result = await deps.runProcess(buildColabArgv(job, cacheDir), {
            timeoutMs: job.timeoutMs + (deps.killGraceMs ?? LOCAL_KILL_GRACE_MS),
        });
        if (result.code !== 0) {
            error = `colab run failed (exit ${result.code}): ${bounded(result.stderr) || 'no stderr'}`;
        } else {
            const worker = parseWorkerResult(result.stdout);
            if (worker === null) {
                error = 'colab worker produced no KK_COLAB_RESULT line';
            } else {
                cache = worker.cache;
                const downloaded: string[] = [];
                for (const name of job.outputNames) {
                    const localPath = join(deps.outputDir, name);
                    const download = await deps.runProcess(
                        buildDownloadArgv(session, join(job.remoteDir, name), localPath),
                        { timeoutMs: 120_000 },
                    );
                    if (download.code !== 0) {
                        error = `colab download of ${name} failed (exit ${download.code}): ${bounded(download.stderr) || 'no stderr'}`;
                        break;
                    }
                    downloaded.push(localPath);
                }
                if (error === undefined && downloaded.length !== job.outputNames.length) {
                    error = `colab produced ${downloaded.length}/${job.outputNames.length} outputs`;
                }
                if (error === undefined) {
                    outputs = downloaded;
                    status = 'ok';
                }
            }
        }
    } catch (thrown: unknown) {
        error = `colab run threw: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
        status = /timeout/i.test(error) ? 'timeout' : 'failed';
    } finally {
        // Teardown is unconditional: a kept session must never outlive the job (R1).
        await deps.runProcess(buildStopArgv(session), { timeoutMs: 60_000 }).catch(() => undefined);
    }

    const durationSec = Number(((now() - startedAt) / 1000).toFixed(2));
    const estimatedCcu = estimateCcu(job.gpu, durationSec);
    await appendLedger(
        deps.ledgerPath,
        {
            timestamp: new Date(now()).toISOString(),
            gpu: job.gpu,
            durationSec,
            estimatedCcu,
            jobType: job.jobType,
            status,
        },
        deps.fs,
    );

    return {
        ok: status === 'ok',
        outputs,
        durationSec,
        cache,
        estimatedCcu,
        ...(error === undefined ? {} : { error }),
    };
}
