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
    EDITOR_URL,
    getPublishTransport,
    InfoqBrowserTransport,
    isAuthenticated,
    LOGIN_URL_RE,
    main,
    processPublishIO,
    SELECTORS,
} from '../src/index';

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };

const DRAFT_SELECTOR = 'button:has-text("保存草稿")';
const LIVE_SELECTOR = 'button:has-text("提交")';
const DRAFT_URL = 'https://xie.infoq.cn/article/1234567890/edit';
const DRAFT_URL_WITHOUT_ID = 'https://xie.infoq.cn/write?draft=1';
const LOGIN_URL = 'https://account.infoq.cn/login?redirect=%2Fwrite';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'infoq');
const EMPTY_DIR = '/tmp/kk-infoq-absent';
/** R5/AC3: the operator recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/infoq-pub/src/profile-check.ts login';

/** Scripted outcome of a save/submit click; `'none'` leaves the page silent (no observed signal). */
type ClickOutcome = 'url' | 'urlWithoutId' | 'toast' | 'none';

interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** Title field never attaches (a page that is not the editor). */
    missingTitle?: boolean;
    onDraft?: ClickOutcome;
    onLive?: ClickOutcome;
}

/**
 * Fake `Page` over the four primitives the flow may use (`goto`, `url`, `locator`, `evaluate`).
 * `count()` is 0 for `:text(…)` selectors until a toast is scripted, so an unobserved outcome
 * cannot become a success by accident. `calls` is owned by the caller so several fake pages can
 * record into one log.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let toast: string | null = null;

    const attached = (selector: string): number => {
        if (selector.includes(':text(')) return toast !== null && selector.includes(toast) ? 1 : 0;
        if (selector.includes('标题')) return options.missingTitle === true ? 0 : 1;
        return 1;
    };

    const apply = (outcome: ClickOutcome | undefined, toastText: string): void => {
        if (outcome === 'url') url = DRAFT_URL;
        else if (outcome === 'urlWithoutId') url = DRAFT_URL_WITHOUT_ID;
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
                        if (selector === DRAFT_SELECTOR) apply(options.onDraft, '保存成功');
                        if (selector === LIVE_SELECTOR) apply(options.onLive, '提交成功');
                    },
                    textContent: async () => toast ?? '',
                }),
            };
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 32)}`);
            return 'pasted body text';
        },
    };
    return page as unknown as Page;
}

interface FakeLauncherOptions {
    /** Page script for every launch. Ignored when `pages` is given. */
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

/** Launcher fake returning recording contexts; every call is logged into one shared call list. */
function makeFakeLauncher(options: FakeLauncherOptions = {}): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    const scripts = options.pages ?? [options.page ?? {}];
    const pages = scripts.map((script) => makeFakePage(script, calls));
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

function transport(fake: LauncherHandle, stepTimeoutMs = 200): InfoqBrowserTransport {
    return new InfoqBrowserTransport('script', { launcher: fake.launcher, stepTimeoutMs });
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

describe('infoq-pub frozen surface', () => {
    test('kind is browser and the driver defaults to script', () => {
        const infoq = new InfoqBrowserTransport();
        expect(infoq.kind).toBe('browser');
        expect(infoq.driver).toBe('script');
        expect(CHANNEL).toBe('infoq');
        expect(EDITOR_URL).toBe('https://xie.infoq.cn/write');
        expect(CONFIG.channel).toBe(CHANNEL);
        expect(CONFIG.homeUrl).toBe(EDITOR_URL);
        expect(CONFIG.loginTimeoutMs).toBe(180_000);
    });

    test('selector table is the measured one from the design', () => {
        expect(SELECTORS.title).toEqual(['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]']);
        expect(SELECTORS.summary).toEqual([
            'input[placeholder*="摘要"]',
            'textarea[placeholder*="摘要"]',
            'input[name="summary"]',
        ]);
        expect(SELECTORS.body).toEqual(['.ProseMirror[contenteditable="true"]', '[contenteditable="true"]']);
        expect(SELECTORS.draft).toEqual([DRAFT_SELECTOR]);
        expect(SELECTORS.live).toEqual([LIVE_SELECTOR]);
    });

    test('readiness rejects a login URL and requires the attached title field', async () => {
        expect(LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        expect(LOGIN_URL_RE.test(EDITOR_URL)).toBe(false);

        const atLogin = makeFakePage({ landedUrl: LOGIN_URL }, []);
        await atLogin.goto(EDITOR_URL);
        expect(await isAuthenticated(atLogin)).toBe(false);

        const noTitle = makeFakePage({ missingTitle: true }, []);
        await noTitle.goto(EDITOR_URL);
        expect(await isAuthenticated(noTitle)).toBe(false);

        const ready = makeFakePage({}, []);
        await ready.goto(EDITOR_URL);
        expect(await isAuthenticated(ready)).toBe(true);
    });
});

describe('infoq-pub draft flow', () => {
    test('draft run saves through the profile page and never clicks the submit control', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('infoq');
        expect(result.url).toBe(DRAFT_URL);
        expect(result.id).toBe('1234567890');
        expect(result.message).toContain('draft');
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.profileDir).toBe(DEFAULT_DIR);
        // One headless preflight pass, then the headed editor visit (options.headless is opt-in).
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.requests.map((request) => request.profileDir)).toEqual([DEFAULT_DIR, DEFAULT_DIR]);
        expect(fake.calls).toContain('fill:input[placeholder*="标题"]|Parity');
        expect(fake.calls.some((call) => call.startsWith('evaluate:'))).toBe(true);
        expect(fake.calls).toContain(`click:${DRAFT_SELECTOR}`);
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
        // withProfilePage closes both contexts: the preflight and the editor visit.
        expect(fake.closeCount()).toBe(2);
    });

    test('optional summary is filled from metadata and skipped when absent', async () => {
        const withSummary = makeFakeLauncher({ page: { onDraft: 'url' } });
        await transport(withSummary).publish({ content: { ...content, metadata: { summary: 'Abstract.' } } });
        expect(withSummary.calls).toContain('fill:input[placeholder*="摘要"]|Abstract.');

        const withoutSummary = makeFakeLauncher({ page: { onDraft: 'url' } });
        await transport(withoutSummary).publish({ content });
        expect(withoutSummary.calls.some((call) => call.includes('摘要'))).toBe(false);
    });

    test('draft success from a toast when the URL does not move', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'toast' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(EDITOR_URL);
        expect(result.id).toBeUndefined();
        expect(fake.calls).toContain(`click:${DRAFT_SELECTOR}`);
    });

    test('a moved URL without an id segment is not a draft signal', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'urlWithoutId' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no outcome observed within 30ms');
    });

    test('an unobserved draft signal fails naming the label and the timeout', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'none' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft');
        expect(result.error).toContain(DRAFT_SELECTOR);
        expect(result.error).toContain('no outcome observed within 30ms');
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
    });
});

describe('infoq-pub live switch (R4/AC2)', () => {
    test('the submit control is clicked only when publishStatus is public', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url', onLive: 'toast' } });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'public' } },
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.message).toContain('editorial review');
        expect(fake.calls).toContain(`click:${DRAFT_SELECTOR}`);
        expect(fake.calls).toContain(`click:${LIVE_SELECTOR}`);
    });

    test('an explicit draft publishStatus stays a draft run', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url' } });
        const result = await transport(fake).publish({ content: { ...content, metadata: { publishStatus: 'draft' } } });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(fake.calls.some((call) => call.includes(LIVE_SELECTOR))).toBe(false);
    });

    test('an unknown publishStatus fails before any browser opens', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url' } });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'published' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("unknown publishStatus 'published'");
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('the agent driver fails fast (E91-D1)', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url' } });
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

    test('an expired session reports the login command instead of a stack', async () => {
        const fake = makeFakeLauncher({ page: { landedUrl: LOGIN_URL } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain('headless infoq readiness refused');
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
    });

    test('a session that expires before the editor visit reports the login command', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { landedUrl: LOGIN_URL }],
        });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Authentication was not confirmed within 30ms');
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('infoq-pub profile resolution (R5)', () => {
    test('precedence is options.profileDir > INFOQ_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
        const fallback = makeFakeLauncher({ page: { onDraft: 'url' } });
        expect((await transport(fallback).publish({ content })).metadata?.profileDir).toBe(DEFAULT_DIR);

        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.INFOQ_PROFILE_DIR = '~/from-channel';
        const fromEnv = makeFakeLauncher({ page: { onDraft: 'url' } });
        const envResult = await transport(fromEnv).publish({ content });
        expect(envResult.metadata?.profileDir).toBe(join(homedir(), 'from-channel'));
        expect(fromEnv.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

        const fromFlag = makeFakeLauncher({ page: { onDraft: 'url' } });
        const flagResult = await transport(fromFlag).publish({
            content,
            options: { profileDir: '/tmp/kk-infoq-flag' },
        });
        expect(flagResult.metadata?.profileDir).toBe('/tmp/kk-infoq-flag');
    });

    test('options.headless true keeps the editor visit headless', async () => {
        const fake = makeFakeLauncher({ page: { onDraft: 'url' } });
        await transport(fake).publish({ content, options: { headless: true } });
        expect(fake.requests.map((request) => request.headless)).toEqual([true, true]);
    });
});

describe('infoq-pub plugin surface', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        const tmpDir = join(process.cwd(), '.tmp-test-infoq');
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

        const tmpDir = join(process.cwd(), '.tmp-test-infoq-main');
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
        const tmpDir = join(process.cwd(), '.tmp-test-infoq-invoke');
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
