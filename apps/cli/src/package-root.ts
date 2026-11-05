import { dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/** Asset sentinel every kk package root ships: the `plugins/kk` tree. */
const SHIPPED_DIR = 'plugins/kk';

/** Walk up from `start` to the first directory containing the shipped `plugins/kk` tree. */
export async function findPackageRoot(fs: FileSystem, start: string): Promise<string | undefined> {
    let dir = resolve(start);
    for (;;) {
        if (await fs.exists(join(dir, SHIPPED_DIR))) return dir;
        const parent = resolve(dir, '..');
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/**
 * The runtime script's directory (the packed CLI's `dist/index.js` sits inside the installed
 * package; under bun test it is the test file inside this checkout). No filesystem call needed:
 * Bun already resolves a symlinked `bin` entry to its real script path in `argv[1]`. Falls back
 * to the cwd when argv[1] is absent (embedded callers may pass a bare `['node', 'kk', …]` argv).
 */
function scriptDir(): string {
    const entry = process.argv[1];
    if (entry === undefined || entry.trim() === '') return process.cwd();
    return dirname(resolve(entry));
}

/**
 * The package/checkout root that ships the kk assets, independent of the cwd.
 *
 * Order matters: the cwd tree first, so a kk project checkout keeps shadowing the installed
 * package's assets (ADR-012 project-root precedence); only when the cwd carries no kk tree do we
 * walk up from the runtime script's directory, so a run outside any checkout still resolves the
 * shipped assets. When both walks miss, the cwd itself is returned, matching the old cwd-rooted
 * callers. Never import.meta.dir/__dirname: Bun inlines those as absolute source paths in the
 * bundle, which would bind the packed CLI to its build checkout (0255 AC7).
 */
export async function resolvePackageRoot(
    fs: FileSystem = createNodeFileSystem(),
    scriptRoot?: string,
): Promise<string> {
    return (
        (await findPackageRoot(fs, process.cwd())) ??
        (await findPackageRoot(fs, scriptRoot ?? scriptDir())) ??
        process.cwd()
    );
}
