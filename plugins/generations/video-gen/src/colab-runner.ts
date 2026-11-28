import { extname, join } from 'node:path';
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
 * Create the session before inference so local media can be uploaded to the fresh VM.
 */

/** Job kinds this runner can dispatch (0452 adds the avatar workers). */
export type ColabJobType = 'wan21-i2v' | 'musetalk' | 'echomimic-v2';

/** One GPU job. */
export interface ColabJob {
    jobType: ColabJobType;
    gpu: ColabGpu;
    /** Local path of the worker script that is uploaded and executed. */
    script: string;
    /** Local media, ordered as stills for Wan or portrait then audio for a presenter. */
    inputPaths: string[];
    /** Local output file names. */
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
/** Cap for `colab new`: a live A100 allocation took 2m45s, so the 120s per-stage cap is too short. */
export const COLAB_ALLOCATE_TIMEOUT_MS = 600_000;
const STAGE_TIMEOUT_MS = 120_000;

/** A distinct session for each attempt, including retries for the same date and provider. */
export function sessionName(job: ColabJob): string {
    return `kk-video-${job.runDate}-${job.jobType}-${crypto.randomUUID()}`;
}

/** Execute the local worker in the session where the media has been staged. */
export function buildColabArgv(job: ColabJob, session: string, cacheDir: string = DEFAULT_COLAB_CACHE_DIR): string[] {
    const inputs = job.inputPaths.map((path, index) => `/content/kk-input-${index}${extname(path)}`);
    const scriptArgs =
        job.jobType === 'wan21-i2v'
            ? ['--images', ...inputs, '--out-dir', job.remoteDir]
            : ['--portrait', inputs[0], '--audio', inputs[1], '--out', join(job.remoteDir, 'presenter.mp4')];
    const env = {
        KK_COLAB_CACHE_DIR: cacheDir,
        ...job.env,
        KK_COLAB_ARGS: JSON.stringify(scriptArgs),
    };
    const envFlags = Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    return [
        process.env.KK_COLAB_BIN ?? 'colab',
        'exec',
        '--file',
        job.script,
        '--session',
        session,
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
 * Run one GPU job: budget check → create → upload → execute → download → stop → ledger.
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
    const deadline = startedAt + job.timeoutMs + (deps.killGraceMs ?? LOCAL_KILL_GRACE_MS);
    const remaining = (): number => {
        const timeoutMs = deadline - now();
        if (timeoutMs <= 0) throw new Error('colab job timed out');
        return timeoutMs;
    };
    let outputs: string[] = [];
    let cache: 'drive' | 'local' = 'local';
    let error: string | undefined;
    let status: 'ok' | 'failed' | 'timeout' = 'failed';

    try {
        const cli = process.env.KK_COLAB_BIN ?? 'colab';
        const stage = async (argv: string[], capMs: number = STAGE_TIMEOUT_MS): Promise<void> => {
            const result = await deps.runProcess(argv, { timeoutMs: Math.min(capMs, remaining()) });
            if (result.code !== 0) {
                throw new Error(
                    `colab ${argv[1]} failed (exit ${result.code}): ${bounded(result.stderr) || 'no stderr'}`,
                );
            }
        };
        await stage([cli, 'new', '--session', session, '--gpu', job.gpu], COLAB_ALLOCATE_TIMEOUT_MS);
        const requestedCache = job.env?.KK_COLAB_CACHE_DIR ?? cacheDir;
        if (requestedCache === '/content/drive' || requestedCache.startsWith('/content/drive/')) {
            // Colab's CLI brokers Drive credentials. An unavailable mount leaves the worker on its local cache.
            await stage([cli, 'drivemount', '/content/drive', '--session', session]).catch(() => undefined);
        }
        for (const [index, path] of job.inputPaths.entries()) {
            await stage([cli, 'upload', path, `/content/kk-input-${index}${extname(path)}`, '--session', session]);
        }
        const result = await deps.runProcess(buildColabArgv(job, session, cacheDir), {
            timeoutMs: remaining(),
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
                for (const [index, name] of job.outputNames.entries()) {
                    const localPath = join(deps.outputDir, name);
                    const remoteName = job.jobType === 'wan21-i2v' ? `clip-${index}.mp4` : 'presenter.mp4';
                    const download = await deps.runProcess(
                        buildDownloadArgv(session, join(job.remoteDir, remoteName), localPath),
                        { timeoutMs: Math.min(STAGE_TIMEOUT_MS, remaining()) },
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
        let stopError: string | undefined;
        try {
            const stopped = await deps.runProcess(buildStopArgv(session), { timeoutMs: 60_000 });
            if (stopped.code !== 0) stopError = bounded(stopped.stderr) || `exit ${stopped.code}`;
        } catch (thrown: unknown) {
            stopError = thrown instanceof Error ? thrown.message : String(thrown);
        }
        if (stopError !== undefined) {
            error = `${error === undefined ? '' : `${error}. `}colab could not stop session ${session}: ${stopError}`;
            if (status === 'ok') status = 'failed';
        }
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
