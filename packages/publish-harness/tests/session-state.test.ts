/**
 * Durable channel session rail unit suite (2026-11-26, hoisted from `shipinhao-pub`).
 *
 * Capture at login, replay into every later context: the profile's cookie store does not survive a
 * restart, so this is what makes one QR scan worth more than one publish. Expired saved cookies are
 * skipped and profile-held cookies win, so a stale snapshot can never downgrade a live session.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserLauncher, ProfileLaunchRequest } from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext } from 'playwright';
import {
    channelStorageStatePath,
    persistChannelSessionState,
    restoreChannelSessionState,
    stateRestoringLauncher,
} from '../src/session-state';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-publish-harness-session-state');

beforeEach(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});

function cookie(name: string, domain: string, expires: number) {
    return { name, value: 'v', domain, path: '/', expires, httpOnly: true, secure: true, sameSite: 'Lax' as const };
}

function fakeContext(existing: ReturnType<typeof cookie>[] = []): {
    context: BrowserContext;
    added: ReturnType<typeof cookie>[];
} {
    const added: ReturnType<typeof cookie>[] = [];
    const context = {
        cookies: async () => existing,
        addCookies: async (cookies: ReturnType<typeof cookie>[]) => {
            added.push(...cookies);
        },
        storageState: async ({ path }: { path: string }) => {
            await writeFile(
                path,
                JSON.stringify({ cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)], origins: [] }),
            );
        },
    } as unknown as BrowserContext;
    return { context, added };
}

describe('channel console session snapshot (2026-11-26)', () => {
    test('a login snapshot is written atomically beside the profile', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        const { context } = fakeContext();
        await persistChannelSessionState(context, profileDir);
        const saved = JSON.parse(await readFile(channelStorageStatePath(profileDir), 'utf-8')) as {
            cookies: { name: string }[];
        };
        expect(saved.cookies.map((c) => c.name)).toEqual(['SUB']);
        // No `.tmp` sibling survives the rename.
        const { readdir } = await import('node:fs/promises');
        expect((await readdir(profileDir)).filter((f) => f.includes('.tmp'))).toEqual([]);
    });

    test('the saved cookies are replayed, expired ones skipped and profile-held ones left alone', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [
                    cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000),
                    cookie('OLD', '.channels.weixin.qq.com', 1),
                    cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000),
                ],
                origins: [],
            }),
        );
        const { context, added } = fakeContext([cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000)]);
        const outcome = await restoreChannelSessionState(context, undefined, profileDir);
        expect(added.map((c) => c.name)).toEqual(['SUB']);
        expect(outcome).toEqual({ restored: true, skippedExpired: 1, shadowed: 1 });
    });

    test('a profile with no snapshot is untouched (a fresh login still works)', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        const { context, added } = fakeContext();
        const outcome = await restoreChannelSessionState(context, undefined, profileDir);
        expect(added).toEqual([]);
        expect(outcome).toEqual({ restored: false, skippedExpired: 0, shadowed: 0 });
    });

    test('session cookies with no expiry are replayed, never read as expired', async () => {
        // `expires` is undefined on a browser-session cookie and -1 on a session-state one; both
        // are alive, and dropping either would end a valid console session at the next launch.
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        const session = { ...cookie('SESSION', '.channels.weixin.qq.com', -1), expires: -1 };
        const noExpiry = { name: 'NOEXP', value: 'v', domain: '.channels.weixin.qq.com', path: '/' };
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({ cookies: [session, noExpiry], origins: [] }),
        );
        const { context, added } = fakeContext();
        const outcome = await restoreChannelSessionState(context, undefined, profileDir);
        expect(added.map((c) => c.name)).toEqual(['SESSION', 'NOEXP']);
        expect(outcome).toEqual({ restored: true, skippedExpired: 0, shadowed: 0 });
    });

    test('a context without a cookie store is left untouched, never a failed restore', async () => {
        // A real Playwright context always exposes both; a double may not, and a snapshot must never
        // turn that into a failure the caller misreads as an expired session.
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({ cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)], origins: [] }),
        );
        const bare = {} as unknown as BrowserContext;
        expect(await restoreChannelSessionState(bare, undefined, profileDir)).toEqual({
            restored: false,
            skippedExpired: 0,
            shadowed: 0,
        });
    });

    test('origin storage is replayed into the page the console reads its token from', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)],
                origins: [{ origin: 'https://channels.weixin.qq.com', localStorage: [{ name: 'token', value: 't' }] }],
            }),
        );
        const { context } = fakeContext();
        const replayed: { origin: string; items: { name: string; value: string }[] }[] = [];
        // Execute the REAL in-page callback against a fake window, so the replay logic itself is
        // covered (a fake that ignores the function would leave the body untested).
        const globals = globalThis as unknown as {
            location?: { origin: string };
            localStorage?: { setItem(name: string, value: string): void };
        };
        const previous = { location: globals.location, localStorage: globals.localStorage };
        const stored: [string, string][] = [];
        globals.location = { origin: 'https://channels.weixin.qq.com' };
        globals.localStorage = { setItem: (name: string, value: string) => stored.push([name, value]) };
        const page = {
            evaluate: async (
                fn: (arg: unknown) => void,
                arg: { origin: string; items: { name: string; value: string }[] },
            ) => {
                replayed.push(arg);
                fn(arg);
            },
        } as unknown as Parameters<typeof restoreChannelSessionState>[1];
        await restoreChannelSessionState(context, page, profileDir);
        expect(replayed).toEqual([
            { origin: 'https://channels.weixin.qq.com', items: [{ name: 'token', value: 't' }] },
        ]);
        expect(stored).toEqual([['token', 't']]);
        globals.location = previous.location;
        globals.localStorage = previous.localStorage;
    });

    test('a page that refuses the storage replay never fails the restore', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)],
                origins: [{ origin: 'https://channels.weixin.qq.com', localStorage: [{ name: 't', value: 'v' }] }],
            }),
        );
        const { context, added } = fakeContext();
        const refuse = {
            evaluate: async () => {
                throw new Error('execution context destroyed');
            },
        };
        const outcome = await restoreChannelSessionState(
            context,
            refuse as unknown as Parameters<typeof restoreChannelSessionState>[1],
            profileDir,
        );
        expect(added.map((c) => c.name)).toEqual(['SUB']);
        expect(outcome.restored).toBe(true);
    });

    test('a launcher whose context cannot be read is closed before the error escapes', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(channelStorageStatePath(profileDir), '{not json');
        let closed = 0;
        const broken = {
            cookies: async () => [],
            close: async () => {
                closed += 1;
            },
        } as unknown as BrowserContext;
        const base: BrowserLauncher = { launch: async () => broken };
        await expect(stateRestoringLauncher(base).launch({ profileDir, headless: true })).rejects.toThrow('unreadable');
        expect(closed).toBe(1);
    });

    test('a failed close during a failed replay never masks the original error', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(channelStorageStatePath(profileDir), '{not json');
        const torn = {
            cookies: async () => [],
            close: async () => {
                throw new Error('context already gone');
            },
        } as unknown as BrowserContext;
        const base: BrowserLauncher = { launch: async () => torn };
        await expect(stateRestoringLauncher(base).launch({ profileDir, headless: true })).rejects.toThrow('unreadable');
    });

    test('a partial replay is reported in one bounded line, never a cookie name', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({
                cookies: [
                    cookie('OLD', '.channels.weixin.qq.com', 1),
                    cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000),
                ],
                origins: [],
            }),
        );
        const { context } = fakeContext([cookie('MINE', '.channels.weixin.qq.com', 2_000_000_000)]);
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: err });
        try {
            await stateRestoringLauncher({ launch: async () => context }).launch({ profileDir, headless: true });
        } finally {
            restore();
        }
        expect(err.text()).toContain('1 expired, 1 shadowed');
        expect(err.text()).not.toContain('MINE');
    });

    test('a context whose cookie read throws is still restored from the snapshot', async () => {
        // The profile's own cookie store is only read to avoid shadowing it; a read that fails must
        // not cost the session the snapshot can supply.
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            channelStorageStatePath(profileDir),
            JSON.stringify({ cookies: [cookie('SUB', '.channels.weixin.qq.com', 2_000_000_000)], origins: [] }),
        );
        const added: { name: string }[] = [];
        const context = {
            cookies: async () => {
                throw new Error('Target page, context or browser has been closed');
            },
            addCookies: async (cookies: { name: string }[]) => {
                added.push(...cookies);
            },
        } as unknown as BrowserContext;
        const outcome = await restoreChannelSessionState(context, undefined, profileDir);
        expect(added.map((c) => c.name)).toEqual(['SUB']);
        expect(outcome.restored).toBe(true);
    });

    test('a corrupt snapshot is reported, never silently ignored', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await writeFile(channelStorageStatePath(profileDir), '{not json');
        const { context } = fakeContext();
        await expect(restoreChannelSessionState(context, undefined, profileDir)).rejects.toThrow('unreadable');
    });

    test('the restoring launcher replays the snapshot for every context it opens', async () => {
        const profileDir = join(TMP_DIR, 'profile');
        await mkdir(profileDir, { recursive: true });
        await persistChannelSessionState(fakeContext().context, profileDir);
        const requests: ProfileLaunchRequest[] = [];
        const { context: opened, added } = fakeContext();
        const base: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                return opened;
            },
        };
        const launched = await stateRestoringLauncher(base).launch({ profileDir, headless: true });
        expect(launched).toBe(opened);
        expect(requests.map((r) => r.profileDir)).toEqual([profileDir]);
        expect(added.map((c) => c.name)).toEqual(['SUB']);
    });
});
