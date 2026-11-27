import { ProcessExecutor } from '@gobing-ai/ts-runtime';

/**
 * Process seam for the video-gen plugin: every external binary (`ffmpeg`, `ffprobe`, `uv`) goes
 * through one injectable argv runner so fail-closed tests can assert a **zero-spawn** verdict and
 * the fast tier never shells out.
 *
 * The default runner is ts-runtime's `ProcessExecutor` (runtime-boundaries rule). Every call site
 * passes a deadline: the executor reaps the whole process group on expiry, so a hung `ffmpeg` or
 * whisper worker surfaces as a failed run instead of holding an unattended daily cron open forever.
 */

/** Options forwarded to a spawned process. */
export interface RunProcessOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
}

/** One process outcome; `code` is the exit status (never thrown for a nonzero exit). */
export interface ProcessResult {
    code: number;
    stdout: string;
    stderr: string;
}

/** Runs one argv without a shell; the array is passed through verbatim. */
export type RunProcess = (argv: string[], options?: RunProcessOptions) => Promise<ProcessResult>;

const executor = new ProcessExecutor({});

function definedEnv(env: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
    if (env === undefined) return undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
        if (value !== undefined) out[key] = value;
    }
    return out;
}

/** Default {@link RunProcess} over ts-runtime's executor: no shell, merged env, owned deadline. */
export const runtimeRunProcess: RunProcess = async (argv, options = {}) => {
    const [command, ...args] = argv;
    if (command === undefined) throw new Error('video-gen: cannot spawn an empty command');
    const env = definedEnv(options.env);
    const result = await executor.run({
        command,
        args,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(env === undefined ? {} : { env }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    });
    return { code: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
};
