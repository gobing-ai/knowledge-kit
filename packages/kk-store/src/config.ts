import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';

/** Store path when `store.db_path` is unset: cwd-relative, next to today's `.works/` run dirs. */
export const DEFAULT_STORE_DB_PATH = '.works/kk.db';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Expand a leading `~` to the user home dir (`~user` is not expanded — no operator writes it). */
function expandHome(target: string): string {
    if (target === '~') return homedir();
    if (target.startsWith('~/')) return join(homedir(), target.slice(2));
    return target;
}

/**
 * Read `store.db_path` from the kk operator config file.
 *
 * Missing, unreadable, unparseable, or blank values yield `undefined` so the
 * default applies — the store must open on a zero-config machine. Mirrors the
 * config-read discipline of `pluginEnvFromConfig` (apps/cli/src/invoke.ts).
 */
async function readStoreDbPath(fileSystem: FileSystem, configFile: string | undefined): Promise<string | undefined> {
    if (configFile === undefined || !(await fileSystem.exists(configFile))) return undefined;
    let raw: string;
    try {
        raw = await fileSystem.readFile(configFile);
    } catch {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = Bun.YAML.parse(raw);
    } catch {
        return undefined;
    }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.store)) return undefined;
    const dbPath = parsed.store.db_path;
    if (typeof dbPath !== 'string' || dbPath.trim() === '') return undefined;
    return dbPath;
}

/**
 * Resolve the store database path: an explicit path wins, then `store.db_path`
 * from the kk config, then {@link DEFAULT_STORE_DB_PATH}. A leading `~` expands,
 * a relative path resolves against the process cwd, and the parent directory is
 * created.
 *
 * Async because file IO goes through ts-runtime's `FileSystem` seam (the repo's
 * `no-direct-fs-io` rule forbids `node:fs` in product source). kk-store cannot
 * import `apps/cli` (apps/cli depends on kk-store), so this takes the config path
 * as an argument and `kk` passes `resolveKkConfigPath()`.
 */
export async function resolveStorePath(configFile?: string, explicitPath?: string): Promise<string> {
    const fileSystem = createNodeFileSystem();
    const configured = explicitPath ?? (await readStoreDbPath(fileSystem, configFile));
    const expanded = expandHome(configured ?? DEFAULT_STORE_DB_PATH);
    const absolute = isAbsolute(expanded) ? expanded : resolve(expanded);
    await fileSystem.ensureDir(dirname(absolute));
    return absolute;
}
