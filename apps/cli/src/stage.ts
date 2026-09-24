import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Checkout/package-relative location of the stages runner this verb executes. */
const STAGES_REL = 'plugins/kk/scripts/kk-workflow-stages.ts';

/** Checkout root: `apps/cli/{src,dist}` are both three levels below it (bun build keeps import.meta.dir = bundle dir). */
const CHECKOUT_ROOT = resolve(import.meta.dir, '../../..');

/**
 * Resolve the stages script: package-shipped copy first (two levels up from the
 * running kk entry, mirroring `dirname $(dirname realpath kk)`), then the
 * checkout copy located from this module's own path — never the current directory.
 */
export function resolveStagesScript(argv1 = process.argv[1], checkoutRoot = CHECKOUT_ROOT): string {
    let fromPkg = '';
    if (argv1) {
        try {
            fromPkg = join(dirname(dirname(realpathSync(argv1))), STAGES_REL);
        } catch {
            fromPkg = '';
        }
    }
    if (fromPkg && existsSync(fromPkg)) return fromPkg;
    const fromCheckout = join(checkoutRoot, STAGES_REL);
    if (existsSync(fromCheckout)) return fromCheckout;
    throw new Error(
        `kk-workflow-stages.ts not found at ${fromPkg || STAGES_REL} — install or refresh the kk package (bun link in a checkout)`,
    );
}

/** Run one stage (`bun <stages.ts> <stage> [args...]`) with inherited stdio; returns its exit code. */
export function runStage(args: string[], execPath = process.execPath, argv1?: string): number {
    const script = resolveStagesScript(argv1);
    const res = spawnSync(execPath, [script, ...args], { stdio: 'inherit' });
    if (res.error) {
        throw new Error(`failed to spawn stage runner at ${script}: ${res.error.message}`);
    }
    return res.status ?? 1;
}
