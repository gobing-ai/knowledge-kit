/**
 * Run a command with the module directory of the active global `spur` install on NODE_PATH.
 *
 * Spur is deliberately a latest global tool rather than a project dependency, while project
 * workflows and decision catalogs declare schemas from `@gobing-ai/spur`. Bun's package resolver
 * does not search the global install by default, so this small adapter derives the path from the
 * `spur` binary instead of pinning a user-specific directory or adding a runtime dependency.
 *
 * Resolution (installed package *or* source checkout) lives in `scripts/spur-env.ts`, which is what
 * makes a locally built `spur` on PATH work exactly like the published one.
 *
 * Usage: bun scripts/with-spur-env.ts -- <command> [args...]
 */

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SPUR_PACKAGE, spurModulesOf, spurPackageRootOf } from './spur-env';

const command = process.argv.slice(2);
if (command[0] === '--') command.shift();
if (command.length === 0) {
    console.error('usage: bun scripts/with-spur-env.ts -- <command> [args...]');
    process.exit(2);
}

const spurBinary = Bun.which('spur');
if (spurBinary === null) {
    console.error('cannot resolve `spur` on PATH; install the single global Spur CLI first');
    process.exit(1);
}

const spurPackageRoot = spurPackageRootOf(dirname(realpathSync(spurBinary)));
if (spurPackageRoot === undefined) {
    console.error(
        `cannot locate the ${SPUR_PACKAGE} package behind ${spurBinary} — ` +
            `expected a package.json named '${SPUR_PACKAGE}' on its path (installed package or source checkout)`,
    );
    process.exit(1);
}

const spurModules = spurModulesOf(spurPackageRoot);
if (spurModules === undefined) {
    console.error(
        `found ${SPUR_PACKAGE} at ${resolve(spurPackageRoot)} but no node_modules carrying it — ` +
            'run the install for that checkout (its workspace link is what resolves the schemas)',
    );
    process.exit(1);
}

const pathSeparator = process.platform === 'win32' ? ';' : ':';
const nodePath = [spurModules, process.env.NODE_PATH]
    .filter((value): value is string => Boolean(value))
    .join(pathSeparator);
const result = Bun.spawnSync({
    cmd: command,
    env: { ...process.env, NODE_PATH: nodePath },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
});

process.exit(result.exitCode ?? 1);
