import { afterAll, describe, expect, it } from 'bun:test';
import { cleanupTempState, makeTempDir, openTempStore } from '../helpers';

afterAll(cleanupTempState);

describe('LocksDao', () => {
    it('gives a lock to one run, is re-entrant for the holder, and releases only for the holder', async () => {
        const { store } = await openTempStore(makeTempDir(), 'locks.db');
        expect(await store.locks.acquire('collect', 'run-a', 60_000)).toBe(true);
        expect(await store.locks.acquire('collect', 'run-b', 60_000)).toBe(false);
        expect(await store.locks.acquire('collect', 'run-a', 60_000)).toBe(true);
        expect((await store.locks.current('collect'))?.ownerRun).toBe('run-a');

        expect(await store.locks.release('collect', 'run-b')).toBe(false);
        expect((await store.locks.current('collect'))?.ownerRun).toBe('run-a');
        expect(await store.locks.release('collect', 'run-a')).toBe(true);
        expect(await store.locks.current('collect')).toBeUndefined();
        expect(await store.locks.acquire('collect', 'run-b', 60_000)).toBe(true);
    });

    it('keeps independent locks for different names', async () => {
        const { store } = await openTempStore(makeTempDir(), 'locks-names.db');
        expect(await store.locks.acquire('collect', 'run-a', 60_000)).toBe(true);
        expect(await store.locks.acquire('publish', 'run-b', 60_000)).toBe(true);
        expect((await store.locks.acquire('collect', 'run-b', 60_000)) as boolean).toBe(false);
    });

    it('steals a claim whose TTL expired so a crashed holder cannot block forever', async () => {
        const { store } = await openTempStore(makeTempDir(), 'locks-ttl.db');
        const t0 = 1_000_000;
        expect(await store.locks.acquire('collect', 'run-a', 10_000, t0)).toBe(true);
        expect(await store.locks.acquire('collect', 'run-b', 10_000, t0 + 9_999)).toBe(false);
        expect(await store.locks.acquire('collect', 'run-b', 10_000, t0 + 10_000)).toBe(true);
        expect((await store.locks.current('collect'))?.ownerRun).toBe('run-b');
    });
});
