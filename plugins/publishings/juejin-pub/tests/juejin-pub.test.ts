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
    isAuthenticated,
    JuejinBrowserTransport,
    LOGIN_URL_RE,
    main,
    processPublishIO,
    SELECTORS,
} from '../src/index';

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };
/** Live needs the publish popup's two prerequisites (R4): a category name and at least one tag. */
const liveContent: Content = {
    ...content,
    metadata: { publishStatus: 'public', category: '前端', tags: ['vue', 'react'] },
};

const PUBLISH_SELECTOR = 'button:has-text("发布")';
const CONFIRM_SELECTOR = 'button:has-text("确定并发布")';
/** The title candidates, widened so the fake page can route its attached-count reads by string. */
const TITLE_SELECTORS: readonly string[] = SELECTORS.title;
const DRAFT_URL = 'https://juejin.cn/editor/drafts/7412345678901234567';
const POST_URL = 'https://juejin.cn/post/7412345678901234567';
const LOGIN_URL = 'https://juejin.cn/login?redirect=%2Feditor%2Fdrafts%2Fnew';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'juejin');
const EMPTY_DIR = '/tmp/kk-juejin-absent';
/** R5/AC3: the operator recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/juejin-pub/src/profile-check.ts login';
/** The one save key the draft rule presses when the autosave shows nothing within its window. */
const KEY_SAVE = process.platform === 'darwin' ? 'Meta+s' : 'Control+s';

/** Signal the fake editor emits when scripted; `'none'` leaves the page silent (no outcome seen). */
type Signal = 'url' | 'toast' | 'none';

interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** Title field never attaches (a page that is not the editor). */
    missingTitle?: boolean;
    /** The editor never receives the markdown; the fill's post-condition must fail the run. */
    emptyBody?: boolean;
    /** Signal emitted while the body fill runs — juejin's autosave (URL or `保存成功` toast). */
    onBodyFill?: Signal;
    /** Signal emitted only after the Meta+S / Control+S press. */
    onKeySave?: Signal;
    /** A toast label present only in the pasted article body (the false-success input, 0196). */
    bodySignal?: string;
    /** Signal emitted when the `确定并发布` control is clicked. */
    onLive?: Signal;
    /** Category items rendered in the publish popup. */
    categories?: string[];
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `keyboard`,
 * `evaluate`). `:text(…)` selectors stay unattached until a toast is scripted, so an unobserved
 * outcome cannot become a success by accident, and the fill's post-condition read is served
 * separately from the fill script. `calls` is owned by the caller so one log spans both launches.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let toast: string | null = null;
    const categories = options.categories ?? ['前端', '后端'];

    const apply = (signal: Signal | undefined, toastText: string, target = DRAFT_URL): void => {
        if (signal === 'url') url = target;
        else if (signal === 'toast') toast = toastText;
    };

    const attached = (selector: string): number => {
        if (selector.includes(':text(')) {
            if (toast !== null && selector.includes(toast)) return 1;
            // Pre-0196 the probe was unscoped, so a label sitting in the pasted article body counted
            // as a signal; only a notification-container match is a real toast now.
            const scoped =
                /\[class\*="(toast|notification|message)"/.test(selector) || selector.includes('[role="alert"]');
            if (!scoped && options.bodySignal !== undefined && selector.includes(options.bodySignal)) return 1;
            return 0;
        }
        if (TITLE_SELECTORS.includes(selector)) return options.missingTitle === true ? 0 : 1;
        if (selector === SELECTORS.category) return categories.length;
        return 1;
    };

    const leaf = (selector: string, index = 0) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        textContent: async () => (selector === SELECTORS.category ? (categories[index] ?? '') : (toast ?? '')),
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
        },
        press: async (key: string) => {
            calls.push(`press:${selector}|${key}`);
        },
        click: async () => {
            // The category log carries the item text: an exact-text pick is otherwise
            // indistinguishable from clicking the first item in the popup.
            calls.push(
                selector === SELECTORS.category ? `click:${selector}#${categories[index]}` : `click:${selector}`,
            );
            if (selector === CONFIRM_SELECTOR) apply(options.onLive, '发布成功', POST_URL);
        },
    });

    const page = {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return {
                first: () => leaf(selector),
                nth: (index: number) => leaf(selector, index),
                count: async () => attached(selector),
            };
        },
        keyboard: {
            async insertText(text: string) {
                calls.push(`insertText:${text}`);
            },
            async press(key: string) {
                calls.push(`keyboard:${key}`);
                apply(options.onKeySave, '保存成功');
            },
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 32)}`);
            // The fill script carries the CodeMirror API probes; the post-condition read is the
            // only expression that reads `textContent` back out of the editor element.
            if (expression.includes('textContent')) return options.emptyBody === true ? '' : 'Body.';
            apply(options.onBodyFill, '保存成功');
            return 'cm6';
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

function transport(fake: LauncherHandle, stepTimeoutMs = 200): JuejinBrowserTransport {
    return new JuejinBrowserTransport('script', { launcher: fake.launcher, stepTimeoutMs });
}

/** The `确定并发布` click log entry — the control a draft run must never touch (E91-D5). */
function liveClicks(calls: string[]): string[] {
    return calls.filter((call) => call === `click:${PUBLISH_SELECTOR}` || call === `click:${CONFIRM_SELECTOR}`);
}

// The profile-dir tiers are process-wide env; clear them for every case and restore afterwards so
// a developer shell or a neighbouring suite cannot change the resolved path.
const originalChannelDir = process.env.JUEJIN_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;

beforeEach(() => {
    delete process.env.JUEJIN_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
});

afterEach(() => {
    if (originalChannelDir === undefined) delete process.env.JUEJIN_PROFILE_DIR;
    else process.env.JUEJIN_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
});

describe('juejin-pub frozen surface', () => {
    test('kind is browser and the driver defaults to script (E91-D1)', () => {
        const juejin = new JuejinBrowserTransport();
        expect(juejin.kind).toBe('browser');
        expect(juejin.driver).toBe('script');
        expect(CHANNEL).toBe('juejin');
        expect(EDITOR_URL).toBe('https://juejin.cn/editor/drafts/new?v=2');
        expect(CONFIG.channel).toBe(CHANNEL);
        expect(CONFIG.homeUrl).toBe(EDITOR_URL);
        expect(CONFIG.loginTimeoutMs).toBe(180_000);
    });

    test('selector table is the measured one from the design', () => {
        expect(SELECTORS.title).toEqual(['input.title-input', 'input[placeholder*="标题"]']);
        expect(SELECTORS.body).toEqual(['.bytemd-editor .CodeMirror', '.CodeMirror', '.cm-editor']);
        expect(SELECTORS.publish).toEqual([PUBLISH_SELECTOR]);
        expect(SELECTORS.category).toBe('.category-list .item');
        expect(SELECTORS.tagInput).toBe('.tag-input input');
        expect(SELECTORS.confirm).toEqual([CONFIRM_SELECTOR]);
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

describe('juejin-pub draft flow (R2, R3 / AC1)', () => {
    test('draft run saves through the profile page and never clicks a live control', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('juejin');
        expect(result.url).toBe(DRAFT_URL);
        expect(result.id).toBe('7412345678901234567');
        expect(result.message).toContain('draft');
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.profileDir).toBe(DEFAULT_DIR);
        // One headless preflight pass, then the headed editor visit (options.headless is opt-in).
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.requests.map((request) => request.profileDir)).toEqual([DEFAULT_DIR, DEFAULT_DIR]);
        expect(fake.calls).toContain('fill:input.title-input|Parity');
        // The markdown body goes through the shared CodeMirror fill, never through HTML paste.
        expect(fake.calls.some((call) => call.startsWith('evaluate:'))).toBe(true);
        expect(fake.calls.some((call) => call.includes('ClipboardEvent'))).toBe(false);
        // The task-local check: a draft run touches neither `发布` nor `确定并发布`.
        expect(liveClicks(fake.calls)).toEqual([]);
        // withProfilePage closes both contexts: the preflight and the editor visit.
        expect(fake.closeCount()).toBe(2);
    });

    test('draft success from a 保存成功 toast when the URL does not move', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'toast' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(EDITOR_URL);
        expect(result.id).toBeUndefined();
        expect(liveClicks(fake.calls)).toEqual([]);
    });

    test('a 保存成功 label that only exists in the pasted body is not an observed save (0196)', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'none', bodySignal: '保存成功' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('no outcome observed within 30ms');
    });

    test('the save key is pressed at most once when the autosave shows nothing', async () => {
        const fake = makeFakeLauncher({ page: { onKeySave: 'url' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_URL);
        expect(fake.calls.filter((call) => call === `keyboard:${KEY_SAVE}`)).toHaveLength(1);
        expect(fake.calls).toContain(`keyboard:${KEY_SAVE}`);
    });

    test('an unobserved draft signal fails naming the label and the timeout', async () => {
        const fake = makeFakeLauncher({ page: {} });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('juejin draft save');
        expect(result.error).toContain(SELECTORS.body[0]);
        expect(result.error).toContain('no outcome observed within 30ms');
        expect(liveClicks(fake.calls)).toEqual([]);
    });

    test('an editor that never receives the body fails instead of drafting an empty article', async () => {
        const fake = makeFakeLauncher({ page: { emptyBody: true, onBodyFill: 'url' } });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('editor text is empty');
        expect(liveClicks(fake.calls)).toEqual([]);
    });
});

describe('juejin-pub live switch (R4 / AC2)', () => {
    test('the live controls run only when publishStatus is public', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url', onLive: 'toast' } });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.message).toContain('published');
        expect(fake.calls).toContain(`click:${PUBLISH_SELECTOR}`);
        expect(fake.calls).toContain(`click:${CONFIRM_SELECTOR}`);
        expect(fake.calls).toContain(`click:${SELECTORS.category}#前端`);
        expect(fake.calls).toContain(`fill:${SELECTORS.tagInput}|vue`);
        expect(fake.calls).toContain(`press:${SELECTORS.tagInput}|Enter`);
        expect(fake.calls).toContain(`fill:${SELECTORS.tagInput}|react`);
    });

    test('a live run reports the published post URL and its id', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url', onLive: 'url' } });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(result.id).toBe('7412345678901234567');
    });

    test('an explicit draft publishStatus stays a draft run', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const result = await transport(fake).publish({ content: { ...content, metadata: { publishStatus: 'draft' } } });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(liveClicks(fake.calls)).toEqual([]);
    });

    test('an unknown publishStatus fails before any browser opens', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'published' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("unknown publishStatus 'published'");
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('a live run without category or tags fails before any browser opens', async () => {
        const withoutCategory = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const noCategory = await transport(withoutCategory).publish({
            content: { ...content, metadata: { publishStatus: 'public', tags: ['vue'] } },
        });
        expect(noCategory.ok).toBe(false);
        expect(noCategory.error).toContain('metadata.category');
        expect(withoutCategory.requests).toEqual([]);
        expect(withoutCategory.calls).toEqual([]);

        const withoutTags = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const noTags = await transport(withoutTags).publish({
            content: { ...content, metadata: { publishStatus: 'public', category: '前端' } },
        });
        expect(noTags.ok).toBe(false);
        expect(noTags.error).toContain('metadata.tags');
        expect(withoutTags.requests).toEqual([]);
        expect(withoutTags.calls).toEqual([]);
    });

    test('the agent driver fails fast (E91-D1)', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const result = await new JuejinBrowserTransport('agent', { launcher: fake.launcher }).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toBe("unsupported driver 'agent' for juejin");
        expect(fake.requests).toEqual([]);
    });
});

describe('juejin-pub session failures (R5 / AC3)', () => {
    test('a missing profile reports the login command and the profile dir only', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(EMPTY_DIR) });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        // The refusal names the resolved profile directory and nothing else from the profile.
        expect(result.error).toContain(`no juejin browser profile at ${DEFAULT_DIR}`);
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
        expect(result.error).toContain('headless juejin readiness refused');
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

describe('juejin-pub profile resolution (R5)', () => {
    test('precedence is options.profileDir > JUEJIN_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
        const fallback = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        expect((await transport(fallback).publish({ content })).metadata?.profileDir).toBe(DEFAULT_DIR);

        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.JUEJIN_PROFILE_DIR = '~/from-channel';
        const fromEnv = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const envResult = await transport(fromEnv).publish({ content });
        expect(envResult.metadata?.profileDir).toBe(join(homedir(), 'from-channel'));
        expect(fromEnv.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

        const fromFlag = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        const flagResult = await transport(fromFlag).publish({
            content,
            options: { profileDir: '/tmp/kk-juejin-flag' },
        });
        expect(flagResult.metadata?.profileDir).toBe('/tmp/kk-juejin-flag');
    });

    test('options.headless true keeps the editor visit headless', async () => {
        const fake = makeFakeLauncher({ page: { onBodyFill: 'url' } });
        await transport(fake).publish({ content, options: { headless: true } });
        expect(fake.requests.map((request) => request.headless)).toEqual([true, true]);
    });
});

describe('juejin-pub plugin surface', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        const tmpDir = join(process.cwd(), '.tmp-test-juejin');
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

        const tmpDir = join(process.cwd(), '.tmp-test-juejin-main');
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
        const tmpDir = join(process.cwd(), '.tmp-test-juejin-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'juejin-pub',
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
