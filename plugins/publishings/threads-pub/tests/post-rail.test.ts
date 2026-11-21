import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import type { BrowserContext, Page } from 'playwright';
import {
    isThreadsAuthenticated,
    THREADS_CONFIG,
    THREADS_HOME_URL,
    THREADS_LOGIN_INSTRUCTION,
    THREADS_POST_SELECTORS,
    ThreadsPostBrowserTransport,
} from '../src/post-rail';

const PROFILE_URL = 'https://www.threads.com/@robin';
const POST_LINK = 'a[href*="/post/"]';
const LOGIN_URL = 'https://www.threads.com/login';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'threads');

const content: Content = { title: 'Parity', body: 'Hello Threads', format: 'markdown' };

interface FakePageOptions {
    /** URL every `goto` lands on — a login URL means the session is gone. */
    landedUrl?: string;
    /** Profile link href; `null` means the control carries no readable href. */
    profileHref?: string | null;
    /** Newest `/post/` link on the profile before Post is clicked. */
    postHref?: string | null;
    /** Newest `/post/` link once Post has been clicked. */
    postHrefAfterSubmit?: string | null;
    /** The timeline carries a post link whose `href` reads as null. */
    nullPostHref?: boolean;
    /** The profile link's `href` read throws. */
    rejectProfileHref?: boolean;
    /** The timeline post link's `href` read throws before Post is clicked. */
    rejectPostHref?: boolean;
    /** `reload()` rejects (the receipt falls back instead of failing). */
    rejectReload?: boolean;
    /** `goto` to the profile URL rejects (the baseline read is best-effort). */
    rejectProfileGoto?: boolean;
    /** The evidence dump's locator counts and screenshot reject (diagnostics must never fail a post). */
    rejectEvidenceProbes?: boolean;
    /** Composer reads/interactions reject — each is `.catch`-guarded in the rail. */
    rejectInteractions?: boolean;
    /** Reject the composer's `isVisible` from the Nth call onward (the harness probes it first). */
    isVisibleRejectsFrom?: number;
    /** The nav "New thread" control is absent — only the inline composer remains. */
    missingCreateEntry?: boolean;
    /** Clicking the nav entry rejects (the flow swallows it). */
    rejectCreateEntryClick?: boolean;
    /** The inline composer never attaches. */
    missingComposer?: boolean;
    /** The composer renders without an `aria-label`, so the visibility probe never confirms it. */
    unlabeledComposer?: boolean;
    /** The editor keeps no text — the readback post-condition must fail. */
    emptyReadback?: boolean;
    /** The Post control never attaches after typing. */
    missingSubmit?: boolean;
    /** The media control is present but clicking it rejects (the rail swallows it). */
    rejectMediaClick?: boolean;
    /** The media control is absent; the cover leg is skipped, not failed. */
    missingMediaButton?: boolean;
    /** The uploaded image never renders in the composer. */
    mediaNeverRenders?: boolean;
    /** Posting returns the page to the profile URL, so the receipt reads it via `reload`. */
    returnToProfileAfterSubmit?: boolean;
    /** The role engine's `Post` button count; a number models a real Playwright locator (2026-11-20). */
    rolePostCount?: number;
    /** The role engine's `count()` rejects — the selector list must still resolve the control. */
    rejectRoleCount?: boolean;
    /** The `Dismiss suggestions` click rejects; the post must still go out. */
    rejectDismissClick?: boolean;
    /** The first (non-forced) submit click is intercepted; the forced fallback must still post. */
    submitClickIntercepted?: boolean;
    /** Whole-document inventory the missing-Post diagnostic reads; absent means no `evaluate`. */
    consoleJson?: string;
    /** `evaluate` rejects — the inventory must never turn the failure into a stack. */
    rejectEvaluate?: boolean;
}

/**
 * Fake `Page` over the primitives the Threads rail uses. Threads' own signals are: the inline
 * composer (a contenteditable div) and the profile timeline's newest `/post/<id>`, so the fake keeps
 * URL, typed text, upload state and whether Post is rendered.
 */
function makeFakePostPage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let typed = '';
    let submitted = false;
    let mediaUploaded = false;
    let submitClicks = 0;

    const onProfile = (): boolean => url === PROFILE_URL;
    const postHref = (): string | null => {
        if (options.nullPostHref === true) return null;
        return submitted ? (options.postHrefAfterSubmit ?? null) : (options.postHref ?? null);
    };
    const composerAttached = (): boolean => onProfile() === false && options.missingComposer !== true;

    const attached = (selector: string): number => {
        if (selector === THREADS_POST_SELECTORS.profileLink[0]) return 1;
        if (selector === POST_LINK) return onProfile() && postHref() !== null ? 1 : 0;
        if (selector === THREADS_POST_SELECTORS.createEntry[0]) return options.missingCreateEntry === true ? 0 : 1;
        if (selector === THREADS_POST_SELECTORS.text[0]) return composerAttached() ? 1 : 0;
        if (selector === THREADS_POST_SELECTORS.submit[0]) {
            if (options.missingSubmit === true) return 0;
            return composerAttached() && typed !== '' ? 1 : 0;
        }
        if (selector === THREADS_POST_SELECTORS.mediaButton[0]) return options.missingMediaButton === true ? 0 : 1;
        if (selector === THREADS_POST_SELECTORS.fileInput[0]) return 1;
        if (selector === THREADS_POST_SELECTORS.mediaPreview[0]) {
            return mediaUploaded && options.mediaNeverRenders !== true ? 1 : 0;
        }
        return 0;
    };

    const leaf = (selector: string) => {
        let visibleCalls = 0;
        return {
            count: async () => {
                if (
                    options.rejectEvidenceProbes === true &&
                    (selector === 'div[contenteditable="true"]' || selector === 'div[role="button"]:text-is("Post")')
                ) {
                    throw new Error('evidence probe detached');
                }
                return attached(selector);
            },
            isVisible: async () => {
                if (selector === THREADS_POST_SELECTORS.text[0]) visibleCalls += 1;
                const from = options.isVisibleRejectsFrom;
                if (from !== undefined && visibleCalls >= from) throw new Error('visibility read detached');
                return attached(selector) > 0;
            },
            getAttribute: async (name: string) => {
                calls.push(`getAttribute:${selector}|${name}`);
                if (options.rejectInteractions === true && selector === THREADS_POST_SELECTORS.text[0]) {
                    throw new Error('composer detached');
                }
                if (selector === THREADS_POST_SELECTORS.profileLink[0]) {
                    if (options.rejectProfileHref === true) throw new Error('profile link detached');
                    return options.profileHref === null ? null : (options.profileHref ?? '/@robin');
                }
                if (selector === POST_LINK) {
                    // Only the pre-submit read races: once Post is clicked the receipt needs a real id.
                    if (options.rejectPostHref === true && !submitted) throw new Error('post link detached');
                    return postHref();
                }
                if (selector === THREADS_POST_SELECTORS.text[0]) {
                    if (options.unlabeledComposer === true) return null;
                    return 'Empty text field. Type to compose a new thread';
                }
                return null;
            },
            click: async (clickOptions?: { force?: boolean; timeout?: number }) => {
                calls.push(`click:${selector}`);
                if (selector.includes('Dismiss suggestions')) {
                    calls.push('dismiss:attempt');
                    if (options.rejectDismissClick === true) throw new Error('suggestions layer stayed open');
                    return;
                }
                if (options.rejectInteractions === true && selector === THREADS_POST_SELECTORS.text[0]) {
                    throw new Error('composer detached');
                }
                if (selector === THREADS_POST_SELECTORS.mediaButton[0] && options.rejectMediaClick === true) {
                    throw new Error('media control detached');
                }
                if (selector === THREADS_POST_SELECTORS.createEntry[0] && options.rejectCreateEntryClick === true) {
                    throw new Error('entry intercepted');
                }
                if (selector !== THREADS_POST_SELECTORS.submit[0]) return;
                submitClicks += 1;
                if (options.submitClickIntercepted === true && clickOptions?.force !== true && submitClicks === 1) {
                    throw new Error('suggestions layer intercepts pointer events');
                }
                submitted = true;
                if (options.returnToProfileAfterSubmit === true) url = PROFILE_URL;
            },
            evaluate: async () => {
                calls.push(`evaluate:${selector}`);
                if (options.rejectInteractions === true) throw new Error('composer detached');
                return options.emptyReadback === true ? '' : typed;
            },
        };
    };

    const page = {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            if (options.rejectProfileGoto === true && target === PROFILE_URL)
                throw new Error('profile navigation failed');
            url = options.landedUrl ?? target;
        },
        async reload() {
            calls.push('reload');
            if (options.rejectReload === true) throw new Error('reload rejected');
            url = options.landedUrl ?? url;
        },
        url: () => url,
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        keyboard: {
            type: async (text: string) => {
                calls.push(`type:${text}`);
                typed = text;
            },
        },
        async waitForTimeout() {},
        async screenshot(payload: { path: string }) {
            calls.push(`screenshot:${payload.path}`);
            if (options.rejectEvidenceProbes === true) throw new Error('screenshot unavailable');
            await writeFile(payload.path, 'png');
        },
        async setInputFiles(selector: string, filePath: string) {
            calls.push(`setInputFiles:${selector}|${filePath}`);
            mediaUploaded = true;
        },
        // A real Playwright page always carries the role engine and `evaluate`; both are optional
        // here so the older doubles keep modelling the CSS-only surface.
        ...(options.rolePostCount === undefined && options.rejectRoleCount !== true
            ? {}
            : {
                  getByRole(role: string, byOptions: { name: string; exact: boolean }) {
                      calls.push(`getByRole:${role}|${byOptions.name}`);
                      return {
                          async count() {
                              if (options.rejectRoleCount === true) throw new Error('role engine detached');
                              return options.rolePostCount ?? 0;
                          },
                          last: () => ({
                              async click() {
                                  calls.push('click:role:Post:last');
                                  submitted = true;
                                  if (options.returnToProfileAfterSubmit === true) url = PROFILE_URL;
                              },
                          }),
                      };
                  },
              }),
        ...(options.consoleJson === undefined && options.rejectEvaluate !== true
            ? {}
            : {
                  async evaluate() {
                      calls.push('evaluate:inventory');
                      if (options.rejectEvaluate === true) throw new Error('evaluate unavailable');
                      return options.consoleJson;
                  },
              }),
    };
    return page as unknown as Page;
}

interface FakeLauncherOptions {
    /** Page script per launch call (index 0 is the session preflight); the last entry repeats. */
    pages?: FakePageOptions[];
    /** Thrown instead of launching — an absent/unusable profile. */
    failLaunch?: (request: ProfileLaunchRequest, index: number) => Error | undefined;
}

function makeFakeLauncher(options: FakeLauncherOptions = {}) {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    const scripts = options.pages ?? [{}];
    const pages = scripts.map((script) => makeFakePostPage(script, calls));
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            const index = requests.length;
            requests.push(request);
            const failure = options.failLaunch?.(request, index);
            if (failure) throw failure;
            const page = pages[Math.min(index, pages.length - 1)] ?? makeFakePostPage({}, calls);
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

function transport(fake: ReturnType<typeof makeFakeLauncher>, stepTimeoutMs = 60): ThreadsPostBrowserTransport {
    return new ThreadsPostBrowserTransport({ launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.THREADS_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalDebugDir = process.env.KK_THREADS_DEBUG_DIR;

beforeEach(() => {
    delete process.env.THREADS_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KK_THREADS_DEBUG_DIR;
});

afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };
    restore('THREADS_PROFILE_DIR', originalChannelDir);
    restore('KK_BROWSER_PROFILE_DIR', originalSharedDir);
    restore('KK_THREADS_DEBUG_DIR', originalDebugDir);
});

describe('threads post rail frozen surface', () => {
    test('exports the measured composer contract', () => {
        expect(THREADS_HOME_URL).toBe('https://www.threads.com');
        expect(THREADS_LOGIN_INSTRUCTION).toBe('bun plugins/publishings/threads-pub/src/profile-check.ts login');
        // 2026-11-20: the label is a CHILD div of the role=button element, so the direct text-is
        // forms alone match nothing; the :has shapes carry the real composer.
        expect([...THREADS_POST_SELECTORS.submit]).toEqual([
            'div[role="button"]:has(> div:text-is("Post")):visible',
            'div[role="button"]:has(div:text-is("Post")):visible',
            'div[role="button"]:text-is("Post"):visible',
            'button:text-is("Post"):visible',
            'div[role="button"][aria-label="Post"]:visible',
        ]);
        expect(THREADS_POST_SELECTORS.fileInput).toEqual(['input[type="file"]']);
        expect(THREADS_CONFIG.channel).toBe('threads');
        expect(THREADS_CONFIG.homeUrl).toBe(THREADS_HOME_URL);
        expect(THREADS_CONFIG.isAuthenticated).toBe(isThreadsAuthenticated);
        expect(THREADS_CONFIG.loginTimeoutMs).toBe(180_000);
    });

    test('readiness rejects a login URL and requires the inline composer', async () => {
        const atLogin = makeFakePostPage({ landedUrl: LOGIN_URL }, []);
        await atLogin.goto(THREADS_HOME_URL);
        expect(await isThreadsAuthenticated(atLogin)).toBe(false);

        const noComposer = makeFakePostPage({ missingComposer: true }, []);
        await noComposer.goto(THREADS_HOME_URL);
        expect(await isThreadsAuthenticated(noComposer)).toBe(false);

        const ready = makeFakePostPage({}, []);
        await ready.goto(THREADS_HOME_URL);
        expect(await isThreadsAuthenticated(ready)).toBe(true);
    });
});

describe('threads post rail refusals before any browser opens', () => {
    let dir = '';
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'kk-threads-post-'));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('an explicit draft publishStatus is refused: the composer publishes immediately', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'draft' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('threads post has no draft');
        expect(fake.requests).toEqual([]);
    });

    test('an unknown publishStatus fails closed before the session probe', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'scheduled' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("unknown publishStatus 'scheduled'");
        expect(fake.requests).toEqual([]);
    });

    test('empty body and title is refused before the session probe', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content: { title: ' ', body: ' ', format: 'markdown' } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('requires non-empty Content.body or Content.title');
        expect(fake.requests).toEqual([]);
    });

    test('a non-string cover is refused', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content, options: { coverPath: 42 } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("got '42'");
        expect(fake.requests).toEqual([]);
    });

    test('a relative cover is refused', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content, options: { coverPath: 'cover.png' } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('must be an absolute path');
        expect(fake.requests).toEqual([]);
    });

    test('a non-image cover extension is refused', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content, options: { coverPath: join(dir, 'cover.txt') } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("must be .png/.jpg/.jpeg/.webp, got '.txt'");
        expect(fake.requests).toEqual([]);
    });

    test('a cover file that does not exist is refused', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content, options: { coverPath: join(dir, 'missing.png') } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not exist');
        expect(fake.requests).toEqual([]);
    });
});

describe('threads post rail session preflight', () => {
    test('an absent profile is refused at the first probe, naming the login command', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(DEFAULT_DIR) });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(`no threads browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(THREADS_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(fake.closeCount()).toBe(0);
    });

    test('a login redirect refuses after one read-only pass instead of opening the composer', async () => {
        // THREADS_CONFIG declares headed-only, but the publish preflight still uses the
        // headless-then-headed ladder (only the profile CLI reads `checkHeadedOnly`).
        const fake = makeFakeLauncher({ pages: [{ landedUrl: LOGIN_URL }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('headless threads readiness refused');
        expect(result.error).toContain(THREADS_LOGIN_INSTRUCTION);
        // The auth wait spends the whole check budget, so the headed fallback is not launched: a
        // second launch inside one deadline is what made `kk plugin check` kill the probe before it
        // could print its refusal (2026-11-19).
        expect(fake.requests.map((request) => request.headless)).toEqual([true]);
    });

    test('a session that expires before the composer visit reports the login command, not a stack', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { landedUrl: LOGIN_URL }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Authentication was not confirmed');
        expect(result.error).toContain(THREADS_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
    });
});

describe('threads post rail flow', () => {
    test('a successful post reports the post id observed on the profile timeline', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { postHref: '/@robin/post/AAA', postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(ResultSchema.parse(result).ok).toBe(true);
        expect(result.target).toBe('threads');
        expect(result.id).toBe('BBB');
        expect(result.url).toBe('https://www.threads.com/@robin/post/BBB');
        expect(result.message).toContain('threads post published and confirmed');
        expect(result.metadata).toEqual({
            operation: 'post',
            driver: 'script',
            publishStatus: 'public',
            profileDir: DEFAULT_DIR,
            confirmedBy: 'profile-timeline',
        });
        // Baseline on the profile, then the home timeline for the inline composer.
        expect(fake.calls).toContain(`goto:${PROFILE_URL}`);
        expect(fake.calls).toContain(`goto:${THREADS_HOME_URL}`);
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.createEntry[0]}`);
        expect(fake.calls).toContain('type:Hello Threads');
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
        expect(fake.closeCount()).toBe(2);
    });

    test('a profile with no post yet publishes when a new id appears', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { postHref: null, postHrefAfterSubmit: '/@robin/post/ZZZ' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('ZZZ');
    });

    test('a timeline whose post href reads as null still baselines to no id', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { nullPostHref: true }],
        });
        const result = await transport(fake).publish({ content });

        // No readable baseline and no id after Post: the receipt cannot be confirmed.
        expect(result.ok).toBe(false);
        expect(result.error).toContain('receipt not confirmed');
    });

    test('the receipt survives a submit that returns the page to the profile URL', async () => {
        const fake = makeFakeLauncher({
            pages: [
                {},
                {
                    postHref: '/@robin/post/AAA',
                    postHrefAfterSubmit: '/@robin/post/BBB',
                    returnToProfileAfterSubmit: true,
                },
            ],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('BBB');
        expect(fake.calls).toContain('reload');
    });

    test('a rejected reload keeps the receipt', async () => {
        const fake = makeFakeLauncher({
            pages: [
                {},
                {
                    postHref: '/@robin/post/AAA',
                    postHrefAfterSubmit: '/@robin/post/BBB',
                    returnToProfileAfterSubmit: true,
                    rejectReload: true,
                },
            ],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('BBB');
    });

    test('a rejected nav-entry click falls back to the inline composer', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectCreateEntryClick: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('BBB');
    });

    test('a build without the nav entry uses the inline composer alone', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { missingCreateEntry: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(fake.calls).not.toContain(`click:${THREADS_POST_SELECTORS.createEntry[0]}`);
    });

    test('options.headless true keeps the composer visit headless', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { postHrefAfterSubmit: '/@robin/post/BBB' }] });
        await transport(fake).publish({ content, options: { headless: true } });

        expect(fake.requests.map((request) => request.headless)).toEqual([true, true]);
    });

    test('the profile dir follows options.profileDir over the channel env', async () => {
        process.env.THREADS_PROFILE_DIR = '~/from-channel';
        const fake = makeFakeLauncher({ pages: [{}, { postHrefAfterSubmit: '/@robin/post/BBB' }] });
        const result = await transport(fake).publish({ content, options: { profileDir: '/tmp/kk-threads' } });

        expect(result.metadata?.profileDir).toBe('/tmp/kk-threads');
    });

    test('KK_THREADS_DEBUG_DIR writes one state dump per step as publish evidence', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-threads-evidence-'));
        process.env.KK_THREADS_DEBUG_DIR = dir;
        try {
            const fake = makeFakeLauncher({ pages: [{}, { postHrefAfterSubmit: '/@robin/post/BBB' }] });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(true);
            const written = readdirSync(dir).sort();
            expect(written).toContain('01-landing.json');
            expect(written).toContain('04-typed.json');
            expect(existsSync(join(dir, '03-focused.png'))).toBe(true);
        } finally {
            delete process.env.KK_THREADS_DEBUG_DIR;
            await rm(dir, { recursive: true, force: true });
        }
    });
});

describe('threads post rail cover leg', () => {
    let dir = '';
    const coverPath = () => join(dir, 'cover.png');

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'kk-threads-cover-'));
        await writeFile(join(dir, 'cover.png'), 'png');
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('an absolute existing cover uploads through the media control', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { postHrefAfterSubmit: '/@robin/post/BBB' }] });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.mediaButton[0]}`);
        expect(fake.calls).toContain(`setInputFiles:${THREADS_POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('metadata.coverPath is honoured and wins over options.coverPath', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { postHrefAfterSubmit: '/@robin/post/BBB' }] });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { coverPath: coverPath() } },
            options: { coverPath: join(dir, 'ignored.png') },
        });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${THREADS_POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('a media control that rejects its click does not stop the cover leg', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectMediaClick: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${THREADS_POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('a missing media control skips the cover instead of failing the post', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { missingMediaButton: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
    });

    test('an image that is uploaded but never rendered still publishes (the render is not a gate)', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { mediaNeverRenders: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${THREADS_POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });
});

describe('threads post rail composer failures', () => {
    test('an unreadable profile link fails before the composer is touched', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { profileHref: null }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not read the profile link');
        expect(fake.calls).not.toContain(`click:${THREADS_POST_SELECTORS.createEntry[0]}`);
    });

    test('a profile link whose href read throws fails the same way', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { rejectProfileHref: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not read the profile link');
    });

    test('an unreadable baseline post link still confirms the new id', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectPostHref: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('BBB');
    });

    test('a home page whose composer never renders is refused as an unauthenticated session', async () => {
        // Readiness and the composer wait share one selector, so a build with no inline composer is
        // refused by the preflight rather than reaching the flow.
        const fake = makeFakeLauncher({ pages: [{ missingComposer: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(THREADS_LOGIN_INSTRUCTION);
    });

    test('a composer whose visibility probe never confirms still types and publishes', async () => {
        // The visibility wait is advisory: the flow clicks and types regardless, and the readback is
        // the real post-condition.
        const fake = makeFakeLauncher({
            pages: [{}, { unlabeledComposer: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain('type:Hello Threads');
    });

    test('an editor that keeps no text refuses to claim a publish', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { emptyReadback: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('text was not retained');
        expect(fake.calls).not.toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
    });

    test('a Post control that never attaches fails instead of a blind click', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { missingSubmit: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('threads post control never attached');
    });

    test('a profile navigation that fails leaves the baseline unknown and refuses the receipt', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { rejectProfileGoto: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('receipt not confirmed');
        expect(result.error).toContain('profile navigation failed');
    });

    test('a rejected evidence probe never changes the publish outcome', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'kk-threads-evidence-reject-'));
        process.env.KK_THREADS_DEBUG_DIR = dir;
        try {
            const fake = makeFakeLauncher({
                pages: [{}, { rejectEvidenceProbes: true, postHrefAfterSubmit: '/@robin/post/BBB' }],
            });
            const result = await transport(fake).publish({ content });

            expect(result.ok).toBe(true);
            // The dump is still written; the counts fall back and the screenshot failure is silent.
            expect(readdirSync(dir)).toContain('01-landing.json');
            expect(fake.calls.some((call) => call.startsWith('screenshot:'))).toBe(true);
        } finally {
            delete process.env.KK_THREADS_DEBUG_DIR;
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('rejected composer reads are absorbed; the readback decision still refuses the publish', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectInteractions: true, isVisibleRejectsFrom: 2, postHrefAfterSubmit: '/@robin/post/BBB' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('text was not retained');
        // The forced click was attempted (and swallowed) before the readback gave up.
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.text[0]}`);
        expect(fake.calls).not.toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
    });

    test('a submit with no new post id is never reported as published', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { postHref: '/@robin/post/AAA', postHrefAfterSubmit: '/@robin/post/AAA' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('receipt not confirmed');
        expect(result.error).toContain('never reported as published');
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
    });
});

describe('measured 2026-11-20 — the composer’s Post control and the suggestions layer', () => {
    test('the role engine names the composer’s Post and its last match is clicked', async () => {
        // Threads puts the label in a CHILD div, so the CSS `:text-is` forms match nothing on the
        // measured build; the accessible name still says Post. The feed's inline composer sits
        // behind the dialog, so the LAST match is the one that posts.
        const fake = makeFakeLauncher({
            pages: [{}, { rolePostCount: 2, postHrefAfterSubmit: '/@robin/post/CCC' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok, `error: ${result.error ?? ''}`).toBe(true);
        expect(result.id).toBe('CCC');
        expect(fake.calls).toContain('getByRole:button|Post');
        expect(fake.calls).toContain('click:role:Post:last');
        expect(fake.calls).not.toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
    });

    test('a role engine that refuses to count falls back to the measured selectors', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectRoleCount: true, postHrefAfterSubmit: '/@robin/post/DDD' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok, `error: ${result.error ?? ''}`).toBe(true);
        expect(result.id).toBe('DDD');
        expect(fake.calls).toContain('getByRole:button|Post');
        expect(fake.calls).toContain(`click:${THREADS_POST_SELECTORS.submit[0]}`);
    });

    test('a suggestions layer that refuses to close still posts', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectDismissClick: true, postHrefAfterSubmit: '/@robin/post/EEE' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok, `error: ${result.error ?? ''}`).toBe(true);
        expect(result.id).toBe('EEE');
        expect(fake.calls).toContain('dismiss:attempt');
    });

    test('a submit click an overlay intercepts falls back to a forced click', async () => {
        // The measured failure: a forced click alone dispatches onto the overlay and posts NOTHING;
        // a real click is tried first, and the force stays as the fallback for a transient overlay.
        const fake = makeFakeLauncher({
            pages: [{}, { submitClickIntercepted: true, postHrefAfterSubmit: '/@robin/post/FFF' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok, `error: ${result.error ?? ''}`).toBe(true);
        expect(result.id).toBe('FFF');
        expect(fake.calls.filter((call) => call === `click:${THREADS_POST_SELECTORS.submit[0]}`)).toHaveLength(2);
    });

    test('a Post control that never attaches reports the dialog’s own inventory', async () => {
        const fake = makeFakeLauncher({
            pages: [
                {},
                {
                    missingSubmit: true,
                    consoleJson: 'DIV[role=button] < DIV[role=none].x1 — DIV < DIV[role=button]',
                },
            ],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('threads post control never attached');
        expect(result.error).toContain('(dialog buttons: DIV[role=button] < DIV[role=none].x1');
        expect(fake.calls).toContain('evaluate:inventory');
    });

    test('an unreadable inventory still fails the Post with the timeout alone', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { missingSubmit: true, rejectEvaluate: true }] });

        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('threads post control never attached');
        expect(result.error).not.toContain('dialog buttons');
        expect(result.error).not.toContain('evaluate unavailable');
    });
});
