/**
 * Task 0292 chunk C — behavior tests for the csdn-pub Markdown-article publisher, layered like the
 * jike-pub precedent (0291):
 *
 * 1. declared surface — the selector-table shape and the `--in/--out` operation contract;
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches;
 * 3. session preflight — the headless read-only pass and the recovery command on refusal;
 * 4. flow — an offline fake page executing the real `evaluate` scripts (title/body readback →
 *    publish modal → tag chips → category options → cover upload → submit → fresh receipt);
 * 5. the named real-browser fixture runner — a guarded headless-Chromium run against the synthetic
 *    editor (a missing browser fails loud with the recovery hint, never a silent skip), plus the
 *    zero-network / zero-credential source assertions (no vendor signing headers, no OBS, no fixed
 *    经验分享 tag).
 *
 * Every test is offline: fake pages only, and the fixture runner aborts all traffic except the
 * synthetic page it serves itself. No test ever calls blog.csdn.net.
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
    CSDN_ARTICLE_SELECTORS,
    CSDN_EDITOR_URL,
    CSDN_LOGIN_INSTRUCTION,
    CSDN_LOGIN_URL_RE,
    CSDN_OPERATIONS,
    CsdnBrowserTransport,
    DRAFT_SAVE_SELECTORS,
    getPublishTransport,
    isCsdnAuthenticated,
    main,
    processPublishIO,
    resolveOperation,
} from '../src/index';
import {
    launchChromium,
    REAL_ARTICLE_URL,
    REAL_DRAFT_URL,
    RECOVERY_HINT,
    runComposerScenario,
} from './fixtures/csdn-composer-runner';

const TMP_DIR = join(process.cwd(), '.tmp-test-csdn-pub');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'csdn');
const LOGIN_URL = 'https://passport.csdn.net/login?service=editor';
const RECEIPT_URL = 'https://mp.csdn.net/mp_blog/creation/editor/20261015100';
const TITLE_INPUT = CSDN_ARTICLE_SELECTORS.titleInput[0];
const BODY_EDITOR = CSDN_ARTICLE_SELECTORS.bodyEditor[0];
const TAG_INPUT = CSDN_ARTICLE_SELECTORS.tagInput[0];
const PUBLISH_BUTTON = CSDN_ARTICLE_SELECTORS.publishButton[0];
const PUBLISH_OPEN = CSDN_ARTICLE_SELECTORS.publishOpen[0];
const COVER_INPUT = CSDN_ARTICLE_SELECTORS.coverInput[0];
const COVER_PATH = join(TMP_DIR, 'cover.png');
const DRAFT_SAVE = DRAFT_SAVE_SELECTORS[0];
/** Draft receipt: the editor URL gaining an articleId param (the frozen draft save's id gain). */
const DRAFT_EDITOR_URL = 'https://editor.csdn.net/md/?articleId=20261015200';

const draftContent: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };
const liveContent: Content = {
    title: 'Hello',
    body: 'Hello CSDN article body',
    format: 'markdown',
    metadata: { publishStatus: 'public' },
};

/** The channel's selector table, dereferenced by role — the compile-time shape under test. */
const SELECTORS: Record<keyof typeof CSDN_ARTICLE_SELECTORS, readonly string[]> = CSDN_ARTICLE_SELECTORS;

/** Every fake-page dial a csdn article flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a passport URL means the session expired. */
    landedUrl?: string;
    /** The title input drops the filled value, so the strict readback must fail. */
    titleReadbackDrops?: boolean;
    /** The body editor drops the filled Markdown, so the strict readback must fail. */
    bodyReadbackDrops?: boolean;
    /** The editor fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
    /** The 发布文章 chrome entry never attaches. */
    missingPublishOpen?: boolean;
    /** The modal-scoped cover file input never attaches. */
    missingCoverInput?: boolean;
    /** Enter on the tag input commits no chip at all (the requested tag is never offered). */
    tagChipNeverCommits?: boolean;
    /** Enter commits a lookalike chip instead of the requested exact tag. */
    lookalikeTagChip?: string;
    /** Exact option texts the category dropdown offers; an exact match persists, anything else misses. */
    categoryOptions?: string[];
    /** The category option is clicked but the control's value never persists. */
    categoryNeverPersists?: boolean;
    /** The 上传中 status never clears after the cover file lands. */
    coverUploadStuck?: boolean;
    /** The file settles but the modal media-node count never rises. */
    coverPreviewNeverLands?: boolean;
    /** The 发布 button never becomes clickable. */
    submitNeverEnabled?: boolean;
    /** What clicking 发布 emits: a fresh receipt anchor + toast, a success toast, a failure toast, or nothing. */
    onSubmit?: 'freshReceipt' | 'successToast' | 'failureToast' | 'none';
    /** What clicking the top-level 保存草稿 button emits: a fresh articleId URL gain, a failure toast, or nothing. */
    onDraftSave?: 'freshId' | 'failureToast' | 'none';
    /** Text of the fresh failure toast (the site's own reason for a rejected publish). */
    failureToastText?: string;
    /** Toasts already on screen before the submit (a stale signal). */
    existingToasts?: string[];
    /** A receipt-shaped URL already on screen before the submit (a stale signal). */
    existingReceiptUrl?: string;
    /** Whether `kk-csdn-toasts` answers with unparseable garbage (snapshot tolerance). */
    malformedToasts?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The evaluate branch keyed on the real scripts' `kk-csdn-*` markers executes
 * their contracts against scripted page state, so a dropped title/body, a lookalike tag chip, an
 * unoffered category option, an unsettled cover upload and an unobserved outcome are all reachable
 * offline.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let titleValue = '';
    let bodyText = '';
    let tagDraft = '';
    let modalOpen = false;
    const tagChips: string[] = [];
    let categoryValue = '';
    let dropdownOptions: string[] = [];
    let coverUploading = false;
    let modalMedia = 0;
    const toasts = [...(options.existingToasts ?? [])];
    const anchors: string[] = options.existingReceiptUrl === undefined ? [] : [options.existingReceiptUrl];

    const isModalSelector = (selector: string): boolean => selector.includes('.modal__publish-article');
    const attached = (selector: string): number => {
        if (selector === COVER_INPUT) return modalOpen && options.missingCoverInput !== true ? 1 : 0;
        if (isModalSelector(selector)) return modalOpen ? 1 : 0;
        if (selector === PUBLISH_OPEN) return options.missingPublishOpen === true ? 0 : 1;
        // The editor chrome (composer scope, grounded title/body controls) is present once loaded.
        return 1;
    };

    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        isEnabled: async () => options.submitNeverEnabled !== true,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            if (options.fillThrows === true) throw new Error('csdn editor page crashed on fill');
            if (SELECTORS.titleInput.includes(selector)) {
                titleValue = options.titleReadbackDrops === true ? '' : text;
            } else if (SELECTORS.bodyEditor.includes(selector)) {
                bodyText = options.bodyReadbackDrops === true ? '' : text;
            } else if (SELECTORS.tagInput.includes(selector)) {
                tagDraft = text;
            }
        },
        press: async (key: string) => {
            calls.push(`press:${selector}|${key}`);
            if (SELECTORS.tagInput.includes(selector) && key === 'Enter') {
                const chip = options.tagChipNeverCommits === true ? '' : (options.lookalikeTagChip ?? tagDraft);
                if (chip.length > 0) tagChips.push(chip);
                tagDraft = '';
            }
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (selector === PUBLISH_OPEN) modalOpen = true;
            if (SELECTORS.categoryControl.includes(selector)) {
                dropdownOptions = options.categoryOptions ?? [];
            }
            if (SELECTORS.publishButton.includes(selector)) {
                if (options.onSubmit === 'freshReceipt') {
                    anchors.push(RECEIPT_URL);
                    toasts.push('发布成功');
                }
                if (options.onSubmit === 'successToast') toasts.push('发布成功');
                if (options.onSubmit === 'failureToast') toasts.push(options.failureToastText ?? '发布失败');
            }
            if (selector === DRAFT_SAVE) {
                if (options.onDraftSave === 'freshId') url = DRAFT_EDITOR_URL;
                if (options.onDraftSave === 'failureToast') toasts.push(options.failureToastText ?? '文章保存失败');
            }
        },
    });

    const jsonArg = (expression: string, name: string): string | null => {
        const match = new RegExp(`const ${name} = ("(?:[^"\\\\]|\\\\.)*");`).exec(expression);
        return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
    };
    const selectorArg = (expression: string): string => {
        const match = /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/.exec(expression);
        return match?.[1] === undefined ? '' : (JSON.parse(match[1]) as string);
    };
    const receiptShaped = (candidate: string): boolean =>
        /mp_blog\/creation\/editor\/\d+/.test(candidate) ||
        /\/article\/details\/\d+/.test(candidate) ||
        /editor\.csdn\.net\/md\/\?[^\s]*articleId=\d+/.test(candidate);

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
            if (SELECTORS.coverInput.includes(selector)) {
                if (options.coverPreviewNeverLands !== true) modalMedia += 1;
                coverUploading = options.coverUploadStuck === true;
            }
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 40)}`);
            if (expression.includes('kk-csdn-input-value')) {
                const selector = selectorArg(expression);
                if (SELECTORS.titleInput.includes(selector)) return titleValue;
                if (SELECTORS.categoryControl.includes(selector)) return categoryValue;
                return '';
            }
            if (expression.includes('kk-csdn-editor-text')) return bodyText;
            if (expression.includes('kk-csdn-modal-exact-text')) {
                const wanted = jsonArg(expression, 'wanted');
                return wanted !== null && tagChips.includes(wanted) ? wanted : '';
            }
            if (expression.includes('kk-csdn-category-exact-click')) {
                const wanted = jsonArg(expression, 'wanted');
                if (wanted === null || !dropdownOptions.includes(wanted)) return '';
                dropdownOptions = [];
                // The fixture site sets the control value on option click; persist-fail keeps it empty.
                if (options.categoryNeverPersists !== true) categoryValue = wanted;
                return wanted;
            }
            if (expression.includes('kk-csdn-modal-media-count')) return String(modalOpen ? modalMedia : 0);
            if (expression.includes('kk-csdn-modal-uploading-status')) {
                return modalOpen && coverUploading ? '上传中' : '';
            }
            if (expression.includes('kk-csdn-toasts')) {
                return options.malformedToasts === true ? 'not-json' : JSON.stringify(toasts);
            }
            if (expression.includes('kk-csdn-receipt-urls')) {
                const urls: string[] = [];
                if (receiptShaped(url)) urls.push(url);
                for (const anchor of anchors) {
                    if (receiptShaped(anchor) && !urls.includes(anchor)) urls.push(anchor);
                }
                return JSON.stringify(urls);
            }
            return '';
        },
    } as unknown as Page;
}

/** Launcher fake returning recording contexts; every preflight/flow launch is logged. */
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

function transport(fake: LauncherHandle, stepTimeoutMs = 250): CsdnBrowserTransport {
    return new CsdnBrowserTransport('article', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.CSDN_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.CSDN_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(COVER_PATH, 'png');
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.CSDN_PROFILE_DIR;
    else process.env.CSDN_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('csdn-pub declared surface', () => {
    test('the article selector table covers exactly the nine flow roles', () => {
        expect(Object.keys(SELECTORS).sort()).toEqual(
            [
                'bodyEditor',
                'categoryControl',
                'composer',
                'coverInput',
                'publishButton',
                'publishOpen',
                'tagInput',
                'titleDisplay',
                'titleInput',
            ].sort(),
        );
        // The grounded pair must never be empty — the readiness probe asserts on it.
        expect(SELECTORS.titleInput.length).toBeGreaterThan(0);
        expect(SELECTORS.bodyEditor.length).toBeGreaterThan(0);
    });

    test('every publish-modal field stays scoped to .modal__publish-article', () => {
        for (const key of ['tagInput', 'categoryControl', 'publishButton', 'coverInput'] as const) {
            for (const selector of SELECTORS[key]) {
                expect(selector).toContain('.modal__publish-article');
            }
        }
    });

    test('only the article operation is declared', () => {
        expect([...CSDN_OPERATIONS]).toEqual(['article']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'article' });
        expect(resolveOperation(undefined, { ...draftContent, metadata: { operation: 'article' } })).toEqual({
            operation: 'article',
        });
        const unknown = resolveOperation({ operation: 'post' }, draftContent);
        expect(unknown.error).toContain("unsupported operation 'post' for csdn: expected one of article");
        const fallback = resolveOperation(undefined, { ...draftContent, metadata: { operation: 'dm' } });
        expect(fallback.error).toContain('dm');
        const precedence = resolveOperation(
            { operation: 'article' },
            { ...draftContent, metadata: { operation: 'dm' } },
        );
        expect(precedence).toEqual({ operation: 'article' });
    });

    test('the login-redirect marker matches the passport and /login shapes, never the editor page', () => {
        expect(CSDN_LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        expect(CSDN_LOGIN_URL_RE.test('https://editor.csdn.net/login')).toBe(true);
        expect(CSDN_LOGIN_URL_RE.test(CSDN_EDITOR_URL)).toBe(false);
    });

    test('the readiness predicate passes on the editor page with the grounded title input, fails on the passport', async () => {
        const calls: string[] = [];
        const editor = makeFakePage({}, calls);
        await editor.goto(CSDN_EDITOR_URL);
        expect(await isCsdnAuthenticated(editor)).toBe(true);
        const loggedOut = makeFakePage({}, calls);
        await loggedOut.goto(LOGIN_URL);
        expect(await isCsdnAuthenticated(loggedOut)).toBe(false);
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('article');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        expect(getPublishTransport('article')).toBeInstanceOf(CsdnBrowserTransport);
    });
});

describe('csdn-pub refusals before any browser', () => {
    test('the pinned top-level 保存草稿 control is the only draft save route', () => {
        expect([...DRAFT_SAVE_SELECTORS]).toEqual(['button.button-save[data-title="保存草稿"]']);
    });

    test('only an unknown publishStatus refuses with a typed message and zero launches', async () => {
        const fake = makeFakeLauncher();
        const unknown = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'unlisted' } },
        });
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain("unknown publishStatus 'unlisted' for csdn");
        expect(unknown.error).toContain("expected 'public', 'draft' or absent");
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty title and an empty body are refused by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const noTitle = await transport(fake).publish({
            content: { title: '   ', body: 'Body', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(noTitle.ok).toBe(false);
        expect(noTitle.error).toContain('csdn article requires a non-empty Content.title');

        const noBody = await transport(fake).publish({
            content: { title: 'Title', body: '   ', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(noBody.ok).toBe(false);
        expect(noBody.error).toContain('csdn article requires non-empty Content.body Markdown');
        expect(fake.requests).toHaveLength(0);
    });

    test('wrong-shaped tags and categories refuse by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const notArray = await transport(fake).publish({ content: liveContent, options: { tags: '后端' } });
        expect(notArray.ok).toBe(false);
        expect(notArray.error).toContain("metadata.tags must be an array of non-empty exact names, got '后端'");

        const blankEntry = await transport(fake).publish({ content: liveContent, options: { tags: ['  '] } });
        expect(blankEntry.ok).toBe(false);
        expect(blankEntry.error).toContain('metadata.tags entries must be non-empty exact names');

        const overCap = await transport(fake).publish({
            content: liveContent,
            options: { categories: ['a', 'b', 'c', 'd'] },
        });
        expect(overCap.ok).toBe(false);
        expect(overCap.error).toContain('metadata.categories requests 4 entries');
        expect(overCap.error).toContain('over the observed CSDN publish-modal limit of 3');
        expect(overCap.error).toContain('refusing rather than truncating');
        expect(fake.requests).toHaveLength(0);
    });

    test('cover payload violations (blank path, bad extension, missing file) refuse before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const blank = await transport(fake).publish({ content: liveContent, options: { coverPath: '   ' } });
        expect(blank.ok).toBe(false);
        expect(blank.error).toContain('metadata.coverPath must be a non-empty local image path');

        const wrongExtension = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: join(TMP_DIR, 'cover.bmp') },
        });
        expect(wrongExtension.ok).toBe(false);
        expect(wrongExtension.error).toContain('must be one of .png, .jpg, .jpeg, .webp (PNG/JPEG/WebP)');

        const absentFile = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: join(TMP_DIR, 'absent.png') },
        });
        expect(absentFile.ok).toBe(false);
        expect(absentFile.error).toContain('metadata.coverPath file does not exist');
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-script driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new CsdnBrowserTransport('article', 'agent', { launcher: fake.launcher });
        const result = await agent.publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported driver 'agent'");
        expect(result.error).toContain('expected one of script');
        expect(fake.requests).toHaveLength(0);
    });

    test('processPublishIO refuses an undeclared operation and a driver option before any transport exists', async () => {
        const fake = new FakeBrowserTransport('script');

        const opIn = join(TMP_DIR, 'op-in.json');
        const opOut = join(TMP_DIR, 'op-out.json');
        await writeFile(opIn, JSON.stringify({ ...draftContent, options: { operation: 'post' } }));
        await expect(processPublishIO(opIn, opOut, fake)).rejects.toThrow(/unsupported operation 'post'/);
        expect(ResultSchema.parse(JSON.parse(await readFile(opOut, 'utf-8'))).ok).toBe(false);

        const driverIn = join(TMP_DIR, 'driver-in.json');
        const driverOut = join(TMP_DIR, 'driver-out.json');
        await writeFile(
            driverIn,
            JSON.stringify({
                ...liveContent,
                options: { driver: 'agent' },
            }),
        );
        await expect(processPublishIO(driverIn, driverOut, fake)).rejects.toThrow(/unsupported driver 'agent'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(driverOut, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('csdn');
        expect(fake.getCallLogs()).toHaveLength(0);
    });

    test('fake mode does not bypass the deterministic refusals: an unknown publishStatus refuses offline', async () => {
        const inPath = join(TMP_DIR, 'draft-in.json');
        const outPath = join(TMP_DIR, 'draft-out.json');
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'scheduled' } }));
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/unknown publishStatus 'scheduled'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
    });
});

describe('csdn-pub session preflight', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: LOGIN_URL });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('csdn session preflight refused');
        expect(result.error).toContain(`run: ${CSDN_LOGIN_INSTRUCTION}`);
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
        const result = await new CsdnBrowserTransport('article', 'script', { launcher }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no csdn browser profile');
        expect(result.error).toContain(CSDN_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
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
                const context = {
                    pages: () => [page],
                    newPage: async () => page,
                    close: async () => {},
                };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new CsdnBrowserTransport('article', 'script', { launcher, stepTimeoutMs: 250 }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('csdn session failed');
        expect(result.error).toContain(CSDN_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('csdn-pub article flow (offline fake page)', () => {
    test('a public text-only article fills title and body with readback, submits and reports the fresh receipt', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(result.id).toBe('20261015100');
        expect(result.metadata).toMatchObject({
            operation: 'article',
            driver: 'script',
            publishStatus: 'public',
            profileDir: DEFAULT_DIR,
        });
        expect(result.metadata?.probe).toMatchObject({
            grounded: { titleInput: true, bodyEditor: true },
            provisional: { composer: true, tagInput: false, categoryControl: false, coverInput: false },
        });
        expect(fake.calls).toContain(`fill:${TITLE_INPUT}|Hello`);
        expect(fake.calls).toContain(`fill:${BODY_EDITOR}|Hello CSDN article body`);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(true);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.closeCount()).toBe(2);
    });

    test('an options.profileDir override names that profile in the Result metadata', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt' });
        const profileDir = join(TMP_DIR, 'profile-flag');
        const result = await transport(fake).publish({ content: liveContent, options: { profileDir } });
        expect(result.ok).toBe(true);
        expect(result.metadata?.profileDir).toBe(profileDir);
    });

    test('a dropped title is refused at the title-readback stage, never filled forward or submitted', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('csdn title readback failed');
        expect(fake.calls.some((call) => call.startsWith(`fill:${BODY_EDITOR}`))).toBe(false);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a page crash during the title fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('csdn editor page crashed on fill');
        expect(result.error).not.toContain(CSDN_LOGIN_INSTRUCTION);
    });

    test('a dropped body is refused at the body-readback stage before the publish modal opens', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'body-readback' });
        expect(result.error).toContain('csdn body readback failed');
        expect(fake.calls.some((call) => call === `click:${PUBLISH_OPEN}`)).toBe(false);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('an absent 发布文章 entry refuses at the publish-open stage, never a modal guess', async () => {
        const fake = makeFakeLauncher({ missingPublishOpen: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'publish-open' });
        expect(result.error).toContain('csdn publish-modal entry not found');
        expect(fake.calls.some((call) => call.startsWith(`fill:${COVER_INPUT}`))).toBe(false);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a lookalike tag chip never substitutes: the tag-commit stage refuses before submit', async () => {
        const fake = makeFakeLauncher({ lookalikeTagChip: '后端技术', onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({ content: liveContent, options: { tags: ['后端'] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'tag-commit' });
        expect(result.error).toContain('csdn did not show a committed tag chip 「后端」 in .modal__publish-article');
        expect(fake.calls.some((call) => call === `press:${TAG_INPUT}|Enter`)).toBe(true);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('an exact tag chip commits and the article publishes', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({ content: liveContent, options: { tags: ['后端'] } });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(fake.calls).toContain(`press:${TAG_INPUT}|Enter`);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(true);
    });

    test('an unoffered category option refuses at the category-select stage, never an empty category', async () => {
        const fake = makeFakeLauncher({ categoryOptions: ['前端'], onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({ content: liveContent, options: { categories: ['后端'] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'category-select' });
        expect(result.error).toContain('csdn did not offer a category option 「后端」');
        expect(result.error).toContain('csdn.js:207');
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a category option that clicks but never persists refuses before submit', async () => {
        const fake = makeFakeLauncher({ categoryOptions: ['后端'], categoryNeverPersists: true });
        const result = await transport(fake).publish({ content: liveContent, options: { categories: ['后端'] } });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'category-select' });
        expect(result.error).toContain('csdn category 「后端」 did not persist in the category control');
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('an exact category option persists and the article publishes', async () => {
        const fake = makeFakeLauncher({ categoryOptions: ['后端'], onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({ content: liveContent, options: { categories: ['后端'] } });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(fake.calls.some((call) => call.startsWith('evaluate:(() => { // kk-csdn-category-exact'))).toBe(true);
    });
});

describe('csdn-pub draft leg (offline fake page)', () => {
    test('absent publishStatus defaults to draft: the top-level 保存草稿 click confirms a fresh articleId URL', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_EDITOR_URL);
        expect(result.id).toBe('20261015200');
        expect(result.message).toContain('draft saved');
        expect(result.metadata).toMatchObject({ publishStatus: 'draft', profileDir: DEFAULT_DIR });
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
        // No field prep requested: the publish modal is never opened and its submit never clicked.
        expect(fake.calls.some((call) => call === `click:${PUBLISH_OPEN}`)).toBe(false);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('explicit publishStatus draft saves a draft through the same pinned control', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'draft' } },
        });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_EDITOR_URL);
    });

    test('a draft with requested fields preps the modal but never clicks its public submit', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId', onSubmit: 'freshReceipt', categoryOptions: ['后端'] });
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'draft' } },
            options: { tags: ['后端'], categories: ['后端'], coverPath: COVER_PATH },
        });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_EDITOR_URL);
        expect(fake.calls).toContain(`press:${TAG_INPUT}|Enter`);
        expect(fake.calls).toContain(`click:${PUBLISH_OPEN}`);
        expect(fake.calls).toContain(`setInputFiles:${COVER_INPUT}|${COVER_PATH}`);
        // The frozen draft contract: modal prep only — the modal's final public submit is NEVER clicked.
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a draft with no id change (stale receipt only) is a typed draft-save failure with a snapshot', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingReceiptUrl: DRAFT_EDITOR_URL });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('csdn draft save not confirmed — no fresh draft id appeared');
        expect(result.metadata?.evidence).toContain('1 receipt-shaped url(s)');
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
    });

    test('an idless state (no URL gain at all) never confirms the draft save', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none' });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
    });

    test('a 保存草稿 button that never enables is refused at the draft-enabled stage', async () => {
        const fake = makeFakeLauncher({ submitNeverEnabled: true, onDraftSave: 'freshId' });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-enabled' });
        expect(result.error).toContain('csdn 保存草稿 button never became clickable');
        expect(fake.calls.some((call) => call === `click:${DRAFT_SAVE}`)).toBe(false);
    });

    test('a fresh draft failure toast reports the site text at the failure-toast stage', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'failureToast', failureToastText: '文章保存失败，请重试' });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'failure-toast' });
        expect(result.error).toContain('csdn draft save failed — site reported: 文章保存失败，请重试');
    });

    test('a fresh success toast alone is idless and never confirms a draft save', async () => {
        // The draft confirmation accepts only an id-bearing URL; a toast-only state stays unconfirmed.
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingToasts: [] });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
    });
});

describe('csdn-pub cover upload and submit confirmation (offline fake page)', () => {
    test('an absent cover file input is a typed cover-upload refusal, never a submit', async () => {
        const fake = makeFakeLauncher({ missingCoverInput: true });
        const result = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: COVER_PATH },
        });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-upload' });
        expect(result.error).toContain('csdn cover upload failed');
        expect(result.error).toContain('not attached');
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('an upload stuck on 上传中 refuses before submit', async () => {
        const fake = makeFakeLauncher({ coverUploadStuck: true });
        const result = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: COVER_PATH },
        });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-upload' });
        expect(result.error).toContain('csdn cover upload did not settle');
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a settled upload whose preview never lands refuses before submit', async () => {
        const fake = makeFakeLauncher({ coverPreviewNeverLands: true });
        const result = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: COVER_PATH },
        });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-upload' });
        expect(result.error).toContain('csdn cover preview never appeared after upload');
        expect(result.error).toContain('baseline 0 media nodes');
        expect(fake.calls.some((call) => call.startsWith(`setInputFiles:${COVER_INPUT}|${COVER_PATH}`))).toBe(true);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('a settled cover with fresh preview evidence uploads and publishes', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt' });
        const result = await transport(fake).publish({
            content: liveContent,
            options: { coverPath: COVER_PATH },
        });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
        expect(fake.calls).toContain(`setInputFiles:${COVER_INPUT}|${COVER_PATH}`);
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(true);
    }, 20_000);

    test('a 发布 button that never enables is refused at the send-enabled stage', async () => {
        const fake = makeFakeLauncher({ submitNeverEnabled: true });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'send-enabled' });
        expect(result.error).toContain('csdn 发布 button never became clickable');
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
    });

    test('no observed confirmation never reports ok:true and carries the on-screen snapshot', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'none' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
        expect(result.error).toContain('csdn publish not confirmed — no fresh persisted receipt appeared');
        expect(result.metadata?.evidence).toContain(`still on ${CSDN_EDITOR_URL}`);
        expect(result.metadata?.evidence).toContain('0 receipt-shaped url(s)');
    });

    test('a receipt already on screen before the submit is stale and never confirms the publish', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'none', existingReceiptUrl: RECEIPT_URL });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
        expect(result.metadata?.evidence).toContain('1 receipt-shaped url(s)');
    });

    test('an already-visible success toast is stale and never confirms the publish', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'none', existingToasts: ['发布成功'] });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'confirmation' });
    });

    test('a fresh success toast alone is a receipt without an article URL', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'successToast' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBeUndefined();
        expect(result.id).toBeUndefined();
        expect(result.message).toContain('success-toast receipt; no article URL read back');
        expect(result.message).toContain(DEFAULT_DIR);
    });

    test('a fresh failure toast reports the site text at the failure-toast stage', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'failureToast', failureToastText: '发布失败，请重试' });
        const result = await transport(fake).publish({ content: liveContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'failure-toast' });
        expect(result.error).toContain('csdn publish failed — site reported: 发布失败，请重试');
    });

    test('a fresh failure toast wins over a stale receipt URL (fails fast, never waits out)', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'failureToast', existingReceiptUrl: RECEIPT_URL });
        const result = await transport(fake, 250).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'failure-toast' });
        expect(result.error).toContain('site reported: 发布失败');
    });

    test('unparseable toast snapshots are tolerated as "no signal", not a crash', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt', malformedToasts: true });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(RECEIPT_URL);
    });
});

describe('csdn-pub fake transport and --in/--out IO', () => {
    test('processPublishIO publishes offline on the fake transport and writes a schema-valid Result', async () => {
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'nested', 'out.json');
        await writeFile(inPath, JSON.stringify(liveContent));
        await processPublishIO(inPath, outPath, new FakeBrowserTransport('script'));
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(true);
        expect(written.id).toBe('fake-browser-id-123');
        expect(written.url).toBe('https://example.com/browser-draft');
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
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'archived' } }));
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('csdn-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain("unknown publishStatus 'archived'");
    });
});

describe('csdn-pub named real-browser fixture runner (offline, guarded)', () => {
    test('a missing Chromium fails loud with the recovery hint, never a silent skip', () => {
        const runnerPath = join(import.meta.dir, 'fixtures', 'csdn-composer-runner.ts');
        const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(TMP_DIR, 'no-browsers-here') };
        const proc = Bun.spawnSync([process.execPath, runnerPath, 'article-happy'], {
            env,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(1);
        expect(proc.stderr.toString()).toContain('csdn real-browser fixture could not launch Chromium');
        expect(proc.stderr.toString()).toContain(RECOVERY_HINT);
    }, 60_000);

    test('the production flow publishes the article through real Chromium against the synthetic editor', async () => {
        const browser = await launchChromium();
        try {
            const facts = await runComposerScenario(browser, 'article-happy');
            expect(facts.ok).toBe(true);
            expect(facts.url).toBe(REAL_ARTICLE_URL);
            expect(facts.id).toBe('20261015001');
            expect(facts.error).toBeUndefined();
            // The read-only headless preflight plus the headed flow pass.
            expect(facts.launches).toBe(2);
        } finally {
            await browser.close();
        }
    }, 120_000);

    test('the production draft leg saves through the top-level 保存草稿 button and gains the articleId URL', async () => {
        const browser = await launchChromium();
        try {
            const facts = await runComposerScenario(browser, 'draft-happy');
            expect(facts.ok).toBe(true);
            expect(facts.url).toBe(REAL_DRAFT_URL);
            expect(facts.id).toBe('20261015002');
            expect(facts.error).toBeUndefined();
            expect(facts.launches).toBe(2);
        } finally {
            await browser.close();
        }
    }, 120_000);

    test('zero network beyond the synthetic editor and zero vendor credentials in src', async () => {
        // The fixture only fulfills the editor origin and aborts everything else (catch-all first).
        const fixtureSource = await readFile(join(import.meta.dir, 'fixtures', 'csdn-composer-runner.ts'), 'utf-8');
        expect(fixtureSource).toContain('route.abort()');
        expect(fixtureSource).toContain("'https://editor.csdn.net/**'");

        // The vendor's API signing headers and OBS direct-upload machinery are never ported.
        const src = await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf-8');
        expect(src).not.toMatch(/x-ca-/i);
        expect(src).not.toMatch(/x-obs-|myhuaweicloud|ObsClient|obsutil/i);
        // The fixed vendor tag appears only in the prose that refuses it — never as a fallback value.
        let cursor = src.indexOf('经验分享');
        while (cursor !== -1) {
            const window = src.slice(Math.max(0, cursor - 120), cursor + 140);
            expect(window).toMatch(/never|NOT/);
            cursor = src.indexOf('经验分享', cursor + 1);
        }
    });
});

describe('csdn-pub environment restoration', () => {
    test('no csdn profile env leaks between suites', () => {
        expect(process.env.CSDN_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
