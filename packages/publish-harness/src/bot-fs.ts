import {
    chmodSync,
    closeSync,
    copyFileSync,
    lstatSync,
    mkdirSync,
    openSync,
    readdirSync,
    readlinkSync,
    realpathSync,
    renameSync,
    rmdirSync,
    type Stats,
    unlinkSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * Narrow private filesystem adapter for the four primitives the ts-runtime `FileSystem`
 * seam does not expose: exclusive mkdir, no-follow `lstat`, permission setting and a
 * symlink-refusing profile copy. Everything else — ordinary text IO, path, copy, rename —
 * goes through `createNodeFileSystem()` (design §Containment). Allowlisted by exact path in
 * `.spur/rules/strict/runtime-boundaries.yaml` (`no-direct-fs-io`); keep it that narrow.
 */

/** No-follow stat subset: only the containment facts callers may read. */
export type PathStat = Pick<Stats, 'isFile' | 'isDirectory' | 'isSymbolicLink' | 'mode' | 'mtimeMs'>;

/** `lstat` without following symlinks; `null` when the path does not exist. */
export function lstat(path: string): PathStat | null {
    try {
        return lstatSync(path);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}

/** Canonical (symlink-free) absolute path. */
export function realpath(path: string): string {
    return realpathSync(path);
}

/**
 * Create exactly one owner-only directory. Returns `false` when it already exists so the
 * caller decides what "busy" means; throws on any other error. Never recursive — an absent
 * parent is a caller bug, not a silently created tree.
 */
export function mkdirExclusive(path: string, mode = 0o700): boolean {
    try {
        mkdirSync(path, { mode });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
    }
}

/** Remove an empty directory; `false` when it is absent or not empty. */
export function rmdir(path: string): boolean {
    try {
        rmdirSync(path);
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTEMPTY' || code === 'EEXIST') return false;
        throw error;
    }
}

/** Symlink target text without following it; `null` when the path is absent or not a symlink. */
export function readlink(path: string): string | null {
    try {
        return readlinkSync(path);
    } catch {
        return null;
    }
}

/** Remove one path without following symlinks; `false` when it is already absent. */
export function unlink(path: string): boolean {
    try {
        unlinkSync(path);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/** Rename one path (same volume); `false` when the source is absent. */
export function rename(from: string, to: string): boolean {
    try {
        renameSync(from, to);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/** Set permissions (`0o700` directories, `0o600` metadata/state files). */
export function chmod(path: string, mode: number): void {
    chmodSync(path, mode);
}

/** Reserve one owner-only file without following or replacing an existing path. */
export function createExclusiveFile(path: string): void {
    closeSync(openSync(path, 'wx', 0o600));
}

/** Options for {@link copyProfileEntry}. */
export interface CopyProfileEntryOptions {
    /** Skip a directory child by name (Chromium `Singleton*` artifacts are not profile state). */
    skip?: (name: string) => boolean;
}

/**
 * Copy one browser-profile entry preserving its mode. Symlinks are refused rather than
 * followed — a copied link could point outside the profile (task 0276 containment); the
 * `FileSystem.copy` seam follows them and cannot skip.
 */
export function copyProfileEntry(src: string, dest: string, options: CopyProfileEntryOptions = {}): void {
    const stat = lstat(src);
    if (stat === null) throw new Error(`copyProfileEntry: source missing: ${src}`);
    if (stat.isSymbolicLink()) throw new Error(`copyProfileEntry: refusing to copy symlink: ${src}`);
    if (stat.isDirectory()) {
        mkdirSync(dest, { mode: stat.mode & 0o777 });
        for (const child of readdirSync(src)) {
            if (options.skip?.(child)) continue;
            copyProfileEntry(join(src, child), join(dest, child), options);
        }
        return;
    }
    copyFileSync(src, dest);
    chmod(dest, stat.mode & 0o777);
}
