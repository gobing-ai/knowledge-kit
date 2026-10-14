import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { BotError } from './bot';
import { chmod, lstat, mkdirExclusive, realpath, rmdir } from './bot-fs';

/**
 * Frozen shared per-profile lease (task 0276, design §Lease module). Every
 * `kkBrowserLauncher` session and bot mutation goes through it; cooperating kk processes plus
 * Chromium's native singleton lock are the supported exclusion set — arbitrary same-user
 * software is out of scope. A lease is never killed or auto-removed; stale/incomplete
 * ownership is refused with recovery guidance naming paths and PIDs.
 */

/** Default lease root. Injected (`leaseRoot`) in tests/probes — never the real home. */
export const DEFAULT_BOT_LEASE_ROOT = join(homedir(), '.config', 'kk', 'browser-leases');
/** Scoped delegation env keys a child `kkBrowserLauncher` reads. */
export const KK_BOT_LEASE_PATH = 'KK_BOT_LEASE_PATH';
/** Secret paired with {@link KK_BOT_LEASE_PATH}; a child must present it to reuse the lease. */
export const KK_BOT_LEASE_TOKEN = 'KK_BOT_LEASE_TOKEN';

const OWNER_FILE = 'owner.json';
const HOLDER_PREFIX = 'holder-';
/** Chromium writes these into the user-data dir; their presence means a live browser owner. */
const NATIVE_LOCK_FILES = ['SingletonLock', 'SingletonSocket'] as const;

interface LeaseOwner {
    schemaVersion: 1;
    id: string;
    token: string;
    logicalPath: string;
    physicalPath: string | null;
    pid: number;
    createdAt: string;
}

/** An owned lease held by the current invocation. */
export interface ProfileLease {
    /** sha256 of the canonical logical profile path; also the lease directory name. */
    readonly id: string;
    /** Opaque secret verified on release/delegation; never printed. */
    readonly token: string;
    /** Canonical logical profile path (symlink-free). */
    readonly profileDir: string;
    /** Absolute lease directory holding `owner.json` and the child holder records. */
    readonly leaseDir: string;
    /** Delete this invocation's marker once no child holder is live. */
    release(): Promise<void>;
    /** Scoped delegation env for a child, binding owner to `physicalProfileDir`. */
    delegatedEnv(physicalProfileDir: string): Promise<Record<string, string>>;
}

/** A child's recorded presence in a parent lease. */
export interface ChildLease {
    readonly pid: number;
    readonly leaseDir: string;
    /** Drop only this child's holder record. */
    release(): Promise<void>;
}

/** Options for {@link acquireProfileLease}. */
export interface AcquireProfileLeaseOptions {
    /** Lease root; default {@link DEFAULT_BOT_LEASE_ROOT}. */
    leaseRoot?: string;
    /** Injected FileSystem for owner-record text IO. */
    fileSystem?: FileSystem;
}

/**
 * Acquire the exclusive lease for `profileDir`. Exclusive owner-only mkdir makes concurrent
 * acquisition atomic; an existing marker or a native Chromium lock refuses with `busy`.
 */
export async function acquireProfileLease(
    profileDir: string,
    options: AcquireProfileLeaseOptions = {},
): Promise<ProfileLease> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const leaseRoot = options.leaseRoot ?? DEFAULT_BOT_LEASE_ROOT;
    const logicalPath = canonicalize(profileDir);
    refuseNativeLock(logicalPath);
    const id = sha256Hex(logicalPath);
    const leaseDir = join(leaseRoot, id);
    await fileSystem.ensureDir(leaseRoot);
    if (!mkdirExclusive(leaseDir, 0o700)) {
        throw new BotError('busy', await busyGuidance(fileSystem, leaseDir));
    }
    const token = randomBytes(16).toString('hex');
    const owner: LeaseOwner = {
        schemaVersion: 1,
        id,
        token,
        logicalPath,
        physicalPath: null,
        pid: process.pid,
        createdAt: new Date().toISOString(),
    };
    await writeOwner(fileSystem, leaseDir, owner);
    return {
        id,
        token,
        profileDir: logicalPath,
        leaseDir,
        async release(): Promise<void> {
            await releaseOwnedLease(fileSystem, leaseDir, owner);
        },
        async delegatedEnv(physicalProfileDir: string): Promise<Record<string, string>> {
            await writeOwner(fileSystem, leaseDir, { ...owner, physicalPath: canonicalize(physicalProfileDir) });
            return { [KK_BOT_LEASE_PATH]: leaseDir, [KK_BOT_LEASE_TOKEN]: token };
        },
    };
}

/** Options for {@link enterDelegatedLease}. */
export interface EnterDelegatedLeaseOptions {
    /** Injected FileSystem for owner/holder text IO. */
    fileSystem?: FileSystem;
}

/**
 * Child side of scoped delegation: validate the delegated lease dir, owner token and bound
 * physical path, then record this PID's holder. A bad token or path is `busy`, never a second
 * acquisition. The child drops only its own holder on release; the parent keeps the lease.
 */
export async function enterDelegatedLease(
    env: Record<string, string | undefined>,
    physicalProfileDir: string,
    options: EnterDelegatedLeaseOptions = {},
): Promise<ChildLease> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const leaseDir = env[KK_BOT_LEASE_PATH];
    const token = env[KK_BOT_LEASE_TOKEN];
    if (leaseDir === undefined || leaseDir === '' || token === undefined || token === '') {
        throw new BotError('usage', `no delegated lease present (${KK_BOT_LEASE_PATH}/${KK_BOT_LEASE_TOKEN})`);
    }
    const owner = await readOwner(fileSystem, leaseDir);
    if (owner === null) throw new BotError('busy', `delegated lease ${leaseDir} has no owner record`);
    if (owner.token !== token) throw new BotError('busy', `delegated lease ${leaseDir} token does not match its owner`);
    const physicalPath = canonicalize(physicalProfileDir);
    if (owner.physicalPath !== null && owner.physicalPath !== physicalPath) {
        throw new BotError(
            'busy',
            `delegated lease ${leaseDir} is bound to ${owner.physicalPath}, not ${physicalPath}`,
        );
    }
    const holderPath = join(leaseDir, `${HOLDER_PREFIX}${process.pid}.json`);
    await fileSystem.writeFile(
        holderPath,
        `${JSON.stringify({ pid: process.pid, physicalPath, enteredAt: new Date().toISOString() }, null, 2)}\n`,
    );
    chmod(holderPath, 0o600);
    return {
        pid: process.pid,
        leaseDir,
        async release(): Promise<void> {
            await fileSystem.deleteFile(holderPath);
        },
    };
}

/**
 * Re-verify that `lease` is still held by this invocation: the lease directory must exist and its
 * owner record must carry this lease's id and token. An in-process borrower (the browser launcher
 * taking a parent's logical lease for a stage/final context) calls this before it skips
 * reacquisition, so a released or foreign lease fails `busy` instead of launching unprotected.
 */
export async function verifyLeaseHeld(lease: ProfileLease, options: EnterDelegatedLeaseOptions = {}): Promise<void> {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    const owner = await readOwner(fileSystem, lease.leaseDir);
    if (owner === null || owner.token !== lease.token || owner.id !== lease.id) {
        throw new BotError(
            'busy',
            `browser lease ${lease.leaseDir} is not held by this invocation any more — refusing to borrow it`,
        );
    }
}

/**
 * Canonical (symlink-free) logical path. Resolves the nearest existing ancestor's real path
 * and re-appends the missing tail, so a not-yet-existing profile still gets a stable key.
 */
export function canonicalize(profileDir: string): string {
    let probe = resolve(profileDir);
    const tail: string[] = [];
    for (;;) {
        if (lstat(probe) !== null) {
            let canonical: string;
            try {
                canonical = realpath(probe);
            } catch {
                canonical = probe;
            }
            return tail.length === 0 ? canonical : join(canonical, ...tail);
        }
        const parent = dirname(probe);
        if (parent === probe) return join(probe, ...tail);
        tail.unshift(basename(probe));
        probe = parent;
    }
}

async function releaseOwnedLease(fileSystem: FileSystem, leaseDir: string, expected: LeaseOwner): Promise<void> {
    const current = await readOwner(fileSystem, leaseDir);
    if (current === null || current.token !== expected.token || current.id !== expected.id) {
        throw new BotError('busy', `lease ${leaseDir} is not owned by this invocation — refusing to release`);
    }
    const live = await liveChildHolders(fileSystem, leaseDir);
    if (live.length > 0) {
        throw new BotError(
            'busy',
            `lease ${leaseDir} still has live child holders (pids ${live.join(', ')}) — stop them before releasing`,
        );
    }
    await fileSystem.deleteFile(join(leaseDir, OWNER_FILE));
    rmdir(leaseDir);
}

async function readOwner(fileSystem: FileSystem, leaseDir: string): Promise<LeaseOwner | null> {
    try {
        return JSON.parse(await fileSystem.readFile(join(leaseDir, OWNER_FILE))) as LeaseOwner;
    } catch {
        return null;
    }
}

async function writeOwner(fileSystem: FileSystem, leaseDir: string, owner: LeaseOwner): Promise<void> {
    const path = join(leaseDir, OWNER_FILE);
    await fileSystem.writeFile(path, `${JSON.stringify(owner, null, 2)}\n`);
    chmod(path, 0o600);
}

async function busyGuidance(fileSystem: FileSystem, leaseDir: string): Promise<string> {
    const owner = await readOwner(fileSystem, leaseDir);
    if (owner === null) {
        // An owner-less directory still carrying holder records is dead-child residue (a parent
        // released after its children died mid-transaction), not an acquire that never finished —
        // name the difference so the operator knows what to confirm before removing anything.
        const residue = await holderResidue(fileSystem, leaseDir);
        if (residue !== null) {
            return (
                `browser lease ${leaseDir} has no owner but ${residue} child holder record(s) remain — ` +
                'a previous parent released after its children stopped; confirm no kk browser still uses this ' +
                `profile, then remove ${leaseDir} manually`
            );
        }
        return `browser lease ${leaseDir} already exists with no owner record — a previous run may have crashed mid-acquire; confirm no kk browser still uses this profile, then remove ${leaseDir} manually`;
    }
    return `browser lease ${leaseDir} is held by pid ${owner.pid} (logical ${owner.logicalPath}) — confirm that process and any browser for this profile have stopped; stale ownership is never auto-removed`;
}

/** Count dead-child holder records, or null when the directory carries none. */
async function holderResidue(fileSystem: FileSystem, leaseDir: string): Promise<number | null> {
    try {
        const entries = await fileSystem.readDir(leaseDir);
        const holders = entries.filter((name) => name.startsWith(HOLDER_PREFIX) && name.endsWith('.json'));
        return holders.length > 0 ? holders.length : null;
    } catch {
        return null;
    }
}

async function liveChildHolders(fileSystem: FileSystem, leaseDir: string): Promise<number[]> {
    let entries: string[];
    try {
        entries = await fileSystem.readDir(leaseDir);
    } catch {
        return [];
    }
    const pids: number[] = [];
    for (const name of entries) {
        if (!name.startsWith(HOLDER_PREFIX) || !name.endsWith('.json')) continue;
        let record: { pid?: unknown };
        try {
            record = JSON.parse(await fileSystem.readFile(join(leaseDir, name)));
        } catch {
            continue;
        }
        if (typeof record.pid === 'number' && isProcessAlive(record.pid)) pids.push(record.pid);
    }
    return pids;
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

function refuseNativeLock(profileDir: string): void {
    for (const name of NATIVE_LOCK_FILES) {
        const path = join(profileDir, name);
        if (lstat(path) !== null) {
            throw new BotError(
                'busy',
                `native Chromium ownership present at ${path} — confirm no browser is using ${profileDir} before retrying`,
            );
        }
    }
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}
