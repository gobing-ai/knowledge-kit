/**
 * Task 0291 chunk C — behavior tests for the jike-pub dynamic-post publisher, layered like the
 * weibo/wechatmp precedents:
 *
 * 1. mapping/fake layer — the offline fake transport and the `--in/--out` CLI contract;
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches;
 * 3. flow — an offline fake driver executing the real `evaluate` scripts (composer fill →
 *    text-readback → exact topic chip → image upload → submit → confirmation receipt);
 * 4. the named real-browser fixture runner — a guarded headless-Chromium run against a synthetic
 *    composer on the real web.okjike.com origin (a missing browser fails loud with the recovery
 *    hint, never a silent skip).
 *
 * Every test is offline: fake transports/pages only, and the fixture runner aborts all traffic
 * except the synthetic page it serves itself. No test ever calls okjike.com.
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
    JIKE_LOGIN_INSTRUCTION,
    JIKE_LOGIN_URL_RE,
    JIKE_OPERATIONS,
    JIKE_POST_SELECTORS,
    JikeBrowserTransport,
    main,
    processPublishIO,
    resolveOperation,
} from '../src/index';
import { launchChromium, REAL_POST_URL, RECOVERY_HINT, runComposerScenario } from './fixtures/jike-composer-runner';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-jike-pub');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'jike');
const LOGIN_URL = 'https://passport.okjike.com/login?fallback=web';
const POST_URL = 'https://web.okjike.com/originalPost/KkFake123';
const SEND_SELECTOR = JIKE_POST_SELECTORS.send[0];
const IMAGE_PATH = join(TMP_DIR, 'photo.png');

const draftContent: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };
const liveContent: Content = {
    title: 'Hello',
    body: 'Hello Jike dynamic post',
    format: 'markdown',
    metadata: { publishStatus: 'public' },
};

/** The channel's selector table, dereferenced by role like the weibo tests do. */
const SELECTORS: Record<keyof typeof JIKE_POST_SELECTORS, readonly string[]> = JIKE_POST_SELECTORS;

/** Every fake-page dial a jike flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** The composer the readiness probe saw detaches before the flow resolves it. */
    composerVanishes?: boolean;
    /** The topic input never attaches. */
    missingTopicInput?: boolean;
    /** The composer-scoped file input never attaches. */
    missingFileInput?: boolean;
    /** The 发送 button never becomes clickable. */
    sendNeverEnabled?: boolean;
    /** The editor drops the filled text, so the readback must fail. */
    emptyReadback?: boolean;
    /** Exact chip texts the circle dropdown offers; an exact match commits, anything else misses. */
    topicChips?: string[];
    /** The 正在上传 status never clears. */
    uploadNeverSettles?: boolean;
    /** The file lands but the preview media-node count never rises. */
    previewNeverLands?: boolean;
    /** What clicking 发送 emits: a fresh post card, a success toast, a failure toast, or nothing. */
    onSend?: 'freshCard' | 'successToast' | 'failureToast' | 'none';
    /** Text of the fresh failure toast (the site's own reason for a rejected post). */
    sendFailureToast?: string;
    /** Toasts already on screen before the send (a stale signal). */
    existingToasts?: string[];
    /** Whether `kk-jike-toasts` answers with unparseable garbage (snapshot tolerance). */
    malformedToasts?: boolean;
    /** The composer fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The evaluate branch keyed on the real scripts' `kk-jike-*` markers executes
 * their contracts against scripted page state, so a dropped field, a lookalike chip, an
 * unconfirmed upload and an unobserved outcome are all reachable offline.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let editorText = '';
    let mediaNodes = 0;
    let probedComposer = false;
    const toasts = [...(options.existingToasts ?? [])];
    const cards: Array<{ href: string; text: string }> = [];

    const attached = (selector: string): number => {
        if (SELECTORS.composer.includes(selector)) {
            if (options.composerVanishes === true) {
                // The readiness predicate consumes the one live probe; afterwards the node is gone.
                if (probedComposer) return 0;
                probedComposer = true;
            }
            return 1;
        }
        if (SELECTORS.topicInput.includes(selector)) return options.missingTopicInput ? 0 : 1;
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
            if (options.onSend === 'successToast') toasts.push('发送成功');
            if (options.onSend === 'failureToast') toasts.push(options.sendFailureToast ?? '发送失败');
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
        async setInputFiles(selector: string, paths: string | string[]) {
            const list = Array.isArray(paths) ? paths : [paths];
            calls.push(`setInputFiles:${selector}|${list.join(',')}`);
            if (attached(selector) === 0) throw new Error(`setInputFiles: ${selector} not attached`);
            if (options.previewNeverLands !== true) mediaNodes += list.length;
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 40)}`);
            if (expression.includes('kk-jike-editor-text')) {
                return String(editorText).trim();
            }
            if (expression.includes('kk-jike-topic-commit')) {
                const wanted = jsonArg(expression, 'wanted');
                if (wanted === null || wanted === '') return '';
                if (!(options.topicChips ?? []).includes(wanted)) return '';
                calls.push(`topic-commit:${wanted}`);
                return wanted;
            }
            if (expression.includes('kk-jike-media-evidence')) return String(mediaNodes);
            if (expression.includes('kk-jike-uploading-status')) {
                return options.uploadNeverSettles === true ? '正在上传 1 张图片' : '';
            }
            if (expression.includes('kk-jike-toasts')) {
                return options.malformedToasts === true ? 'not-json' : JSON.stringify(toasts);
            }
            if (expression.includes('kk-jike-post-links')) {
                return JSON.stringify(cards.map((card) => card.href));
            }
            if (expression.includes('kk-jike-fresh-post-link')) {
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

function transport(fake: LauncherHandle, stepTimeoutMs = 250): JikeBrowserTransport {
    return new JikeBrowserTransport('post', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.JIKE_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.JIKE_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(IMAGE_PATH, 'png');
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.JIKE_PROFILE_DIR;
    else process.env.JIKE_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('jike-pub declared surface', () => {
    test('only the dynamic post is declared', () => {
        expect([...JIKE_OPERATIONS]).toEqual(['post']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'post' });
        expect(resolveOperation(undefined, { ...draftContent, metadata: { operation: 'post' } })).toEqual({
            operation: 'post',
        });
        const unknown = resolveOperation({ operation: 'dm' }, draftContent);
        expect(unknown.error).toContain("unsupported operation 'dm' for jike: expected one of post");
        const fallback = resolveOperation(undefined, { ...draftContent, metadata: { operation: 'comment' } });
        expect(fallback.error).toContain('comment');
        const precedence = resolveOperation(
            { operation: 'post' },
            {
                ...draftContent,
                metadata: { operation: 'comment' },
            },
        );
        expect(precedence).toEqual({ operation: 'post' });
    });

    test('the login-redirect marker matches the passport and /login shapes, never the home page', () => {
        expect(JIKE_LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        expect(JIKE_LOGIN_URL_RE.test('https://web.okjike.com/login')).toBe(true);
        expect(JIKE_LOGIN_URL_RE.test('https://web.okjike.com/originalPost/KkFake123')).toBe(false);
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('post');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        expect(getPublishTransport('post')).toBeInstanceOf(JikeBrowserTransport);
    });
});

describe('jike-pub refusals before any browser', () => {
    test('absent, draft and unknown publishStatus refuse with typed messages and zero launches', async () => {
        const fake = makeFakeLauncher();
        const absent = await transport(fake).publish({ content: draftContent });
        expect(absent.ok).toBe(false);
        expect(absent.error).toContain('jike has no evidenced draft flow: publishStatus is absent');
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
        expect(unknown.error).toContain("unknown publishStatus 'unlisted' for jike: only 'public' publishes");
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

    test('a non-string or empty topic is refused by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const nonString = await transport(fake).publish({
            content: liveContent,
            options: { topic: 42 },
        });
        expect(nonString.ok).toBe(false);
        expect(nonString.error).toContain("metadata.topic must be a non-empty exact circle name, got '42'");

        const empty = await transport(fake).publish({ content: liveContent, options: { topic: '   ' } });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain('metadata.topic must be a non-empty exact circle name');
        expect(fake.requests).toHaveLength(0);
    });

    test('image payload violations (not an array, blank entry, bad extension, missing file, over the cap of 9) refuse before any browser opens', async () => {
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
            options: { images: Array.from({ length: 10 }, () => 'x.png') },
        });
        expect(overCap.ok).toBe(false);
        expect(overCap.error).toContain('requests 10 images, over the source-observed jike cap of 9');
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
        const agent = new JikeBrowserTransport('post', 'agent', { launcher: fake.launcher });
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
            JSON.stringify({
                ...draftContent,
                metadata: { publishStatus: 'public' },
                options: { driver: 'agent' },
            }),
        );
        await expect(processPublishIO(inPath, outPath, fake)).rejects.toThrow(/unsupported driver 'agent'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('jike');
        expect(fake.getCallLogs()).toHaveLength(0);
    });

    test('fake mode does not bypass the deterministic refusals: the image cap refuses offline', async () => {
        const inPath = join(TMP_DIR, 'cap-in.json');
        const outPath = join(TMP_DIR, 'cap-out.json');
        await writeFile(
            inPath,
            JSON.stringify({
                ...liveContent,
                options: { images: Array.from({ length: 10 }, (_, i) => join(TMP_DIR, `p${i}.png`)) },
            }),
        );
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/over the source-observed jike cap of 9/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
    });
});

describe('jike-pub session preflight', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: LOGIN_URL });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('jike session preflight refused');
        expect(result.error).toContain(`run: ${JIKE_LOGIN_INSTRUCTION}`);
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
        const result = await new JikeBrowserTransport('post', 'script', { launcher }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no jike browser profile');
        expect(result.error).toContain(JIKE_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(requests).toHaveLength(1);
    });

    test('a session that expires between the preflight and the flow names the recovery command', async () => {
        const requests: ProfileLaunchRequest[] = [];
        const pages: Page[] = [];
        let launches = 0;
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                launches += 1;
                // First launch (headless preflight) verifies; the headed flow lands logged out.
                const page = makeFakePage(launches === 1 ? {} : { landedUrl: LOGIN_URL }, []);
                pages.push(page);
                const context = {
                    pages: () => [page],
                    newPage: async () => page,
                    close: async () => {},
                };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new JikeBrowserTransport('post', 'script', { launcher, stepTimeoutMs: 250 }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('jike session failed');
        expect(result.error).toContain(JIKE_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('jike-pub post flow (offline fake page)', () => {
    test('a public text-only post fills the composer, submits and reports the fresh receipt', async () => {
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(result.id).toBe('KkFake123');
        expect(result.metadata).toEqual({
            operation: 'post',
            driver: 'script',
            publishStatus: 'public',
            profileDir: DEFAULT_DIR,
        });
        expect(fake.calls).toContain(`fill:${SELECTORS.composer[0]}|Hello Jike dynamic post`);
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

    test('a dropped composer text is refused at the text-readback stage, never submitted', async () => {
        const fake = makeFakeLauncher({ emptyReadback: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'text-readback' });
        expect(result.error).toContain('readback');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('a composer that vanishes after the readiness probe is a typed composer refusal', async () => {
        const fake = makeFakeLauncher({ composerVanishes: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'composer' });
        expect(result.error).toContain('jike composer not found');
        expect(result.error).toContain(JIKE_LOGIN_INSTRUCTION);
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a page crash during the fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('composer page crashed on fill');
        expect(result.error).not.toContain(JIKE_LOGIN_INSTRUCTION);
    });

    test('a lookalike circle chip never substitutes: the topic-commit stage refuses before send', async () => {
        const fake = makeFakeLauncher({ topicChips: ['AI圈官方', 'AI圈第二期'], onSend: 'freshCard' });
        const result = await transport(fake).publish({ content: liveContent, options: { topic: 'AI圈' } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'topic-commit' });
        expect(result.error).toContain('jike did not offer an exact circle chip 「AI圈」');
        expect(fake.calls.some((call) => call.startsWith(`fill:${SELECTORS.topicInput[0]}`))).toBe(true);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('an exact circle chip commits and the post publishes', async () => {
        const fake = makeFakeLauncher({ topicChips: ['科技圈', 'AI圈'], onSend: 'freshCard' });
        const result = await transport(fake).publish({ content: liveContent, options: { topic: 'AI圈' } });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        expect(fake.calls).toContain('topic-commit:AI圈');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(true);
    });

    test('an unreachable topic input is a typed topic-commit refusal, never a silent skip', async () => {
        const fake = makeFakeLauncher({ missingTopicInput: true });
        const result = await transport(fake).publish({ content: liveContent, options: { topic: 'AI圈' } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'topic-commit' });
        expect(result.error).toContain('jike topic commit failed');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('a settled upload whose preview never lands refuses at the image-upload stage, never a text-only post', async () => {
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

    test('an upload stuck on 正在上传 refuses before submit', async () => {
        const fake = makeFakeLauncher({ uploadNeverSettles: true });
        const result = await transport(fake).publish({ content: liveContent, options: { images: [IMAGE_PATH] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'image-upload' });
        expect(result.error).toContain('did not settle');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('an absent file input is a typed refusal, never a text-only submit', async () => {
        const fake = makeFakeLauncher({ missingFileInput: true });
        const result = await transport(fake).publish({ content: liveContent, options: { images: [IMAGE_PATH] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'image-upload' });
        expect(result.error).toContain('jike image upload failed');
        expect(result.error).toContain('not attached');
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('multiple images upload in caller order through one setInputFiles call', async () => {
        const second = join(TMP_DIR, 'second.jpg');
        await writeFile(second, 'jpg');
        const fake = makeFakeLauncher({ onSend: 'freshCard' });
        const result = await transport(fake).publish({
            content: liveContent,
            options: { images: [IMAGE_PATH, second] },
        });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_URL);
        const upload = fake.calls.find((call) => call.startsWith(`setInputFiles:${SELECTORS.fileInput[0]}`));
        expect(upload).toBeDefined();
        expect(upload?.indexOf(IMAGE_PATH)).toBeLessThan(upload?.indexOf(second) ?? -1);
    });

    test('a send button that never enables is refused at the send-enabled stage', async () => {
        const fake = makeFakeLauncher({ sendNeverEnabled: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'send-enabled' });
        expect(result.error).toContain('发送 button never became clickable');
        expect(fake.calls.some((call) => call === `click:${SEND_SELECTOR}`)).toBe(false);
    });

    test('no observed confirmation never reports ok:true', async () => {
        const fake = makeFakeLauncher({ onSend: 'none' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
        expect(result.error).toContain('jike publish not confirmed');
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
        const fake = makeFakeLauncher({ onSend: 'failureToast', sendFailureToast: '发送失败，请重试' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'failure-toast' });
        expect(result.error).toContain('site reported: 发送失败，请重试');
    });

    test('an already-visible success toast is stale and never confirms the post', async () => {
        const fake = makeFakeLauncher({ onSend: 'none', existingToasts: ['发送成功'] });
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
});

describe('jike-pub fake transport and --in/--out IO', () => {
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
        await writeFile(inPath, JSON.stringify({ ...draftContent, options: { operation: 'dm' } }));
        await expect(processPublishIO(inPath, outPath, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported operation 'dm'/,
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
            expect(errTarget.text()).toContain('jike-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain('publishStatus is absent');
    });
});

describe('jike-pub named real-browser fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const runnerPath = join(import.meta.dir, 'fixtures', 'jike-composer-runner.ts');
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = Bun.spawnSync([process.execPath, runnerPath, 'post-happy'], {
            env,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('jike real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('the production flow publishes a text-only post through real Chromium against the synthetic composer', async () => {
        const browser = await launchChromium();
        try {
            const facts = await runComposerScenario(browser, 'post-happy');
            expect(facts.ok).toBe(true);
            expect(facts.url).toBe(REAL_POST_URL);
            expect(facts.id).toBe('KkRealFixture1');
            expect(facts.error).toBeUndefined();
            // The read-only headless preflight plus the headed flow pass.
            expect(facts.launches).toBe(2);
        } finally {
            await browser.close();
        }
    }, 120_000);
});

describe('jike-pub environment restoration', () => {
    test('no jike profile env leaks between suites', () => {
        expect(process.env.JIKE_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
