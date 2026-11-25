import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Cookie, Page } from 'playwright';
import { restoreWechatSessionState, selectRestoreCookies, storageStatePath } from '../src/index';
import { main as profileCheckMain } from '../src/profile-check';

/**
 * 0436 R2 / AC2: a stale `storage-state.json` must never mask a fresh console session.
 *
 * Measured 2026-11-24: the state file was dated 2026-11-23 17:33 while the profile carried a fresh
 * `wxuin` cookie (expires 2027-12-25) from a 21:03 sign-in — the restore re-injected the stale
 * snapshot over the live one, so every later `check` refused a session the browser actually had.
 * The rule pinned here: the profile's own live cookie always wins; the saved state may only supply
 * (a) cookies the profile no longer holds and (b) nothing that has itself expired.
 */

const tmpRoot = join(process.cwd(), '.works/tmp/test-wechatmp-0436');
const profileDir = join(tmpRoot, 'profile');
/** Two years out — every fixture expiry is relative to this, never to the wall clock. */
const NOW_MS = 1_800_000_000_000;
const NOW_S = Math.floor(NOW_MS / 1000);
const FRESH_S = NOW_S + 365 * 24 * 3600;
const STALE_S = NOW_S - 24 * 3600;

afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

function cookie(overrides: Partial<Cookie> & { name: string }): Cookie {
    return {
        value: 'v',
        domain: 'mp.weixin.qq.com',
        path: '/',
        expires: FRESH_S,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        ...overrides,
    } as Cookie;
}

/** Fake context: records what a restore injects and holds the profile's own cookie jar. */
function fakeContext(profileCookies: Cookie[], calls: Cookie[][] = []): BrowserContext {
    return {
        cookies: async () => profileCookies,
        addCookies: async (cookies: Cookie[]) => void calls.push(cookies),
    } as unknown as BrowserContext;
}

const page = { goto: async () => {} } as unknown as Page;

describe('wechatmp session-state restore (0436 R2)', () => {
    test('a stale saved cookie never overrides the profile cookie that replaced it', () => {
        // The measured shape: both copies are still live (wxuin ran to 2027-12-25), so expiry cannot
        // tell them apart — the profile's own live cookie must win on presence alone.
        const selection = selectRestoreCookies(
            [cookie({ name: 'wxuin', value: 'STALE-VALUE', expires: FRESH_S - 60 })],
            [cookie({ name: 'wxuin', value: 'FRESH-VALUE', expires: FRESH_S })],
            NOW_MS,
        );
        expect(selection.inject).toEqual([]);
        expect(selection.shadowed).toBe(1);
        expect(selection.expired).toBe(0);
    });

    test('a cookie the profile lost is still restored from the saved state', () => {
        // The reason the file exists: mp.weixin.qq.com grant cookies do not survive a Chromium
        // restart although the store keeps a fresh session id (measured 2026-10-05).
        const slaveSid = cookie({ name: 'slave_sid', value: 'grant' });
        const selection = selectRestoreCookies(
            [slaveSid, cookie({ name: 'wxuin', expires: FRESH_S - 60 })],
            [cookie({ name: 'wxuin', expires: FRESH_S })],
            NOW_MS,
        );
        expect(selection.inject).toEqual([slaveSid]);
        expect(selection.shadowed).toBe(1);
    });

    test('an already-expired saved cookie is never injected', () => {
        const selection = selectRestoreCookies([cookie({ name: 'slave_sid', expires: STALE_S })], [], NOW_MS);
        expect(selection.inject).toEqual([]);
        expect(selection.expired).toBe(1);
    });

    test('a profile cookie in another domain or path does not shadow the saved one', () => {
        const saved = cookie({ name: 'wxuin', domain: 'mp.weixin.qq.com', path: '/cgi-bin' });
        const selection = selectRestoreCookies(
            [saved],
            [cookie({ name: 'wxuin', domain: 'mp.weixin.qq.com', path: '/' })],
            NOW_MS,
        );
        expect(selection.inject).toEqual([saved]);
    });

    test('a session cookie in the profile (expires -1) counts as live and shadows the saved one', () => {
        const selection = selectRestoreCookies(
            [cookie({ name: 'wxuin', expires: STALE_S })],
            [cookie({ name: 'wxuin', expires: -1 })],
            NOW_MS,
        );
        expect(selection.inject).toEqual([]);
    });

    test('restore injects only what the profile lacks, and never the stale value', async () => {
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            storageStatePath(profileDir),
            JSON.stringify({
                cookies: [
                    cookie({ name: 'wxuin', value: 'STALE-VALUE', expires: FRESH_S - 60 }),
                    cookie({ name: 'slave_sid', value: 'GRANT-VALUE' }),
                ],
                origins: [],
            }),
        );
        const calls: Cookie[][] = [];
        const context = fakeContext([cookie({ name: 'wxuin', value: 'FRESH-VALUE', expires: FRESH_S })], calls);
        const err = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: err });
        try {
            await restoreWechatSessionState(context, page, profileDir);
        } finally {
            restore();
        }
        expect(calls).toHaveLength(1);
        expect(calls[0]?.map((entry) => entry.name)).toEqual(['slave_sid']);
        // The operator gets a bounded line; no cookie name or value ever reaches it.
        expect(err.text()).not.toContain('STALE-VALUE');
        expect(err.text()).not.toContain('FRESH-VALUE');
        expect(err.text()).not.toContain('wxuin');
    });

    test('a missing saved state still refuses with the login guidance (nothing fabricated)', async () => {
        const empty = join(tmpRoot, 'profile-empty');
        await mkdir(empty, { recursive: true });
        await expect(
            restoreWechatSessionState(fakeContext([cookie({ name: 'wxuin', expires: FRESH_S })]), page, empty),
        ).rejects.toThrow(/run .*login/);
    });
});

describe('wechatmp check with a stale state file (0436 AC2)', () => {
    test('a check verifies from what the browser holds when the saved state is older', async () => {
        const checkDir = join(tmpRoot, 'profile-check');
        await mkdir(checkDir, { recursive: true });
        await writeFile(
            storageStatePath(checkDir),
            JSON.stringify({
                cookies: [cookie({ name: 'wxuin', value: 'STALE-VALUE', expires: FRESH_S - 60 })],
                origins: [],
            }),
        );
        const injected: Cookie[][] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => {
            const context = {
                pages: () => [],
                newPage: async () => ({
                    goto: async () => {},
                    url: () => 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index',
                }),
                addCookies: async (cookies: Cookie[]) => void injected.push(cookies),
                cookies: async () => [cookie({ name: 'wxuin', value: 'FRESH-VALUE', expires: FRESH_S })],
                close: async () => {},
            };
            return context as unknown as BrowserContext;
        });
        const out = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: out, stderr: createBufferTarget() });
        try {
            const code = await profileCheckMain(['check', '--profile', checkDir]);
            expect(code).toBe(0);
            const verdict = JSON.parse(out.text().trim().split('\n').at(-1) ?? '') as { status: string };
            expect(verdict.status).toBe('verified');
            expect(out.text()).not.toContain('STALE-VALUE');
            // Nothing stale was replayed over the live session the profile already held.
            expect(injected.flat()).toEqual([]);
        } finally {
            restore();
            spy.mockRestore();
        }
    });
});
