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
import type { BrowserContext } from 'playwright';
import { BotError, DEFAULT_BOT_LOGIN_TIMEOUT_MS, loginBot, openBot } from '../src/browser';
import { acquireProfileLease } from '../src/profile-lease';

/**
 * Generic `kk bot` session lifecycle (task 0276, design §Bot command contract), driven through an
 * injected fake launcher: no browser binary, no real profile root. These tests prove the login
 * transaction, the confirmation contract, the reopen-until-close behaviour and the navigation
 * redaction; real cookie portability is the browser smoke (a separate deliverable).
 */

const DEFAULT_URL = 'https://alice.example.com/home';

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
}

/** Fake persistent context recording the profile requests and page navigations. */
function makeSession(options: { gotoError?: boolean; rejectConfirm?: boolean } = {}): FakeSession {
    const requests: ProfileLaunchRequest[] = [];
    const navigations: string[] = [];
    const handles: FakeHandle[] = [];
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
            const close = async (): Promise<void> => {
                closes += 1;
                for (const listener of listeners.splice(0)) listener();
            };
            const context = {
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
    return { launcher, requests, navigations, handles };
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
        expect(JSON.parse(readFileSync(metadataPath, 'utf8'))).toEqual({
            schemaVersion: 1,
            defaultUrl: 'https://site.example.com/login',
            authenticationEvidence: 'operator-confirmed',
        });
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
