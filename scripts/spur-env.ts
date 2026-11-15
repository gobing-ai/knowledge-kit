/**
 * Locate the active `@gobing-ai/spur` package behind a `spur` binary and the module root that makes
 * its schemas resolvable.
 *
 * Two shapes exist on real machines, and the package's own `name` — never its directory name — is
 * the discriminator:
 *
 * - **installed package** — `~/.bun/bin/spur → …/node_modules/@gobing-ai/spur/spur.js`; module root
 *   is the sibling `node_modules`.
 * - **source checkout** — PATH points at a working copy (`…/spur-new/apps/cli/spur.js`, manifest
 *   name `@gobing-ai/spur`); the workspace self-link `<repo>/node_modules/@gobing-ai/spur → apps/cli`
 *   is what resolves the schemas there.
 *
 * A directory-name walk (`…/spur` under `@gobing-ai`) only sees the first shape, which is how a
 * re-pointed global binary broke `bun run test-pre-check`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The package whose schemas project workflows and decision catalogs import. */
export const SPUR_PACKAGE = '@gobing-ai/spur';

/** The package `name` recorded by `dir`, or undefined when it holds no readable manifest. */
export function packageNameOf(dir: string): string | undefined {
    const manifest = join(dir, 'package.json');
    if (!existsSync(manifest)) return undefined;
    try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf-8'));
        const name = (parsed as { name?: unknown } | null)?.name;
        return typeof name === 'string' ? name : undefined;
    } catch {
        return undefined;
    }
}

/** Nearest ancestor of `start` (inclusive) whose `package.json` names `@gobing-ai/spur`. */
export function spurPackageRootOf(start: string): string | undefined {
    let current = start;
    for (;;) {
        if (packageNameOf(current) === SPUR_PACKAGE) return current;
        const parent = dirname(current);
        if (parent === current) return undefined;
        current = parent;
    }
}

/**
 * The directory to put on NODE_PATH so `@gobing-ai/spur` resolves: the nearest ancestor's
 * `node_modules` that actually carries the package. Falls back to the package root's grandparent
 * only when that legacy layout holds, so an installed package keeps resolving as before.
 */
export function spurModulesOf(packageRoot: string): string | undefined {
    let current = packageRoot;
    for (;;) {
        const modules = join(current, 'node_modules');
        if (existsSync(join(modules, '@gobing-ai', 'spur'))) return modules;
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    const legacy = dirname(dirname(packageRoot));
    return existsSync(join(legacy, '@gobing-ai', 'spur')) ? legacy : undefined;
}
