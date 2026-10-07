import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as tsBrowserAutomation from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { main as profileCheckMain } from '../src/profile-check';

/**
 * The 0216 probe contract for the wechatmp profile-check CLI: `check|login [--profile] [--timeout]
 * [--headed]`, exit 0/1/2, and one `{status, profileDir, detail}` JSON verdict as the LAST line on
 * stdout (`kk plugin check` parses it). The browser seam is the published package namespace, mocked
 * with `spyOn` like `wechatmp-default-launcher.test.ts` — no real Chromium is ever launched here.
 */

const tmpRoot = join(process.cwd(), '.tmp-test-wechat-profile-check');
const profileDir = join(tmpRoot, 'profile');

afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
});

interface FakeContext {
    pages: () => unknown[];
    newPage: () => Promise<unknown>;
    close: () => Promise<void>;
    addCookies?: (cookies: unknown[]) => Promise<void>;
    storageState?: (opts: { path: string }) => Promise<void>;
}

function fakeContext(page: unknown, closed: string[] = []): FakeContext {
    return {
        pages: () => [],
        newPage: async () => page,
        close: async () => void closed.push('closed'),
        addCookies: async () => {},
        storageState: async () => {},
    };
}

function consoleHomePage(): unknown {
    return {
        goto: async () => {},
        url: () => 'https://mp.weixin.qq.com/cgi-bin/home?t=home/index',
        waitForTimeout: async () => {},
    };
}

function loginPage(): unknown {
    return {
        goto: async () => {},
        url: () => 'https://mp.weixin.qq.com/mp/login?lang=zh_CN',
        waitForTimeout: async () => {},
    };
}

/** Runs `main` with output captured; returns the exit code, stdout text and stderr text. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const out = createBufferTarget();
    const err = createBufferTarget();
    const restore = setDefaultOutputTargets({ stdout: out, stderr: err });
    try {
        const code = await profileCheckMain(argv);
        return { code, out: out.text(), err: err.text() };
    } finally {
        restore();
    }
}

describe('wechatmp-pub profile-check CLI (0216, ADR-032 probe contract)', () => {
    test('unknown command is a usage error: exit 2, no browser opened', async () => {
        const opened: unknown[] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => {
            opened.push(1);
            return fakeContext(consoleHomePage()) as never;
        });
        try {
            const { code, out, err } = await run(['banish']);
            expect(code).toBe(2);
            expect(err).toContain('usage: wechatmp profile-check');
            expect(JSON.parse(out.trim().split('\n').at(-1) ?? '')).toEqual({
                status: 'error',
                detail: "unknown command 'banish'",
            });
            expect(opened).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    test('check without a saved session state refuses: exit 1, JSON verdict last on stdout', async () => {
        await mkdir(profileDir, { recursive: true });
        const closed: string[] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(consoleHomePage(), closed) as never,
        );
        try {
            const { code, out } = await run(['check', '--profile', profileDir]);
            expect(code).toBe(1);
            const lines = out.trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as {
                status: string;
                profileDir: string;
                detail: string;
            };
            expect(verdict.status).toBe('refused');
            expect(verdict.profileDir).toBe(profileDir);
            expect(verdict.detail).toContain('storage-state.json');
            expect(closed).toEqual(['closed']);
        } finally {
            spy.mockRestore();
        }
    });

    test('check with a saved session state verifies: exit 0, cookie values never printed', async () => {
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            join(profileDir, 'storage-state.json'),
            JSON.stringify({
                cookies: [{ name: 'slave_sid', value: 'SECRET-VALUE', domain: 'mp.weixin.qq.com', path: '/' }],
                origins: [],
            }),
        );
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(consoleHomePage()) as never,
        );
        try {
            const { code, out } = await run(['check', '--profile', profileDir]);
            expect(code).toBe(0);
            const lines = out.trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('verified');
            expect(out).not.toContain('SECRET-VALUE');
        } finally {
            spy.mockRestore();
        }
    });

    test('check --headed probes headed only (0216)', async () => {
        await mkdir(profileDir, { recursive: true });
        const requests: Array<{ headless: boolean }> = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async (open) => {
            requests.push({ headless: open.headless });
            return fakeContext(loginPage()) as never;
        });
        try {
            // loginPage never reaches the console, so the check refuses after the single headed pass.
            const { code } = await run(['check', '--headed', '--profile', profileDir, '--timeout', '50']);
            expect(code).toBe(1);
            expect(requests.map((request) => request.headless)).toEqual([false]);
        } finally {
            spy.mockRestore();
        }
    });

    test('login times out when the QR scan never completes: exit 1', async () => {
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(loginPage()) as never,
        );
        try {
            const { code, err } = await run(['login', '--profile', profileDir, '--timeout', '30']);
            expect(code).toBe(1);
            expect(err).toContain('login failed');
        } finally {
            spy.mockRestore();
        }
    });
});
