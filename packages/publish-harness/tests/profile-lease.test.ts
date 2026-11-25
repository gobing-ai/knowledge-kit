import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotError } from '../src/bot';
import {
    acquireProfileLease,
    canonicalize,
    enterDelegatedLease,
    KK_BOT_LEASE_PATH,
    KK_BOT_LEASE_TOKEN,
} from '../src/profile-lease';

const FIXTURE = fileURLToPath(new URL('./fixtures/lease-acquire-probe.ts', import.meta.url));

describe('profile lease (0276)', () => {
    let root: string;
    let leaseRoot: string;
    let profileDir: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-lease-'));
        leaseRoot = join(root, 'leases');
        profileDir = join(root, 'profiles', 'alice');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('acquires an owner-only lease keyed by the canonical logical path', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        const leaseDir = join(leaseRoot, lease.id);

        expect(lease.id).toMatch(/^[0-9a-f]{64}$/);
        expect(lease.profileDir).toBe(canonicalize(profileDir));
        expect(statSync(leaseDir).mode & 0o777).toBe(0o700);
        expect(statSync(join(leaseDir, 'owner.json')).mode & 0o777).toBe(0o600);

        await lease.release();
        expect(existsSync(leaseDir)).toBe(false);
    });

    test('refuses a second acquisition while held (contention)', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        let caught: unknown;
        try {
            await acquireProfileLease(profileDir, { leaseRoot });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('busy');
        expect((caught as BotError).message).toContain(lease.id);
        await lease.release();
    });

    test('re-acquires after release (re-entry)', async () => {
        const first = await acquireProfileLease(profileDir, { leaseRoot });
        await first.release();
        const second = await acquireProfileLease(profileDir, { leaseRoot });
        expect(second.id).toBe(first.id);
        expect(second.token).not.toBe(first.token);
        await second.release();
    });

    test('refuses a native Chromium singleton lock', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'SingletonLock'), '');
        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(/native Chromium/);
    });

    test('refuses a singleton lock whose owner pid is still alive', async () => {
        mkdirSync(profileDir, { recursive: true });
        symlinkSync(`${hostname()}-${process.pid}`, join(profileDir, 'SingletonLock'));
        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(/native Chromium/);
    });

    test('reclaims the singleton lock a crashed launch left behind (dead pid)', async () => {
        mkdirSync(profileDir, { recursive: true });
        // A crashed Chromium leaves <host>-<pid> behind; the pid is gone, so the lock is stale and
        // one crash must not turn every later launch into a hand-cleanup.
        symlinkSync(`${hostname()}-999999`, join(profileDir, 'SingletonLock'));
        symlinkSync('12345', join(profileDir, 'SingletonCookie'));
        writeFileSync(join(profileDir, 'SingletonSocket'), '');
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        expect(existsSync(join(profileDir, 'SingletonLock'))).toBe(false);
        expect(existsSync(join(profileDir, 'SingletonCookie'))).toBe(false);
        await lease.release();
    });

    test("refuses another host's singleton lock", async () => {
        mkdirSync(profileDir, { recursive: true });
        symlinkSync('other-host-999999', join(profileDir, 'SingletonLock'));
        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(/native Chromium/);
    });

    test('scoped delegation: token check, holder blocks release, child drops only its holder', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        const stageDir = join(root, 'stage');
        const env = await lease.delegatedEnv(stageDir);
        expect(env[KK_BOT_LEASE_PATH]).toBe(join(leaseRoot, lease.id));
        expect(env[KK_BOT_LEASE_TOKEN]).toBe(lease.token);

        await expect(enterDelegatedLease({ ...env, [KK_BOT_LEASE_TOKEN]: 'deadbeef' }, stageDir)).rejects.toThrow(
            /token/,
        );
        await expect(enterDelegatedLease(env, join(root, 'elsewhere'))).rejects.toThrow(/bound to/);

        const child = await enterDelegatedLease(env, stageDir);
        expect(child.pid).toBe(process.pid);
        await expect(lease.release()).rejects.toThrow(/child holders/);

        await child.release();
        await lease.release();
        expect(existsSync(join(leaseRoot, lease.id))).toBe(false);
    });

    test('two separate bun processes race for the same lease: exactly one wins', async () => {
        const run = async (): Promise<string> => {
            const proc = Bun.spawn(['bun', FIXTURE, profileDir, leaseRoot], { stdout: 'pipe', stderr: 'pipe' });
            const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
            return out.trim().split('\n')[0] ?? '';
        };
        const outcomes = await Promise.all([run(), run()]);
        expect(outcomes.filter((o) => o === 'acquired')).toHaveLength(1);
        expect(outcomes.filter((o) => o === 'busy')).toHaveLength(1);
    });
});

describe('dead-child residue guidance (0276 P3)', () => {
    let root: string;
    let leaseRoot: string;
    let profileDir: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-lease-residue-'));
        leaseRoot = join(root, 'leases');
        profileDir = join(root, 'profiles', 'alice');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('an owner-less lease with holder records names the residue and keeps confirm-before-remove', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        const leaseDir = join(leaseRoot, lease.id);
        // Simulate the dead-child shape: the parent released (owner record gone) while children
        // mid-transaction left their holder records behind.
        await lease.release();
        mkdirSync(leaseDir, { recursive: true });
        writeFileSync(join(leaseDir, 'holder-abc.json'), '{}');
        writeFileSync(join(leaseDir, 'holder-def.json'), '{}');

        let caught: unknown;
        try {
            await acquireProfileLease(profileDir, { leaseRoot });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        const message = (caught as BotError).message;
        expect(message).toContain('no owner but 2 child holder record(s) remain');
        expect(message).toContain('a previous parent released after its children stopped');
        expect(message).toContain(leaseDir);
        rmSync(leaseDir, { recursive: true, force: true });
    });

    test('a dead owner with a live child holder is NOT reclassified: a running child still owns it', async () => {
        // One-writer guarantee (0436 R1): reclassifying a dead owner's lease must never hand the
        // profile to a second live owner. A live child holder is a live user of the profile.
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        const env = await lease.delegatedEnv(join(root, 'stage'));
        const child = await enterDelegatedLease(env, join(root, 'stage'));
        const ownerPath = join(leaseRoot, lease.id, 'owner.json');
        const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as { pid: number };
        writeFileSync(ownerPath, JSON.stringify({ ...owner, pid: 999_999 }));

        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(/child holders/);
        // Nothing was reclassified: the lease still sits at its own id.
        expect(existsSync(join(leaseRoot, lease.id, 'owner.json'))).toBe(true);
        expect(readdirSync(leaseRoot).filter((name) => name.includes('.stale-'))).toEqual([]);

        await child.release();
        await lease.release();
    });

    test('an owner-less lease with no holder records keeps the crashed-acquire wording', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        const leaseDir = join(leaseRoot, lease.id);
        await lease.release();
        mkdirSync(leaseDir, { recursive: true });

        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(
            /already exists with no owner record/,
        );
        rmSync(leaseDir, { recursive: true, force: true });
    });
});

describe('dead-owner lease reclassification (0436 R1)', () => {
    let root: string;
    let leaseRoot: string;
    let profileDir: string;

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-lease-reclaim-'));
        leaseRoot = join(root, 'leases');
        profileDir = join(root, 'profiles', 'alice');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    /** Spawn the two-process probe, which acquires and exits without releasing: a dead-owner lease. */
    async function leaveDeadOwnerLease(): Promise<{ leaseDir: string; owner: { pid: number } }> {
        const proc = Bun.spawn(['bun', FIXTURE, profileDir, leaseRoot], { stdout: 'pipe', stderr: 'pipe' });
        const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
        expect(out.trim().split('\n')[0]).toBe('acquired');
        const [id] = readdirSync(leaseRoot);
        const leaseDir = join(leaseRoot, id as string);
        const owner = JSON.parse(readFileSync(join(leaseDir, 'owner.json'), 'utf8')) as { pid: number };
        expect(() => process.kill(owner.pid, 0)).toThrow();
        return { leaseDir, owner };
    }

    test('adopts a dead-pid lease: reclassified to .stale-<ts>, the acquire proceeds', async () => {
        // Measured 2026-11-24: leases from pids 75743 (linkedin) and 68156 (weibo) were dead and
        // refused both operator sign-in attempts. A dead owner is no owner.
        const { leaseDir, owner } = await leaveDeadOwnerLease();

        const lease = await acquireProfileLease(profileDir, { leaseRoot });
        expect(lease.id).toBe(leaseDir.slice(leaseRoot.length + 1));

        const names = readdirSync(leaseRoot).filter((name) => name !== lease.id);
        expect(names).toHaveLength(1);
        // `<id>.stale-<stamp>-<pid>-<6 hex>`: the random tail keeps two reclaims in one minute apart.
        expect(names[0]).toMatch(/^[0-9a-f]{64}\.stale-\d{4}-\d{2}-\d{2}T\d{4}-\d+-[0-9a-f]{6}$/);
        // The dead lease is evidence, not garbage: reclassified, never deleted.
        const staleDir = join(leaseRoot, names[0] as string);
        const staleOwner = JSON.parse(readFileSync(join(staleDir, 'owner.json'), 'utf8')) as { pid: number };
        expect(staleOwner.pid).toBe(owner.pid);

        const fresh = JSON.parse(readFileSync(join(leaseDir, 'owner.json'), 'utf8')) as { pid: number };
        expect(fresh.pid).toBe(process.pid);
        await lease.release();
    }, 30_000);

    test('the reclassified lease no longer refuses the next acquire, twice over', async () => {
        const { leaseDir } = await leaveDeadOwnerLease();
        const first = await acquireProfileLease(profileDir, { leaseRoot });
        // A dead owner reclassified once leaves the profile free; a second login must not re-refuse.
        await first.release();
        const second = await acquireProfileLease(profileDir, { leaseRoot });
        expect(second.id).toBe(first.id);
        expect(existsSync(join(leaseDir, 'owner.json'))).toBe(true);
        await second.release();
    }, 30_000);

    test('a LIVE owner is never reclassified (one writer per profile)', async () => {
        const held = await acquireProfileLease(profileDir, { leaseRoot });
        await expect(acquireProfileLease(profileDir, { leaseRoot })).rejects.toThrow(/is held by pid/);
        expect(readdirSync(leaseRoot).filter((name) => name.includes('.stale-'))).toEqual([]);
        await held.release();
    });
});
