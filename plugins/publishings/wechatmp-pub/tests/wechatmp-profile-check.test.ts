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

const tmpRoot = join(process.cwd(), '.works/tmp/test-wechat-profile-check');
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

    // 20261016: a dead MP session used to spend the entire forwarded budget in the readiness poll, so
    // `kk plugin check --timeout` SIGKILLed the probe at that instant and reported `probe exit 1
    // (malformed probe output)` instead of the `refused` verdict the operator needs.
    test('--timeout bounds the whole probe: a dead session still reports `refused` inside it', async () => {
        const deadProfile = join(tmpRoot, 'profile-dead-session');
        await mkdir(deadProfile, { recursive: true });
        await writeFile(
            join(deadProfile, 'storage-state.json'),
            JSON.stringify({
                cookies: [{ name: 'slave_sid', value: 'SECRET-VALUE', domain: 'mp.weixin.qq.com', path: '/' }],
                origins: [],
            }),
        );
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(loginPage()) as never,
        );
        try {
            const budgetMs = 3_000;
            const startedAt = Date.now();
            const { code, out } = await run(['check', '--profile', deadProfile, '--timeout', String(budgetMs)]);
            const elapsedMs = Date.now() - startedAt;
            expect(code).toBe(1);
            const verdict = JSON.parse(out.trim().split('\n').at(-1) ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('refused');
            expect(elapsedMs).toBeLessThan(budgetMs);
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

describe('wechatmp-pub profile-check `open` verb (0277)', () => {
    test('open without explicit --profile/--url is a usage error: exit 2, no browser', async () => {
        const opened: unknown[] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => {
            opened.push(1);
            return fakeContext(consoleHomePage()) as never;
        });
        try {
            expect((await run(['open'])).code).toBe(2);
            expect((await run(['open', '--profile', profileDir])).code).toBe(2);
            expect((await run(['open', '--url', 'https://mp.weixin.qq.com/'])).code).toBe(2);
            expect(opened).toHaveLength(0);
        } finally {
            spy.mockRestore();
        }
    });

    test('open without a saved session state refuses: exit 1, context cleaned up, nothing fabricated', async () => {
        await mkdir(profileDir, { recursive: true });
        // Earlier tests in this file leave a captured state behind; this refusal needs it absent.
        await rm(join(profileDir, 'storage-state.json'), { force: true });
        const closed: string[] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(consoleHomePage(), closed) as never,
        );
        try {
            const { code, out } = await run(['open', '--profile', profileDir, '--url', 'https://mp.weixin.qq.com/']);
            expect(code).toBe(1);
            expect(closed).toEqual(['closed']);
            const lines = out.trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('refused');
            expect(verdict.detail).toContain('storage-state.json');
        } finally {
            spy.mockRestore();
        }
    });

    test('open restores the durable state, navigates the supplied --url, and waits for the operator', async () => {
        await mkdir(profileDir, { recursive: true });
        await writeFile(
            join(profileDir, 'storage-state.json'),
            JSON.stringify({ cookies: [{ name: 'slave_sid', value: 'SECRET-VALUE' }], origins: [] }),
        );
        const gotos: string[] = [];
        const closed: string[] = [];
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(async () => {
            const context = {
                pages: () => [{ goto: async (url: string) => void gotos.push(url) }],
                once: (event: string, listener: () => void) => {
                    if (event === 'close') listener();
                },
                addCookies: async () => {},
                close: async () => void closed.push('closed'),
            };
            return context as never;
        });
        try {
            const { code, out } = await run([
                'open',
                '--profile',
                profileDir,
                '--url',
                'https://mp.weixin.qq.com/cgi-bin/app?t=manage/index',
            ]);
            expect(code).toBe(0);
            expect(gotos).toEqual(['https://mp.weixin.qq.com/cgi-bin/app?t=manage/index']);
            const lines = out.trim().split('\n');
            const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
            expect(verdict.status).toBe('verified');
            expect(verdict.detail).toContain('closed by the operator');
            expect(out).not.toContain('SECRET-VALUE');
        } finally {
            spy.mockRestore();
        }
    });
});

describe('wechatmp-pub profile-check login verdict (0277 R3)', () => {
    const loginProfileDir = join(tmpRoot, 'login-profile');

    test('login in bot mode emits the canonical defaultUrl verdict as the LAST stdout line', async () => {
        // `kk bot login` persists a default URL ONLY from this line; without it a completed QR
        // sign-in is discarded ("exited 0 but returned no usable defaultUrl verdict").
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(consoleHomePage()) as never,
        );
        try {
            const { code, out } = await run([
                'login',
                '--profile',
                loginProfileDir,
                '--url',
                'https://mp.weixin.qq.com/cgi-bin/app?t=manage/index&operator=1',
            ]);
            expect(code).toBe(0);
            const lines = out.trim().split('\n');
            expect(JSON.parse(lines[lines.length - 1] ?? '')).toEqual({
                status: 'verified',
                profileDir: loginProfileDir,
                defaultUrl: 'https://mp.weixin.qq.com/',
            });
            // The operator's URL — with its query — must never become the persisted default.
            expect(out).not.toContain('operator=1');
        } finally {
            spy.mockRestore();
        }
    });

    test('login without --url keeps the operator-mode output (no verdict line)', async () => {
        const spy = spyOn(tsBrowserAutomation, 'openPersistentBrowser').mockImplementation(
            async () => fakeContext(consoleHomePage()) as never,
        );
        try {
            const { code, out } = await run(['login', '--profile', loginProfileDir, '--timeout', '50']);
            expect(code).toBe(0);
            expect(out).toContain('login verified');
            expect(out).not.toContain('defaultUrl');
        } finally {
            spy.mockRestore();
        }
    });
});
