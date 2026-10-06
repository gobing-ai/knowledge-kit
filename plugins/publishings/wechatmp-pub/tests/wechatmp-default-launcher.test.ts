import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content, Result } from '@gobing-ai/kk-core';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import type { BrowserContext, Page } from 'playwright';
import { CONSOLE_URL, WechatmpBrowserTransport } from '../src/index';

/**
 * The DEFAULT launcher — the production seam.
 *
 * Every other test injects `openPage`, so `defaultOpenConsole` (index.ts) and the session-state
 * replay inside `openWithState` are otherwise uncovered. They are also the path the live CLI takes:
 * `addCookies` alone is NOT the session (the captured state's `origins` half carries the localStorage
 * that keeps the console off its login page), so the replay order, its skip guards and its
 * failure-tolerance are behavior this file must pin.
 */

const tmpRoot = join(process.cwd(), '.tmp-test-wechat-launcher');
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
function makeRawPage({ failReplay = false }: { failReplay?: boolean } = {}): RawPage {
    const gotos: string[] = [];
    const evaluates: { expression: unknown; arg: unknown }[] = [];
    return {
        gotos,
        evaluates,
        page: {
            // Deliberately NOT an authenticated route: the run stops at the readiness gate, so these
            // tests measure the launch seam without driving a whole 文章 flow through a fake console.
            url: () => 'https://mp.weixin.qq.com/mp/login?lang=zh_CN',
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
}): Promise<LauncherRun> {
    await mkdir(profileDir, { recursive: true });
    await writeFile(bodyImage, 'png');
    const stateFile = join(profileDir, 'storage-state.json');
    if (options.storageState === undefined) await rm(stateFile, { force: true });
    else await writeFile(stateFile, JSON.stringify(options.storageState));

    let injected: unknown;
    const context = {
        addCookies: async (cookies: unknown) => {
            injected = cookies;
        },
        pages: () => [options.page],
        newPage: async () => options.page,
        close: async () => undefined,
    } as unknown as BrowserContext;

    const launches: unknown[] = [];
    spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async (open) => {
        launches.push(open);
        if (options.browserFails === true) throw new tsBrowserAutomation.BrowserProfileMissingError('no profile dir');
        return context;
    });

    const prevProfileDir = process.env.WECHATMP_PROFILE_DIR;
    process.env.WECHATMP_PROFILE_DIR = profileDir;
    try {
        const result = await new WechatmpBrowserTransport({
            checkSession: options.shippedPreflight === true ? undefined : async () => undefined,
            consoleReadyTimeoutMs: 120,
            stepTimeoutMs: 50,
            submitSettleMs: 1,
            draftTimeoutMs: 50,
            submitAttempts: 1,
        }).publish({ content: ARTICLE });
        return { result, injected, launches };
    } finally {
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

        expect(launches).toEqual([{ profileDir, headless: true }]);
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
        expect(launches).toEqual([{ profileDir, headless: true }]);
        expect(gotos).toEqual([]);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no saved console profile');
    });
});
