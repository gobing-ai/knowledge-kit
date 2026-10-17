import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { BrowserLauncher, ProfileLaunchRequest } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { BrowserContext, Cookie } from 'playwright';
import { BotError, DEFAULT_BOT_LOGIN_TIMEOUT_MS, execBot, loginBot, openBot } from '../src/browser';
import { acquireProfileLease } from '../src/profile-lease';

/**
 * Generic `kk bot` session lifecycle (task 0276, design §Bot command contract), driven through an
 * injected fake launcher: no browser binary, no real profile root. These tests prove the login
 * transaction, the confirmation contract, the reopen-until-close behaviour and the navigation
 * redaction. The one exception is the AC1 cookie test at the end of the exec block, which needs a
 * real persistent context and skips (announcing it) when Chromium is not installed.
 */

const DEFAULT_URL = 'https://alice.example.com/home';

/**
 * True when a real Chromium is not usable here (`bunx playwright install chromium`). Decided
 * before any launch so a missing browser skips the one real-browser test instead of failing it —
 * same probe as the image-gen compose E2E, which has to pick it at collection time.
 */
function chromiumMissing(): boolean {
    try {
        const { chromium } = require('playwright') as typeof import('playwright');
        const executable = chromium.executablePath();
        return executable === '' || !existsSync(executable);
    } catch {
        return true;
    }
}

interface FakeHandle {
    close(): Promise<void>;
    closeCount(): number;
    /** Make the next `pages()` call report an empty page list (exercises `newPage()`). */
    emptyPages(): void;
}

interface FakeSession {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    navigations: string[];
    handles: FakeHandle[];
    /** URLs the session-fact capture asked the cookie jar about (0305). */
    cookieQueries: string[];
}

/** Fake persistent context recording the profile requests and page navigations. */
function makeSession(
    options: { gotoError?: boolean; rejectConfirm?: boolean; cookies?: Partial<Cookie>[] } = {},
): FakeSession {
    const requests: ProfileLaunchRequest[] = [];
    const navigations: string[] = [];
    const handles: FakeHandle[] = [];
    const cookieQueries: string[] = [];
    const launcher: BrowserLauncher = {
        async launch(request) {
            requests.push(request);
            let closes = 0;
            let pagesEmpty = false;
            const listeners: (() => void)[] = [];
            const page = {
                async goto(url: string) {
                    if (options.gotoError === true) {
                        throw new Error(`page.goto: net::ERR_NAME_NOT_RESOLVED at ${url}`);
                    }
                    navigations.push(url);
                },
            };
            const cookies = async (url: string) => {
                cookieQueries.push(url);
                return (options.cookies ?? []).map((cookie) => ({
                    name: 'auth',
                    value: 'SEKRET-COOKIE',
                    domain: 'site.example.com',
                    path: '/',
                    expires: -1,
                    httpOnly: true,
                    secure: true,
                    sameSite: 'Lax',
                    ...cookie,
                }));
            };
            const close = async (): Promise<void> => {
                closes += 1;
                for (const listener of listeners.splice(0)) listener();
            };
            const context = {
                cookies,
                pages: () => (pagesEmpty ? [] : [page]),
                newPage: async () => page,
                once: (_event: string, listener: () => void) => {
                    listeners.push(listener);
                    return context;
                },
                close,
            };
            handles.push({
                close,
                closeCount: () => closes,
                emptyPages: () => {
                    pagesEmpty = true;
                },
            });
            return context as unknown as BrowserContext;
        },
    };
    return { launcher, requests, navigations, handles, cookieQueries };
}

/** A stdin-shaped stream that reports itself as an interactive terminal. */
function fakeTty(): PassThrough {
    const stream = new PassThrough();
    Object.defineProperty(stream, 'isTTY', { value: true, configurable: true });
    return stream;
}

/** Run `body` with `process.stdin`/`process.stdout` swapped for a fake TTY, always restored. */
async function withFakeTty<T>(input: PassThrough, body: () => Promise<T>): Promise<T> {
    const stdin = Object.getOwnPropertyDescriptor(process, 'stdin');
    const stdout = Object.getOwnPropertyDescriptor(process, 'stdout');
    Object.defineProperty(process, 'stdin', { value: input, configurable: true });
    Object.defineProperty(process, 'stdout', { value: new PassThrough(), configurable: true });
    try {
        return await body();
    } finally {
        if (stdin !== undefined) Object.defineProperty(process, 'stdin', stdin);
        if (stdout !== undefined) Object.defineProperty(process, 'stdout', stdout);
    }
}

/** Bounded poll — the session helpers release leases from event listeners, asynchronously. */
async function settle(probe: () => boolean): Promise<void> {
    for (let i = 0; i < 400; i += 1) {
        if (probe()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

describe('bot session lifecycle (0276)', () => {
    let root: string;
    let profileRoot: string;
    let profileDir: string;
    let leaseRoot: string;
    let transactionRoot: string;
    const fileSystem = createNodeFileSystem();

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-session-'));
        profileRoot = join(root, 'profiles');
        profileDir = join(profileRoot, 'alice');
        leaseRoot = join(root, 'leases');
        transactionRoot = join(root, 'transactions');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const deps = () => ({ root: profileRoot, leaseRoot, transactionRoot, fileSystem });
    const listIfPresent = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

    const seedSavedBot = (): void => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'Cookies'), 'old-cookie');
        writeFileSync(
            join(profileDir, 'bot.json'),
            JSON.stringify({
                schemaVersion: 1,
                defaultUrl: DEFAULT_URL,
                authenticationEvidence: 'operator-confirmed',
            }),
        );
    };

    test('login saves an operator-confirmed session at origin+pathname, navigating the full URL', async () => {
        const session = makeSession();
        const deadlines: number[] = [];
        const supplied = 'https://site.example.com/login?token=SEKRET#frag';

        const result = await loginBot('alice', supplied, {
            ...deps(),
            launcher: session.launcher,
            confirm: async (timeoutMs) => {
                deadlines.push(timeoutMs);
                return true;
            },
        });

        expect(DEFAULT_BOT_LOGIN_TIMEOUT_MS).toBe(180_000);
        expect(deadlines).toEqual([DEFAULT_BOT_LOGIN_TIMEOUT_MS]);
        expect(result.defaultUrl).toBe('https://site.example.com/login');
        // The full supplied URL is navigation input only.
        expect(session.navigations).toEqual([supplied]);
        // The browser opened the staged profile headed, never the final path.
        expect(session.requests).toHaveLength(1);
        expect(session.requests[0]?.headless).toBe(false);
        expect(session.requests[0]?.profileDir).not.toBe(profileDir);
        expect(session.requests[0]?.profileDir.startsWith(transactionRoot)).toBe(true);

        const metadataPath = join(profileDir, 'bot.json');
        const stored = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
        expect(stored).toMatchObject({
            schemaVersion: 1,
            defaultUrl: 'https://site.example.com/login',
            authenticationEvidence: 'operator-confirmed',
        });
        // AC1: the save time is recorded, traceable to this invocation.
        expect(Date.now() - Date.parse(String(stored.lastLoginAt))).toBeLessThan(60_000);
        expect(new Date(String(stored.lastLoginAt)).toISOString()).toBe(String(stored.lastLoginAt));
        // AC2: a jar with only session cookies yields no expiry estimate.
        expect(stored).not.toHaveProperty('expiresAt');
        expect(session.cookieQueries).toEqual(['https://site.example.com/login']);
        expect(statSync(metadataPath).mode & 0o777).toBe(0o600);
        expect(statSync(profileDir).mode & 0o777).toBe(0o700);
        // No credential value from the supplied URL reached the metadata.
        expect(readFileSync(metadataPath, 'utf8')).not.toContain('SEKRET');
        // Success removed this invocation's transaction and released the lease.
        expect(listIfPresent(transactionRoot)).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
        expect(session.handles[0]?.closeCount()).toBe(1);
    });

    test('login stores a plugin name when an adapter supplies one (0277 handoff)', async () => {
        const session = makeSession();
        await loginBot('alice', 'https://site.example.com/login', {
            ...deps(),
            launcher: session.launcher,
            confirm: async () => true,
            pluginName: 'xhs-pub',
        });

        expect(JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8'))).toMatchObject({
            authenticationEvidence: 'operator-confirmed',
            pluginName: 'xhs-pub',
        });
    });

    test('login records the earliest persistent httpOnly cookie expiry (0305 R2/R3)', async () => {
        const later = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000);
        const earlier = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);
        const session = makeSession({
            cookies: [
                // Session cookie: no expiry to record.
                { expires: -1 },
                // Non-httpOnly analytics cookie: never the auth signal.
                { httpOnly: false, expires: Math.floor(Date.parse('2026-10-20T00:00:00Z') / 1000) },
                { expires: later },
                { expires: earlier },
            ],
        });

        await loginBot('alice', 'https://site.example.com/login', {
            ...deps(),
            launcher: session.launcher,
            confirm: async () => true,
        });

        const raw = readFileSync(join(profileDir, 'bot.json'), 'utf8');
        expect(JSON.parse(raw)).toMatchObject({ expiresAt: '2026-11-01T00:00:00.000Z' });
        // Cookie names and values never reach disk.
        expect(raw).not.toContain('SEKRET-COOKIE');
        expect(raw).not.toContain('"auth"');
    });

    test('a refused login records no facts at all (0305: no write on refusal)', async () => {
        seedSavedBot();
        const session = makeSession({
            cookies: [{ expires: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000) }],
        });
        await expect(
            loginBot('alice', 'https://site.example.com/login', {
                ...deps(),
                launcher: session.launcher,
                confirm: async () => false,
            }),
        ).rejects.toBeInstanceOf(BotError);

        const stored = JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')) as Record<string, unknown>;
        expect(stored).not.toHaveProperty('lastLoginAt');
        expect(stored).not.toHaveProperty('expiresAt');
        expect(session.cookieQueries).toEqual([]);
    });

    test('a cancelled login saves nothing and preserves the previous profile', async () => {
        seedSavedBot();
        const session = makeSession();
        let caught: unknown;
        try {
            await loginBot('alice', 'https://site.example.com/login', {
                ...deps(),
                launcher: session.launcher,
                confirm: async () => false,
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('unconfirmed');
        expect(readFileSync(join(profileDir, 'Cookies'), 'utf8')).toBe('old-cookie');
        expect(JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')).defaultUrl).toBe(DEFAULT_URL);
        // Staging is owned by this invocation, so it is removed; the lease is released.
        expect(listIfPresent(transactionRoot)).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
        expect(session.handles[0]?.closeCount()).toBe(1);
    });

    test('a failed navigation reports the failure without echoing the supplied URL', async () => {
        const session = makeSession({ gotoError: true });
        let caught: unknown;
        try {
            await loginBot('alice', 'https://site.example.com/login?token=SEKRET', {
                ...deps(),
                launcher: session.launcher,
                confirm: async () => true,
            });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('browser');
        expect((caught as BotError).message).toContain('<login-url>');
        expect((caught as BotError).message).not.toContain('SEKRET');
        expect(existsSync(profileDir)).toBe(false);
        expect(listIfPresent(transactionRoot)).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('refuses a generic login when interactive input is unavailable', async () => {
        // A TTY would make the real prompt wait for the operator; the non-TTY refusal is the path
        // this test owns (the TTY prompt itself is exercised by the operator, not here).
        if (process.stdin.isTTY === true) return;
        const session = makeSession();
        let caught: unknown;
        try {
            await loginBot('alice', 'https://site.example.com/login', { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('unconfirmed');
        expect((caught as BotError).message).toContain('no interactive terminal');
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('the generic login confirms on a TTY: an affirmative answer saves the session', async () => {
        const input = fakeTty();
        const session = makeSession();
        const result = await withFakeTty(input, async () => {
            const pending = loginBot('alice', 'https://site.example.com/login', {
                ...deps(),
                launcher: session.launcher,
            });
            await new Promise((resolve) => setTimeout(resolve, 20));
            input.write('yes\n');
            return await pending;
        });

        expect(result.defaultUrl).toBe('https://site.example.com/login');
        expect(JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')).authenticationEvidence).toBe(
            'operator-confirmed',
        );
    });

    test('the generic login refuses "no", a closed stdin and a confirmation timeout', async () => {
        const cases: { name: string; answer?: string; close?: boolean; timeoutMs?: number }[] = [
            { name: 'alice', answer: 'n\n' },
            { name: 'bob', close: true },
            { name: 'carol', timeoutMs: 30 },
        ];
        for (const testCase of cases) {
            const input = fakeTty();
            const session = makeSession();
            let caught: unknown;
            try {
                await withFakeTty(input, async () => {
                    const pending = loginBot(testCase.name, 'https://site.example.com/login', {
                        ...deps(),
                        launcher: session.launcher,
                        ...(testCase.timeoutMs === undefined ? {} : { timeoutMs: testCase.timeoutMs }),
                    });
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    if (testCase.close === true) input.end();
                    else if (testCase.answer !== undefined) input.write(testCase.answer);
                    await pending;
                });
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(BotError);
            expect((caught as BotError).code).toBe('unconfirmed');
            expect(existsSync(join(profileRoot, testCase.name))).toBe(false);
        }
        expect(listIfPresent(leaseRoot)).toEqual([]);
        expect(listIfPresent(transactionRoot)).toEqual([]);
    });

    test('refuses an unsafe name and a non-http URL before any effect', async () => {
        const session = makeSession();
        for (const [name, url] of [
            ['bad name', 'https://site.example.com/'],
            ['alice', 'ftp://site.example.com/'],
            ['alice', 'https://user:secret@site.example.com/'],
        ] as const) {
            let caught: unknown;
            try {
                await loginBot(name, url, { ...deps(), launcher: session.launcher, confirm: async () => true });
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(BotError);
            expect((caught as BotError).code).toBe('usage');
            expect((caught as BotError).message).not.toContain('secret');
        }
        expect(session.requests).toEqual([]);
        expect(existsSync(profileRoot)).toBe(false);
    });

    test('refuses a login while the profile lease is held (busy)', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot, fileSystem });
        const session = makeSession();
        let caught: unknown;
        try {
            await loginBot('alice', 'https://site.example.com/login', {
                ...deps(),
                launcher: session.launcher,
                confirm: async () => true,
            });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('busy');
        expect(session.requests).toEqual([]);
        expect(listIfPresent(transactionRoot)).toEqual([]);
        await lease.release();
    });

    test('open reopens the saved page headed and stays until the context closes', async () => {
        seedSavedBot();
        const session = makeSession();
        const pending = openBot('alice', { ...deps(), launcher: session.launcher });
        session.handles[0]?.emptyPages();
        await settle(() => session.navigations.length === 1);

        expect(session.requests[0]).toMatchObject({ profileDir, headless: false });
        expect(session.navigations).toEqual([DEFAULT_URL]);
        // The session is still open, so the lease is still held.
        expect(listIfPresent(leaseRoot)).toHaveLength(1);

        await session.handles[0]?.close();
        const result = await pending;
        expect(result.defaultUrl).toBe(DEFAULT_URL);
        expect(result.message).toContain('closed the local session');
        expect(listIfPresent(leaseRoot)).toEqual([]);
        expect(readFileSync(join(profileDir, 'bot.json'), 'utf8')).toContain(DEFAULT_URL);
    });

    test('open --login reauthenticates through the login transaction, then reopens the saved page', async () => {
        seedSavedBot();
        const session = makeSession();
        const pending = openBot('alice', {
            ...deps(),
            launcher: session.launcher,
            login: true,
            confirm: async () => true,
        });
        await settle(() => session.requests.length === 2);

        // First launch staged the re-login, second reopened the saved final profile.
        expect(session.requests[0]?.profileDir).not.toBe(profileDir);
        expect(session.requests[1]).toMatchObject({ profileDir, headless: false });
        expect(session.navigations).toEqual([DEFAULT_URL, DEFAULT_URL]);
        expect(session.handles[0]?.closeCount()).toBe(1);

        await session.handles[1]?.close();
        const result = await pending;
        expect(result.defaultUrl).toBe(DEFAULT_URL);
        expect(listIfPresent(transactionRoot)).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('open never invents a session for a missing, legacy or corrupt profile', async () => {
        const session = makeSession();

        // Missing profile directory.
        let caught: unknown;
        try {
            await openBot('ghost', { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('not-found');
        expect((caught as BotError).message).toContain('kk bot login <url> --save ghost');

        // Legacy profile without metadata (also through the --login route).
        mkdirSync(join(profileRoot, 'legacy'), { recursive: true });
        for (const options of [{}, { login: true }]) {
            caught = undefined;
            try {
                await openBot('legacy', { ...deps(), launcher: session.launcher, ...options });
            } catch (error) {
                caught = error;
            }
            expect((caught as BotError).code).toBe('persistence');
            expect((caught as BotError).message).toContain('kk bot login <url> --save legacy');
        }

        // Corrupt metadata is reported and left untouched.
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(join(profileDir, 'bot.json'), '{ not json');
        caught = undefined;
        try {
            await openBot('alice', { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).code).toBe('persistence');
        expect(readFileSync(join(profileDir, 'bot.json'), 'utf8')).toBe('{ not json');
        expect(session.requests).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });
});

describe('known-plugin adapter sessions (0277 R2/R3)', () => {
    let root: string;
    let profileRoot: string;
    let profileDir: string;
    let leaseRoot: string;
    let transactionRoot: string;
    const fileSystem = createNodeFileSystem();

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-adapter-'));
        profileRoot = join(root, 'profiles');
        profileDir = join(profileRoot, 'juejin');
        leaseRoot = join(root, 'leases');
        transactionRoot = join(root, 'transactions');
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const deps = () => ({ root: profileRoot, leaseRoot, transactionRoot, fileSystem });
    const listIfPresent = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

    /** Adapter fake recording the run request and replaying a scripted child outcome. */
    function makeAdapter(outcome: { exitCode: number; stdout: string } = { exitCode: 0, stdout: '' }) {
        const requests: Array<{ mode: string; profileDir: string; url: string; env: Record<string, string> }> = [];
        return {
            requests,
            adapter: {
                pluginName: 'juejin-pub',
                run: async (request: {
                    mode: string;
                    profileDir: string;
                    url: string;
                    env: Record<string, string>;
                }) => {
                    requests.push(request);
                    return outcome;
                },
            },
        };
    }

    test('adapter login promotes without a prompt, keeping the plugin-fixed query (Juejin ?v=2)', async () => {
        const { adapter, requests } = makeAdapter({
            exitCode: 0,
            stdout:
                'juejin profile login verified\n' +
                JSON.stringify({
                    status: 'verified',
                    profileDir: '/stage',
                    defaultUrl: 'https://juejin.example.com/editor/drafts/new?v=2',
                }),
        });
        const result = await loginBot('juejin', 'https://juejin.example.com/editor/drafts/new?token=SEKRET', {
            ...deps(),
            adapter,
        });

        // The child ran inside the transaction's staged profile under the delegated lease.
        expect(requests).toHaveLength(1);
        expect(requests[0]?.mode).toBe('login');
        expect(requests[0]?.profileDir.startsWith(transactionRoot)).toBe(true);
        expect(requests[0]?.env.KK_BOT_LEASE_PATH).toContain('lease');
        expect(requests[0]?.env.KK_BOT_LEASE_TOKEN).not.toBe('');
        // The persisted defaultUrl is the plugin-owned canonical URL — its ?v=2 is code, kept;
        // the operator-supplied token query never reaches disk.
        expect(result.defaultUrl).toBe('https://juejin.example.com/editor/drafts/new?v=2');
        const stored = JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')) as Record<string, unknown>;
        expect(stored).toMatchObject({
            defaultUrl: 'https://juejin.example.com/editor/drafts/new?v=2',
            authenticationEvidence: 'site-verified',
            pluginName: 'juejin-pub',
        });
        expect(readFileSync(join(profileDir, 'bot.json'), 'utf8')).not.toContain('SEKRET');
        expect(result.message).toContain('site-verified');
        // Success consumed the transaction and released the lease.
        expect(listIfPresent(transactionRoot)).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('adapter login stores the reported identity and expiry plus the save time (0305 R3)', async () => {
        const { adapter } = makeAdapter({
            exitCode: 0,
            stdout:
                'juejin profile login verified\n' +
                JSON.stringify({
                    status: 'verified',
                    profileDir: '/stage',
                    defaultUrl: 'https://juejin.example.com/editor/drafts/new?v=2',
                    expiresAt: '2026-11-16T02:00:00.000Z',
                    identity: '  alice@example.com \u001b[0m',
                }),
        });
        await loginBot('juejin', 'https://juejin.example.com/editor/drafts/new', { ...deps(), adapter });

        const stored = JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')) as Record<string, unknown>;
        expect(stored).toMatchObject({
            expiresAt: '2026-11-16T02:00:00.000Z',
            // Trimmed, control characters stripped, capped — never stored raw.
            identity: 'alice@example.com [0m',
        });
        expect(Date.now() - Date.parse(String(stored.lastLoginAt))).toBeLessThan(60_000);
    });

    test('invalid adapter facts are dropped, not fatal: the login still verifies (0305 R3)', async () => {
        const { adapter } = makeAdapter({
            exitCode: 0,
            stdout: JSON.stringify({
                status: 'verified',
                profileDir: '/stage',
                defaultUrl: 'https://juejin.example.com/editor/drafts/new',
                expiresAt: 'tomorrow',
                identity: 'a'.repeat(500),
            }),
        });
        const result = await loginBot('juejin', 'https://juejin.example.com/editor/drafts/new', {
            ...deps(),
            adapter,
        });
        expect(result.message).toContain('site-verified');

        const stored = JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')) as Record<string, unknown>;
        expect(stored).not.toHaveProperty('expiresAt');
        // An overlong label is capped rather than refused.
        expect(stored.identity).toHaveLength(128);
        expect(stored.lastLoginAt).toBeString();
    });

    test('an adapter verdict without facts still parses (existing 0277 verdicts keep working)', async () => {
        const { adapter } = makeAdapter({
            exitCode: 0,
            stdout: JSON.stringify({
                status: 'verified',
                profileDir: '/stage',
                defaultUrl: 'https://juejin.example.com/editor/drafts/new',
            }),
        });
        await loginBot('juejin', 'https://juejin.example.com/editor/drafts/new', { ...deps(), adapter });
        const stored = JSON.parse(readFileSync(join(profileDir, 'bot.json'), 'utf8')) as Record<string, unknown>;
        expect(stored).not.toHaveProperty('identity');
        expect(stored).not.toHaveProperty('expiresAt');
        expect(stored.lastLoginAt).toBeString();
    });

    test('adapter child failures save nothing: exit 2 is usage, others are operational', async () => {
        const usage = makeAdapter({ exitCode: 2, stdout: 'usage: ...' });
        let caught: unknown;
        try {
            await loginBot('juejin', 'https://juejin.example.com/', { ...deps(), adapter: usage.adapter });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('usage');
        expect(existsSync(profileDir)).toBe(false);
        expect(listIfPresent(transactionRoot)).toEqual([]);

        const failed = makeAdapter({ exitCode: 1, stdout: '' });
        caught = undefined;
        try {
            await loginBot('juejin', 'https://juejin.example.com/', { ...deps(), adapter: failed.adapter });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).code).toBe('browser');

        // Exit 0 without a parseable verdict is refused too — nothing half-saved.
        const mute = makeAdapter({ exitCode: 0, stdout: 'no verdict here' });
        caught = undefined;
        try {
            await loginBot('juejin', 'https://juejin.example.com/', { ...deps(), adapter: mute.adapter });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).code).toBe('browser');
        expect(existsSync(profileDir)).toBe(false);
    });

    test('open through the adapter reuses the saved default and releases the lease on failure', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(
            join(profileDir, 'bot.json'),
            JSON.stringify({
                schemaVersion: 1,
                defaultUrl: 'https://juejin.example.com/editor/drafts/new?v=2',
                authenticationEvidence: 'site-verified',
                pluginName: 'juejin-pub',
            }),
        );
        const { adapter, requests } = makeAdapter({ exitCode: 0, stdout: '' });
        const result = await openBot('juejin', { ...deps(), adapter });
        expect(result.defaultUrl).toBe('https://juejin.example.com/editor/drafts/new?v=2');
        expect(requests[0]?.mode).toBe('open');
        expect(requests[0]?.profileDir).toBe(profileDir);
        expect(requests[0]?.env.KK_BOT_LEASE_PATH).toContain('lease');
        expect(listIfPresent(leaseRoot)).toEqual([]);

        // A failing child still releases the lease (finally), and exit 2 maps to usage.
        const refuser = makeAdapter({ exitCode: 2, stdout: '' });
        let caught: unknown;
        try {
            await openBot('juejin', { ...deps(), adapter: refuser.adapter });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).code).toBe('usage');
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('generic metadata may not smuggle a query: only adapter-owned defaultUrls keep one', async () => {
        mkdirSync(profileDir, { recursive: true });
        writeFileSync(
            join(profileDir, 'bot.json'),
            JSON.stringify({
                schemaVersion: 1,
                defaultUrl: 'https://alice.example.com/home?token=SEKRET',
                authenticationEvidence: 'operator-confirmed',
            }),
        );
        let caught: unknown;
        try {
            await openBot('juejin', { ...deps() });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('persistence');
    });
});

describe('bot exec (0306: one authenticated request)', () => {
    let root: string;
    let profileRoot: string;
    let profileDir: string;
    let leaseRoot: string;
    const fileSystem = createNodeFileSystem();

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'kk-bot-exec-'));
        profileRoot = join(root, 'profiles');
        profileDir = join(profileRoot, 'alice');
        leaseRoot = join(root, 'leases');
        mkdirSync(profileDir, { recursive: true });
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    const deps = () => ({ root: profileRoot, leaseRoot, fileSystem });
    const listIfPresent = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

    /** One fake `context.request.fetch` invocation. */
    interface FetchCall {
        url: string;
        options: Record<string, unknown>;
    }

    interface ExecOutcome {
        /** Thrown by `fetch` (a transport failure). */
        fetchError?: Error;
        /** Thrown by `response.body()`. */
        bodyError?: Error;
        status?: number;
        statusText?: string;
        headers?: Array<{ name: string; value: string }>;
        body?: string;
    }

    /** Fake persistent context whose APIRequestContext records the request and replays a response. */
    function makeExecSession(outcome: ExecOutcome = {}) {
        const calls: FetchCall[] = [];
        const requests: ProfileLaunchRequest[] = [];
        let closes = 0;
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                const context = {
                    request: {
                        async fetch(url: string, options: Record<string, unknown>) {
                            calls.push({ url, options });
                            if (outcome.fetchError !== undefined) throw outcome.fetchError;
                            return {
                                status: () => outcome.status ?? 200,
                                statusText: () => outcome.statusText ?? 'OK',
                                headersArray: () => outcome.headers ?? [{ name: 'content-type', value: 'text/plain' }],
                                body: async () => {
                                    if (outcome.bodyError !== undefined) throw outcome.bodyError;
                                    return Buffer.from(outcome.body ?? 'hello');
                                },
                            };
                        },
                    },
                    close: async () => {
                        closes += 1;
                    },
                };
                return context as unknown as BrowserContext;
            },
        };
        return { launcher, calls, requests, closeCount: () => closes };
    }

    const request = (overrides: Partial<Parameters<typeof execBot>[1]> = {}) => ({
        url: 'https://site.example.com/path?token=SEKRET',
        method: 'GET',
        headers: {},
        followRedirects: false,
        ...overrides,
    });

    test('sends one request through the headless persistent context under the lease', async () => {
        const session = makeExecSession({ body: 'pong' });

        const response = await execBot(
            'alice',
            request({
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                data: Buffer.from('ping'),
                timeoutMs: 1500,
            }),
            { ...deps(), launcher: session.launcher },
        );

        expect(response).toEqual({
            status: 200,
            statusText: 'OK',
            headers: [{ name: 'content-type', value: 'text/plain' }],
            body: Buffer.from('pong'),
        });
        // The URL is sent as given (query kept); the fragment never reaches the wire.
        expect(session.calls).toEqual([
            {
                url: 'https://site.example.com/path?token=SEKRET',
                options: {
                    method: 'POST',
                    headers: { 'content-type': 'text/plain' },
                    data: Buffer.from('ping'),
                    failOnStatusCode: false,
                    maxRedirects: 0,
                    timeout: 1500,
                },
            },
        ]);
        expect(session.requests).toEqual([{ profileDir, headless: true }]);
        expect(session.closeCount()).toBe(1);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('follows redirects only with -L and leaves the 30 s default timeout in place without -m', async () => {
        const session = makeExecSession();
        await execBot('alice', request({ followRedirects: true }), { ...deps(), launcher: session.launcher });

        expect(session.calls[0]?.options).toEqual({ method: 'GET', headers: {}, failOnStatusCode: false });
    });

    test('never creates a profile and points at login guidance when the directory is missing', async () => {
        const session = makeExecSession();
        let caught: unknown;
        try {
            await execBot('ghost', request(), { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('not-found');
        expect((caught as BotError).message).toContain('kk bot login <url> --save ghost');
        expect(session.requests).toEqual([]);
        expect(existsSync(join(profileRoot, 'ghost'))).toBe(false);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    test('refuses a held lease instead of waiting for it', async () => {
        const lease = await acquireProfileLease(profileDir, { leaseRoot, fileSystem });
        const session = makeExecSession();
        let caught: unknown;
        try {
            await execBot('alice', request(), { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('busy');
        expect(session.calls).toEqual([]);
        await lease.release();
    });

    test('reports a transport failure URL-free and still closes the context and releases the lease', async () => {
        const session = makeExecSession({
            fetchError: new Error(
                'apiRequestContext.fetch: connect ECONNREFUSED https://site.example.com/path?token=SEKRET\nCall log:\n  - → GET https://site.example.com/path?token=SEKRET',
            ),
        });
        let caught: unknown;
        try {
            await execBot('alice', request(), { ...deps(), launcher: session.launcher });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('browser');
        expect((caught as BotError).message).not.toContain('https://site.example.com');
        expect((caught as BotError).message).not.toContain('SEKRET');
        expect((caught as BotError).message).toContain('ECONNREFUSED');
        expect(session.closeCount()).toBe(1);
        expect(listIfPresent(leaseRoot)).toEqual([]);

        // Under -L the failing hop can be the redirect target, a URL the caller never supplied.
        const redirected = makeExecSession({
            fetchError: new Error(
                'apiRequestContext.fetch: read ECONNRESET at http://other.example.net/next?code=REDIR',
            ),
        });
        caught = undefined;
        try {
            await execBot('alice', request(), { ...deps(), launcher: redirected.launcher });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).message).not.toContain('other.example.net');
        expect((caught as BotError).message).not.toContain('REDIR');
        expect((caught as BotError).message).toContain('ECONNRESET');

        const unreadable = makeExecSession({ bodyError: new Error('Response body is unavailable for https://x/') });
        caught = undefined;
        try {
            await execBot('alice', request(), { ...deps(), launcher: unreadable.launcher });
        } catch (error) {
            caught = error;
        }
        expect((caught as BotError).code).toBe('browser');
        expect((caught as BotError).message).toContain('response unreadable');
        expect(unreadable.closeCount()).toBe(1);
    });

    test('rejects an unsafe name, a non-http scheme and an embedded credential before any effect', async () => {
        const session = makeExecSession();
        const cases: Array<{ name: string; url: string; code: string; leak?: string }> = [
            { name: 'bad name', url: 'https://site.example.com/', code: 'usage' },
            { name: 'alice', url: 'ftp://site.example.com/x', code: 'usage', leak: 'ftp://' },
            { name: 'alice', url: 'https://user:secret@site.example.com/', code: 'usage', leak: 'secret' },
            { name: 'alice', url: 'not-a-url', code: 'usage' },
        ];
        for (const testCase of cases) {
            let caught: unknown;
            try {
                await execBot(testCase.name, request({ url: testCase.url }), {
                    ...deps(),
                    launcher: session.launcher,
                });
            } catch (error) {
                caught = error;
            }
            expect(caught).toBeInstanceOf(BotError);
            expect((caught as BotError).code).toBe(testCase.code as BotError['code']);
            if (testCase.leak !== undefined) {
                expect((caught as BotError).message).not.toContain(testCase.leak);
            }
        }
        expect(session.calls).toEqual([]);
        expect(session.requests).toEqual([]);
        expect(listIfPresent(leaseRoot)).toEqual([]);
    });

    // AC1: the request must carry the saved profile's cookie session. Real Chromium on 127.0.0.1
    // only — a fake launcher cannot show that the profile's cookies reach `context.request`, and
    // the cookie must be PERSISTENT (Max-Age): a session cookie dies with the first launch, so it
    // would prove nothing about a second one. Skips where no browser binary is installed.
    const realExec = test.skipIf(chromiumMissing());
    realExec(
        'attaches the saved profile cookie to the exec request on the same launch path (AC1)',
        async () => {
            const seen: Array<string | null> = [];
            const server = Bun.serve({
                hostname: '127.0.0.1',
                port: 0,
                fetch: (incoming) => {
                    seen.push(incoming.headers.get('cookie'));
                    if (new URL(incoming.url).pathname === '/set') {
                        return new Response('ok', {
                            headers: { 'set-cookie': 'sid=SEKRET123; Path=/; Max-Age=3600' },
                        });
                    }
                    return Response.json({ cookie: incoming.headers.get('cookie') });
                },
            });
            try {
                const base = `http://127.0.0.1:${server.port}`;
                // First launch stores the cookie in the profile through the same path exec uses.
                const stored = await execBot('alice', request({ url: `${base}/set` }), deps());
                expect(stored.status).toBe(200);
                expect(listIfPresent(leaseRoot)).toEqual([]);

                // Second launch: the persisted cookie is attached by the browser context itself.
                const echoed = await execBot('alice', request({ url: `${base}/echo` }), deps());
                expect(seen[0]).toBeNull();
                expect(seen[1]).toContain('sid=SEKRET123');
                expect(JSON.parse(echoed.body.toString())).toEqual({ cookie: 'sid=SEKRET123' });
                expect(listIfPresent(leaseRoot)).toEqual([]);
            } finally {
                server.stop(true);
            }
        },
        60_000,
    );
});
