import { afterAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Content } from '@gobing-ai/kk-core';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import type { BrowserContext, Page } from 'playwright';
import { CONSOLE_URL, WechatmpBrowserTransport } from '../src/index';

/**
 * The DEFAULT launcher — the production seam.
 *
 * Every other test injects `openPage`, so `defaultOpenConsole` (index.ts) and the session-state
 * replay inside `openWithState` are the file's only uncovered path. They are also the path the live
 * CLI takes: `addCookies` alone is NOT the session (the captured state's `origins` half carries the
 * localStorage that keeps the console off its login page), so the replay order and the skip guards
 * are behavior this file must pin.
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

/** A raw Playwright page recording the launcher's navigation and storage replay. */
function makeRawPage() {
    const gotos: string[] = [];
    const evaluates: { expression: unknown; arg: unknown }[] = [];
    const page = {
        // Deliberately NOT an authenticated route: the run stops at the readiness gate, so this test
        // measures the launch seam without driving the whole 文章 flow through a fake console.
        url: () => 'https://mp.weixin.qq.com/mp/login?lang=zh_CN',
        goto: async (url: string) => {
            gotos.push(url);
        },
        evaluate: async (expression: unknown, arg: unknown) => {
            evaluates.push({ expression, arg });
        },
        close: async () => undefined,
    } as unknown as Page;
    return { page, gotos, evaluates };
}

describe('wechatmp-pub default launcher (stubbed browser, no openPage injected)', () => {
    test('replays the saved localStorage origins and injects cookies before the console navigation', async () => {
        await mkdir(tmpRoot, { recursive: true });
        await writeFile(bodyImage, 'png');
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            join(profileDir, 'storage-state.json'),
            JSON.stringify({
                cookies: SAVED_COOKIES,
                origins: [
                    { origin: 'https://mp.weixin.qq.com', localStorage: REPLAYED_PAIRS },
                    // Entries the launcher must SKIP rather than fail on: no origin, no items.
                    { origin: '', localStorage: [{ name: 'x', value: '9' }] },
                    { origin: 'https://mp.weixin.qq.com', localStorage: [] },
                    { localStorage: [{ name: 'y', value: '8' }] },
                ],
            }),
        );

        const { page, gotos, evaluates } = makeRawPage();
        let injected: unknown;
        const context = {
            addCookies: async (cookies: unknown) => {
                injected = cookies;
            },
            pages: () => [page],
            newPage: async () => page,
            close: async () => undefined,
        } as unknown as BrowserContext;

        const launches: unknown[] = [];
        const openSpy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async (options) => {
            launches.push(options);
            return context;
        });

        const prevProfileDir = process.env.WECHATMP_PROFILE_DIR;
        process.env.WECHATMP_PROFILE_DIR = profileDir;
        try {
            // No `openPage` and no `driver`: the production default launcher and the script driver.
            const result = await new WechatmpBrowserTransport({
                checkSession: async () => undefined,
                consoleReadyTimeoutMs: 120,
                stepTimeoutMs: 50,
                submitSettleMs: 1,
                draftTimeoutMs: 50,
                submitAttempts: 1,
            }).publish({ content: ARTICLE });

            expect(openSpy).toHaveBeenCalledTimes(1);
            expect(launches).toEqual([{ profileDir, headless: true }]);
            expect(injected).toEqual(SAVED_COOKIES);
            // The replay happens per origin FIRST; the console is the last navigation.
            expect(gotos).toEqual(['https://mp.weixin.qq.com', CONSOLE_URL]);
            // A string expression, not a typed callback: this plugin's tsconfig has no DOM lib, so
            // a callback cannot compile against `window.localStorage` in the shipped module.
            expect(evaluates).toHaveLength(1);
            expect(typeof evaluates[0]?.expression).toBe('string');
            expect(String(evaluates[0]?.expression)).toContain('localStorage.setItem');
            expect(evaluates[0]?.arg).toEqual(REPLAYED_PAIRS);

            // The recorded failure is the readiness gate — the launcher itself never threw.
            expect(result.ok).toBe(false);
            expect(result.error).toContain('no authenticated wechatmp console');
        } finally {
            mock.restore();
            if (prevProfileDir === undefined) delete process.env.WECHATMP_PROFILE_DIR;
            else process.env.WECHATMP_PROFILE_DIR = prevProfileDir;
        }
    });
});
