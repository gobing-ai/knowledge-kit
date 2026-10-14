import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
