import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    CHANNEL,
    CONFIG,
    DRAFT_URL_RE,
    getPublishTransport,
    HOME_URL,
    InfoqBrowserTransport,
    isAuthenticated,
    LOGIN_URL_RE,
    main,
    processPublishIO,
    resolveOperation,
    SELECTORS,
} from '../src/index';

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };

const WRITE_ENTRY_SELECTOR = 'div.write-btn';
const LIVE_SELECTOR = 'div.submit-btn';
/** The measured editor URL shape: the entry itself creates the server-side draft (0201 + 0191). */
const DRAFT_URL = 'https://xie.infoq.cn/draft/405943';
const LOGIN_URL = 'https://account.geekbang.org/infoq/login';
const LEGACY_LOGIN_URL = 'https://account.infoq.cn/login?redirect=%2Fwrite';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'infoq');
const EMPTY_DIR = '/tmp/kk-infoq-absent';
/** R5/AC3: the operator recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/infoq-pub/src/profile-check.ts login';

/** Scripted submit outcome; `'none'` leaves the page silent (no observed signal). */
type ClickOutcome = 'url' | 'toast' | 'none';

interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** Title field never attaches (a page that is not the editor). */
    missingTitle?: boolean;
    /** The home write entry never attaches (a non-hydrated or foreign page, 0201). */
    missingWriteEntry?: boolean;
    /** A visible 登录 control — the measured logged-out marker (0191). */
    loggedOut?: boolean;
    /** The 知道了 feature-notice modal is up and swallows input events (measured 0201). */
    noticeModal?: boolean;
    /** Clicking the write entry routes to the server-side draft URL (default true). */
    entry?: boolean;
    /** Draft-saved signal after the paste: the 已保存 indicator, or silence (autosave never fires). */
    autosave?: 'toast' | 'none';
    onLive?: ClickOutcome;
    /** A label present only in the pasted article body (the false-success input, 0195). */
    bodySignal?: string;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`).
 * `count()` is 0 for toast/text selectors until scripted, so an unobserved outcome cannot become
 * a success by accident. `calls` is owned by the caller so several fake pages can record into one
 * log.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    // The measured autosave indicator (0201): once content is pasted the 已保存 chip shows and
    // stays; the fake models it as present from construction when scripted.
    let toast: string | null = options.autosave === 'toast' ? '已保存' : null;

    const attached = (selector: string): number => {
        if (selector.includes(':text(') || selector.includes('text=')) {
            const label = /:text\("([^"]+)"\)/.exec(selector)?.[1] ?? /^text=(.+)$/.exec(selector)?.[1];
            if (label === '知道了') return options.noticeModal === true ? 1 : 0;
            // Pre-0195 the probe was unscoped, so a label sitting in the pasted article body counted
            // as a signal; only a notification-container match is a real toast now.
            const scoped =
                /\[class\*="(toast|notification|message|save-status)/.test(selector) ||
                selector.includes('[role="alert"]');
            if (scoped) {
                if (toast !== null && label !== undefined && toast.includes(label)) return 1;
                return 0;
            }
            if (!scoped && options.bodySignal !== undefined && label?.includes(options.bodySignal)) return 1;
            return 0;
        }
        if (selector.includes('标题')) return options.missingTitle === true ? 0 : 1;
        if (selector.includes('write-btn')) return options.missingWriteEntry === true ? 0 : 1;
        return 1;
    };

    const apply = (outcome: ClickOutcome | undefined, toastText: string): void => {
        if (outcome === 'url') url = DRAFT_URL;
        else if (outcome === 'toast') toast = toastText;
    };

    const page = {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return {
                first: () => ({
                    count: async () => attached(selector),
                    isVisible: async () => attached(selector) > 0,
                    fill: async (text: string) => {
                        calls.push(`fill:${selector}|${text}`);
                    },
                    click: async () => {
                        calls.push(`click:${selector}`);
                        if (selector === WRITE_ENTRY_SELECTOR && options.entry !== false) url = DRAFT_URL;
                        if (selector === LIVE_SELECTOR) apply(options.onLive, '提交成功');
                    },
                    textContent: async () => toast ?? '',
                }),
            };
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 32)}`);
            // The logged-out marker scan (0191): scripted per page.
            if (expression.includes('登录')) return options.loggedOut === true;
            return 'pasted body text';
        },
    };
    return page as unknown as Page;
}

interface FakeLauncherOptions {
    /** Page script for every launch. Deviations merge over the working draft defaults. */
    page?: FakePageOptions;
    /** Page script per launch call (index 0 is the headless preflight); the last entry repeats. */
    pages?: FakePageOptions[];
    /** Thrown instead of launching when it returns an error — an absent/unusable profile. */
    failLaunch?: (request: ProfileLaunchRequest, index: number) => Error | undefined;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/** Defaults that make a fake page a working draft run; tests name only their deviation. */
const WORKING_DRAFT: FakePageOptions = { entry: true, autosave: 'toast' };

/** Launcher fake returning recording contexts; every call is logged into one shared call list. */
function makeFakeLauncher(options: FakeLauncherOptions = {}): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    const merged = (script: FakePageOptions): FakePageOptions => ({ ...WORKING_DRAFT, ...script });
    const scripts = options.pages ?? [merged(options.page ?? {})];
    const pages = scripts.map((script) => makeFakePage(merged(script), calls));
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            const index = requests.length;
            requests.push(request);
            const failure = options.failLaunch?.(request, index);
            if (failure) throw failure;
            const page = pages[Math.min(index, pages.length - 1)] ?? makeFakePage({}, calls);
            const context = {
                pages: () => [page],
                newPage: async () => page,
                close: async () => {
                    closes += 1;
                },
            };
            return context as unknown as BrowserContext;
        },
    };
    return { launcher, requests, calls, closeCount: () => closes };
}

function transport(fake: LauncherHandle, stepTimeoutMs = 200, checkTimeoutMs = 200): InfoqBrowserTransport {
    return new InfoqBrowserTransport('script', { launcher: fake.launcher, stepTimeoutMs, checkTimeoutMs });
}

// The profile-dir tiers are process-wide env; clear them for every case and restore afterwards so
// a developer shell or a neighbouring suite cannot change the resolved path.
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

describe('infoq-pub frozen surface (measured 0201 + 0191)', () => {
    test('kind is browser, the driver defaults to script, and the entry is the measured home URL', () => {
        const infoq = new InfoqBrowserTransport();
        expect(infoq.kind).toBe('browser');
        expect(infoq.driver).toBe('script');
        expect(CHANNEL).toBe('infoq');
        expect(HOME_URL).toBe('https://xie.infoq.cn/');
        expect(CONFIG.channel).toBe(CHANNEL);
        expect(CONFIG.homeUrl).toBe(HOME_URL);
        expect(CONFIG.loginTimeoutMs).toBe(180_000);
    });

    test('the editor URL is the server-side draft route the entry lands on', () => {
        expect(DRAFT_URL_RE.test(DRAFT_URL)).toBe(true);
        expect(DRAFT_URL_RE.exec(DRAFT_URL)?.[1]).toBe('405943');
        expect(DRAFT_URL_RE.test(HOME_URL)).toBe(false);
    });

    test('LOGIN_URL_RE covers the geekbang SSO domain, the legacy infoq domain, and /login paths', () => {
        expect(LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        expect(LOGIN_URL_RE.test(LEGACY_LOGIN_URL)).toBe(true);
        expect(LOGIN_URL_RE.test(HOME_URL)).toBe(false);
    });

    test('selector table is the measured one, with the measured-absent controls removed', () => {
        expect(SELECTORS.writeEntry).toEqual([WRITE_ENTRY_SELECTOR]);
        expect(SELECTORS.noticeDismiss).toEqual(['text=知道了']);
        expect(SELECTORS.title).toEqual(['input[placeholder="请输入标题"]', 'input[placeholder*="标题"]']);
        expect(SELECTORS.body).toEqual(['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]']);
        expect(SELECTORS.live).toEqual([LIVE_SELECTOR]);
        // Measured absent (0201/0191): no summary field, and no draft button — the editor autosaves.
        expect(SELECTORS).not.toHaveProperty('summary');
        expect(SELECTORS).not.toHaveProperty('draft');
    });

    test('readiness needs the hydrated write entry and no visible 登录 control', async () => {
        const atLogin = makeFakePage({ landedUrl: LOGIN_URL }, []);
        await atLogin.goto(HOME_URL);
        expect(await isAuthenticated(atLogin)).toBe(false);

        const notHydrated = makeFakePage({ missingWriteEntry: true }, []);
        await notHydrated.goto(HOME_URL);
        expect(await isAuthenticated(notHydrated)).toBe(false);

        const loggedOut = makeFakePage({ loggedOut: true }, []);
        await loggedOut.goto(HOME_URL);
        expect(await isAuthenticated(loggedOut)).toBe(false);

        const ready = makeFakePage({}, []);
        await ready.goto(HOME_URL);
        expect(await isAuthenticated(ready)).toBe(true);
    });
});

describe('infoq-pub draft flow', () => {
    test('draft run enters via the write button, fills the editor, and never clicks the submit control', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('infoq');
        expect(result.url).toBe(DRAFT_URL);
        expect(result.id).toBe('405943');
        expect(result.message).toContain('draft');
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.profileDir).toBe(DEFAULT_DIR);
        // One headed-only preflight pass (the WAF 451s every headless load, so headless is never
        // probed), then the headed editor visit (options.headless is opt-in).
        expect(fake.requests.map((request) => request.headless)).toEqual([false, false]);
        expect(fake.requests.map((request) => request.profileDir)).toEqual([DEFAULT_DIR, DEFAULT_DIR]);
        expect(fake.calls).toContain(`click:${WRITE_ENTRY_SELECTOR}`);
        expect(fake.calls).toContain('fill:input[placeholder="请输入标题"]|Parity');
        expect(fake.calls.some((call) => call.startsWith('evaluate:'))).toBe(true);
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
        // withProfilePage closes both contexts: the preflight and the editor visit.
        expect(fake.closeCount()).toBe(2);
    });

    test('summary metadata is ignored — the measured console has no summary field', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content: { ...content, metadata: { summary: 'Abstract.' } } });
        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.includes('摘要'))).toBe(false);
    });

    test('the 知道了 feature-notice modal is dismissed before the editor is filled (0201)', async () => {
        const fake = makeFakeLauncher({ page: { noticeModal: true } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        const dismiss = fake.calls.indexOf('click:text=知道了');
        const fill = fake.calls.findIndex((call) => call.startsWith('fill:'));
        expect(dismiss).toBeGreaterThanOrEqual(0);
        expect(fill).toBeGreaterThan(dismiss);
    });

    test('a 已保存 label that only exists in the pasted body is not an observed save (0195)', async () => {
        const fake = makeFakeLauncher({ page: { autosave: 'none', bodySignal: '已保存' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no outcome observed within 30ms');
    });

    test('an entry that never reaches /draft/<id> fails naming the URL and the timeout', async () => {
        const fake = makeFakeLauncher({ page: { entry: false } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no /draft/<id> within 30ms');
        expect(result.error).toContain(HOME_URL);
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
    });

    test('an unobserved autosave signal fails naming the label and the timeout', async () => {
        const fake = makeFakeLauncher({ page: { autosave: 'none' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('infoq draft autosave');
        expect(result.error).toContain('no outcome observed within 30ms');
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
    });
});

describe('infoq-pub live switch (R4/AC2)', () => {
    test('the submit control is clicked only when publishStatus is public', async () => {
        const fake = makeFakeLauncher({ page: { onLive: 'toast' } });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.message).toContain('editorial review');
        expect(fake.calls).toContain(`click:${WRITE_ENTRY_SELECTOR}`);
        expect(fake.calls).toContain(`click:${LIVE_SELECTOR}`);
    });

    test('an explicit draft publishStatus stays a draft run', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content: { ...content, metadata: { publishStatus: 'draft' } } });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
    });

    test('an unknown publishStatus fails before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'published' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("unknown publishStatus 'published'");
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('the agent driver fails fast (E91-D1)', async () => {
        const fake = makeFakeLauncher();
        const result = await new InfoqBrowserTransport('agent', { launcher: fake.launcher }).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toBe("unsupported driver 'agent' for infoq");
        expect(fake.requests).toEqual([]);
    });
});

describe('infoq-pub session failures (R5/AC3)', () => {
    test('a missing profile reports the login command and the profile dir only', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(EMPTY_DIR) });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        // The refusal names the resolved profile directory and nothing else from the profile.
        expect(result.error).toContain(`no infoq browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(LOGIN_HINT);
        // One line, no stack, and no second (headed) launch: the preflight refuses outright.
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        expect(fake.requests).toHaveLength(1);
        // The launcher threw before a context existed, so there is nothing to close.
        expect(fake.closeCount()).toBe(0);
    });

    test('an expired session reports the login command instead of a stack, via the headed-only check', async () => {
        const fake = makeFakeLauncher({ page: { landedUrl: LOGIN_URL } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        // Headless 451s at the WAF in production (0201/0191), so the refusal names the headed pass.
        expect(result.error).toContain('headed infoq readiness refused');
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        expect(fake.requests.map((request) => request.headless)).toEqual([false]);
    });

    test('a session that expires before the editor visit reports the login command', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { landedUrl: LOGIN_URL }],
        });
        const result = await transport(fake, 30, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Authentication was not confirmed within 30ms');
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        // Headed-only preflight, then the headed editor visit whose session has expired.
        expect(fake.requests.map((request) => request.headless)).toEqual([false, false]);
    });
});

describe('infoq-pub profile resolution (R5)', () => {
    test('precedence is options.profileDir > INFOQ_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
        const fallback = makeFakeLauncher();
        expect((await transport(fallback).publish({ content })).metadata?.profileDir).toBe(DEFAULT_DIR);

        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        const fromEnv = makeFakeLauncher();
        const envResult = await transport(fromEnv).publish({ content });
        expect(envResult.metadata?.profileDir).toBe(join(homedir(), 'from-channel'));
        expect(fromEnv.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

        const fromFlag = makeFakeLauncher();
        const flagResult = await transport(fromFlag).publish({
            content,
            options: { profileDir: '/tmp/kk-infoq-flag' },
        });
        expect(flagResult.metadata?.profileDir).toBe('/tmp/kk-infoq-flag');
    });

    test('options.headless true keeps the editor visit headless', async () => {
        const fake = makeFakeLauncher();
        await transport(fake).publish({ content, options: { headless: true } });
        expect(fake.requests.map((request) => request.headless)).toEqual([false, true]);
    });
});

describe('infoq-pub plugin surface', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        const tmpDir = join(process.cwd(), '.works/tmp/test-infoq');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch returns the script fake', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const fake = getPublishTransport();
            expect(fake).toBeInstanceOf(FakeBrowserTransport);
            expect(fake.driver).toBe('script');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without --in/--out and 0 on fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }

        const tmpDir = join(process.cwd(), '.works/tmp/test-infoq-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        const tmpDir = join(process.cwd(), '.works/tmp/test-infoq-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'infoq-pub',
                    inPath,
                    outPath,
                    pluginsRoot: join(process.cwd(), 'plugins'),
                }),
            ).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('task 0205 R2 — declared mode refuses unknown operations pre-browser', () => {
    test('resolveOperation defaults to draft and refuses unknowns by name', () => {
        expect(resolveOperation(undefined)).toEqual({ operation: 'draft' });
        const mode = resolveOperation({ operation: 'live' });
        expect(mode.error).toContain("unsupported operation 'live' for infoq");
        expect(mode.error).toContain('draft');
    });
    test('publish refuses an unknown operation before resolving a profile', async () => {
        const transport = new InfoqBrowserTransport();
        const result = await transport.publish({ content, options: { operation: 'editorial' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported operation 'editorial'");
    });
});
