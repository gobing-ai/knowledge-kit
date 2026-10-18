import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport, FakeFileCliTransport } from '@gobing-ai/publish-harness';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    ARTICLE_CHANNEL,
    ARTICLE_CONFIG,
    ARTICLE_EDIT_RE,
    ARTICLE_SELECTORS,
    getPublishTransport,
    isArticleAuthenticated,
    LOGIN_URL_RE,
    main,
    oauth1Header,
    processPublishIO,
    resolveOperation,
    X_ARTICLES_URL,
    XArticleBrowserTransport,
    XPostApiTransport,
} from '../src/index';

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
    const originals = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(env)) {
        originals.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    return fn().finally(() => {
        for (const [key, value] of originals) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });
}

const TOKENS = {
    X_API_KEY: 'key',
    X_API_SECRET: 'secret',
    X_ACCESS_TOKEN: 'token',
    X_ACCESS_TOKEN_SECRET: 'token-secret',
};

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };
/** A live article is a published URL, so it is opt-in through `metadata.publishStatus` (R4). */
const liveContent: Content = { ...content, metadata: { publishStatus: 'public' } };

const DRAFT_URL = 'https://x.com/compose/articles/edit/19283746';
const LIVE_URL = 'https://x.com/i/articles/19283746';
const LOGIN_URL = 'https://x.com/i/flow/login?redirect_after_login=%2Fcompose%2Farticles';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'x');
const EMPTY_DIR = '/tmp/kk-x-absent';
/** R5/AC3: the operator recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/x-pub/src/profile-check.ts login';

const WRITE_SELECTORS: readonly string[] = ARTICLE_SELECTORS.write;
const TITLE_SELECTORS: readonly string[] = ARTICLE_SELECTORS.title;
const PUBLISH_SELECTOR = ARTICLE_SELECTORS.publish[0];
const ADD_PHOTOS_SELECTOR = ARTICLE_SELECTORS.addPhotos[0];
const FILE_INPUT_SELECTOR = ARTICLE_SELECTORS.fileInput[0];
/** The crop-dialog confirm the cover leg clicks (measured 2026-10-07, 0194); never a publish control. */
const APPLY_SELECTOR = '[role="dialog"] button:has-text("Apply") >> visible=true';

/** Signal the fake editor emits when scripted; `'none'` leaves the page on its current URL. */
type PublisherSignal = 'url' | 'none';

interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** The write control never attaches (a page that is not the article list). */
    missingWrite?: boolean;
    /** Title field never attaches; combined with `missingWrite` the page is not an article editor. */
    missingTitle?: boolean;
    /** The Draft.js editor never receives the pasted HTML; the paste post-condition must fail. */
    emptyBody?: boolean;
    /** The cover image never renders after Apply; the attachment post-condition must fail. */
    coverAttached?: boolean;
    /** The X autosave: the editor URL rewrite that is the whole draft signal. */
    onPaste?: PublisherSignal;
    /** Signal emitted when the publish control is clicked. */
    onPublish?: PublisherSignal;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The draft signal is URL-only by design, so the page only ever moves its URL:
 * the paste call is X's autosave, the `publish` click the live publish. `calls` is owned by the
 * caller so one log spans both launches.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';

    const attached = (selector: string): number => {
        if (WRITE_SELECTORS.includes(selector)) return options.missingWrite === true ? 0 : 1;
        if (TITLE_SELECTORS.includes(selector)) return options.missingTitle === true ? 0 : 1;
        return 1;
    };

    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (selector === PUBLISH_SELECTOR && options.onPublish === 'url') url = LIVE_URL;
        },
    });

    const page = {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        async setInputFiles(selector: string, filePath: string) {
            calls.push(`setInputFiles:${selector}|${filePath}`);
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression}`);
            // The paste script is the only expression carrying the clipboard event; the
            // post-condition read is the only one that reads the editor's text back.
            if (expression.includes('ClipboardEvent')) {
                if (options.onPaste === 'url') url = DRAFT_URL;
                return true;
            }
            // The cover-attachment probe is the only expression that asks for a rendered image.
            if (expression.includes('twimg')) return options.coverAttached !== false;
            return options.emptyBody === true ? '' : 'Body.';
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

function transport(fake: LauncherHandle, stepTimeoutMs = 200): XArticleBrowserTransport {
    return new XArticleBrowserTransport('script', { launcher: fake.launcher, stepTimeoutMs });
}

// The profile-dir tiers and the fake switch are process-wide env; clear them for every case and
// restore afterwards so a developer shell or a neighbouring suite cannot change a run.
const originalChannelDir = process.env.X_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(() => {
    delete process.env.X_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
});

afterEach(() => {
    if (originalChannelDir === undefined) delete process.env.X_PROFILE_DIR;
    else process.env.X_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
});

describe('x-pub plugin', () => {
    test('oauth1Header is deterministic for fixed nonce and timestamp', () => {
        const header = oauth1Header({
            method: 'POST',
            url: 'https://api.twitter.com/2/tweets',
            consumerKey: 'key',
            consumerSecret: 'secret',
            token: 'token',
            tokenSecret: 'token-secret',
            nonce: 'nonce',
            timestamp: '1',
        });
        expect(header.startsWith('OAuth ')).toBe(true);
        expect(header).toContain('oauth_signature=');
        expect(header).toContain('oauth_consumer_key="key"');
    });

    test('post fails loud when developer tokens are unset and does not drive x.com', async () => {
        await withEnv(
            {
                X_API_KEY: undefined,
                X_API_SECRET: undefined,
                X_ACCESS_TOKEN: undefined,
                X_ACCESS_TOKEN_SECRET: undefined,
            },
            async () => {
                const result = await new XPostApiTransport().publish({
                    content: { title: 'Hi', body: 'Hello X', format: 'markdown' },
                });
                expect(result.ok).toBe(false);
                expect(result.error).toContain('X_API_KEY');
                expect(result.error).toContain('does not fall back to a browser');
            },
        );
    });

    test('post calls POST /2/tweets via mocked fetch', async () => {
        const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
            input: Parameters<typeof fetch>[0],
            init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
            expect(String(input)).toBe('https://api.twitter.com/2/tweets');
            expect(init?.method).toBe('POST');
            expect(String(init?.headers && new Headers(init.headers).get('Authorization'))).toMatch(/^OAuth /);
            return new Response(JSON.stringify({ data: { id: '123', text: 'Hello X' } }), { status: 201 });
        }) as typeof fetch);
        await withEnv(TOKENS, async () => {
            try {
                const result = await new XPostApiTransport().publish({
                    content: { body: 'Hello X', format: 'markdown' },
                });
                expect(result.ok).toBe(true);
                expect(result.id).toBe('123');
                expect(result.url).toContain('123');
                expect(JSON.stringify(result)).not.toContain('token-secret');
            } finally {
                fetchSpy.mockRestore();
            }
        });
    });

    describe('article frozen surface (R1, R7)', () => {
        test('kind is browser and the driver defaults to script (E91-D1)', () => {
            const article = new XArticleBrowserTransport();
            expect(article.kind).toBe('browser');
            expect(article.driver).toBe('script');
            expect(ARTICLE_CHANNEL).toBe('x');
            expect(X_ARTICLES_URL).toBe('https://x.com/compose/articles');
            expect(ARTICLE_EDIT_RE.source).toBe('\\/compose\\/articles\\/edit\\/(\\d+)');
            expect(ARTICLE_CONFIG.channel).toBe('x');
            expect(ARTICLE_CONFIG.homeUrl).toBe(X_ARTICLES_URL);
            expect(ARTICLE_CONFIG.isAuthenticated).toBe(isArticleAuthenticated);
            expect(ARTICLE_CONFIG.loginTimeoutMs).toBe(180_000);
        });

        test('selector table is the seeded one from the design', () => {
            expect(ARTICLE_SELECTORS.write).toEqual([
                '[data-testid="empty_state_button_text"]',
                'button:has-text("Write")',
                '[aria-label*="Write" i]',
            ]);
            expect(ARTICLE_SELECTORS.title).toEqual([
                'textarea[placeholder="Add a title"]',
                '[data-testid="twitter-article-title"]',
            ]);
            expect(ARTICLE_SELECTORS.body).toEqual([
                '.DraftEditor-editorContainer [contenteditable="true"]',
                'div[role="textbox"]',
            ]);
            expect(ARTICLE_SELECTORS.addPhotos).toEqual([
                '[data-testid="addPhotoButton"]',
                'button[aria-label*="Add photos" i]',
            ]);
            expect(ARTICLE_SELECTORS.fileInput).toEqual([
                '[data-testid="fileInput"]',
                'input[type="file"][accept*="image"]',
            ]);
            expect(ARTICLE_SELECTORS.publish).toEqual(['[data-testid="publishButton"]', 'button:has-text("Publish")']);
        });

        test('the publish selector never comes from the post composer', () => {
            // `tweetButton`/`Tweet` belong to the tweet composer: clicking one would post a tweet.
            const publish = JSON.stringify(ARTICLE_SELECTORS.publish);
            expect(publish).not.toContain('tweetButton');
            expect(publish).not.toContain('Tweet');
        });

        test('readiness rejects a login URL and requires the write or title control', async () => {
            expect(LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
            expect(LOGIN_URL_RE.test(X_ARTICLES_URL)).toBe(false);

            const atLogin = makeFakePage({ landedUrl: LOGIN_URL }, []);
            await atLogin.goto(X_ARTICLES_URL);
            expect(await isArticleAuthenticated(atLogin)).toBe(false);

            const notEditor = makeFakePage({ missingWrite: true, missingTitle: true }, []);
            await notEditor.goto(X_ARTICLES_URL);
            expect(await isArticleAuthenticated(notEditor)).toBe(false);

            const ready = makeFakePage({}, []);
            await ready.goto(X_ARTICLES_URL);
            expect(await isArticleAuthenticated(ready)).toBe(true);
        });
    });

    describe('article draft flow (R2, R3 / AC1)', () => {
        test('draft run opens the articles page, pastes HTML and reports the observed edit URL', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(true);
            expect(result.target).toBe('x');
            expect(result.url).toBe(DRAFT_URL);
            expect(result.id).toBe('19283746');
            expect(result.message).toContain('draft');
            expect(result.metadata?.operation).toBe('article');
            expect(result.metadata?.publishStatus).toBe('draft');
            expect(result.metadata?.driver).toBe('script');
            expect(result.metadata?.profileDir).toBe(DEFAULT_DIR);
            // The articles page, reached from the env/option profile: one headless preflight pass,
            // then the headed editor visit (`options.headless` is opt-in).
            expect(fake.calls).toContain(`goto:${X_ARTICLES_URL}`);
            expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
            expect(fake.requests.map((request) => request.profileDir)).toEqual([DEFAULT_DIR, DEFAULT_DIR]);
            // The write control opens the editor, then the title field is filled.
            expect(fake.calls).toContain(`click:${WRITE_SELECTORS[0]}`);
            expect(fake.calls).toContain(`fill:${TITLE_SELECTORS[0]}|Parity`);
            // The Draft.js body goes in as rendered HTML through the shared paste (E91-D4), never
            // as plain markdown text.
            expect(fake.calls.some((call) => call.includes('text/html') && call.includes('<p>Body.</p>'))).toBe(true);
            // The task-local check: a draft run never clicks the publish control.
            expect(fake.calls).not.toContain(`click:${PUBLISH_SELECTOR}`);
            // withProfilePage closes both contexts: the preflight and the editor visit.
            expect(fake.closeCount()).toBe(2);
        });

        test('a missing title falls back to Untitled', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content: { body: 'Body.', format: 'markdown' } });

            expect(result.ok).toBe(true);
            expect(fake.calls).toContain(`fill:${TITLE_SELECTORS[0]}|Untitled`);
        });

        test('an unobserved draft signal fails naming the label and the deadline', async () => {
            const fake = makeFakeLauncher({ page: {} });
            const result = await transport(fake, 30).publish({ content });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('x article draft');
            expect(result.error).toContain('no outcome observed within 30ms');
            expect(fake.calls).not.toContain(`click:${PUBLISH_SELECTOR}`);
        });

        test('an editor that never receives the body fails instead of drafting an empty article', async () => {
            const fake = makeFakeLauncher({ page: { emptyBody: true, onPaste: 'url' } });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('editor text is empty');
            expect(fake.calls).not.toContain(`click:${PUBLISH_SELECTOR}`);
        });
    });

    describe('article cover (R2)', () => {
        const coverDir = join(process.cwd(), '.works/tmp/test-x-cover');
        const coverPath = join(coverDir, 'cover.png');

        beforeEach(async () => {
            await mkdir(coverDir, { recursive: true });
            await writeFile(coverPath, 'png');
        });

        afterEach(async () => {
            await rm(coverDir, { recursive: true, force: true });
        });

        test('an absolute existing image cover uploads without the picker and confirms the crop dialog', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content, options: { coverPath } });

            expect(result.ok).toBe(true);
            // Measured 2026-10-07 (0194): opening the picker swallows the set file — the flow sets
            // the base input directly, clicks the crop dialog's Apply, and requires the render.
            expect(fake.calls).not.toContain(`click:${ADD_PHOTOS_SELECTOR}`);
            expect(fake.calls).toContain(`setInputFiles:${FILE_INPUT_SELECTOR}|${coverPath}`);
            expect(fake.calls).toContain(`click:${APPLY_SELECTOR}`);
            expect(fake.calls.some((call) => call.startsWith('evaluate:') && call.includes('twimg'))).toBe(true);
        });

        test('a cover whose image never renders fails naming the attachment wait', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url', coverAttached: false } });
            const result = await transport(fake, 40).publish({ content, options: { coverPath } });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('cover attachment');
        });

        test('metadata.coverImage is used when options.coverPath is absent', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({
                content: { ...content, metadata: { coverImage: coverPath } },
            });

            expect(result.ok).toBe(true);
            expect(fake.calls).toContain(`setInputFiles:${FILE_INPUT_SELECTOR}|${coverPath}`);
        });

        test('a draft without a cover never opens the photo picker', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(true);
            expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
            expect(fake.calls).not.toContain(`click:${ADD_PHOTOS_SELECTOR}`);
        });

        test('a non-absolute cover fails before any browser opens', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content, options: { coverPath: 'cover.png' } });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('absolute');
            expect(fake.requests).toEqual([]);
            expect(fake.calls).toEqual([]);
        });

        test('a non-image cover extension fails before any browser opens', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content, options: { coverPath: join(coverDir, 'x.txt') } });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('.png');
            expect(fake.requests).toEqual([]);
            expect(fake.calls).toEqual([]);
        });

        test('a cover file that does not exist fails before any browser opens', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({
                content,
                options: { coverPath: join(coverDir, 'missing.png') },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('does not exist');
            expect(fake.requests).toEqual([]);
            expect(fake.calls).toEqual([]);
        });

        test('a non-string cover fails before any browser opens', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({ content, options: { coverPath: 42 } });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('cover path');
            expect(fake.requests).toEqual([]);
            expect(fake.calls).toEqual([]);
        });
    });

    describe('article live switch (R4 / AC2)', () => {
        test('the publish control runs only when publishStatus is public', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url', onPublish: 'url' } });
            const result = await transport(fake).publish({ content: liveContent });

            expect(result.ok).toBe(true);
            expect(result.metadata?.publishStatus).toBe('public');
            expect(result.message).toContain('published');
            expect(result.url).toBe(LIVE_URL);
            expect(result.id).toBe('19283746');
            expect(fake.calls).toContain(`click:${PUBLISH_SELECTOR}`);
        });

        test('a live run whose publish control moves nothing fails naming the label and the deadline', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url', onPublish: 'none' } });
            const result = await transport(fake, 30).publish({ content: liveContent });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('x article publish');
            expect(result.error).toContain('no outcome observed within 30ms');
        });

        test('an explicit draft publishStatus stays a draft run', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url', onPublish: 'url' } });
            const result = await transport(fake).publish({
                content: { ...content, metadata: { publishStatus: 'draft' } },
            });

            expect(result.ok).toBe(true);
            expect(result.metadata?.publishStatus).toBe('draft');
            expect(fake.calls).not.toContain(`click:${PUBLISH_SELECTOR}`);
        });

        test('an unknown publishStatus fails before any browser opens', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await transport(fake).publish({
                content: { ...content, metadata: { publishStatus: 'published' } },
            });

            expect(result.ok).toBe(false);
            expect(result.error).toContain("unknown publishStatus 'published'");
            expect(fake.requests).toEqual([]);
            expect(fake.calls).toEqual([]);
        });

        test('the agent driver fails fast (E91-D1)', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            const result = await new XArticleBrowserTransport('agent', { launcher: fake.launcher }).publish({
                content,
            });

            expect(result.ok).toBe(false);
            expect(result.error).toBe("unsupported driver 'agent' for x article");
            expect(fake.requests).toEqual([]);
        });
    });

    describe('article session failures (R5 / AC3)', () => {
        test('a missing profile reports the login command and the profile dir only', async () => {
            const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(EMPTY_DIR) });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('session preflight refused');
            // The refusal names the resolved profile directory and nothing else from the profile.
            expect(result.error).toContain(`no x browser profile at ${DEFAULT_DIR}`);
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
            expect(result.error).toContain('headless x readiness refused');
            expect(result.error).toContain(LOGIN_HINT);
            expect(result.error?.split('\n')).toHaveLength(1);
            expect(result.error).not.toContain('    at ');
            expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        });

        test('a session that expires before the editor visit reports the login command', async () => {
            const fake = makeFakeLauncher({ pages: [{}, { landedUrl: LOGIN_URL }] });
            const result = await transport(fake, 30).publish({ content });

            expect(result.ok).toBe(false);
            expect(result.error).toContain('Authentication was not confirmed within 30ms');
            expect(result.error).toContain(LOGIN_HINT);
            expect(result.error?.split('\n')).toHaveLength(1);
            expect(result.error).not.toContain('    at ');
            expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        });
    });

    describe('article profile resolution (R5)', () => {
        test('precedence is options.profileDir > X_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
            const fallback = makeFakeLauncher({ page: { onPaste: 'url' } });
            expect((await transport(fallback).publish({ content })).metadata?.profileDir).toBe(DEFAULT_DIR);

            process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
            process.env.X_PROFILE_DIR = '~/from-channel';
            const fromEnv = makeFakeLauncher({ page: { onPaste: 'url' } });
            const envResult = await transport(fromEnv).publish({ content });
            expect(envResult.metadata?.profileDir).toBe(join(homedir(), 'from-channel'));
            expect(fromEnv.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

            const fromFlag = makeFakeLauncher({ page: { onPaste: 'url' } });
            const flagResult = await transport(fromFlag).publish({
                content,
                options: { profileDir: '/tmp/kk-x-flag' },
            });
            expect(flagResult.metadata?.profileDir).toBe('/tmp/kk-x-flag');
        });

        test('options.headless true keeps the editor visit headless', async () => {
            const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
            await transport(fake).publish({ content, options: { headless: true } });
            expect(fake.requests.map((request) => request.headless)).toEqual([true, true]);
        });
    });

    test('fake transports: post uses FakeFileCliTransport, article uses the script FakeBrowserTransport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport('post')).toBeInstanceOf(FakeFileCliTransport);
            const article = getPublishTransport('article');
            expect(article).toBeInstanceOf(FakeBrowserTransport);
            expect(article.driver).toBe('script');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('getPublishTransport article defaults to the script browser transport', () => {
        const article = getPublishTransport('article');
        expect(article).toBeInstanceOf(XArticleBrowserTransport);
        expect(article.driver).toBe('script');
    });

    test('processPublishIO article operation stays offline on FakeBrowserTransport', async () => {
        const fake = new FakeBrowserTransport('script');
        const tmpDir = join(process.cwd(), '.works/tmp/test-x-article');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'A', body: 'B', format: 'markdown', options: { operation: 'article' } }),
        );
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('no second X plugin package exists', async () => {
        const names = await readdir(join(process.cwd(), 'plugins/publishings'));
        const xish = names.filter(
            (name) => /^x(-|$)/.test(name) || name.includes('twitter') || name === 'publish-to-x',
        );
        expect(xish).toEqual(['x-pub']);
    });

    test('main returns 1 without args and 0 on fake transport', async () => {
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
        const tmpDir = join(process.cwd(), '.works/tmp/test-x-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
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
        const tmpDir = join(process.cwd(), '.works/tmp/test-x-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'x-pub',
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

describe('task 0205 R2 — declared modes refuse unknown operations pre-browser', () => {
    test('resolveOperation refuses an unknown operation by name', () => {
        const mode = resolveOperation({ operation: 'dm' });
        expect(mode.error).toContain("unsupported operation 'dm'");
        expect(mode.error).toContain('post, article');
    });
    test('metadata operation also validates; declared ones resolve', () => {
        const content = { title: 't', body: 'b', format: 'markdown', metadata: { operation: 'article' } };
        expect(resolveOperation(undefined, content)).toEqual({ operation: 'article' });
        expect(resolveOperation(undefined, { ...content, metadata: { operation: 42 } })?.error).toContain(
            'unsupported operation',
        );
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'post' });
    });
});
