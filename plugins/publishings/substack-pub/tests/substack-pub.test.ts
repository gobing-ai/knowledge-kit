import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
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
    channelConfig,
    editorUrl,
    getPublishTransport,
    isAuthenticated,
    LOGIN_URL_RE,
    main,
    processPublishIO,
    resolveOperation,
    resolvePublicationUrl,
    SELECTORS,
    SubstackBrowserTransport,
} from '../src/index';
import { main as profileCheckMain } from '../src/profile-check';

const content: Content = { title: 'Parity', body: 'Body.', format: 'markdown' };
/** Live is a subscriber email on Substack, so it is opt-in through `metadata.publishStatus` (R4). */
const liveContent: Content = { ...content, metadata: { publishStatus: 'public' } };

const PUBLICATION_URL = 'https://robin.substack.com/publish';
const EDITOR_URL = 'https://robin.substack.com/publish/post';
const DRAFT_URL = 'https://robin.substack.com/publish/post/19283746';
const LIVE_URL = 'https://robin.substack.com/p/why-knowledge-kit';
const PUBLISHED_URL = 'https://robin.substack.com/publish/posts/published';
const LOGIN_URL = 'https://substack.com/account/login?redirect=%2Fpublish%2Fpost%2Fnew';
const CONTINUE_SELECTOR = SELECTORS.continue[0];
const SEND_SELECTOR = SELECTORS.send[0];
const BODY_SELECTOR = SELECTORS.body[0];
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'substack');
const EMPTY_DIR = '/tmp/kk-substack-absent';
/** R5/AC3: the operator recovery command every session failure names. */
const LOGIN_HINT = 'bun plugins/publishings/substack-pub/src/profile-check.ts login';
/** The title candidates, widened so the fake page can route its attached-count reads by string. */
const TITLE_SELECTORS: readonly string[] = SELECTORS.title;

/** Signal the fake editor emits when scripted; `'none'` leaves the page on its current URL. */
type PasteSignal = 'url' | 'none';
type SendSignal = 'url' | 'published' | 'none';

interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** Title field never attaches (a page that is not the editor). */
    missingTitle?: boolean;
    /** The editor never receives the pasted HTML; the paste post-condition must fail the run. */
    emptyBody?: boolean;
    /** Substack's autosave: the editor URL rewrite that is the whole draft signal. */
    onPaste?: PasteSignal;
    /** Signal emitted when the live `send` control is clicked. */
    onSend?: SendSignal;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`). The
 * draft signal is URL-only by design, so the page only ever moves its URL: the paste call is the
 * autosave, the `send` click the publish. `calls` is owned by the caller so one log spans both
 * launches.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';

    const attached = (selector: string): number => {
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
            if (selector === SEND_SELECTOR && options.onSend === 'url') url = LIVE_URL;
            if (selector === SEND_SELECTOR && options.onSend === 'published') url = PUBLISHED_URL;
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
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression}`);
            // The paste script is the only expression carrying the clipboard event; the
            // post-condition read is the only one that reads the editor's text back.
            if (expression.includes('ClipboardEvent')) {
                if (options.onPaste === 'url') url = DRAFT_URL;
                return true;
            }
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

function transport(fake: LauncherHandle, stepTimeoutMs = 200): SubstackBrowserTransport {
    return new SubstackBrowserTransport('script', { launcher: fake.launcher, stepTimeoutMs });
}

/** Every `click:` the flow recorded — a draft run must produce none (E91-D5, task-local check). */
function clicks(calls: string[]): string[] {
    return calls.filter((call) => call.startsWith('click:'));
}

// Both the profile-dir tiers and the publication URL are process-wide env; clear them for every
// case and restore afterwards so a developer shell or a neighbouring suite cannot change a run.
const originalPublication = process.env.SUBSTACK_PUBLICATION_URL;
const originalChannelDir = process.env.SUBSTACK_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;

beforeEach(() => {
    delete process.env.SUBSTACK_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    process.env.SUBSTACK_PUBLICATION_URL = PUBLICATION_URL;
});

afterEach(() => {
    if (originalPublication === undefined) delete process.env.SUBSTACK_PUBLICATION_URL;
    else process.env.SUBSTACK_PUBLICATION_URL = originalPublication;
    if (originalChannelDir === undefined) delete process.env.SUBSTACK_PROFILE_DIR;
    else process.env.SUBSTACK_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
});

describe('substack-pub frozen surface (R1, R6)', () => {
    test('kind is browser and the driver defaults to script (E91-D1)', () => {
        const substack = new SubstackBrowserTransport();
        expect(substack.kind).toBe('browser');
        expect(substack.driver).toBe('script');
        expect(CHANNEL).toBe('substack');
    });

    test('selector table is the seeded one from the design', () => {
        expect(SELECTORS.title).toEqual([
            '[data-testid="title-input"]',
            'textarea[placeholder="Title"]',
            'input[placeholder="Title"]',
        ]);
        expect(SELECTORS.subtitle).toEqual([
            '[data-testid="subtitle-input"]',
            'textarea[placeholder="Add a subtitle..."]',
        ]);
        expect(SELECTORS.body).toEqual(['.ProseMirror[contenteditable="true"]']);
        expect(SELECTORS.continue).toEqual(['[data-testid="continue-button"]', 'button:has-text("Continue")']);
        expect(SELECTORS.send).toEqual([
            '[data-testid="publish-button"]',
            'button:has-text("Send to everyone now")',
            'button:has-text("Publish now")',
        ]);
    });

    test('editorUrl derives the post-editor URL from the publication base', () => {
        expect(editorUrl('https://robin.substack.com/publish')).toBe(EDITOR_URL);
        expect(editorUrl('https://robin.substack.com/publish/')).toBe(EDITOR_URL);
        expect(editorUrl('https://robin.substack.com')).toBe(EDITOR_URL);
        expect(editorUrl(' https://robin.substack.com/publish ')).toBe(EDITOR_URL);
    });

    test('channelConfig carries the publication editor, the readiness gate and the login deadline', () => {
        const config = channelConfig(PUBLICATION_URL);
        expect(config.channel).toBe(CHANNEL);
        expect(config.homeUrl).toBe(EDITOR_URL);
        expect(config.isAuthenticated).toBe(isAuthenticated);
        expect(config.loginTimeoutMs).toBe(180_000);
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

describe('substack-pub publication URL (R1, R5)', () => {
    test('resolvePublicationUrl prefers the explicit URL, then the environment', () => {
        expect(resolvePublicationUrl('https://robin.substack.com/publish')).toEqual({ url: PUBLICATION_URL });
        expect(resolvePublicationUrl()).toEqual({ url: PUBLICATION_URL });
        expect(channelConfig(PUBLICATION_URL).homeUrl).toBe(EDITOR_URL);
    });

    test('resolvePublicationUrl refuses an unset, blank, malformed or non-https URL', () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        const unset = resolvePublicationUrl();
        expect('error' in unset && unset.error).toContain('SUBSTACK_PUBLICATION_URL');

        const blank = resolvePublicationUrl('   ');
        expect('error' in blank && blank.error).toContain('SUBSTACK_PUBLICATION_URL');

        const malformed = resolvePublicationUrl('not a url');
        expect('error' in malformed && malformed.error).toContain('not a URL');

        const insecure = resolvePublicationUrl('http://robin.substack.com');
        expect('error' in insecure && insecure.error).toContain('https:');
        expect('error' in insecure && insecure.error).toContain('SUBSTACK_PUBLICATION_URL');
    });

    test('a missing publication URL fails before any browser opens', async () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('SUBSTACK_PUBLICATION_URL');
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('a non-https publication URL fails before any browser opens', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        const result = await transport(fake).publish({
            content,
            options: { publicationUrl: 'http://robin.substack.com' },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('must be https:');
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('a publication editor URL is rejected before any browser opens (0197)', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        const result = await transport(fake).publish({
            content,
            options: { publicationUrl: 'https://robin.substack.com/publish/posts' },
        });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('publication root');
        expect(fake.requests).toEqual([]);
        expect(fake.calls).toEqual([]);
    });

    test('options.publicationUrl wins over SUBSTACK_PUBLICATION_URL', async () => {
        process.env.SUBSTACK_PUBLICATION_URL = 'https://env.substack.com';
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        const result = await transport(fake).publish({ content, options: { publicationUrl: PUBLICATION_URL } });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`goto:${EDITOR_URL}`);
        expect(fake.calls.some((call) => call.includes('env.substack.com'))).toBe(false);
    });
});

describe('substack-pub draft flow (R2, R3 / AC1)', () => {
    test('draft run pastes the rendered HTML body and reports the observed URL', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.target).toBe('substack');
        expect(result.url).toBe(DRAFT_URL);
        expect(result.id).toBe('19283746');
        expect(result.message).toContain('draft');
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.profileDir).toBe(DEFAULT_DIR);
        // The publication editor, reached from the env publication URL: one headless preflight
        // pass, then the headed editor visit (`options.headless` is opt-in).
        expect(fake.calls).toContain(`goto:${EDITOR_URL}`);
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.requests.map((request) => request.profileDir)).toEqual([DEFAULT_DIR, DEFAULT_DIR]);
        expect(fake.calls).toContain('fill:[data-testid="title-input"]|Parity');
        // The ProseMirror body goes in as rendered HTML through the shared paste (E91-D4), never
        // as plain markdown text.
        expect(fake.calls.some((call) => call.includes('text/html') && call.includes('<p>Body.</p>'))).toBe(true);
        // The task-local check: a draft run clicks nothing at all.
        expect(clicks(fake.calls)).toEqual([]);
        // withProfilePage closes both contexts: the preflight and the editor visit.
        expect(fake.closeCount()).toBe(2);
    });

    test('the optional metadata.subtitle is filled when present and skipped when absent', async () => {
        const withSubtitle = makeFakeLauncher({ page: { onPaste: 'url' } });
        const filled = await transport(withSubtitle).publish({
            content: { ...content, metadata: { subtitle: 'A subtitle' } },
        });
        expect(filled.ok).toBe(true);
        expect(withSubtitle.calls).toContain(`fill:${SELECTORS.subtitle[0]}|A subtitle`);

        const withoutSubtitle = makeFakeLauncher({ page: { onPaste: 'url' } });
        const skipped = await transport(withoutSubtitle).publish({ content });
        expect(skipped.ok).toBe(true);
        expect(withoutSubtitle.calls.some((call) => call.startsWith('fill:') && call.includes('subtitle'))).toBe(false);
    });

    test('an unobserved draft signal fails naming the label and the timeout', async () => {
        const fake = makeFakeLauncher({ page: {} });
        const result = await transport(fake, 30).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('substack draft signal');
        expect(result.error).toContain(BODY_SELECTOR);
        expect(result.error).toContain('no outcome observed within 30ms');
        expect(clicks(fake.calls)).toEqual([]);
    });

    test('an editor that never receives the body fails instead of drafting an empty article', async () => {
        const fake = makeFakeLauncher({ page: { emptyBody: true, onPaste: 'url' } });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('editor text is empty');
        expect(clicks(fake.calls)).toEqual([]);
    });
});

describe('substack-pub live switch (R4 / AC2)', () => {
    test('the live controls run only when publishStatus is public', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url', onSend: 'url' } });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.message).toContain('published');
        expect(fake.calls).toContain(`click:${CONTINUE_SELECTOR}`);
        expect(fake.calls).toContain(`click:${SEND_SELECTOR}`);
    });

    test('a live run reports the published URL and the post id', async () => {
        const viaPost = makeFakeLauncher({ page: { onPaste: 'url', onSend: 'url' } });
        const published = await transport(viaPost).publish({ content: liveContent });
        expect(published.ok).toBe(true);
        expect(published.url).toBe(LIVE_URL);
        expect(published.id).toBe('19283746');

        const viaQueue = makeFakeLauncher({ page: { onPaste: 'url', onSend: 'published' } });
        const queued = await transport(viaQueue).publish({ content: liveContent });
        expect(queued.ok).toBe(true);
        expect(queued.url).toBe(PUBLISHED_URL);
    });

    test('a live run whose send control shows nothing fails naming the control and the timeout', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url', onSend: 'none' } });
        const result = await transport(fake, 30).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.error).toContain(`substack publish '${SEND_SELECTOR}'`);
        expect(result.error).toContain('no outcome observed within 30ms');
    });

    test('an explicit draft publishStatus stays a draft run', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url', onSend: 'url' } });
        const result = await transport(fake).publish({ content: { ...content, metadata: { publishStatus: 'draft' } } });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(clicks(fake.calls)).toEqual([]);
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
        const result = await new SubstackBrowserTransport('agent', { launcher: fake.launcher }).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toBe("unsupported driver 'agent' for substack");
        expect(fake.requests).toEqual([]);
    });
});

describe('substack-pub session failures (R5 / AC3)', () => {
    test('a missing profile reports the login command and the profile dir only', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(EMPTY_DIR) });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        // The refusal names the resolved profile directory and nothing else from the profile.
        expect(result.error).toContain(`no substack browser profile at ${DEFAULT_DIR}`);
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
        expect(result.error).toContain('headless substack readiness refused');
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

describe('substack-pub profile resolution (R5)', () => {
    test('precedence is options.profileDir > SUBSTACK_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
        const fallback = makeFakeLauncher({ page: { onPaste: 'url' } });
        expect((await transport(fallback).publish({ content })).metadata?.profileDir).toBe(DEFAULT_DIR);

        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.SUBSTACK_PROFILE_DIR = '~/from-channel';
        const fromEnv = makeFakeLauncher({ page: { onPaste: 'url' } });
        const envResult = await transport(fromEnv).publish({ content });
        expect(envResult.metadata?.profileDir).toBe(join(homedir(), 'from-channel'));
        expect(fromEnv.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

        const fromFlag = makeFakeLauncher({ page: { onPaste: 'url' } });
        const flagResult = await transport(fromFlag).publish({
            content,
            options: { profileDir: '/tmp/kk-substack-flag' },
        });
        expect(flagResult.metadata?.profileDir).toBe('/tmp/kk-substack-flag');
    });

    test('options.headless true keeps the editor visit headless', async () => {
        const fake = makeFakeLauncher({ page: { onPaste: 'url' } });
        await transport(fake).publish({ content, options: { headless: true } });
        expect(fake.requests.map((request) => request.headless)).toEqual([true, true]);
    });
});

describe('substack-pub profile-check CLI (R5 / AC3)', () => {
    test('--publication is stripped from argv before the shared CLI parses it', async () => {
        const fake = makeFakeLauncher({ page: {} });
        const lines: string[] = [];
        const code = await profileCheckMain(
            ['--publication', 'https://robin.substack.com', 'check', '--profile', '~/from-flag'],
            {
                launcher: fake.launcher,
                stdout: (line) => lines.push(line),
            },
        );

        expect(code).toBe(0);
        expect(lines.some((line) => line.includes('"status":"verified"'))).toBe(true);
        expect(fake.calls).toContain(`goto:${EDITOR_URL}`);
        expect(fake.requests).toEqual([{ profileDir: join(homedir(), 'from-flag'), headless: true }]);
    });

    test('the --publication=<url> form is accepted too', async () => {
        const fake = makeFakeLauncher({ page: {} });
        const lines: string[] = [];
        const code = await profileCheckMain([`--publication=${PUBLICATION_URL}`, 'check'], {
            launcher: fake.launcher,
            stdout: (line) => lines.push(line),
        });

        expect(code).toBe(0);
        expect(fake.calls).toContain(`goto:${EDITOR_URL}`);
    });

    test('a missing publication URL exits 2 and launches nothing', async () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        const fake = makeFakeLauncher({ page: {} });
        const lines: string[] = [];
        const code = await profileCheckMain(['check'], {
            launcher: fake.launcher,
            stdout: (line) => lines.push(line),
        });

        expect(code).toBe(2);
        expect(lines.join('\n')).toContain('SUBSTACK_PUBLICATION_URL');
        const verdict = JSON.parse(lines.at(-1) ?? '') as { status: string; detail: string };
        expect(verdict.status).toBe('error');
        expect(verdict.detail).toContain('SUBSTACK_PUBLICATION_URL');
        expect(fake.requests).toEqual([]);
    });

    test('a refused session exits 1 with the resolved profile dir', async () => {
        const fake = makeFakeLauncher({ failLaunch: () => new BrowserProfileMissingError(EMPTY_DIR) });
        const lines: string[] = [];
        const code = await profileCheckMain(['check'], {
            launcher: fake.launcher,
            stdout: (line) => lines.push(line),
        });

        expect(code).toBe(1);
        expect(lines.join('\n')).toContain('"status":"refused"');
        expect(lines.join('\n')).toContain(DEFAULT_DIR);
    });

    test('without an injected writer the CLI reports through the shared echo seam', async () => {
        const fake = makeFakeLauncher({ page: {} });
        const outTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout: outTarget });
        let code: number;
        try {
            code = await profileCheckMain(['--publication', PUBLICATION_URL, 'check'], { launcher: fake.launcher });
        } finally {
            restore();
        }

        expect(code).toBe(0);
        expect(outTarget.text()).toContain('"status":"verified"');
    });
});

describe('substack-pub plugin surface (R6)', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        const tmpDir = join(process.cwd(), '.works/tmp/test-substack');
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

    test('getPublishTransport defaults to the script driver', () => {
        const fake = getPublishTransport();
        expect(fake).toBeInstanceOf(SubstackBrowserTransport);
        expect(fake.driver).toBe('script');
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

        const tmpDir = join(process.cwd(), '.works/tmp/test-substack-main');
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
        const tmpDir = join(process.cwd(), '.works/tmp/test-substack-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify(content));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'substack-pub',
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
    test('resolveOperation defaults to post and refuses unknowns by name', () => {
        expect(resolveOperation(undefined)).toEqual({ operation: 'post' });
        const mode = resolveOperation({ operation: 'note' });
        expect(mode.error).toContain("unsupported operation 'note' for substack");
        expect(mode.error).toContain('post');
    });
});

describe('substack-pub profile-check bot mode (0277)', () => {
    test('`login --url` derives the publication from the URL origin and reports the canonical editor URL', async () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        const fake = makeFakeLauncher({ page: {} });
        const lines: string[] = [];
        const code = await profileCheckMain(
            ['login', '--url', 'https://mysite.substack.com/inbox', '--profile', '~/from-flag'],
            {
                launcher: fake.launcher,
                stdout: (line) => lines.push(line),
            },
        );

        expect(code).toBe(0);
        const verdict = JSON.parse(lines.at(-1) ?? '') as { status: string; defaultUrl?: string; profileDir?: string };
        expect(verdict.status).toBe('verified');
        // The verdict's defaultUrl is the plugin-owned canonical editor URL of the derived
        // publication — never the operator-supplied navigation URL with its /inbox path.
        expect(verdict.defaultUrl).toBe('https://mysite.substack.com/publish/post');
        expect(verdict.profileDir).toBe(join(homedir(), 'from-flag'));
        expect(fake.calls).toContain('goto:https://mysite.substack.com/inbox');
    });

    test('a non-https bot --url is a usage error that opens no browser', async () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        const fake = makeFakeLauncher({ page: {} });
        const lines: string[] = [];
        const code = await profileCheckMain(
            ['login', '--url', 'http://mysite.substack.com/', '--profile', '/tmp/kk-substack-x'],
            {
                launcher: fake.launcher,
                stdout: (line) => lines.push(line),
            },
        );

        expect(code).toBe(2);
        expect(fake.requests).toEqual([]);
        const verdict = JSON.parse(lines.at(-1) ?? '') as { status: string };
        expect(verdict.status).toBe('error');
    });

    test('`open --profile --url` navigates headed and resolves when the operator closes the browser', async () => {
        delete process.env.SUBSTACK_PUBLICATION_URL;
        mkdirSync('/tmp/kk-substack-open', { recursive: true });
        const gotos: string[] = [];
        const requests: ProfileLaunchRequest[] = [];
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                return {
                    pages: () => [
                        {
                            goto: async (url: string) => {
                                gotos.push(url);
                            },
                        },
                    ],
                    newPage: async () => ({}),
                    once: (event: string, listener: () => void) => {
                        if (event === 'close') listener();
                    },
                } as unknown as BrowserContext;
            },
        };
        const lines: string[] = [];
        const code = await profileCheckMain(
            ['open', '--profile', '/tmp/kk-substack-open', '--url', 'https://mysite.substack.com/publish'],
            { launcher, stdout: (line) => lines.push(line) },
        );

        expect(code).toBe(0);
        expect(requests).toEqual([{ profileDir: '/tmp/kk-substack-open', headless: false }]);
        expect(gotos).toEqual(['https://mysite.substack.com/publish']);
        // The open verb reports through the shared human line — the bot parent reads only the
        // exit code (unlike bot-mode login, whose last stdout line is the verdict JSON).
        expect(lines.at(-1)).toContain('profile open closed: /tmp/kk-substack-open');
        rmSync('/tmp/kk-substack-open', { recursive: true, force: true });
    });
});
