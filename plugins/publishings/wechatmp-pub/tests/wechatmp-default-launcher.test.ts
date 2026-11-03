import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Result } from '@gobing-ai/kk-core';
import { kkBrowserLauncher } from '@gobing-ai/publish-harness/browser';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import {
    CONSOLE_URL,
    openWechatLogin,
    persistWechatSessionState,
    storageStatePath,
    WechatmpBrowserTransport,
} from '../src/index';

/**
 * The DEFAULT launcher — the production seam.
 *
 * Every other test injects `openPage`, so `defaultOpenConsole` (index.ts) and the session-state
 * replay inside `openWithState` are otherwise uncovered. They are also the path the live CLI takes:
 * `addCookies` alone is NOT the session (the captured state's `origins` half carries the localStorage
 * that keeps the console off its login page), so the replay order, its skip guards and its
 * failure-tolerance are behavior this file must pin.
 */

const tmpRoot = join(process.cwd(), '.works/tmp/test-wechat-launcher');
const bodyImage = join(tmpRoot, 'body.png');
const profileDir = join(tmpRoot, 'profile');

// The scratch tree must not survive the run: an untracked directory left behind changes the tree
// mid-pass and fails a later evidence binding.
afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

const ARTICLE: Content = {
    title: '每日 AI 资讯 — 2026-10-05',
    body: '# 今日头条\n\n模型发布 **重点** 摘要。',
    format: 'markdown',
    metadata: { wechatmp: { coverPath: bodyImage } },
};

const SAVED_COOKIES = [{ name: 'slave_sid', value: 'v', domain: 'mp.weixin.qq.com', path: '/' }];
const REPLAYED_PAIRS = [
    { name: 'a', value: '1' },
    { name: 'b', value: '2' },
];

interface RawPage {
    page: Page;
    gotos: string[];
    evaluates: { expression: unknown; arg: unknown }[];
}

/** A raw Playwright page recording the launcher's navigation and storage replay. */
function makeRawPage({
    failReplay = false,
    authenticated = false,
}: {
    failReplay?: boolean;
    authenticated?: boolean;
} = {}): RawPage {
    const gotos: string[] = [];
    const evaluates: { expression: unknown; arg: unknown }[] = [];
    return {
        gotos,
        evaluates,
        page: {
            // Deliberately NOT an authenticated route: the run stops at the readiness gate, so these
            // tests measure the launch seam without driving a whole 文章 flow through a fake console.
            url: () =>
                authenticated
                    ? 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index'
                    : 'https://mp.weixin.qq.com/mp/login?lang=zh_CN',
            goto: async (url: string) => {
                if (failReplay && url !== CONSOLE_URL) throw new Error('navigation blocked');
                gotos.push(url);
            },
            evaluate: async (expression: unknown, arg: unknown) => {
                if (failReplay) throw new Error('storage blocked');
                evaluates.push({ expression, arg });
            },
            close: async () => undefined,
        } as unknown as Page,
    };
}

interface LauncherRun {
    result: Result;
    injected: unknown;
    launches: unknown[];
    snapshots: number;
    errors: string;
}

/**
 * Drive `publish` through the production launcher: no `openPage` injected, a stubbed browser, and a
 * real `storage-state.json` in `WECHATMP_PROFILE_DIR`. The preflight is stubbed unless
 * `shippedPreflight` asks for the plugin's own `checkWechatSession`.
 */
async function runDefaultLauncher(options: {
    page: Page;
    storageState?: unknown;
    shippedPreflight?: boolean;
    browserFails?: boolean;
    snapshotError?: string;
    closeError?: string;
}): Promise<LauncherRun> {
    await mkdir(profileDir, { recursive: true });
    await writeFile(bodyImage, 'png');
    const stateFile = join(profileDir, 'storage-state.json');
    if (options.storageState === undefined) await rm(stateFile, { force: true });
    else await writeFile(stateFile, JSON.stringify(options.storageState));

    let injected: unknown;
    let snapshots = 0;
    const context = {
        addCookies: async (cookies: unknown) => {
            injected = cookies;
        },
        pages: () => [options.page],
        newPage: async () => options.page,
        storageState: async ({ path }: { path: string }) => {
            snapshots += 1;
            if (options.snapshotError !== undefined) throw new Error(options.snapshotError);
            await writeFile(path, JSON.stringify({ cookies: SAVED_COOKIES, origins: [] }));
        },
        close: async () => {
            if (options.closeError !== undefined) throw new Error(options.closeError);
        },
    } as unknown as BrowserContext;

    const launches: unknown[] = [];
    spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async (open) => {
        launches.push(open);
        if (options.browserFails === true) throw new tsBrowserAutomation.BrowserProfileMissingError('no profile dir');
        return context;
    });

    const prevProfileDir = process.env.WECHATMP_PROFILE_DIR;
    process.env.WECHATMP_PROFILE_DIR = profileDir;
    const errTarget = createBufferTarget();
    const restoreOutput = setDefaultOutputTargets({ stderr: errTarget });
    try {
        const result = await new WechatmpBrowserTransport({
            checkSession: options.shippedPreflight === true ? undefined : async () => undefined,
            consoleReadyTimeoutMs: 120,
            stepTimeoutMs: 50,
            submitSettleMs: 1,
            draftTimeoutMs: 50,
            submitAttempts: 1,
        }).publish({ content: ARTICLE });
        return { result, injected, launches, snapshots, errors: errTarget.text() };
    } finally {
        restoreOutput();
        mock.restore();
        if (prevProfileDir === undefined) delete process.env.WECHATMP_PROFILE_DIR;
        else process.env.WECHATMP_PROFILE_DIR = prevProfileDir;
    }
}

describe('wechatmp-pub default launcher (stubbed browser, no openPage injected)', () => {
    test('replays the saved localStorage origins and injects cookies before the console navigation', async () => {
        const { page, gotos, evaluates } = makeRawPage();
        const { result, injected, launches } = await runDefaultLauncher({
            page,
            storageState: {
                cookies: SAVED_COOKIES,
                origins: [
                    { origin: 'https://mp.weixin.qq.com', localStorage: REPLAYED_PAIRS },
                    // Entries the launcher must SKIP rather than fail on: no origin, no items.
                    { origin: '', localStorage: [{ name: 'x', value: '9' }] },
                    { origin: 'https://mp.weixin.qq.com', localStorage: [] },
                    { localStorage: [{ name: 'y', value: '8' }] },
                ],
            },
        });

        expect(launches).toEqual([{ profileDir, headless: true, launcher: kkBrowserLauncher }]);
        expect(injected).toEqual(SAVED_COOKIES);
        // The replay happens per origin FIRST; the console is the last navigation.
        expect(gotos).toEqual(['https://mp.weixin.qq.com', CONSOLE_URL]);
        // A string expression, not a typed callback: this plugin's tsconfig has no DOM lib, so a
        // callback cannot compile against `window.localStorage` in the shipped module.
        expect(evaluates).toHaveLength(1);
        expect(typeof evaluates[0]?.expression).toBe('string');
        expect(String(evaluates[0]?.expression)).toContain('localStorage.setItem');
        expect(evaluates[0]?.arg).toEqual(REPLAYED_PAIRS);

        // The recorded failure is the readiness gate — the launcher itself never threw.
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no authenticated wechatmp console');
    });

    test('does not snapshot an unauthenticated launcher page', async () => {
        const { result, snapshots } = await runDefaultLauncher({
            page: makeRawPage().page,
            storageState: { cookies: SAVED_COOKIES, origins: [] },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no authenticated wechatmp console');
        expect(snapshots).toBe(0);
    });

    test('attaches the snapshot callback only after the launcher has an authenticated route', async () => {
        const { result, snapshots } = await runDefaultLauncher({
            page: makeRawPage({ authenticated: true }).page,
            storageState: { cookies: SAVED_COOKIES, origins: [] },
        });

        // The minimal raw page cannot drive the editor, so this is an expected flow failure; the
        // authenticated route still proves the callback runs before the owned context closes.
        expect(result.ok).toBe(false);
        expect(snapshots).toBe(1);
    });

    test('snapshot and close diagnostics never echo a storage secret', async () => {
        const sentinel = 'COOKIE-SENTINEL-DO-NOT-ECHO';
        const snapshot = await runDefaultLauncher({
            page: makeRawPage({ authenticated: true }).page,
            storageState: { cookies: SAVED_COOKIES, origins: [] },
            snapshotError: sentinel,
        });
        expect(snapshot.result.ok).toBe(false);
        expect(snapshot.errors).toContain('authenticated session snapshot failed');
        expect(snapshot.errors).not.toContain(sentinel);

        const closed = await runDefaultLauncher({
            page: makeRawPage({ authenticated: true }).page,
            storageState: { cookies: SAVED_COOKIES, origins: [] },
            closeError: sentinel,
        });
        expect(closed.result.ok).toBe(false);
        expect(closed.snapshots).toBe(1);
        expect(closed.errors).toContain('browser context close failed');
        expect(closed.errors).not.toContain(sentinel);
    });

    test('a localStorage replay the page refuses is swallowed and the console navigation still happens', async () => {
        const { page, gotos, evaluates } = makeRawPage({ failReplay: true });
        const { result, launches } = await runDefaultLauncher({
            page,
            storageState: {
                cookies: SAVED_COOKIES,
                origins: [{ origin: 'https://mp.weixin.qq.com', localStorage: REPLAYED_PAIRS }],
            },
        });

        expect(launches).toHaveLength(1);
        // The origin visit rejected, so only the console navigation is recorded — and it DID run.
        expect(gotos).toEqual([CONSOLE_URL]);
        expect(evaluates).toEqual([]);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no authenticated wechatmp console');
    });

    test('an unset checkSession runs the shipped preflight, which a missing profile refuses fast', async () => {
        const { page, gotos } = makeRawPage();
        const { result, launches } = await runDefaultLauncher({
            page,
            shippedPreflight: true,
            browserFails: true,
        });

        // The shipped preflight is headless and reads the same resolved profile dir.
        expect(launches).toEqual([{ profileDir, headless: true, launcher: kkBrowserLauncher }]);
        expect(gotos).toEqual([]);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no saved console profile');
    });
});

describe('wechatmp-pub authenticated session snapshot', () => {
    test('login uses the atomic state writer and preserves the old state when the write fails', async () => {
        await mkdir(profileDir, { recursive: true });
        const stateFile = storageStatePath(profileDir);
        const previous = JSON.stringify({ cookies: [{ name: 'stable', value: 'stable' }], origins: [] });
        await writeFile(stateFile, previous);
        await chmod(stateFile, 0o600);

        const paths: string[] = [];
        const page = {
            goto: async () => undefined,
            url: () => 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index',
            waitForTimeout: async () => undefined,
        } as unknown as Page;
        const context = {
            pages: () => [page],
            newPage: async () => page,
            storageState: async ({ path }: { path: string }) => {
                paths.push(path);
                throw new Error('snapshot failed COOKIE-SENTINEL-DO-NOT-ECHO');
            },
            close: async () => undefined,
        } as unknown as BrowserContext;
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => context);
        const errTarget = createBufferTarget();
        const restoreOutput = setDefaultOutputTargets({ stderr: errTarget });
        try {
            await expect(openWechatLogin({ profileDir, timeoutMs: 1 })).rejects.toThrow(
                'authenticated session snapshot failed',
            );
        } finally {
            restoreOutput();
            spy.mockRestore();
        }
        expect(paths).toHaveLength(1);
        expect(paths[0]).not.toBe(stateFile);
        expect(await readFile(stateFile, 'utf-8')).toBe(previous);
        expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
        expect(errTarget.text()).not.toContain('COOKIE-SENTINEL-DO-NOT-ECHO');
    });

    test('atomically replaces the saved state after an authenticated publisher refresh', async () => {
        await mkdir(profileDir, { recursive: true });
        const stateFile = join(profileDir, 'storage-state.json');
        await writeFile(stateFile, JSON.stringify({ cookies: [{ name: 'old', value: 'old' }] }));

        const context = {
            storageState: async ({ path }: { path: string }) => {
                await writeFile(path, JSON.stringify({ cookies: [{ name: 'rotated', value: 'rotated' }] }));
            },
        };

        await persistWechatSessionState(context, profileDir);
        expect(JSON.parse(await readFile(stateFile, 'utf-8'))).toEqual({
            cookies: [{ name: 'rotated', value: 'rotated' }],
        });
        expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
    });

    test('a snapshot write failure preserves the previous state for the next run', async () => {
        await mkdir(profileDir, { recursive: true });
        const stateFile = join(profileDir, 'storage-state.json');
        const previous = JSON.stringify({ cookies: [{ name: 'stable', value: 'stable' }] });
        await writeFile(stateFile, previous);
        await chmod(stateFile, 0o600);

        const context = {
            storageState: async () => {
                throw new Error('snapshot write denied');
            },
        };

        await expect(persistWechatSessionState(context, profileDir)).rejects.toThrow('snapshot write denied');
        expect(await readFile(stateFile, 'utf-8')).toBe(previous);
        expect((await stat(stateFile)).mode & 0o777).toBe(0o600);
    });

    test('a rename failure leaves the existing target untouched', async () => {
        await mkdir(profileDir, { recursive: true });
        const stateTarget = join(profileDir, 'storage-state.json');
        await rm(stateTarget, { force: true });
        await mkdir(stateTarget, { recursive: true });
        const marker = join(stateTarget, 'previous-state');
        await writeFile(marker, 'preserve');

        const context = {
            storageState: async ({ path }: { path: string }) => {
                await writeFile(path, JSON.stringify({ cookies: [{ name: 'rotated', value: 'rotated' }] }));
            },
        };

        await expect(persistWechatSessionState(context, profileDir)).rejects.toThrow();
        expect(await readFile(marker, 'utf-8')).toBe('preserve');
    });
});
