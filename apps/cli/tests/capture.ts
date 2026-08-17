import { createBufferTarget, setDefaultOutputTargets, type WriteTarget } from '@gobing-ai/ts-utils';

export interface CapturedOutput {
    out: ReturnType<typeof createBufferTarget>;
    err: ReturnType<typeof createBufferTarget>;
    read(): string;
    readErr(): string;
    restore(): void;
}

/**
 * Capture ts-utils `echo`/`echoError` output (default stdout/stderr targets)
 * into in-memory buffers. Migrated replacement for legacy logger monkey-patching
 * (feature A3 / task 0065).
 */
export function captureOutput(): CapturedOutput {
    const out = createBufferTarget();
    const err = createBufferTarget();
    const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
    return {
        out,
        err,
        read: () => out.text(),
        readErr: () => err.text(),
        restore,
    };
}

/**
 * Silence ts-utils `echo`/`echoError` (negative-path tests keep the dots
 * reporter clean). Returns a rollback restoring the previous targets.
 */
export function silenceOutput(): () => void {
    const noop: WriteTarget = { write() {} };
    return setDefaultOutputTargets({ stdout: noop, stderr: noop });
}
