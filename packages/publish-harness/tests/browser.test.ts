import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type BrowserLauncher,
    BrowserProfileBusyError,
    BrowserProfileMissingError,
    InvalidProfileDirError,
    LoginTimeoutError,
    PlaywrightUnavailableError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import {
    acquireProfileLease,
    BotError,
    type ChannelBrowserConfig,
    captureSessionFacts,
    checkChannelSession,
    createKkBrowserLauncher,
    createShadowFinder,
    expectOutcome,
    fillCodeMirror,
    findShadowControl,
    KK_BOT_LEASE_PATH,
    KK_BOT_LEASE_TOKEN,
    markdownToHtml,
    pasteHtml,
    readScopedSignal,
    resolveChannelProfileDir,
    resolveSelector,
    runProfileCli,
    uploadFile,
    waitUntil,
} from '../src/browser';

/** Records every helper call so a test can assert which DOM path ran. */
interface FakePageHandle {
    page: Page;
    calls: string[];
}

/**
 * Fake `Page` exposing only the four primitives the helpers may use (`locator`, `evaluate`,
 * `keyboard`, `setInputFiles`). `evaluateResults` is a queue whose last entry repeats, so the
 * Nth evaluate of a poll loop is scriptable without knowing the poll count.
 */
function makeFakePage(options: { attached?: boolean; evaluateResults?: unknown[] } = {}): FakePageHandle {
    const calls: string[] = [];
    const results = [...(options.evaluateResults ?? [])];
    const page = {
        locator(selector: string) {
            calls.push(`locator:${selector}`);
            return {
                first() {
                    return {
                        count: async () => (options.attached === false ? 0 : 1),
                        isVisible: async () => false,
                    };
                },
            };
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression}`);
            const head = results.length > 1 ? results.shift() : results[0];
            return head ?? '';
        },
        keyboard: {
            async insertText(text: string) {
                calls.push(`insertText:${text}`);
            },
        },
        async setInputFiles(selector: string, files: string) {
            calls.push(`setInputFiles:${selector}|${files}`);
        },
        async goto(url: string) {
            calls.push(`goto:${url}`);
        },
    };
    return { page: page as unknown as Page, calls };
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    page: FakePageHandle;
    closeCount: () => number;
    /** URLs the bot-mode session-fact capture asked the cookie jar about (0305). */
    cookieQueries: string[];
}

/**
 * Launcher fake returning a recording context; `onLaunch` may throw to simulate a refusal and
 * `cookies` scripts the jar `captureSessionFacts` reads.
 */
function makeLauncher(
    onLaunch?: (request: ProfileLaunchRequest) => void,
    cookies: { httpOnly?: boolean; expires?: number }[] = [],
): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const page = makeFakePage();
    const cookieQueries: string[] = [];
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            requests.push(request);
            onLaunch?.(request);
            const context = {
                cookies: async (url: string) => {
                    cookieQueries.push(url);
                    return cookies.map((cookie) => ({
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
                },
                pages: () => [page.page],
                newPage: async () => page.page,
                close: async () => {
                    closes += 1;
                },
            };
            return context as unknown as BrowserContext;
        },
    };
    return { launcher, requests, page, closeCount: () => closes, cookieQueries };
}

const CONFIG: ChannelBrowserConfig = {
    channel: 'infoq',
    homeUrl: 'https://xie.infoq.cn/write',
    isAuthenticated: async () => true,
};

const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'infoq');

// The profile-dir tiers are process-wide env; clear them for every case so a developer shell or a
// neighbouring suite cannot change the resolved path, and restore the originals afterwards.
const originalChannelDir = process.env.INFOQ_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;

beforeEach(() => {
    delete process.env.INFOQ_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
});

afterEach(() => {
    if (originalChannelDir === undefined) delete process.env.INFOQ_PROFILE_DIR;
    else process.env.INFOQ_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
});

describe('resolveChannelProfileDir', () => {
    test('falls back to the harness default when no override tier is set', () => {
        expect(resolveChannelProfileDir('infoq')).toBe(DEFAULT_DIR);
    });

    test('prefers override over both env tiers', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        expect(resolveChannelProfileDir('infoq', '~/from-flag')).toBe(join(homedir(), 'from-flag'));
    });

    test('prefers the channel env over the shared env', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        expect(resolveChannelProfileDir('infoq')).toBe(join(homedir(), 'from-channel'));
    });

    test('falls through to the shared env when the channel env is unset', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        expect(resolveChannelProfileDir('infoq')).toBe(join(homedir(), 'from-shared'));
    });

    test('treats blank tiers as unset rather than as a path', () => {
        process.env.KK_BROWSER_PROFILE_DIR = '   ';
        expect(resolveChannelProfileDir('infoq', '')).toBe(DEFAULT_DIR);
    });
});

describe('checkChannelSession', () => {
    test('verified headless probe reports the profile dir, no headed retry', async () => {
        const { launcher, requests, closeCount } = makeLauncher();
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('verified');
        expect(result.profileDir).toBe(DEFAULT_DIR);
        expect(result.detail).toContain(DEFAULT_DIR);
        expect(requests.map((request) => request.headless)).toEqual([true]);
        expect(closeCount()).toBe(1);
    });

    test('missing profile is refused without a headed retry (never creates one)', async () => {
        const { launcher, requests } = makeLauncher(() => {
            throw new BrowserProfileMissingError(DEFAULT_DIR);
        });
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('refused');
        expect(requests).toHaveLength(1);
        expect(result.detail).toContain(DEFAULT_DIR);
    });

    test('retries headed once when the headless probe refuses', async () => {
        const { launcher, requests } = makeLauncher((request) => {
            if (request.headless) throw new LoginTimeoutError('headless console never confirmed');
        });
        const result = await checkChannelSession(CONFIG, { profileDir: DEFAULT_DIR, launcher });

        expect(result.status).toBe('verified');
        expect(result.detail).toContain('headed');
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });

    test('headedOnly checks headed only and never probes headless', async () => {
        const { launcher, requests } = makeLauncher((request) => {
            if (request.headless) throw new LoginTimeoutError('headless console never confirmed');
        });
        const result = await checkChannelSession(CONFIG, {
            profileDir: DEFAULT_DIR,
            launcher,
            headedOnly: true,
        });

        expect(result.status).toBe('verified');
        expect(requests.map((request) => request.headless)).toEqual([false]);
    });

    test('one budget covers both passes, so a refusal prints inside the caller deadline (2026-11-19)', async () => {
        // Both passes wait their full timeout before refusing. Budgeting each pass separately spent
        // 2x the caller's deadline, and the caller (kk plugin check) killed the probe before it could
        // print `refused` — reporting `malformed probe output` for an expired session.
        const { launcher, requests } = makeLauncher();
        const neverAuthenticated: ChannelBrowserConfig = { ...CONFIG, isAuthenticated: async () => false };
        const startedAt = Date.now();
        const result = await checkChannelSession(neverAuthenticated, {
            profileDir: DEFAULT_DIR,
            launcher,
            timeoutMs: 1_500,
        });
        const elapsed = Date.now() - startedAt;

        expect(result.status).toBe('refused');
        expect(requests.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(2_600);
    });

    test('headedFallback false keeps a refusal to the single headless pass', async () => {
        const { launcher, requests } = makeLauncher(() => {
            throw new LoginTimeoutError('headless console never confirmed');
        });
        const result = await checkChannelSession(CONFIG, {
            profileDir: DEFAULT_DIR,
            launcher,
            headedFallback: false,
        });

        expect(result.status).toBe('refused');
        expect(result.detail).toContain('headless console never confirmed');
        expect(requests.map((request) => request.headless)).toEqual([true]);
    });
});

describe('captureSessionFacts (0305 R2)', () => {
    /** Context fake exposing only the cookie jar the helper may read. */
    function jar(cookies: unknown[] | (() => Promise<never>)): BrowserContext {
        return {
            cookies: async (url: string) => {
                expect(url).toBe('https://site.example.com/home');
                if (typeof cookies === 'function') return cookies();
                return cookies;
            },
        } as unknown as BrowserContext;
    }

    const cookie = (expires: number, httpOnly = true) => ({
        name: 'auth',
        value: 'SEKRET',
        domain: 'site.example.com',
        path: '/',
        expires,
        httpOnly,
        secure: true,
        sameSite: 'Lax',
    });

    test('returns the earliest persistent httpOnly expiry as RFC 3339 UTC', async () => {
        const later = Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000);
        const earlier = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);
        const facts = await captureSessionFacts(
            jar([cookie(later), cookie(earlier), cookie(earlier - 60)]),
            'https://site.example.com/home',
        );
        expect(facts).toEqual({ expiresAt: '2026-10-31T23:59:00.000Z' });
    });

    test('ignores session cookies (-1), zero expiry and non-httpOnly cookies', async () => {
        const expires = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);
        const sessionOnly = await captureSessionFacts(
            jar([cookie(-1), cookie(0), cookie(expires, false)]),
            'https://site.example.com/home',
        );
        expect(sessionOnly).toEqual({});
        expect(sessionOnly).not.toHaveProperty('expiresAt');
    });

    test('an unreadable or missing cookie jar yields no fact instead of failing', async () => {
        expect(
            await captureSessionFacts(
                jar(async () => Promise.reject(new Error('context closed'))),
                'https://site.example.com/home',
            ),
        ).toEqual({});
        expect(await captureSessionFacts({} as unknown as BrowserContext, 'https://site.example.com/home')).toEqual({});
    });
});

describe('runProfileCli', () => {
    function collect(lines: string[]): (line: string) => void {
        return (line) => {
            lines.push(line);
        };
    }

    test('checkHeadedOnly config checks headed only via the CLI', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli({ ...CONFIG, checkHeadedOnly: true }, ['check'], {
            launcher,
            stdout: collect(lines),
        });

        expect(code).toBe(0);
        expect(requests.map((request) => request.headless)).toEqual([false]);
    });

    test('--headed (0216) checks headed only, beating the default headless-first passes', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['check', '--headed'], { launcher, stdout: collect(lines) });

        expect(code).toBe(0);
        expect(requests.map((request) => request.headless)).toEqual([false]);
    });

    test('the usage string lists --headed (0216 surface)', async () => {
        const lines: string[] = [];
        const code = await runProfileCli(CONFIG, ['banish'], { stdout: collect(lines) });

        expect(code).toBe(2);
        expect(lines.join('\n')).toContain('--headed');
    });

    test('check prints the JSON verdict as the LAST stdout line even when refused (0216 probe parse)', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher(() => {
            throw new BrowserProfileMissingError(DEFAULT_DIR);
        });
        const code = await runProfileCli(CONFIG, ['check'], { launcher, stdout: collect(lines) });

        expect(code).toBe(1);
        const verdict = JSON.parse(lines[lines.length - 1] ?? '') as { status: string; detail: string };
        expect(verdict.status).toBe('refused');
        expect(verdict.detail).toContain('run the login command first');
        expect(lines).toHaveLength(1);
    });

    test('unknown verb is a usage error (exit 2) and never launches a browser', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['banish'], { launcher, stdout: collect(lines) });

        expect(code).toBe(2);
        expect(lines.join('\n')).toContain("unknown command 'banish'");
        expect(lines.join('\n')).toContain('usage:');
        expect(JSON.parse(lines.at(-1) ?? '')).toEqual({ status: 'error', detail: "unknown command 'banish'" });
        expect(requests).toHaveLength(0);
    });

    test('non-numeric --timeout is a usage error (exit 2)', async () => {
        const lines: string[] = [];
        const code = await runProfileCli(CONFIG, ['check', '--timeout', 'soon'], {
            stdout: collect(lines),
        });
        expect(code).toBe(2);
        expect(lines.join('\n')).toContain('--timeout');
    });

    test('login exits 0 and prints the verified profile dir', async () => {
        const lines: string[] = [];
        const { launcher, requests } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['login', '--profile', '~/from-flag'], {
            launcher,
            stdout: collect(lines),
        });

        expect(code).toBe(0);
        expect(requests[0]?.headless).toBe(false);
        expect(requests[0]?.profileDir).toBe(join(homedir(), 'from-flag'));
        expect(lines.join('\n')).toContain('login verified');
    });

    test('bot-mode login (--url) emits expiry and identity facts in the verdict (0305 R4)', async () => {
        const lines: string[] = [];
        const { launcher, requests, cookieQueries } = makeLauncher(undefined, [
            { expires: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000) },
            { expires: Math.floor(Date.parse('2026-12-01T00:00:00Z') / 1000) },
            { httpOnly: false, expires: Math.floor(Date.parse('2026-10-20T00:00:00Z') / 1000) },
        ]);
        const code = await runProfileCli(
            {
                ...CONFIG,
                readIdentity: async (page) => {
                    expect(page).toBeDefined();
                    return '  alice@xie.infoq.cn  ';
                },
            },
            ['login', '--url', 'https://xie.infoq.cn/login?token=SEKRET'],
            { launcher, stdout: collect(lines) },
        );

        expect(code).toBe(0);
        // Same single headed launch; the scoped helper navigated the supplied URL.
        expect(requests).toHaveLength(1);
        expect(requests[0]?.headless).toBe(false);
        expect(cookieQueries).toEqual([CONFIG.homeUrl]);
        const verdict = JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>;
        expect(verdict).toEqual({
            status: 'verified',
            profileDir: DEFAULT_DIR,
            defaultUrl: CONFIG.homeUrl,
            expiresAt: '2026-11-01T00:00:00.000Z',
            identity: 'alice@xie.infoq.cn',
        });
        expect(lines.join('\n')).not.toContain('SEKRET');
        expect(lines.join('\n')).not.toContain('SEKRET-COOKIE');
    });

    test('bot-mode login omits identity when readIdentity returns null or throws, and never fails', async () => {
        for (const readIdentity of [async () => null, async () => Promise.reject(new Error('no account name'))]) {
            const lines: string[] = [];
            const { launcher } = makeLauncher();
            const code = await runProfileCli(
                { ...CONFIG, readIdentity },
                ['login', '--url', 'https://xie.infoq.cn/login'],
                { launcher, stdout: collect(lines) },
            );

            expect(code).toBe(0);
            const verdict = JSON.parse(lines.at(-1) ?? '') as Record<string, unknown>;
            expect(verdict).toEqual({
                status: 'verified',
                profileDir: DEFAULT_DIR,
                defaultUrl: CONFIG.homeUrl,
            });
            expect(verdict).not.toHaveProperty('identity');
            // No persistent httpOnly cookie → no expiry claim either.
            expect(verdict).not.toHaveProperty('expiresAt');
            expect(lines.join('\n')).toContain('login verified');
        }
    });

    test('non-bot login (no --url) keeps the void loginWithProfile path and no verdict line', async () => {
        const lines: string[] = [];
        const { launcher, requests, cookieQueries } = makeLauncher(undefined, [{ expires: 1_800_000_000 }]);
        const code = await runProfileCli(CONFIG, ['login', '--profile', '~/from-flag'], {
            launcher,
            stdout: collect(lines),
        });

        expect(code).toBe(0);
        expect(requests).toHaveLength(1);
        expect(cookieQueries).toEqual([]);
        // The wait is announced first (a silent 3-minute block reads as a hang), then exactly one
        // verdict line and no JSON facts — bot mode is the only caller that needs them.
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('a browser window is opening');
        expect(lines[1]).toBe(`infoq profile login verified: ${join(homedir(), 'from-flag')}`);
    });

    test('login exits 1 when the headed login never confirms', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher(() => {
            throw new LoginTimeoutError('not confirmed within 10ms');
        });
        const code = await runProfileCli(CONFIG, ['login'], { launcher, stdout: collect(lines) });

        expect(code).toBe(1);
        expect(lines.join('\n')).toContain('not confirmed within 10ms');
    });

    test('check exits 0 and prints the machine-readable verdict when verified', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher();
        const code = await runProfileCli(CONFIG, ['check'], { launcher, stdout: collect(lines) });

        expect(code).toBe(0);
        expect(JSON.parse(lines[0] ?? '')).toMatchObject({ status: 'verified', profileDir: DEFAULT_DIR });
    });

    test('check exits 1 and names the refusal when the session is refused', async () => {
        const lines: string[] = [];
        const { launcher } = makeLauncher(() => {
            throw new BrowserProfileMissingError(DEFAULT_DIR);
        });
        const code = await runProfileCli(CONFIG, ['check'], { launcher, stdout: collect(lines) });

        expect(code).toBe(1);
        expect(lines.join('\n')).toContain('refused');
    });

    test('writes through the ts-utils output seam when no stdout dep is injected', async () => {
        // Default-writer path: no `stdout` in deps, so the line goes to the ts-utils stdout target
        // (captured here with the documented buffer-target seam instead of the real process stdout).
        const captured = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: captured });
        try {
            const code = await runProfileCli(CONFIG, ['banish']);
            expect(code).toBe(2);
            expect(captured.text()).toContain("unknown command 'banish'");
            expect(captured.text()).toContain('usage:');
        } finally {
            restore();
        }
    });
});

describe('waitUntil', () => {
    test('returns true as soon as the predicate passes', async () => {
        let calls = 0;
        const observed = await waitUntil(async () => {
            calls += 1;
            return calls >= 2;
        }, 1_000);

        expect(observed).toBe(true);
        expect(calls).toBe(2);
    });

    test('returns the final predicate call after the deadline', async () => {
        let calls = 0;
        const observed = await waitUntil(async () => {
            calls += 1;
            return false;
        }, 20);

        expect(observed).toBe(false);
        expect(calls).toBe(2);
    });
});

describe('pasteHtml', () => {
    test('dispatches a synthetic paste event and accepts a filled editor', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['', 'article body'] });
        await pasteHtml(page, '.ProseMirror', '<p>article body</p>');

        const paste = calls.find((call) => call.includes('ClipboardEvent'));
        expect(paste).toBeDefined();
        expect(paste).toContain('text/html');
        expect(paste).toContain('text/plain');
        expect(paste).toContain('<p>article body</p>');
    });

    test('throws naming the selector and timeout when the editor stays empty', async () => {
        const { page } = makeFakePage({ evaluateResults: ['', ''] });
        await expect(pasteHtml(page, '.stale', '<p>x</p>', { timeoutMs: 20 })).rejects.toThrow(/\.stale.*20ms/);
    });

    test('throws naming the selector and timeout when it never attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(pasteHtml(page, '#missing', '<p>x</p>', { timeoutMs: 20 })).rejects.toThrow(/#missing.*20ms/);
    });
});

describe('fillCodeMirror', () => {
    test('tries CodeMirror 6, then CodeMirror 5, then the keyboard in that order', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        const script = calls.find((call) => call.startsWith('evaluate:')) ?? '';
        expect(script.indexOf('view.dispatch')).toBeLessThan(script.indexOf('setValue'));
        expect(script.indexOf('setValue')).toBeLessThan(script.indexOf("'keyboard'"));
    });

    test('fills through the CodeMirror 6 view when available', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        expect(calls.some((call) => call.includes('view.dispatch'))).toBe(true);
    });

    test('falls back to the CodeMirror 5 setValue API', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm5'] });
        await fillCodeMirror(page, '.CodeMirror', '# Title');

        expect(calls.some((call) => call.startsWith('insertText:'))).toBe(false);
        expect(calls.some((call) => call.includes('setValue'))).toBe(true);
    });

    test('falls back to keyboard insertText when no editor API is reachable', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['keyboard'] });
        await fillCodeMirror(page, '.bytemd', '# Title');

        expect(calls).toContain('insertText:# Title');
    });

    test('throws naming the selector and timeout when the editor element vanishes', async () => {
        const { page } = makeFakePage({ evaluateResults: ['missing'] });
        await expect(fillCodeMirror(page, '.gone', '# Title', { timeoutMs: 20 })).rejects.toThrow(/\.gone.*20ms/);
    });

    test('reads the editor back before reporting the fill', async () => {
        const { page, calls } = makeFakePage({ evaluateResults: ['cm6', '# Title'] });
        await fillCodeMirror(page, '.cm-editor', '# Title');

        expect(calls.filter((call) => call.startsWith('evaluate:')).length).toBeGreaterThanOrEqual(2);
    });

    test('throws when the editor stays empty after the fill (no false success)', async () => {
        const { page } = makeFakePage({ evaluateResults: ['cm6', ''] });
        await expect(fillCodeMirror(page, '.cm-editor', '# Title', { timeoutMs: 20 })).rejects.toThrow(
            /editor text is empty 20ms/,
        );
    });
});

describe('resolveSelector', () => {
    test('resolves the first attached candidate of a list', async () => {
        const { page } = makeFakePage();
        await expect(resolveSelector(page, ['.title-input', 'input[placeholder*="标题"]'])).resolves.toBe(
            '.title-input',
        );
    });

    test('throws naming every candidate and the deadline when none attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(resolveSelector(page, ['.a', '.b'], { timeoutMs: 20, label: 'body editor' })).rejects.toThrow(
            /body editor: \.a \| \.b not attached within 20ms/,
        );
    });
});

describe('uploadFile', () => {
    test('sets files on an attached input without requiring visibility', async () => {
        const { page, calls } = makeFakePage();
        await uploadFile(page, 'input[type="file"]', '/tmp/cover.png');

        expect(calls).toContain('setInputFiles:input[type="file"]|/tmp/cover.png');
        expect(calls.some((call) => call.includes('isVisible'))).toBe(false);
    });

    test('throws naming the selector and timeout when the input never attaches', async () => {
        const { page } = makeFakePage({ attached: false });
        await expect(uploadFile(page, 'input[type="file"]', '/tmp/cover.png', { timeoutMs: 20 })).rejects.toThrow(
            /input\[type="file"\].*20ms/,
        );
    });
});

describe('expectOutcome', () => {
    test('returns the observed evidence', async () => {
        const evidence: (string | null)[] = [null, '', 'draft-42'];
        const outcome = await expectOutcome(async () => evidence.shift() ?? 'draft-42', {
            timeoutMs: 1_000,
            label: 'juejin draft',
        });

        expect(outcome).toEqual({ ok: true, evidence: 'draft-42' });
    });

    test('reports the label and deadline when nothing is observed', async () => {
        const outcome = await expectOutcome(async () => null, { timeoutMs: 20, label: 'substack URL' });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.error).toContain('substack URL');
        expect(outcome.ok === false && outcome.error).toContain('20ms');
    });
});

describe('expectOutcome — probe rejections (residual 0190)', () => {
    test('keeps polling when a probe rejects and still reports the observed outcome', async () => {
        let calls = 0;
        const outcome = await expectOutcome(
            async () => {
                calls += 1;
                // A live probe really does throw mid-navigation (`page.evaluate` on a replaced
                // document); that is "no signal yet", not the end of the rail.
                if (calls < 3) throw new Error('Execution context was destroyed');
                return 'draft-9';
            },
            { timeoutMs: 1_000, label: 'juejin draft' },
        );

        expect(outcome).toEqual({ ok: true, evidence: 'draft-9' });
    });

    test('a probe that keeps rejecting yields a failed outcome naming the rejection', async () => {
        const outcome = await expectOutcome(
            async () => {
                throw new Error('Evaluation failed: navigation in progress');
            },
            { timeoutMs: 20, label: 'x article draft' },
        );

        expect(outcome.ok).toBe(false);
        expect(outcome.ok === false && outcome.error).toContain('x article draft');
        expect(outcome.ok === false && outcome.error).toContain('Evaluation failed: navigation in progress');
    });
});

describe('readScopedSignal — toast scoping (residuals 0195/0196)', () => {
    /** Models the live failure mode: the label sits in the editor body or in a toast. */
    const makeSignalPage = (state: { bodyHasLabel: boolean; toast: string | null }) => ({
        locator(selector: string) {
            const scoped =
                /\[class\*="(toast|notification|message)"/.test(selector) || selector.includes('[role="alert"]');
            const wanted = selector.slice(selector.indexOf(':text("') + 7, selector.lastIndexOf('")'));
            const found = scoped ? state.toast : state.bodyHasLabel ? wanted : state.toast;
            return {
                first: () => ({
                    count: async () => (found === null ? 0 : 1),
                    isVisible: async () => true,
                    textContent: async () => found,
                }),
            };
        },
    });

    test('reads the label from a notification container', async () => {
        const page = makeSignalPage({ bodyHasLabel: false, toast: '保存成功' });

        expect(await readScopedSignal(page as never, ['保存成功'])).toBe('保存成功');
    });

    test('ignores the same label when it only exists in the pasted article body', async () => {
        const page = makeSignalPage({ bodyHasLabel: true, toast: null });

        expect(await readScopedSignal(page as never, ['保存成功'])).toBeNull();
    });
});

describe('closed-shadow controls (ADR-029 rail)', () => {
    /** A pierced CDP tree with the label inside a shadow root, as the xhs publish bar reports it. */
    const makeSession = (state: { shadowLabel?: string; lightLabel?: string }) => {
        const calls: string[] = [];
        const button = (backendNodeId: number, nodeValue: string) => ({
            nodeName: 'BUTTON',
            backendNodeId,
            children: [{ nodeName: '#text', nodeValue }],
        });
        return {
            calls,
            async send(method: string) {
                calls.push(method);
                if (method === 'DOM.getDocument') {
                    return {
                        root: {
                            nodeName: '#document',
                            children: state.lightLabel === undefined ? [] : [button(1, state.lightLabel)],
                            shadowRoots:
                                state.shadowLabel === undefined
                                    ? []
                                    : [
                                          {
                                              nodeName: '#document-fragment',
                                              shadowRoots: [],
                                              children: [button(7, `  ${state.shadowLabel} `)],
                                          },
                                      ],
                        },
                    };
                }
                if (method === 'DOM.getBoxModel') {
                    // The quad the live bar reports: centre ((x1+x3)/2, (y1+y4)/2).
                    return { model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } };
                }
                return {};
            },
        };
    };

    test('resolves a labelled control inside a closed shadow root and returns its centre', async () => {
        const session = makeSession({ shadowLabel: '暂存离开' });

        expect(await findShadowControl(session, ['暂存离开', '发布'])).toEqual({ label: '暂存离开', x: 60, y: 40 });
        expect(session.calls).toContain('DOM.getDocument');
    });

    test('a label that exists only in the light DOM is not a shadow control', async () => {
        const session = makeSession({ lightLabel: '暂存离开' });

        expect(await findShadowControl(session, ['暂存离开'])).toBeNull();
    });

    test('the shadow tree wins over a mirrored light-DOM label', async () => {
        const session = makeSession({ shadowLabel: '发布', lightLabel: '发布' });

        expect(await findShadowControl(session, ['发布'])).toEqual({ label: '发布', x: 60, y: 40 });
    });

    test('a platform without CDP yields no finder instead of guessed coordinates', async () => {
        expect(await createShadowFinder({}, {})).toBeUndefined();
    });

    test('a CDP-capable context enables the domain and returns a bound finder', async () => {
        const cdp = makeSession({ shadowLabel: '发布' });
        const sent: string[] = [];
        const context = {
            async newCDPSession() {
                return {
                    async send(method: string) {
                        sent.push(method);
                        return await cdp.send(method);
                    },
                };
            },
        };

        const finder = await createShadowFinder(context, {});
        expect(sent).toEqual(['DOM.enable']);
        expect(await finder?.(['发布', '暂存离开'])).toEqual({ label: '发布', x: 60, y: 40 });

        const failing = {
            async newCDPSession(): Promise<never> {
                throw new Error('no devtools protocol');
            },
        };
        expect(await createShadowFinder(failing, {})).toBeUndefined();
    });
});

describe('markdownToHtml', () => {
    test('renders GFM through the Bun built-in', () => {
        const html = markdownToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n');

        expect(html).toContain('<table>');
        expect(html).toContain('<td>1</td>');
    });
});

describe('main entry isolation (R5)', () => {
    test('src/index.ts never imports the browser module or the browser package', async () => {
        const source = await Bun.file(new URL('../src/index.ts', import.meta.url)).text();

        expect(source).not.toContain('./browser');
        expect(source).not.toContain('ts-browser-automation');
    });
});

describe('createKkBrowserLauncher (0214, lease ownership 0276)', () => {
    let root: string;
    let leaseRoot: string;
    const savedChannel = process.env.KK_BROWSER_CHANNEL;
    const savedLeasePath = process.env.KK_BOT_LEASE_PATH;
    const savedLeaseToken = process.env.KK_BOT_LEASE_TOKEN;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'kk-launcher-'));
        leaseRoot = join(root, 'leases');
        delete process.env.KK_BROWSER_CHANNEL;
        delete process.env.KK_BOT_LEASE_PATH;
        delete process.env.KK_BOT_LEASE_TOKEN;
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
        restoreEnv('KK_BROWSER_CHANNEL', savedChannel);
        restoreEnv('KK_BOT_LEASE_PATH', savedLeasePath);
        restoreEnv('KK_BOT_LEASE_TOKEN', savedLeaseToken);
    });

    const restoreEnv = (key: string, value: string | undefined): void => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    /** Lease directories currently on disk under the injected lease root. */
    const leaseDirs = async (): Promise<string[]> => (existsSync(leaseRoot) ? await readdir(leaseRoot) : []);

    /**
     * The launcher releases ownership from the context's `close` listener, so the release promise
     * runs after `close()` resolves. Wait (bounded) for it instead of racing it.
     */
    const settle = async (probe: () => Promise<boolean>): Promise<void> => {
        for (let i = 0; i < 200; i += 1) {
            if (await probe()) return;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    };

    /** Wait until no lease directory is left under the injected root. */
    const settleLeases = async (): Promise<void> => {
        await settle(async () => (await leaseDirs()).length === 0);
    };

    interface FakeContextHandle {
        closeCount: () => number;
    }

    /**
     * Fake playwright recording the launch options; `fail` makes `launchPersistentContext` throw it
     * and `failInit` makes the webdriver init script throw. The returned context is minimal: exactly
     * `addInitScript`, `once` and `close`, which is all the launcher's ownership cleanup uses.
     */
    function fakePlaywright(fail?: Error, failInit?: Error) {
        const launches: { dir: string; options: Record<string, unknown> }[] = [];
        const initScripts: unknown[] = [];
        const handles: FakeContextHandle[] = [];
        const load = async () =>
            ({
                chromium: {
                    async launchPersistentContext(dir: string, options: Record<string, unknown>) {
                        launches.push({ dir, options });
                        if (fail) throw fail;
                        let closes = 0;
                        const listeners: (() => void)[] = [];
                        handles.push({ closeCount: () => closes });
                        const context = {
                            async addInitScript(script: unknown) {
                                if (failInit) throw failInit;
                                initScripts.push(script);
                                // A real browser evaluates the script in the page; invoking it here
                                // keeps the init-script arrow itself covered. Bun's own
                                // `navigator.webdriver` is unconfigurable, which is a test-process
                                // artifact, not a launcher failure.
                                if (typeof script === 'function') {
                                    try {
                                        (script as () => void)();
                                    } catch {
                                        // ignore: the script is exercised, not asserted on
                                    }
                                }
                            },
                            once(_event: string, listener: () => void) {
                                listeners.push(listener);
                                return context;
                            },
                            async close() {
                                closes += 1;
                                for (const listener of listeners.splice(0)) listener();
                            },
                        };
                        return context;
                    },
                },
            }) as unknown as typeof import('playwright');
        return { load, launches, initScripts, handles };
    }

    test('quarantines a poisoned Default/Sync Data and relaunches once', async () => {
        // Measured 2026-11-12: a corrupt Sync Data LevelDB made Chromium trap during startup, which
        // Playwright reports only as a closed browser — every later login then failed. Sync state is
        // disposable, so the launcher moves it aside and relaunches before giving up.
        const profileDir = join(root, 'poison');
        mkdirSync(join(profileDir, 'Default', 'Sync Data'), { recursive: true });
        writeFileSync(join(profileDir, 'Default', 'Sync Data', 'CURRENT'), 'MANIFEST-000001');
        const pw = fakePlaywright();
        let calls = 0;
        const inner = pw.load;
        const load = async () => {
            const real = await inner();
            return {
                ...real,
                chromium: {
                    ...real.chromium,
                    async launchPersistentContext(dir: string, options: Record<string, unknown>) {
                        calls += 1;
                        if (calls === 1)
                            throw new Error('persistentContext: Target page, context or browser has been closed');
                        return real.chromium.launchPersistentContext(dir, options);
                    },
                },
            } as unknown as typeof import('playwright');
        };

        const context = await createKkBrowserLauncher(load, undefined, { leaseRoot }).launch({
            profileDir,
            headless: true,
        });
        expect(calls).toBe(2);
        expect(pw.launches).toHaveLength(1);
        expect(existsSync(join(profileDir, 'Default', 'Sync Data'))).toBe(false);
        expect(readdirSync(join(profileDir, 'Default')).some((name) => name.startsWith('Sync Data.broken-'))).toBe(
            true,
        );
        await context.close();
    });

    test('a profile that keeps dying during startup reports the poisoned profile, not a raw trace', async () => {
        const profileDir = join(root, 'poison-stubborn');
        mkdirSync(join(profileDir, 'Default', 'Sync Data'), { recursive: true });
        const pw = fakePlaywright(new Error('Target page, context or browser has been closed'));
        await expect(
            createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({ profileDir, headless: true }),
        ).rejects.toThrow(/makes Chromium exit during startup/);
    });

    test('defaults to the full Chromium channel with the stealth options and webdriver init script', async () => {
        const pw = fakePlaywright();
        const profileDir = join(root, 'p');

        const context = await createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({
            profileDir,
            headless: false,
        });

        expect(pw.launches).toHaveLength(1);
        expect(pw.launches[0]?.dir).toBe(profileDir);
        expect(pw.launches[0]?.options).toMatchObject({
            headless: false,
            channel: 'chromium',
            args: ['--disable-blink-features=AutomationControlled'],
            ignoreDefaultArgs: ['--enable-automation'],
        });
        expect(pw.initScripts).toHaveLength(1);
        // The owned path holds the profile lease for exactly as long as the context is open.
        expect(await leaseDirs()).toHaveLength(1);
        await context.close();
        await settleLeases();
        expect(await leaseDirs()).toEqual([]);
    });

    test('KK_BROWSER_CHANNEL=chrome selects installed Google Chrome; blank falls back to chromium', async () => {
        const pw = fakePlaywright();
        await Bun.write(join(root, 'p', '.keep'), '');
        const launcher = createKkBrowserLauncher(pw.load, undefined, { leaseRoot });

        process.env.KK_BROWSER_CHANNEL = 'chrome';
        const chrome = await launcher.launch({ profileDir: join(root, 'p'), headless: true });
        await chrome.close();
        await settleLeases();
        process.env.KK_BROWSER_CHANNEL = '  ';
        const chromium = await launcher.launch({ profileDir: join(root, 'p'), headless: true });
        await chromium.close();
        await settleLeases();
        expect(await leaseDirs()).toEqual([]);

        expect(pw.launches.map((l) => l.options.channel)).toEqual(['chrome', 'chromium']);
    });

    test('a missing profile is refused headless before any launch, and its lease is released', async () => {
        const pw = fakePlaywright();
        const profileDir = join(root, 'absent');

        await expect(
            createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({ profileDir, headless: true }),
        ).rejects.toBeInstanceOf(BrowserProfileMissingError);
        expect(pw.launches).toHaveLength(0);
        expect(await stat(profileDir).catch(() => null)).toBeNull();
        expect(await leaseDirs()).toEqual([]);
    });

    test('rejects a blank profile path', async () => {
        await expect(
            createKkBrowserLauncher(fakePlaywright().load).launch({ profileDir: ' ', headless: false }),
        ).rejects.toBeInstanceOf(InvalidProfileDirError);
    });

    test('maps busy-profile, missing-browser and missing-peer failures to typed errors', async () => {
        const profileDir = join(root, 'p');
        const launch = (load: () => Promise<typeof import('playwright')>) =>
            createKkBrowserLauncher(load, undefined, { leaseRoot }).launch({ profileDir, headless: false });

        await expect(
            launch(fakePlaywright(new Error('ProcessSingleton: profile already in use')).load),
        ).rejects.toBeInstanceOf(BrowserProfileBusyError);
        await expect(launch(fakePlaywright(new Error("Executable doesn't exist at /x")).load)).rejects.toBeInstanceOf(
            PlaywrightUnavailableError,
        );
        await expect(
            launch(async () => {
                throw new Error('Cannot find package playwright');
            }),
        ).rejects.toBeInstanceOf(PlaywrightUnavailableError);
        const other = new Error('boom');
        await expect(launch(fakePlaywright(other).load)).rejects.toBe(other);
        // Every failed launch released the lease it took before the browser attempt.
        expect(await leaseDirs()).toEqual([]);
    });

    test('a failed init script closes the context and releases the lease (close on errors)', async () => {
        const pw = fakePlaywright(undefined, new Error('init script rejected'));
        const profileDir = join(root, 'p');

        await expect(
            createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({ profileDir, headless: false }),
        ).rejects.toThrow('init script rejected');
        expect(pw.handles[0]?.closeCount()).toBe(1);
        expect(await leaseDirs()).toEqual([]);
    });

    test('reports a release that fails at context closure without throwing from the handler', async () => {
        const buffer = createBufferTarget();
        const restoreTargets = setDefaultOutputTargets({ stdout: buffer, stderr: buffer });
        try {
            const pw = fakePlaywright();
            const profileDir = join(root, 'p');
            const context = await createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({
                profileDir,
                headless: false,
            });
            // Simulate a lease that another process tampered with: release then fails `busy`.
            const id = (await leaseDirs())[0] ?? '';
            rmSync(join(leaseRoot, id, 'owner.json'));

            await expect(context.close()).resolves.toBeUndefined();
            let reported = '';
            for (let i = 0; i < 100 && !reported.includes('release failed'); i += 1) {
                reported = buffer.text();
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            expect(reported).toContain('browser lease release failed');
            expect(reported).not.toContain('owner.json');
        } finally {
            restoreTargets();
        }
    });

    test('borrowed ownership validates the physical path and the live owner token, and never releases it', async () => {
        const pw = fakePlaywright();
        const logicalDir = join(root, 'bots', 'alice');
        const stageDir = join(root, 'stage');
        const lease = await acquireProfileLease(logicalDir, { leaseRoot });
        const launcher = createKkBrowserLauncher(pw.load, { lease, physicalProfileDir: stageDir }, { leaseRoot });

        const context = await launcher.launch({ profileDir: stageDir, headless: false });
        await context.close();

        // The parent still holds the lease after the context closed; only the parent releases it.
        expect(await leaseDirs()).toEqual([lease.id]);
        await expect(launcher.launch({ profileDir: join(root, 'elsewhere'), headless: false })).rejects.toThrow(
            /bound to/,
        );

        await lease.release();
        // A released (or foreign) lease is never borrowed as an unrestricted bypass.
        let caught: unknown;
        try {
            await launcher.launch({ profileDir: stageDir, headless: false });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(BotError);
        expect((caught as BotError).code).toBe('busy');
    });

    test('a launch that fails after claiming never releases a borrowed parent lease, and drops a child holder', async () => {
        const logicalDir = join(root, 'bots', 'alice');
        const stageDir = join(root, 'stage');
        const lease = await acquireProfileLease(logicalDir, { leaseRoot });

        const borrowed = createKkBrowserLauncher(
            fakePlaywright(new Error('boom')).load,
            { lease, physicalProfileDir: stageDir },
            { leaseRoot },
        );
        await expect(borrowed.launch({ profileDir: stageDir, headless: false })).rejects.toThrow('boom');
        expect(await leaseDirs()).toEqual([lease.id]);

        const env = await lease.delegatedEnv(stageDir);
        process.env[KK_BOT_LEASE_PATH] = env[KK_BOT_LEASE_PATH] ?? '';
        process.env[KK_BOT_LEASE_TOKEN] = env[KK_BOT_LEASE_TOKEN] ?? '';
        const delegated = createKkBrowserLauncher(
            async () => {
                throw new Error('Cannot find package playwright');
            },
            undefined,
            { leaseRoot },
        );
        await expect(delegated.launch({ profileDir: stageDir, headless: false })).rejects.toBeInstanceOf(
            PlaywrightUnavailableError,
        );
        expect((await readdir(join(leaseRoot, lease.id))).filter((name) => name.startsWith('holder-'))).toEqual([]);
        await lease.release();
    });

    test('delegated ownership records a child holder and drops only that holder on close', async () => {
        const pw = fakePlaywright();
        const logicalDir = join(root, 'bots', 'alice');
        const stageDir = join(root, 'stage');
        const lease = await acquireProfileLease(logicalDir, { leaseRoot });
        const env = await lease.delegatedEnv(stageDir);
        process.env[KK_BOT_LEASE_PATH] = env[KK_BOT_LEASE_PATH] ?? '';
        process.env[KK_BOT_LEASE_TOKEN] = 'deadbeef';

        // A wrong token is a busy refusal, never a second acquisition.
        await expect(
            createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({
                profileDir: stageDir,
                headless: false,
            }),
        ).rejects.toBeInstanceOf(BotError);
        expect(await leaseDirs()).toEqual([lease.id]);

        process.env[KK_BOT_LEASE_TOKEN] = env[KK_BOT_LEASE_TOKEN] ?? '';
        const context = await createKkBrowserLauncher(pw.load, undefined, { leaseRoot }).launch({
            profileDir: stageDir,
            headless: false,
        });
        const holders = async (): Promise<string[]> =>
            (await readdir(join(leaseRoot, lease.id))).filter((name) => name.startsWith('holder-'));
        expect(await holders()).toHaveLength(1);

        await context.close();
        await settle(async () => (await holders()).length === 0);
        expect(await holders()).toEqual([]);
        // The child never releases the parent lease.
        expect(await leaseDirs()).toEqual([lease.id]);
        await lease.release();
    });
});
