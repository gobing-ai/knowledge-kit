import { spawnSync } from 'node:child_process';
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
    const res = spawnSync(execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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
