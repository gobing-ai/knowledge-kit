/**
 * Run a command with the module directory of the active global `spur` install on NODE_PATH.
 *
 * Spur is deliberately a latest global tool rather than a project dependency, while project
 * workflows and decision catalogs declare schemas from `@gobing-ai/spur`. Bun's package resolver
 * does not search the global install by default, so this small adapter derives the path from the
 * `spur` binary instead of pinning a user-specific directory or adding a runtime dependency.
 *
 * Usage: bun scripts/with-spur-env.ts -- <command> [args...]
 */

import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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

let current = dirname(realpathSync(spurBinary));
let spurPackageRoot: string | undefined;
while (current !== dirname(current)) {
    if (
        basename(current) === 'spur' &&
        basename(dirname(current)) === '@gobing-ai' &&
        existsSync(join(current, 'package.json'))
    ) {
        spurPackageRoot = current;
        break;
    }
    current = dirname(current);
}

if (spurPackageRoot === undefined) {
    console.error(`cannot locate the @gobing-ai/spur package behind ${spurBinary}`);
    process.exit(1);
}

const spurModules = dirname(dirname(spurPackageRoot));
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
