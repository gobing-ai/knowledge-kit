/**
 * Keep `node_modules/@gobing-ai/spur` pointing at the `spur` package behind the CLI on PATH.
 *
 * This repo consumes Spur as a latest global tool and never declares it as a dependency (AGENTS.md),
 * yet its own decision catalogs and `.spur/config.yaml` declare
 * `$schema: "@gobing-ai/spur/schemas/…"`. Bun resolves a declared schema through the module tree
 * above the catalog's own directory, so the checkout has to make the package resolvable from
 * `plugins/kk/decisions/` — and because nothing declares it, `bun install` treats the link as
 * extraneous and prunes it. On 2026-11-19 exactly that killed a collect tick and a generate run
 * (`kk store label` exited at catalog load; spur's `decide` loaded zero project catalogs).
 *
 * Three consumers need the same resolution and each has one owner:
 *  - `bun run …` → `scripts/with-spur-env.ts` (NODE_PATH for the child process);
 *  - scheduler jobs → `kk schedule render` binds `NODE_PATH` in the kk-serve plist;
 *  - a bare interactive `kk store label` / `spur decision` → this link, which is the only mechanism
 *    that exists inside an operator's own shell.
 *
 * Re-run by `prepare` on every install, so the prune heals itself instead of asking for a permanent
 * `NODE_PATH` export in a shell rc (which would leak one checkout's global tree into every project).
 *
 * Never fatal, and never destructive: a missing `spur` only warns (an install must not fail because
 * the CLI is not installed yet), and an entry that is a real directory is reported, not removed.
 */

import { lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SPUR_PACKAGE, spurPackageRootOf } from './spur-env';

const root = resolve(import.meta.dir, '..');
const link = join(root, 'node_modules/@gobing-ai/spur');

const binary = Bun.which('spur');
const target = binary === null ? undefined : spurPackageRootOf(dirname(realpathSync(binary)));
if (target === undefined) {
    console.warn(
        `link-spur: no '${SPUR_PACKAGE}' behind the 'spur' on PATH — project decision catalogs will not ` +
            'resolve their schema until one is installed (install the global Spur CLI, then re-run this)',
    );
    process.exit(0);
}

const existing = lstatSync(link, { throwIfNoEntry: false });
if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
        console.warn(
            `link-spur: ${link} exists and is not a symlink — leaving it alone; remove it by hand if ` +
                `the catalogs fail to load (expected target ${target})`,
        );
        process.exit(0);
    }
    if (realpathSync(link) === realpathSync(target)) process.exit(0);
    rmSync(link, { force: true });
}

mkdirSync(dirname(link), { recursive: true });
symlinkSync(target, link, 'dir');
console.log(`link-spur: node_modules/${SPUR_PACKAGE} -> ${target}`);
