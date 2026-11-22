/**
 * Task 0328 — behavior tests for the linkedin-pub feed-post publisher, layered like the jike-pub
 * precedent it scaffolds from:
 *
 * 1. mapping/fake layer — the offline fake transport and the `--in/--out` CLI contract;
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches (0328 failure
 *    list: draft requested, over-length text, image missing/over-cap, selector drift loud);
 * 3. preflight — logged-out and missing-profile sessions refuse with the recovery command;
 * 4. flow — an offline fake driver executing the real `evaluate` scripts (share box → composer
 *    fill → text-readback → image upload → Post → confirmation receipt).
 *
 * Every test is offline: fake transports/pages only. No test ever calls linkedin.com. The
 * production selectors are provisional (see `src/index.ts`), so there is no real-browser fixture —
 * the operator's manual live gate (0328 plan step 5) is the selector measurement.
 */
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
import {
    getPublishTransport,
    isLinkedinAuthenticated,
    LINKEDIN_CONFIG,
    LINKEDIN_HOME_URL,
    LINKEDIN_LOGIN_INSTRUCTION,
    LINKEDIN_LOGIN_URL_RE,
    LINKEDIN_OPERATIONS,
    LINKEDIN_POST_SELECTORS,
    LinkedinBrowserTransport,
    MAX_TEXT_CHARS,
    main,
    processPublishIO,
    resolveOperation,
} from '../src/index';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-linkedin-pub');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'linkedin');
const LOGIN_URL = 'https://www.linkedin.com/authwall?trk=login';
const POST_URL = 'https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001/';
const SEND_SELECTOR = LINKEDIN_POST_SELECTORS.send[0];
const IMAGE_PATH = join(TMP_DIR, 'photo.png');

const draftContent: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };
const liveContent: Content = {
    title: 'Hello',
    body: 'Hello LinkedIn feed post',
    format: 'markdown',
    metadata: { publishStatus: 'public' },
};

/** The channel's selector table, dereferenced by role like the jike tests do. */
const SELECTORS: Record<keyof typeof LINKEDIN_POST_SELECTORS, readonly string[]> = LINKEDIN_POST_SELECTORS;

/** Every fake-page dial a LinkedIn flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** The share box the readiness probe saw detaches before the flow resolves it. */
    triggerVanishes?: boolean;
    /** The share box clicks but the modal editor never attaches (selector drift). */
    composerNeverOpens?: boolean;
    /** The dialog-scoped file input never attaches. */
    missingFileInput?: boolean;
    /** The Post button never becomes clickable. */
    sendNeverEnabled?: boolean;
    /** The editor drops the filled text, so the readback must fail. */
    emptyReadback?: boolean;
    /** The file lands but the preview media-node count never rises. */
    previewNeverLands?: boolean;
    /** What clicking Post emits: a fresh post card, a success toast, a failure toast, or nothing. */
    onSend?: 'freshCard' | 'successToast' | 'failureToast' | 'none';
    /** Text of the fresh failure toast (the site's own reason for a rejected post). */
    sendFailureToast?: string;
    /** Toasts already on screen before the send (a stale signal). */
    existingToasts?: string[];
    /** Whether `kk-linkedin-toasts` answers with unparseable garbage (snapshot tolerance). */
    malformedToasts?: boolean;
    /** The composer fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
    /** Uploading media opens a media editor step whose Next button must be clicked. */
    withMediaNextButton?: boolean;
    /** Number of `kk-linkedin-link-preview` polls before an OG link preview card attaches. */
    linkPreviewAfterPolls?: number;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The evaluate branch keyed on the real scripts' `kk-linkedin-*` markers executes
 * their contracts against scripted page state, so a dropped field, an unconfirmed upload and an
 * unobserved outcome are all reachable offline.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let editorText = '';
    let mediaNodes = 0;
    let mediaNextPending = false;
    let linkPreviewPolls = 0;
    let probedTrigger = false;
    const toasts = [...(options.existingToasts ?? [])];
    const cards: Array<{ href: string; text: string }> = [];

    const attached = (selector: string): number => {
        if (SELECTORS.shareTrigger.includes(selector)) {
            if (options.triggerVanishes === true) {
                // The readiness predicate consumes the one live probe; afterwards the node is gone.
                if (probedTrigger) return 0;
                probedTrigger = true;
            }
            return 1;
        }
        if (SELECTORS.composer.includes(selector)) return options.composerNeverOpens ? 0 : 1;
        if (SELECTORS.fileInput.includes(selector)) return options.missingFileInput ? 0 : 1;
        return 1;
    };

    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        isEnabled: async () => options.sendNeverEnabled !== true,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            if (options.fillThrows === true) throw new Error('composer page crashed on fill');
            if (SELECTORS.composer.includes(selector)) {
                editorText = options.emptyReadback === true ? '' : text;
            }
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (!SEND_SELECTOR.includes(selector)) return;
            if (options.onSend === 'freshCard') cards.push({ href: POST_URL, text: editorText });
            if (options.onSend === 'successToast') toasts.push('Post successful.');
            if (options.onSend === 'failureToast') toasts.push(options.sendFailureToast ?? 'Post failed. Try again.');
        },
    });

    const jsonArg = (expression: string, name: string): string | null => {
        const match = new RegExp(`const ${name} = ("(?:[^"\\\\]|\\\\.)*");`).exec(expression);
        return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
    };

    return {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        ...(options.withMediaNextButton !== true
            ? {}
            : {
                  getByRole(_role: string, query: { name: string | RegExp }) {
                      if (query.name instanceof RegExp) {
                          return {
                              count: async () => (mediaNextPending ? 1 : 0),
                              first: () => ({
                                  click: async () => {
                                      calls.push('click:role:Next');
                                      mediaNextPending = false;
                                  },
                              }),
                          };
                      }
                      return {
                          count: async () => 0,
                          first: () => leaf(SEND_SELECTOR),
                          last: () => leaf(SEND_SELECTOR),
                      };
                  },
              }),
        async setInputFiles(selector: string, paths: string | string[]) {
            const list = Array.isArray(paths) ? paths : [paths];
            calls.push(`setInputFiles:${selector}|${list.join(',')}`);
            if (attached(selector) === 0) throw new Error(`setInputFiles: ${selector} not attached`);
            if (options.previewNeverLands !== true) {
                mediaNodes += list.length;
                if (options.withMediaNextButton === true) mediaNextPending = true;
            }
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 40)}`);
            if (expression.includes('kk-linkedin-editor-text')) {
                return String(editorText).trim();
            }
            if (expression.includes('kk-linkedin-media-evidence')) return String(mediaNodes);
            if (expression.includes('kk-linkedin-link-preview')) {
                linkPreviewPolls += 1;
                return options.linkPreviewAfterPolls !== undefined && linkPreviewPolls >= options.linkPreviewAfterPolls
                    ? '1'
                    : '';
            }
            if (expression.includes('kk-linkedin-toasts')) {
                return options.malformedToasts === true ? 'not-json' : JSON.stringify(toasts);
            }
            if (expression.includes('kk-linkedin-post-links')) {
                return JSON.stringify(cards.map((card) => card.href));
            }
            if (expression.includes('kk-linkedin-fresh-post-link')) {
                const wanted = jsonArg(expression, 'wanted') ?? '';
                if (wanted === '') return '';
                const seenRaw = /const seen = (\[[^\]]*\]);/.exec(expression)?.[1] ?? '[]';
                const seen = new Set(JSON.parse(seenRaw) as string[]);
                for (const card of cards) {
                    if (seen.has(card.href)) continue;
                    if (card.text.replace(/\s+/g, '').includes(wanted)) return card.href;
                }
                return '';
            }
            return '';
        },
    } as unknown as Page;
}

/** Launcher fake returning recording contexts; every publish/preflight launch is logged. */
function makeFakeLauncher(options: FakePageOptions = {}): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    let closes = 0;
    const launcher: BrowserLauncher = {
        async launch(request) {
            requests.push(request);
            const page = makeFakePage(options, calls);
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

function transport(fake: LauncherHandle, stepTimeoutMs = 250): LinkedinBrowserTransport {
    return new LinkedinBrowserTransport('post', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.LINKEDIN_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.LINKEDIN_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(IMAGE_PATH, 'png');
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.LINKEDIN_PROFILE_DIR;
    else process.env.LINKEDIN_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('linkedin-pub declared surface', () => {
    test('the manifest declares the publish kind, the check entry and the LinkedIn session', async () => {
        const manifest = JSON.parse(await Bun.file(join(import.meta.dir, '..', 'plugin.json')).text()) as Record<
            string,
            unknown
        >;
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        const session = manifest.browserSession as Record<string, string>;
        expect(session.profileName).toBe('linkedin');
        expect(session.homeUrl).toBe(LINKEDIN_HOME_URL);
        expect(LINKEDIN_CONFIG.channel).toBe('linkedin');
        expect(LINKEDIN_CONFIG.isAuthenticated).toBe(isLinkedinAuthenticated);
    });

    test('only the feed post is declared, with options.operation winning over metadata.operation', () => {
        expect([...LINKEDIN_OPERATIONS]).toEqual(['post']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'post' });
        expect(resolveOperation(undefined, { ...draftContent, metadata: { operation: 'post' } })).toEqual({
            operation: 'post',
        });
        const unknown = resolveOperation({ operation: 'article' }, draftContent);
        expect(unknown.error).toContain("unsupported operation 'article' for linkedin: expected one of post");
        const fallback = resolveOperation(undefined, { ...draftContent, metadata: { operation: 'comment' } });
        expect(fallback.error).toContain('comment');
        const precedence = resolveOperation(
            { operation: 'post' },
            { ...draftContent, metadata: { operation: 'comment' } },
        );
        expect(precedence).toEqual({ operation: 'post' });
    });

    test('the login-redirect marker matches the authwall and /login shapes, never a post permalink', () => {
        expect(LINKEDIN_LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        expect(LINKEDIN_LOGIN_URL_RE.test('https://www.linkedin.com/checkpoint/challengesv2/1')).toBe(true);
        expect(LINKEDIN_LOGIN_URL_RE.test(POST_URL)).toBe(false);
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('post');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        expect(getPublishTransport('post')).toBeInstanceOf(LinkedinBrowserTransport);
    });
});

describe('linkedin-pub refusals before any browser', () => {
    test('absent, draft and unknown publishStatus refuse with typed messages and zero launches (0328 R1)', async () => {
        const fake = makeFakeLauncher();
        const absent = await transport(fake).publish({ content: draftContent });
        expect(absent.ok).toBe(false);
        expect(absent.error).toContain('linkedin has no draft mode: publishStatus is absent');
        expect(absent.error).toContain('LinkedIn drafts are not addressable');
        expect(absent.error).toContain('set publishStatus: public to publish live');

        const draft = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'draft' } },
        });
        expect(draft.ok).toBe(false);
        expect(draft.error).toContain("publishStatus 'draft' refuses before the browser");

        const unknown = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'unlisted' } },
        });
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain("unknown publishStatus 'unlisted' for linkedin: only 'public' publishes");
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty body is refused before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { body: '   ', title: 'Only a title', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('requires non-empty Content.body text');
        expect(fake.requests).toHaveLength(0);
    });

    test('text over the 3000-character LinkedIn cap is refused, never truncated', async () => {
        const fake = makeFakeLauncher();
        const over = await transport(fake).publish({
            content: {
                body: 'a'.repeat(MAX_TEXT_CHARS + 1),
                format: 'markdown',
                metadata: { publishStatus: 'public' },
            },
        });
        expect(over.ok).toBe(false);
        expect(over.error).toContain(`over the ${MAX_TEXT_CHARS}-character limit`);
        expect(over.error).toContain('never truncates');
        expect(fake.requests).toHaveLength(0);

        // The boundary itself stays publishable.
        const atCap = await transport(makeFakeLauncher({ onSend: 'freshCard' })).publish({
            content: { body: 'a'.repeat(MAX_TEXT_CHARS), format: 'markdown', metadata: { publishStatus: 'public' } },
            options: { profileDir: join(TMP_DIR, 'cap-profile') },
        });
        expect(atCap.ok).toBe(true);
    });

    test('image payload violations (not an array, blank entry, bad extension, missing file, over the cap of 1) refuse before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const notArray = await transport(fake).publish({ content: liveContent, options: { images: 'photo.png' } });
        expect(notArray.ok).toBe(false);
        expect(notArray.error).toContain('metadata.images must be an array of local image paths');

        const blankEntry = await transport(fake).publish({ content: liveContent, options: { images: ['  '] } });
        expect(blankEntry.ok).toBe(false);
        expect(blankEntry.error).toContain('must be non-empty local image paths');

        const wrongExtension = await transport(fake).publish({
            content: liveContent,
            options: { images: [join(TMP_DIR, 'notes.txt')] },
        });
        expect(wrongExtension.ok).toBe(false);
        expect(wrongExtension.error).toContain('must be one of .png, .jpg, .jpeg, .webp, .gif');

        const absentFile = await transport(fake).publish({
            content: liveContent,
            options: { images: [join(TMP_DIR, 'absent.png')] },
        });
        expect(absentFile.ok).toBe(false);
        expect(absentFile.error).toContain('metadata.images file does not exist');

        const overCap = await transport(fake).publish({
            content: liveContent,
            options: { images: [IMAGE_PATH, join(TMP_DIR, 'second.png')] },
        });
        expect(overCap.ok).toBe(false);
        expect(overCap.error).toContain('requests 2 images, over the LinkedIn cap of 1 image per post');
        expect(overCap.error).toContain('refusing rather than truncating');

        const nestedEntry = await transport(fake).publish({
            content: liveContent,
            options: { images: [['x.png']] },
        });
        expect(nestedEntry.ok).toBe(false);
        expect(nestedEntry.error).toContain("got '1 entry'");
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-script driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new LinkedinBrowserTransport('post', 'agent', { launcher: fake.launcher });
        const result = await agent.publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported driver 'agent'");
        expect(result.error).toContain('expected one of script');
        expect(fake.requests).toHaveLength(0);
    });

    test('processPublishIO refuses a driver option before resolving a transport', async () => {
        const fake = new FakeBrowserTransport('script');
        const inPath = join(TMP_DIR, 'driver-in.json');
        const outPath = join(TMP_DIR, 'driver-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ ...draftContent, metadata: { publishStatus: 'public' }, options: { driver: 'agent' } }),
        );
        await expect(processPublishIO(inPath, outPath, fake)).rejects.toThrow(/unsupported driver 'agent'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('linkedin');
        expect(fake.getCallLogs()).toHaveLength(0);
    });

    test('fake mode does not bypass the deterministic refusals: the draft refusal holds offline', async () => {
        const inPath = join(TMP_DIR, 'draft-in.json');
        const outPath = join(TMP_DIR, 'draft-out.json');
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'draft' } }));
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/has no draft mode/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
    });
});

describe('linkedin-pub session preflight', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: LOGIN_URL });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('linkedin session preflight refused');
        expect(result.error).toContain(`run: ${LINKEDIN_LOGIN_INSTRUCTION}`);
        // One read-only headless pass: no headed window ever opens on a refused preflight.
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        expect(fake.closeCount()).toBe(1);
    });

    test('a missing browser profile is refused with the login command and no second launch', async () => {
        const requests: ProfileLaunchRequest[] = [];
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                throw new BrowserProfileMissingError(request.profileDir);
            },
        };
        const result = await new LinkedinBrowserTransport('post', 'script', { launcher }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no linkedin browser profile');
        expect(result.error).toContain(LINKEDIN_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(requests).toHaveLength(1);
    });

    test('a session that expires between the preflight and the flow names the recovery command', async () => {
        const requests: ProfileLaunchRequest[] = [];
        let launches = 0;
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                launches += 1;
                // First launch (headless preflight) verifies; the headed flow lands logged out.
                const page = makeFakePage(launches === 1 ? {} : { landedUrl: LOGIN_URL }, []);
                const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new LinkedinBrowserTransport('post', 'script', { launcher, stepTimeoutMs: 250 }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('linkedin session failed');
        expect(result.error).toContain(LINKEDIN_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('linkedin-pub post flow (offline fake page)', () => {
    test('a public text-only post fills the composer, submits and reports the fresh receipt', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(result.id).toBe('7300000000000000001');
        expect(result.metadata).toEqual({
            operation: 'post',
            driver: 'script',
            publishStatus: 'public',
            profileDir: DEFAULT_DIR,
        });
        expect(fake.calls).toContain(`fill:${SELECTORS.composer[0]}|Hello LinkedIn feed post`);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(true);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.closeCount()).toBe(2);
    });

    test('an options.profileDir override names that profile in the Result metadata', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const profileDir = join(TMP_DIR, 'profile-flag');
        const result = await transport(fake).publish({ content: liveContent, options: { profileDir } });
        expect(result.ok).toBe(true);
        expect(result.metadata?.profileDir).toBe(profileDir);
    });

    test('a public post with one image uploads through the dialog file input and publishes', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const result = await transport(fake).publish({ content: liveContent, options: { images: [IMAGE_PATH] } });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(fake.calls.some((call) => call === `setInputFiles:${SELECTORS.fileInput[0]}|${IMAGE_PATH}`)).toBe(true);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(true);
    });

    test('a dropped composer text is refused at the text-readback stage, never submitted', async () => {
        const fake = makeFakeLauncher({ emptyReadback: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'text-readback' });
        expect(result.error).toContain('readback');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('a share box that vanishes after the readiness probe is a loud typed refusal (selector drift)', async () => {
        const fake = makeFakeLauncher({ triggerVanishes: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'share-trigger' });
        expect(result.error).toContain('linkedin share box not found');
        expect(result.error).toContain(LINKEDIN_LOGIN_INSTRUCTION);
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a share box that clicks but opens no composer is a loud typed composer refusal', async () => {
        const fake = makeFakeLauncher({ composerNeverOpens: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'composer' });
        expect(result.error).toContain('linkedin composer did not open');
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a page crash during the fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('composer page crashed on fill');
        expect(result.error).not.toContain(LINKEDIN_LOGIN_INSTRUCTION);
    });

    test('metadata.coverImage is used when options.images and metadata.images are omitted', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const result = await transport(fake).publish({
            content: { ...liveContent, metadata: { ...liveContent.metadata, coverImage: IMAGE_PATH } },
        });

        expect(result.ok).toBe(true);
        expect(
            fake.calls.some((call) => call.startsWith(`setInputFiles:${SELECTORS.fileInput[0]}|${IMAGE_PATH}`)),
        ).toBe(true);
    });

    test('clicks Next in LinkedIn media editor when present before returning to Post', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard', withMediaNextButton: true });
        const result = await transport(fake).publish({
            content: { ...liveContent, metadata: { ...liveContent.metadata, coverImage: IMAGE_PATH } },
        });

        expect(result.ok).toBe(true);
        expect(fake.calls).toContain('click:role:Next');
        expect(fake.calls).toContain(`click:${SEND_SELECTOR}`);
    });

    test('an upload whose preview never lands refuses at the image-upload stage, never a text-only post', async () => {
        const fake = makeFakeLauncher({ previewNeverLands: true });
        const result = await transport(fake).publish({ content: liveContent, options: { images: [IMAGE_PATH] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'image-upload' });
        expect(result.error).toContain('preview never reached 1 media nodes');
        expect(
            fake.calls.some((call) => call.startsWith(`setInputFiles:${SELECTORS.fileInput[0]}|${IMAGE_PATH}`)),
        ).toBe(true);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    }, 20_000);

    test('an absent file input is a typed refusal, never a text-only submit', async () => {
        const fake = makeFakeLauncher({ missingFileInput: true });
        const result = await transport(fake).publish({ content: liveContent, options: { images: [IMAGE_PATH] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'image-upload' });
        expect(result.error).toContain('linkedin image upload failed');
        expect(result.error).toContain('not attached');
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('a Post button that never enables is refused at the send-enabled stage', async () => {
        const fake = makeFakeLauncher({ sendNeverEnabled: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'send-enabled' });
        expect(result.error).toContain('Post button never became clickable');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('no observed confirmation never reports ok:true', async () => {
        const fake = makeFakeLauncher({ onSend: 'none' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
        expect(result.error).toContain('linkedin publish not confirmed');
    });

    test('a fresh success toast alone is a receipt without a post URL', async () => {
        const fake = makeFakeLauncher({ onSend: 'successToast' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBeUndefined();
        expect(result.id).toBeUndefined();
        expect(result.message).toContain('success-toast receipt');
        expect(result.message).toContain(DEFAULT_DIR);
    });

    test('a fresh failure toast reports the site text at the failure-toast stage', async () => {
        const fake = makeFakeLauncher({ onSend: 'failureToast', sendFailureToast: 'Post failed. Try again.' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'failure-toast' });
        expect(result.error).toContain('site reported: Post failed. Try again.');
    });

    test('an already-visible success toast is stale and never confirms the post', async () => {
        const fake = makeFakeLauncher({ onSend: 'none', existingToasts: ['Post successful.'] });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
    });

    test('unparseable toast snapshots are tolerated as "no signal", not a crash', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard', malformedToasts: true });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
    });

    test('link-only post with URL polls for async OG preview card before clicking Post', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard', linkPreviewAfterPolls: 2 });
        const urlContent: Content = {
            ...liveContent,
            body: '第261121期\n\nhttps://podcast.salty.vip/i/daily-ai-2026-11-21/',
        };
        const result = await transport(fake, 1_500).publish({ content: urlContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        const previewCalls = fake.calls.filter((call) => call.includes('kk-linkedin-link-preview'));
        expect(previewCalls.length).toBeGreaterThanOrEqual(2);
    });

    test('link-only post still submits when async OG preview card never renders', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const urlContent: Content = {
            ...liveContent,
            body: 'Check https://podcast.salty.vip/i/daily-ai-2026-11-21/',
        };
        const result = await transport(fake, 100).publish({ content: urlContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(fake.calls.some((call) => call.includes('kk-linkedin-link-preview'))).toBe(true);
        expect(fake.calls).toContain(`click:${SEND_SELECTOR}`);
    });

    test('attached coverImage skips OG link preview wait even when body contains a URL', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard', linkPreviewAfterPolls: 1 });
        const urlWithImage: Content = {
            ...liveContent,
            body: 'With cover https://podcast.salty.vip/i/daily-ai-2026-11-21/',
            metadata: { ...liveContent.metadata, coverImage: IMAGE_PATH },
        };
        const result = await transport(fake).publish({ content: urlWithImage });

        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.includes('kk-linkedin-link-preview'))).toBe(false);
    });

    test('unparseable URL-like token skips OG link preview wait and still submits', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const malformedUrl: Content = {
            ...liveContent,
            body: 'Broken URL https://[bad here',
        };
        const result = await transport(fake).publish({ content: malformedUrl });

        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.includes('kk-linkedin-link-preview'))).toBe(false);
    });
});

describe('linkedin-pub fake transport and --in/--out IO', () => {
    test('processPublishIO posts offline on the fake transport and writes a schema-valid Result', async () => {
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'nested', 'out.json');
        await writeFile(inPath, JSON.stringify(liveContent));
        await processPublishIO(inPath, outPath, new FakeBrowserTransport('script'));
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(true);
        expect(written.id).toBe('fake-browser-id-123');
        expect(written.url).toBe('https://example.com/browser-draft');
    });

    test('processPublishIO refuses an undeclared operation before any transport exists', async () => {
        const inPath = join(TMP_DIR, 'op-in.json');
        const outPath = join(TMP_DIR, 'op-out.json');
        await writeFile(inPath, JSON.stringify({ ...draftContent, options: { operation: 'article' } }));
        await expect(processPublishIO(inPath, outPath, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported operation 'article'/,
        );
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
    });

    test('malformed input reports a single-line failure and never a stack', async () => {
        const inPath = join(TMP_DIR, 'bad-in.json');
        const outPath = join(TMP_DIR, 'bad-out.json');
        await writeFile(inPath, JSON.stringify({ title: 42 }));
        await expect(processPublishIO(inPath, outPath, new FakeBrowserTransport('script'))).rejects.toThrow(
            /Invalid Content input/,
        );
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
        expect(written.error?.length).toBeLessThanOrEqual(300);
    });

    test('main returns 1 without args, 1 on invalid args, and 0 on the fake transport', async () => {
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');

            process.argv = ['bun', 'index.ts', '--bogus'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid arguments');
        } finally {
            restore();
            process.argv = origArgv;
        }

        const inPath = join(TMP_DIR, 'main-in.json');
        const outPath = join(TMP_DIR, 'main-out.json');
        await writeFile(inPath, JSON.stringify(liveContent));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
            const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
            expect(written.ok).toBe(true);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
        }
    });

    test('a pre-browser refusal exits 1, still writes the ok:false Result, and opens no browser', async () => {
        const inPath = join(TMP_DIR, 'refuse-in.json');
        const outPath = join(TMP_DIR, 'refuse-out.json');
        await writeFile(inPath, JSON.stringify(draftContent));
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('linkedin-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain('publishStatus is absent');
    });
});

describe('linkedin-pub profile-check entry (0328 R2)', () => {
    test('profile-check.ts source-text-only asserts (not imported, prevents coverage drops)', async () => {
        const content = await Bun.file(join(import.meta.dir, '..', 'src', 'profile-check.ts')).text();
        expect(content).toContain("import { runProfileCli } from '@gobing-ai/publish-harness/browser'");
        expect(content).toContain("import { LINKEDIN_CONFIG } from './index'");
        expect(content).toContain('if (import.meta.main)');
        expect(content).toContain('runProfileCli(LINKEDIN_CONFIG, Bun.argv.slice(2))');
    });
});

describe('linkedin-pub environment restoration', () => {
    test('no linkedin profile env leaks between suites', () => {
        expect(process.env.LINKEDIN_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
