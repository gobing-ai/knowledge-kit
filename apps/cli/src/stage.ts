import { spawn, spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { echo, echoError } from '@gobing-ai/ts-utils';

/** Checkout/package-relative location of the stages runner this verb executes. */
const STAGES_REL = 'plugins/kk/scripts/kk-workflow-stages.ts';

/** Source-module marker: shipped only by a checkout (the package files allow-list never includes src). */
const CHECKOUT_MARKER_REL = 'apps/cli/src/stage.ts';

/** Checkout root: `apps/cli/{src,dist}` are both three levels below it (bun build keeps import.meta.dir = bundle dir). */
const CHECKOUT_ROOT = resolve(import.meta.dir, '../../..');

const INSTALL_GUIDANCE = 'install or refresh the kk package (bun link in a checkout)';

/** Regular-file probe that never throws on a missing or unstattable path. */
function isFile(path: string): boolean {
    try {
        return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
    } catch {
        return false;
    }
}

/** realpath that yields '' when the path cannot be resolved (missing entry, dangling symlink). */
function canonical(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return '';
    }
}

/**
 * Resolve the stages script for the running entry.
 *
 * A recognized checkout entry — the source-module marker exists and the real package root is this
 * checkout's `apps/cli` — always executes the checked-in runner. A divergent copy staged under
 * `apps/cli/plugins/` is ignored, so editing the checked-in runner or its helpers takes effect
 * without restaging. An installed entry keeps its own package-shipped runner regardless of cwd.
 * The module-anchored source fallback applies only to a genuine checkout whose package copy is
 * unavailable; an unrelated ancestor `plugins` directory is never selected.
 */
export function resolveStagesScript(argv1 = process.argv[1], checkoutRoot = CHECKOUT_ROOT): string {
    const fromCheckout = join(checkoutRoot, STAGES_REL);
    const checkoutMarker = join(checkoutRoot, CHECKOUT_MARKER_REL);

    let fromPkg = '';
    let entryPkgRoot = '';
    if (argv1) {
        const realEntry = canonical(argv1);
        if (realEntry) {
            entryPkgRoot = dirname(dirname(realEntry));
            fromPkg = join(entryPkgRoot, STAGES_REL);
        }
    }

    const checkoutEntry =
        isFile(checkoutMarker) && entryPkgRoot !== '' && canonical(join(checkoutRoot, 'apps/cli')) === entryPkgRoot;
    if (checkoutEntry) {
        if (isFile(fromCheckout)) return fromCheckout;
        throw new Error(`kk-workflow-stages.ts not found at ${fromCheckout} — ${INSTALL_GUIDANCE}`);
    }

    if (fromPkg && isFile(fromPkg)) return fromPkg;

    // Installed bundle (or unresolvable entry): only a real checkout may fall back to module-anchored source.
    if (isFile(checkoutMarker) && isFile(fromCheckout)) return fromCheckout;

    throw new Error(`kk-workflow-stages.ts not found at ${fromPkg || STAGES_REL} — ${INSTALL_GUIDANCE}`);
}

/** Run one stage (`bun <stages.ts> <stage> [args...]`) with inherited stdio; returns its exit code. */
/**
 * Run one stage as a subprocess, forwarding its output through the default
 * echo/echoError targets — never raw stdio inheritance, which would bypass the
 * output-target seam and leak stage logs into test reporters.
 * Output arrives when the stage exits (spawnSync), not streamed.
 */
export function runStage(args: string[], execPath = process.execPath, argv1?: string): number {
    const script = resolveStagesScript(argv1);
    // `env: process.env` is explicit on purpose: Bun's `spawnSync` snapshots the environment at
    // startup, so a variable set on `process.env` later (a test's hermetic switch, a stage's own
    // override) never reached the child without this (measured 2026-10-12).
    const res = spawnSync(execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    if (res.error) {
        throw new Error(`failed to spawn stage runner at ${script}: ${res.error.message}`);
    }
    forwardChildOutput(res.stdout, echo);
    forwardChildOutput(res.stderr, echoError);
    return res.status ?? 1;
}

/** Forward one captured child stream to a writer, trimming only the final newline (echo re-adds it). */
function forwardChildOutput(chunk: Buffer | string | null | undefined, write: (message: string) => void): void {
    const text = typeof chunk === 'string' ? chunk : (chunk?.toString('utf-8') ?? '');
    if (text.length === 0) return;
    write(text.endsWith('\n') ? text.slice(0, -1) : text);
}

/** Signals a host cancels an interactive `kk stage run` with. */
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** Grace period before a stage that ignored the forwarded signal is killed outright. */
const CANCEL_ESCALATION_MS = 5000;

/** Conventional shell exit status per forwarded signal; anything else falls back to 1. */
const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

/**
 * Cancellable variant of `runStage` used by the `kk stage run` verb.
 *
 * `spawnSync` cannot react to a signal while it blocks, so a cancellation addressed only to the
 * CLI process left the stage process — and everything the stage had spawned — running (measured
 * 2026-10-15: SIGTERM to the parent left both the stage child and its decision/socket grandchild
 * alive). The stage therefore runs in its own process group and every forwarded signal is
 * delivered to that whole group, which reaches the stage's own children as well.
 *
 * Output is captured and forwarded on exit through the same echo targets as `runStage`, so the
 * output-target seam and the exit-status contract are unchanged.
 */
export function runStageCancellable(args: string[], execPath = process.execPath, argv1?: string): Promise<number> {
    const script = resolveStagesScript(argv1);
    return new Promise<number>((resolvePromise, rejectPromise) => {
        const child = spawn(execPath, [script, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            // `env: process.env` is explicit for the same reason as `runStage`: Bun snapshots the
            // environment at startup, so a variable set later never reached the child otherwise.
            env: process.env,
            detached: true,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(Buffer.from(chunk)));
        child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(Buffer.from(chunk)));

        let escalation: ReturnType<typeof setTimeout> | undefined;
        const forward = (signal: NodeJS.Signals): void => {
            const pid = child.pid;
            if (pid === undefined) return;
            try {
                process.kill(-pid, signal); // negative pid = the stage's whole process group
            } catch {
                try {
                    child.kill(signal);
                } catch {
                    // already exited
                }
            }
            escalation ??= setTimeout(() => {
                try {
                    process.kill(-pid, 'SIGKILL');
                } catch {
                    // already exited
                }
            }, CANCEL_ESCALATION_MS);
        };

        const handlers = new Map<NodeJS.Signals, () => void>();
        for (const signal of FORWARDED_SIGNALS) {
            const handler = (): void => forward(signal);
            handlers.set(signal, handler);
            process.on(signal, handler);
        }
        const disarm = (): void => {
            for (const [signal, handler] of handlers) process.removeListener(signal, handler);
            handlers.clear();
            if (escalation !== undefined) clearTimeout(escalation);
        };

        child.on('error', (err: Error) => {
            disarm();
            rejectPromise(new Error(`failed to spawn stage runner at ${script}: ${err.message}`));
        });
        child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
            disarm();
            forwardChildOutput(Buffer.concat(stdoutChunks), echo);
            forwardChildOutput(Buffer.concat(stderrChunks), echoError);
            resolvePromise(code ?? (signal === null ? 1 : (SIGNAL_EXIT_CODES[signal] ?? 1)));
        });
    });
}
