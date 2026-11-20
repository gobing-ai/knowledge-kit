import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
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
    isPostAuthenticated,
    POST_CONFIG,
    POST_SELECTORS,
    X_NEW_POST_BUTTON,
    X_POST_SUBMIT,
    X_POST_SUBMIT_INLINE,
    X_POST_URL,
    XPostBrowserTransport,
} from '../src/post-rail';

const PROFILE_URL = 'https://x.com/robin';
const PROFILE_STATUS_LINK = '[data-testid="tweet"] a[href*="/status/"]';
const LOGIN_URL = 'https://x.com/i/flow/login?redirect_after_login=%2Fcompose%2Fpost';
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'x');
/** R5/AC3-style recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/x-pub/src/profile-check.ts login';

const content: Content = { title: 'Parity', body: 'Hello X', format: 'markdown' };

interface FakePageOptions {
    /** URL every `goto` lands on — a login URL means the session is gone. */
    landedUrl?: string;
    /** Profile link href; `null` means the profile control carries no readable href. */
    profileHref?: string | null;
    /** Newest `/status/` link on the profile timeline before Post is clicked. */
    statusHref?: string | null;
    /** Newest `/status/` link once Post has been clicked. */
    statusHrefAfterSubmit?: string | null;
    /** Composer URL the nav Post button lands on. */
    composeUrl?: string;
    /** The nav Post button never renders (the preflight must refuse). */
    missingNavButton?: boolean;
    /** The nav Post button disappears on the second /home visit (openComposer's own wait). */
    navGoneAfterProfile?: boolean;
    /** Clicking the nav Post button leaves the page on the timeline. */
    composerNeverOpens?: boolean;
    /** The editor's forced click rejects (the rail falls back to `focus()`). */
    rejectClick?: boolean;
    /** `focus()` rejects too, so the editor cannot be reached at all. */
    rejectFocus?: boolean;
    /** Every key press rejects — the rail must swallow them and still type. */
    rejectPress?: boolean;
    /** The profile link's `href` read throws. */
    rejectProfileHref?: boolean;
    /** The timeline's status link `href` read throws before Post is clicked (no readable baseline). */
    rejectStatusHref?: boolean;
    /** `reload()` rejects (the receipt must fall back instead of failing). */
    rejectReload?: boolean;
    /** The media control never attaches. */
    missingMediaButton?: boolean;
    /** The uploaded image never renders in the composer. */
    mediaNeverRenders?: boolean;
    /** Post stays disabled after the media is attached (X never finishes the upload). */
    submitDisabledAfterMedia?: boolean;
    /** The editor never accepts the text, so Post stays disabled through every attempt. */
    editorNeverAccepts?: boolean;
    /** `setInputFiles` rejects with a non-login error (the no-hint branch). */
    uploadError?: string;
    /** Posting returns the page to the profile URL, so the receipt reads it via `reload`. */
    returnToProfileAfterSubmit?: boolean;
    /**
     * Measured 2026-11-20: on `/compose/post` the composer is a PAGE, and Escape navigates to `/home`.
     * Any rail that presses Escape to clear a mask therefore loses the page-scoped submit control.
     */
    escapeLeavesCompose?: boolean;
}

/**
 * Fake `Page` over the primitives the post rail uses. The rail's only success evidence is the
 * profile timeline's newest `/status/` id, so the fake keeps a small state machine: URL,
 * typed text, and whether the Post control is enabled.
 */
function makeFakePostPage(options: FakePageOptions, calls: string[]): Page {
    const composeUrl = options.composeUrl ?? 'https://x.com/compose/post';
    let url = 'about:blank';
    let typed = '';
    let submitted = false;
    let mediaUploaded = false;
    let homeVisits = 0;

    const composerOpen = (): boolean => url.includes('/compose/post');
    const submitEnabled = (): boolean =>
        composerOpen() &&
        typed.length > 0 &&
        options.editorNeverAccepts !== true &&
        !(mediaUploaded && options.submitDisabledAfterMedia === true);
    const statusHref = (): string | null =>
        submitted ? (options.statusHrefAfterSubmit ?? null) : (options.statusHref ?? null);

    const attached = (selector: string): number => {
        if (selector === POST_SELECTORS.profileLink[0]) return 1;
        if (selector === PROFILE_STATUS_LINK) return url === PROFILE_URL && statusHref() !== null ? 1 : 0;
        if (selector === X_NEW_POST_BUTTON) {
            if (options.missingNavButton === true) return 0;
            return options.navGoneAfterProfile === true && homeVisits > 1 ? 0 : 1;
        }
        if (selector === POST_SELECTORS.text[0]) return composerOpen() ? 1 : 0;
        if (selector === POST_SELECTORS.mediaButton[0]) return options.missingMediaButton === true ? 0 : 1;
        if (selector === POST_SELECTORS.fileInput[0]) return 1;
        if (selector === POST_SELECTORS.mediaPreview[0]) {
            return mediaUploaded && options.mediaNeverRenders !== true ? 1 : 0;
        }
        return 0;
    };

    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        isEnabled: async () =>
            selector === X_POST_SUBMIT || selector === X_POST_SUBMIT_INLINE ? submitEnabled() : attached(selector) > 0,
        getAttribute: async (name: string) => {
            calls.push(`getAttribute:${selector}|${name}`);
            if (selector === POST_SELECTORS.profileLink[0]) {
                if (options.rejectProfileHref === true) throw new Error('profile link detached');
                return options.profileHref === null ? null : (options.profileHref ?? '/robin');
            }
            if (selector === PROFILE_STATUS_LINK) {
                // A baseline read can fail (`count()` said attached, the href read raced a re-render);
                // once Post is clicked the rail must read the new link or fail the receipt.
                if (options.rejectStatusHref === true && !submitted) throw new Error('status link detached');
                return statusHref();
            }
            return null;
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (selector === POST_SELECTORS.text[0] && options.rejectClick === true) {
                throw new Error('mask intercepts pointer events');
            }
            if (selector === X_NEW_POST_BUTTON && options.composerNeverOpens !== true) url = composeUrl;
            if ((selector !== X_POST_SUBMIT && selector !== X_POST_SUBMIT_INLINE) || !submitEnabled()) return;
            submitted = true;
            if (options.returnToProfileAfterSubmit === true) url = PROFILE_URL;
        },
        focus: async () => {
            calls.push(`focus:${selector}`);
            if (options.rejectFocus === true) throw new Error('editor not focusable');
        },
        press: async (key: string) => {
            calls.push(`press:${key}`);
            if (options.rejectPress === true) throw new Error('key press rejected');
            if (key === 'Escape' && options.escapeLeavesCompose === true) url = 'https://x.com/home';
            if (key === 'Backspace') typed = '';
        },
        pressSequentially: async (text: string) => {
            calls.push(`type:${text}`);
            typed = text;
        },
    });

    const page = {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
            if (url === X_POST_URL) homeVisits += 1;
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
            press: async (key: string) => {
                calls.push(`key:${key}`);
                if (options.rejectPress === true) throw new Error('key press rejected');
            },
        },
        async waitForTimeout() {},
        async setInputFiles(selector: string, filePath: string) {
            calls.push(`setInputFiles:${selector}|${filePath}`);
            if (options.uploadError !== undefined) throw new Error(options.uploadError);
            mediaUploaded = true;
        },
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

function transport(fake: ReturnType<typeof makeFakeLauncher>, stepTimeoutMs = 60): XPostBrowserTransport {
    return new XPostBrowserTransport({ launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.X_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;

beforeEach(() => {
    delete process.env.X_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
});

afterEach(() => {
    if (originalChannelDir === undefined) delete process.env.X_PROFILE_DIR;
    else process.env.X_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
});

describe('post rail frozen surface', () => {
    test('exports the measured composer contract', () => {
        expect(X_POST_URL).toBe('https://x.com/home');
        expect(X_NEW_POST_BUTTON).toBe('[data-testid="SideNav_NewTweet_Button"]');
        expect(X_POST_SUBMIT).toBe('[data-testid="tweetButton"]');
        // Measured 2026-11-20: the inline composer on /home submits with its own testid, and both
        // controls start disabled until the editor holds text.
        expect(X_POST_SUBMIT_INLINE).toBe('[data-testid="tweetButtonInline"]');
        expect(POST_SELECTORS.text).toEqual(['[data-testid="tweetTextarea_0"]']);
        expect(POST_SELECTORS.fileInput).toEqual(['input[data-testid="fileInput"]', '[data-testid="fileInput"]']);
        expect(POST_CONFIG.channel).toBe('x');
        expect(POST_CONFIG.homeUrl).toBe(X_POST_URL);
        expect(POST_CONFIG.isAuthenticated).toBe(isPostAuthenticated);
        expect(POST_CONFIG.loginTimeoutMs).toBe(180_000);
        // X login-walls headless loads: one headed pass keeps the probe inside kk's kill budget.
        expect(POST_CONFIG.checkHeadedOnly).toBe(true);
    });

    test('readiness rejects a login URL and requires the nav Post button', async () => {
        const atLogin = makeFakePostPage({ landedUrl: LOGIN_URL }, []);
        await atLogin.goto(X_POST_URL);
        expect(await isPostAuthenticated(atLogin)).toBe(false);

        const noNav = makeFakePostPage({ missingNavButton: true }, []);
        await noNav.goto(X_POST_URL);
        expect(await isPostAuthenticated(noNav)).toBe(false);

        const ready = makeFakePostPage({}, []);
        await ready.goto(X_POST_URL);
        expect(await isPostAuthenticated(ready)).toBe(true);
    });
});

describe('post rail refusals before any browser opens', () => {
    const tmpDirs: string[] = [];
    function scratch(): string {
        const dir = mkdtempSync(join(tmpdir(), 'kk-x-post-'));
        tmpDirs.push(dir);
        return dir;
    }
    afterEach(async () => {
        await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    });

    test('an explicit draft publishStatus is refused: the compose surface publishes immediately', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'draft' } },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('x post has no draft');
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
        const result = await transport(fake).publish({
            content: { title: '  ', body: '  ', format: 'markdown' },
        });

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
        const dir = scratch();
        const path = join(dir, 'cover.txt');
        await writeFile(path, 'txt');
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({ content, options: { coverPath: path } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain("must be .png/.jpg/.jpeg/.webp, got '.txt'");
        expect(fake.requests).toEqual([]);
    });

    test('a cover file that does not exist is refused', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content,
            options: { coverPath: join(scratch(), 'missing.png') },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not exist');
        expect(fake.requests).toEqual([]);
    });
});

describe('post rail session preflight (AC3)', () => {
    test('an absent profile is refused outright, headed, naming the login command', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(DEFAULT_DIR) });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(`no x browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: false }]);
        expect(fake.closeCount()).toBe(0);
    });

    test('a login redirect refuses the preflight instead of opening the composer', async () => {
        const fake = makeFakeLauncher({ pages: [{ landedUrl: LOGIN_URL }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('headed x readiness refused');
        expect(result.error).toContain(LOGIN_HINT);
        expect(fake.requests).toHaveLength(1);
    });

    test('a session that expires before the composer visit reports the login command, not a stack', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { landedUrl: LOGIN_URL }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('Authentication was not confirmed');
        expect(result.error).toContain(LOGIN_HINT);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(result.error).not.toContain('    at ');
        expect(fake.requests.map((request) => request.headless)).toEqual([false, false]);
    });
});

describe('post rail flow', () => {
    test('a successful post reports the status id observed on the profile timeline', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHref: '/robin/status/100', statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content });

        expect(ResultSchema.parse(result).ok).toBe(true);
        expect(result.id).toBe('200');
        expect(result.url).toBe('https://x.com/robin/status/200');
        expect(result.target).toBe('x');
        expect(result.message).toContain('published and confirmed');
        expect(result.metadata).toEqual({
            operation: 'post',
            driver: 'script',
            publishStatus: 'public',
            profileDir: DEFAULT_DIR,
            confirmedBy: 'profile-timeline',
        });
        // Preflight is the single headed pass (checkHeadedOnly); the flow visit is headed by default.
        expect(fake.requests).toEqual([
            { profileDir: DEFAULT_DIR, headless: false },
            { profileDir: DEFAULT_DIR, headless: false },
        ]);
        // Composer reached from the timeline: baseline read on the profile, then the nav Post click.
        expect(fake.calls).toContain(`goto:${PROFILE_URL}`);
        expect(fake.calls).toContain(`goto:${X_POST_URL}`);
        expect(fake.calls).toContain(`click:${X_NEW_POST_BUTTON}`);
        expect(fake.calls).toContain('type:Hello X');
        expect(fake.calls).toContain(`click:${X_POST_SUBMIT}`);
        // No cover was given, so the media control is never touched.
        expect(fake.calls).not.toContain(`click:${POST_SELECTORS.mediaButton[0]}`);
        expect(fake.closeCount()).toBe(2);
    });

    test('the body wins over the title for the posted text', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/7' }],
        });
        await transport(fake).publish({ content: { title: 'Title only', body: 'Body only', format: 'markdown' } });

        expect(fake.calls).toContain('type:Body only');
        expect(fake.calls).not.toContain('type:Title only');
    });

    test('a profile with no status yet publishes when a new id appears', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHref: null, statusHrefAfterSubmit: '/robin/status/11' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('11');
    });

    test('the receipt survives a submit that returns the page to the profile URL', async () => {
        // Compose under the profile path + a submit that lands back on it: the receipt reads the
        // timeline through the reload fallback instead of a fresh navigation.
        const fake = makeFakeLauncher({
            pages: [
                {},
                {
                    composeUrl: `${PROFILE_URL}/compose/post`,
                    statusHref: '/robin/status/100',
                    statusHrefAfterSubmit: '/robin/status/200',
                    returnToProfileAfterSubmit: true,
                },
            ],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('200');
        expect(fake.calls).toContain('reload');
    });

    test('options.headless true keeps the composer visit headless', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/9' }],
        });
        await transport(fake).publish({ content, options: { headless: true } });

        expect(fake.requests.map((request) => request.headless)).toEqual([false, true]);
    });

    test('the profile dir follows options.profileDir over the channel env', async () => {
        process.env.X_PROFILE_DIR = '~/from-channel';
        const fromFlag = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/9' }],
        });
        const result = await transport(fromFlag).publish({ content, options: { profileDir: '/tmp/kk-x-post' } });

        expect(result.metadata?.profileDir).toBe('/tmp/kk-x-post');
        expect(fromFlag.requests.map((request) => request.profileDir)).toEqual(['/tmp/kk-x-post', '/tmp/kk-x-post']);
    });
});

describe('post rail cover leg', () => {
    let dir = '';
    const coverPath = () => join(dir, 'cover.png');

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'kk-x-post-cover-'));
        await writeFile(join(dir, 'cover.png'), 'png');
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('an absolute existing cover uploads through the media picker and requires the render', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`click:${POST_SELECTORS.mediaButton[0]}`);
        expect(fake.calls).toContain(`setInputFiles:${POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('metadata.coverPath is honoured and wins over options.coverPath', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { coverPath: coverPath() } },
            options: { coverPath: join(dir, 'ignored.png') },
        });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('metadata.coverImage is the last resort', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({
            content: { ...content, metadata: { coverImage: coverPath() } },
        });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:${POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('a media control that never attaches fails the run', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { missingMediaButton: true, statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('x media control never attached');
        expect(fake.calls).not.toContain(`setInputFiles:${POST_SELECTORS.fileInput[0]}|${coverPath()}`);
    });

    test('an image that is uploaded but never rendered fails instead of claiming a publish', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { mediaNeverRenders: true, statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('uploaded but never rendered');
        expect(fake.calls).not.toContain(`click:${X_POST_SUBMIT}`);
    });

    test('a Post that stays disabled after the media fails before the receipt wait', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { submitDisabledAfterMedia: true, statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('stayed disabled after the media');
        expect(fake.calls).not.toContain(`click:${X_POST_SUBMIT}`);
    });

    test('an upload error is reported verbatim, with no login hint', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { uploadError: 'disk went away' }],
        });
        const result = await transport(fake).publish({ content, options: { coverPath: coverPath() } });

        expect(result.ok).toBe(false);
        expect(result.error).toBe('disk went away');
    });
});

describe('post rail composer failures', () => {
    test('an unreadable profile link fails before the composer is touched', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { profileHref: null }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not read the profile link');
        expect(fake.calls).not.toContain(`click:${X_NEW_POST_BUTTON}`);
    });

    test('a nav Post button that disappears after the profile visit fails naming the wait', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { navGoneAfterProfile: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('x home never rendered the Post button');
        expect(result.error).toContain('no outcome observed within 60ms');
    });

    test('a composer that never opens fails naming the compose path', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { composerNeverOpens: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('x composer never opened at /compose/post');
    });

    test('an editor that never accepts the text refuses to claim a publish after three attempts', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { editorNeverAccepts: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('did not accept the text in three attempts');
        expect(result.error).toContain('refusing to claim a publish');
        expect(fake.calls.filter((call) => call.startsWith('type:')).length).toBe(3);
        expect(fake.calls).not.toContain(`click:${X_POST_SUBMIT}`);
    });

    test('an editor whose forced click and focus both fail refuses to claim a publish', async () => {
        // The composer opens over a `[data-testid="mask"]` layer; when neither the forced click nor
        // focus reaches the editor, typing blind must fail instead of clicking a dead Post.
        const fake = makeFakeLauncher({ pages: [{}, { rejectClick: true, rejectFocus: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('editor could not be focused');
        expect(result.error).toContain('refusing to claim a publish');
        expect(fake.calls).not.toContain(`click:${X_POST_SUBMIT}`);
    });

    test('a masked editor is still reached: rejected key presses are swallowed and typing proceeds', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectClick: true, rejectPress: true, statusHrefAfterSubmit: '/robin/status/200' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('200');
        expect(fake.calls).toContain(`focus:${POST_SELECTORS.text[0]}`);
        expect(fake.calls).toContain('type:Hello X');
    });

    test('an unreadable profile href read fails the run instead of guessing a handle', async () => {
        const fake = makeFakeLauncher({ pages: [{}, { rejectProfileHref: true }] });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not read the profile link');
    });

    test('an unreadable baseline status link still confirms the new id', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { rejectStatusHref: true, statusHrefAfterSubmit: '/robin/status/321' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('321');
    });
    test('a rejected reload keeps the receipt: the reload is a refresh, not a requirement', async () => {
        const fake = makeFakeLauncher({
            pages: [
                {},
                {
                    composeUrl: `${PROFILE_URL}/compose/post`,
                    statusHref: '/robin/status/100',
                    statusHrefAfterSubmit: '/robin/status/200',
                    returnToProfileAfterSubmit: true,
                    rejectReload: true,
                },
            ],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('200');
        expect(fake.calls).toContain('reload');
    });

    test('a submit with no new status id is never reported as published', async () => {
        const fake = makeFakeLauncher({
            pages: [{}, { statusHref: '/robin/status/100', statusHrefAfterSubmit: '/robin/status/100' }],
        });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('receipt not confirmed');
        expect(result.error).toContain('never reported as published');
        expect(fake.calls).toContain(`click:${X_POST_SUBMIT}`);
    });
});

describe('measured 2026-11-20 — /compose/post is a page, and Escape navigates away from it', () => {
    /**
     * The reported failure was `x post submit never enabled`. Cause, measured on the live site: the
     * rail's first typing move pressed Escape to clear a mask, which navigated `/compose/post` →
     * `/home`; the page-scoped `[data-testid="tweetButton"]` then did not exist, so every attempt timed
     * out on a submit control that was no longer on the page. The fake now models that navigation, so a
     * reintroduced Escape fails this test instead of the nightly run.
     */
    test('the happy path never presses Escape, and the post still goes out', async () => {
        const fake = makeFakeLauncher({
            pages: [
                {
                    escapeLeavesCompose: true,
                    statusHref: '/robin/status/100',
                    statusHrefAfterSubmit: '/robin/status/101',
                },
            ],
        });
        const result = await transport(fake).publish({ content });
        expect(fake.calls.filter((call) => call === 'press:Escape')).toEqual([]);
        expect(result.ok, `error: ${result.error ?? ''} calls: ${fake.calls.slice(0, 12).join(' | ')}`).toBe(true);
    });
});
