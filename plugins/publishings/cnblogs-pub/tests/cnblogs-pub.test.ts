/**
 * Task 0293 chunk C2 — behavior tests for the cnblogs-pub Markdown-article publisher, layered like
 * the csdn-pub precedent (0292):
 *
 * 1. declared surface/manifest — the selector-table shape, the `--in/--out` operation contract and
 *    the plugin.json kind/entry/check/browserSession fields;
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches (including the
 *    no-upload image rule: non-HTTPS Markdown image refs refuse by count, never echoing a path,
 *    while existing HTTPS image URLs pass through literally);
 * 3. payload mapping — FakeBrowserTransport verifies only the Content→Result mapping and the
 *    `--in/--out` CLI routing (real DOM behavior is the dom fixture's job, never duplicated here);
 * 4. session preflight — the headless read-only pass, the recovery command on refusal, and the
 *    readiness predicate that requires the site-owned composer (a 登录 body alone is not a session);
 * 5. flow — an offline fake page executing the real `evaluate` scripts (title/body/summary readback
 *    → exact category checkbox commits → the publishStatus branch → fresh persisted receipt);
 * 6. zero-network / zero-credential source assertions (no XSRF upload endpoint machinery, no vendor
 *    signing headers, no OBS; category names never invented or first-matched).
 *
 * Every test is offline: fake pages only. No test ever calls www.cnblogs.com or i.cnblogs.com.
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
import { CNBLOGS_LOGIN_INSTRUCTION, CnblogsBrowserTransport } from '../src/flow';
import {
    CNBLOGS_OPERATIONS,
    countNonHttpsImageRefs,
    getPublishTransport,
    main,
    processPublishIO,
    resolveOperation,
} from '../src/index';
import {
    CNBLOGS_ARTICLE_SELECTORS,
    CNBLOGS_EDIT_URL,
    CNBLOGS_LOGIN_URL_RE,
    CNBLOGS_RECEIPT_URL_RES,
    isCnblogsAuthenticated,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-cnblogs-pub-main');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'cnblogs');
const SIGNIN_URL = 'https://account.cnblogs.com/signin?ReturnUrl=%2fposts%2fedit';
/** Draft receipt: the edit URL gaining a postId param (the frozen draft save's id gain). */
const DRAFT_RECEIPT_URL = 'https://i.cnblogs.com/posts/edit?postId=20261015200';
const POST_RECEIPT_URL = 'https://www.cnblogs.com/robin/p/20261015001.html';
const TITLE_INPUT = CNBLOGS_ARTICLE_SELECTORS.titleInput[0];
const BODY_EDITOR = CNBLOGS_ARTICLE_SELECTORS.bodyEditor[0];
const SUMMARY_INPUT = CNBLOGS_ARTICLE_SELECTORS.summaryInput[0];
const DRAFT_SAVE = CNBLOGS_ARTICLE_SELECTORS.draftSave[0];
const PUBLISH_BUTTON = CNBLOGS_ARTICLE_SELECTORS.publishButton[0];

const draftContent: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };
const liveContent: Content = {
    title: 'Hello',
    body: 'Hello cnblogs body\n\n![pic](https://example.com/pic.png)',
    format: 'markdown',
    metadata: { publishStatus: 'public' },
};

/** The channel's selector table, dereferenced by role — the compile-time shape under test. */
const SELECTORS: Record<keyof typeof CNBLOGS_ARTICLE_SELECTORS, readonly string[]> = CNBLOGS_ARTICLE_SELECTORS;

/** Every fake-page dial a cnblogs article flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a signin URL means the session expired. */
    landedUrl?: string;
    /** The grounded editor controls never attach (a logged-out page body without the composer). */
    groundedMissing?: boolean;
    /** The body editor never attaches while the title input does (a partially-rendered composer). */
    missingBodyEditor?: boolean;
    /** The grounded controls attach but never become visible (editor-readiness refusal). */
    groundedInvisible?: boolean;
    /** The title input drops the filled value, so the strict readback must fail. */
    titleReadbackDrops?: boolean;
    /** The body textarea drops the filled Markdown, so the strict readback must fail. */
    bodyReadbackDrops?: boolean;
    /** The summary textarea drops the filled digest, so the strict readback must fail. */
    summaryReadbackDrops?: boolean;
    /** The editor fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
    /** The category panel never attaches. */
    missingCategoryPanel?: boolean;
    /** Exact checkbox labels the panel offers; an exact match commits, anything else misses. */
    categoryOptions?: string[];
    /** The checkbox is offered and clicked but never reports itself checked. */
    categoryNeverChecks?: boolean;
    /** The save control never becomes clickable. */
    submitNeverEnabled?: boolean;
    /** What clicking the draft control emits: a fresh postId URL gain, or nothing. */
    onDraftSave?: 'freshId' | 'none';
    /** What clicking the publish control emits: a fresh post URL, or nothing. */
    onSubmit?: 'freshReceipt' | 'none';
    /** A receipt-shaped URL already on screen before the save (a stale/ambiguous signal). */
    existingReceiptUrl?: string;
    /** Toasts already on screen (the flow never reads them — they alone never confirm). */
    existingToasts?: string[];
    /** The fresh receipt appears but the persisted title/body state no longer matches. */
    persistedStateDrifts?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`). The
 * evaluate branch keyed on the real scripts' `kk-cnblogs-*` markers executes their contracts
 * against scripted page state, so dropped readbacks, an unoffered/unchecked category, a stale
 * receipt and a drifted persisted state are all reachable offline.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let titleValue = '';
    let bodyText = '';
    let summaryValue = '';
    const checkedCategories = new Set<string>();

    const attached = (selector: string): number =>
        options.groundedMissing === true ||
        (options.missingBodyEditor === true && SELECTORS.bodyEditor.includes(selector))
            ? 0
            : 1;
    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0 && options.groundedInvisible !== true,
        isEnabled: async () => options.submitNeverEnabled !== true,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            if (options.fillThrows === true) throw new Error('cnblogs editor page crashed on fill');
            if (SELECTORS.titleInput.includes(selector)) {
                titleValue = options.titleReadbackDrops === true ? '' : text;
            } else if (SELECTORS.bodyEditor.includes(selector)) {
                bodyText = options.bodyReadbackDrops === true ? '' : text;
            } else if (SELECTORS.summaryInput.includes(selector)) {
                summaryValue = options.summaryReadbackDrops === true ? '' : text;
            }
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (SELECTORS.draftSave.includes(selector) && options.onDraftSave === 'freshId') {
                url = DRAFT_RECEIPT_URL;
            }
            if (SELECTORS.publishButton.includes(selector) && options.onSubmit === 'freshReceipt') {
                url = POST_RECEIPT_URL;
            }
        },
    });

    const selectorArg = (expression: string): string => {
        const match = /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/.exec(expression);
        return match?.[1] === undefined ? '' : (JSON.parse(match[1]) as string);
    };
    const stringArg = (expression: string, name: string): string | null => {
        const match = new RegExp(`const ${name} = ("(?:[^"\\\\]|\\\\.)*");`).exec(expression);
        return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
    };
    const norm = (value: string): string => value.replace(/\s+/g, '');
    const receiptShaped = (candidate: string): boolean => CNBLOGS_RECEIPT_URL_RES.some((re) => re.test(candidate));

    return {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 44)}`);
            if (expression.includes('kk-cnblogs-input-value')) {
                const selector = selectorArg(expression);
                if (SELECTORS.titleInput.includes(selector)) return titleValue;
                if (SELECTORS.bodyEditor.includes(selector)) return bodyText;
                if (SELECTORS.summaryInput.includes(selector)) return summaryValue;
                return '';
            }
            if (expression.includes('kk-cnblogs-category-commit')) {
                if (options.missingCategoryPanel === true) return JSON.stringify({ offered: false, checked: false });
                const wanted = stringArg(expression, 'wanted');
                if (wanted === null || !(options.categoryOptions ?? []).includes(wanted)) {
                    return JSON.stringify({ offered: false, checked: false });
                }
                const checked = options.categoryNeverChecks !== true;
                if (checked) checkedCategories.add(wanted);
                return JSON.stringify({ offered: true, checked });
            }
            if (expression.includes('kk-cnblogs-persisted')) {
                const requested = [...expression.matchAll(/squish\(("(?:[^"\\]|\\.)*")\)/g)].map((match) =>
                    JSON.parse(match[1] as string),
                ) as string[];
                const wantedList = /for \(const wanted of (\[[^\]]*\])\) \{/.exec(expression)?.[1] ?? '[]';
                const categories = JSON.parse(wantedList) as string[];
                const healthy = options.persistedStateDrifts !== true;
                return JSON.stringify({
                    titleOk: healthy && norm(titleValue) === norm(requested[0] ?? ''),
                    bodyOk: healthy && norm(bodyText) === norm(requested[1] ?? ''),
                    missing: categories.filter((category) => !checkedCategories.has(category)),
                });
            }
            if (expression.includes('kk-cnblogs-receipt-urls')) {
                const urls: string[] = [];
                if (receiptShaped(url)) urls.push(url);
                const anchor = options.existingReceiptUrl;
                if (anchor !== undefined && receiptShaped(anchor) && !urls.includes(anchor)) urls.push(anchor);
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

function transport(fake: LauncherHandle, stepTimeoutMs = 250): CnblogsBrowserTransport {
    return new CnblogsBrowserTransport('article', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.CNBLOGS_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.CNBLOGS_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.CNBLOGS_PROFILE_DIR;
    else process.env.CNBLOGS_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('cnblogs-pub declared surface and manifest', () => {
    test('the article selector table covers exactly the six flow roles', () => {
        expect(Object.keys(SELECTORS).sort()).toEqual(
            ['bodyEditor', 'categoryPanel', 'draftSave', 'publishButton', 'summaryInput', 'titleInput'].sort(),
        );
        // The grounded pair must never be empty — the readiness probe asserts on it.
        expect(SELECTORS.titleInput.length).toBeGreaterThan(0);
        expect(SELECTORS.bodyEditor.length).toBeGreaterThan(0);
        // The status legs are exact-text controls only, most specific wording first.
        expect([...SELECTORS.draftSave]).toEqual(['button:text-is("保存草稿")', 'button:text-is("存为草稿")']);
        expect([...SELECTORS.publishButton]).toEqual(['button:text-is("发布博文")', 'button:text-is("发布")']);
    });

    test('the login marker matches the signin shapes, never the editor page; receipts match the two id shapes', () => {
        expect(CNBLOGS_LOGIN_URL_RE.test(SIGNIN_URL)).toBe(true);
        expect(CNBLOGS_LOGIN_URL_RE.test('https://www.cnblogs.com/signin')).toBe(true);
        expect(CNBLOGS_LOGIN_URL_RE.test(CNBLOGS_EDIT_URL)).toBe(false);
        expect(CNBLOGS_RECEIPT_URL_RES.some((re) => re.test(DRAFT_RECEIPT_URL))).toBe(true);
        expect(CNBLOGS_RECEIPT_URL_RES.some((re) => re.test(POST_RECEIPT_URL))).toBe(true);
        expect(CNBLOGS_RECEIPT_URL_RES.some((re) => re.test(CNBLOGS_EDIT_URL))).toBe(false);
    });

    test('only the article operation is declared, with metadata fallback and options precedence', () => {
        expect([...CNBLOGS_OPERATIONS]).toEqual(['article']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'article' });
        expect(resolveOperation(undefined, { ...draftContent, metadata: { operation: 'article' } })).toEqual({
            operation: 'article',
        });
        const unknown = resolveOperation({ operation: 'page' }, draftContent);
        expect(unknown.error).toContain(`unsupported operation 'page' for cnblogs: expected one of article`);
        const fallback = resolveOperation(undefined, { ...draftContent, metadata: { operation: 'note' } });
        expect(fallback.error).toContain('note');
        const precedence = resolveOperation(
            { operation: 'article' },
            { ...draftContent, metadata: { operation: 'note' } },
        );
        expect(precedence).toEqual({ operation: 'article' });
    });

    test('plugin.json declares the publish kind, entry, check and the cnblogs browser session', async () => {
        const manifest = JSON.parse(await readFile(join(import.meta.dir, '..', 'plugin.json'), 'utf-8')) as Record<
            string,
            unknown
        >;
        expect(manifest.name).toBe('cnblogs-pub');
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        expect(manifest.browserSession).toMatchObject({ profileName: 'cnblogs', homeUrl: 'https://www.cnblogs.com' });
        // The packed entry/check targets resolve on disk (the packaging seam for this plugin).
        await readFile(join(import.meta.dir, '..', 'src', 'index.ts'));
        await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'));
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('article');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        expect(getPublishTransport('article')).toBeInstanceOf(CnblogsBrowserTransport);
    });

    test('the readiness predicate passes only on the site-owned composer — a 登录 body alone is no session', async () => {
        const editor = makeFakePage({}, []);
        await editor.goto(CNBLOGS_EDIT_URL);
        expect(await isCnblogsAuthenticated(editor)).toBe(true);
        // A page showing only the logged-out body (no `input#post-title`) refuses even on the edit URL.
        const loggedOut = makeFakePage({ groundedMissing: true }, []);
        await loggedOut.goto(CNBLOGS_EDIT_URL);
        expect(await isCnblogsAuthenticated(loggedOut)).toBe(false);
        const signin = makeFakePage({}, []);
        await signin.goto(SIGNIN_URL);
        expect(await isCnblogsAuthenticated(signin)).toBe(false);
    });
});

describe('cnblogs-pub refusals before any browser', () => {
    test('only an unknown publishStatus refuses with a typed message and zero launches', async () => {
        const fake = makeFakeLauncher();
        const unknown = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'scheduled' } },
        });
        expect(unknown.ok).toBe(false);
        expect(unknown.error).toContain(`unknown publishStatus 'scheduled' for cnblogs`);
        expect(unknown.error).toContain(`expected 'public', 'draft' or absent`);
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty title and an empty body are refused by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const noTitle = await transport(fake).publish({
            content: { title: '   ', body: 'Body', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(noTitle.ok).toBe(false);
        expect(noTitle.error).toContain('cnblogs article requires a non-empty Content.title');

        const noBody = await transport(fake).publish({
            content: { title: 'Title', body: '   ', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(noBody.ok).toBe(false);
        expect(noBody.error).toContain('cnblogs article requires non-empty Content.body Markdown');
        expect(fake.requests).toHaveLength(0);
    });

    test('unsupported cover/tags/images refuse by container+key, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...liveContent, metadata: { images: ['https://example.com/a.png'] } },
            options: { coverPath: '/tmp/a.png', tags: ['后端'] },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported field(s) options.coverPath, options.tags, metadata.images');
        expect(result.error).toContain('title/body/digest/categories only');
        expect(result.error).toContain('upload.cnblogs.com XSRF image endpoint');
        expect(fake.requests).toHaveLength(0);
    });

    test('wrong-shaped categories and digests refuse by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const notArray = await transport(fake).publish({ content: liveContent, options: { categories: '后端' } });
        expect(notArray.ok).toBe(false);
        expect(notArray.error).toContain("metadata.categories must be an array of non-empty exact names, got '后端'");

        const blankEntry = await transport(fake).publish({ content: liveContent, options: { categories: ['  '] } });
        expect(blankEntry.ok).toBe(false);
        expect(blankEntry.error).toContain('metadata.categories entries must be non-empty exact names');

        const blankDigest = await transport(fake).publish({
            content: { ...draftContent, metadata: { digest: '   ' } },
        });
        expect(blankDigest.ok).toBe(false);
        expect(blankDigest.error).toContain(`metadata.digest must be a non-empty string when present`);
        expect(fake.requests).toHaveLength(0);
    });

    test('non-HTTPS Markdown image refs refuse BEFORE submit by count only — no path ever leaks', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: {
                ...liveContent,
                body: 'Intro\n\n![local](./img/local-shot.png)\n\n![plain](http://example.com/plain.png)',
            },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('2 non-HTTPS Markdown image reference(s) in Content.body');
        expect(result.error).toContain('does not upload images');
        expect(result.error).not.toContain('local-shot.png');
        expect(result.error).not.toContain('plain.png');
        expect(fake.requests).toHaveLength(0);
    });

    test('existing HTTPS image URLs stay literal: a mixed body counts only the non-HTTPS ref', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: {
                ...liveContent,
                body: '![https](https://example.com/ok.png)\n\n![local](./local.png)',
            },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('1 non-HTTPS Markdown image reference(s)');
        expect(result.error).not.toContain('https://example.com/ok.png');
        expect(fake.requests).toHaveLength(0);
        expect(countNonHttpsImageRefs('![a](https://example.com/x.png)')).toBe(0);
        expect(countNonHttpsImageRefs('![a](./x.png) ![b](y.png "t") ![c](http://z/q.png)')).toBe(3);
    });

    test('reference-style images resolve through their definitions; plain link definitions are ignored', () => {
        const md = [
            '![a][local] ![b][Remote] ![c][] ![shortcut]',
            '[docs](./readme.md) [plain][link]',
            '',
            '[local]: ./x.png',
            '[remote]: <https://example.com/r.png> "title"',
            '[c]: http://z/c.png',
            '[shortcut]: ../s.png',
            '[link]: ./not-an-image.md',
        ].join('\n');
        expect(countNonHttpsImageRefs(md)).toBe(3);
        expect(countNonHttpsImageRefs('![a][undefined-label]')).toBe(0);
    });

    test('a non-script driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new CnblogsBrowserTransport('article', 'agent', { launcher: fake.launcher });
        const result = await agent.publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`unsupported driver 'agent'`);
        expect(result.error).toContain('expected one of script');
        expect(fake.requests).toHaveLength(0);
    });
});

describe('cnblogs-pub payload mapping and --in/--out IO (FakeBrowserTransport)', () => {
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

    test('fake mode does not bypass the deterministic refusals: an unknown publishStatus refuses offline', async () => {
        const inPath = join(TMP_DIR, 'status-in.json');
        const outPath = join(TMP_DIR, 'status-out.json');
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'archived' } }));
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/unknown publishStatus 'archived'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('cnblogs');
        expect(written.error?.split('\n')).toHaveLength(1);
    });

    test('processPublishIO refuses an undeclared operation and a driver option before any transport exists', async () => {
        const opIn = join(TMP_DIR, 'op-in.json');
        const opOut = join(TMP_DIR, 'op-out.json');
        await writeFile(opIn, JSON.stringify({ ...draftContent, options: { operation: 'page' } }));
        await expect(processPublishIO(opIn, opOut, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported operation 'page'/,
        );
        expect(ResultSchema.parse(JSON.parse(await readFile(opOut, 'utf-8'))).ok).toBe(false);

        const driverIn = join(TMP_DIR, 'driver-in.json');
        const driverOut = join(TMP_DIR, 'driver-out.json');
        await writeFile(driverIn, JSON.stringify({ ...liveContent, options: { driver: 'agent' } }));
        await expect(processPublishIO(driverIn, driverOut, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported driver 'agent'/,
        );
        expect(ResultSchema.parse(JSON.parse(await readFile(driverOut, 'utf-8'))).ok).toBe(false);
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
        await writeFile(inPath, JSON.stringify(draftContent));
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
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'unlisted' } }));
        const origArgv = process.argv;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('cnblogs-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain("unknown publishStatus 'unlisted'");
    });
});

describe('cnblogs-pub session preflight', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: SIGNIN_URL });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cnblogs session preflight refused');
        expect(result.error).toContain(`run: ${CNBLOGS_LOGIN_INSTRUCTION}`);
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
        const result = await new CnblogsBrowserTransport('article', 'script', { launcher }).publish({
            content: liveContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no cnblogs browser profile');
        expect(result.error).toContain(CNBLOGS_LOGIN_INSTRUCTION);
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
                const page = makeFakePage(launches === 1 ? {} : { landedUrl: SIGNIN_URL }, []);
                const context = { pages: () => [page], newPage: async () => page, close: async () => {} };
                return context as unknown as BrowserContext;
            },
        };
        const result = await new CnblogsBrowserTransport('article', 'script', { launcher, stepTimeoutMs: 250 }).publish(
            { content: liveContent },
        );
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cnblogs session failed');
        expect(result.error).toContain(CNBLOGS_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('cnblogs-pub article flow (offline fake page)', () => {
    test('absent publishStatus defaults to draft: the exact 保存草稿 control confirms a fresh postId URL', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_RECEIPT_URL);
        expect(result.id).toBe('20261015200');
        expect(result.message).toContain('draft saved');
        expect(result.metadata).toMatchObject({
            operation: 'article',
            driver: 'script',
            publishStatus: 'draft',
            profileDir: DEFAULT_DIR,
            confirmedBy: 'draft-save',
        });
        expect(fake.calls).toContain(`fill:${TITLE_INPUT}|Parity`);
        expect(fake.calls).toContain(`fill:${BODY_EDITOR}|Body text`);
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
        // The draft leg never touches the public publish control.
        expect(fake.calls.some((call) => call === `click:${PUBLISH_BUTTON}`)).toBe(false);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.closeCount()).toBe(2);
    });

    test('an explicit draft publishStatus saves through the same pinned control', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'draft' } },
        });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_RECEIPT_URL);
        expect(result.metadata).toMatchObject({ publishStatus: 'draft' });
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
    });

    test('a public article activates 发布博文, keeps HTTPS image refs literal and reports the fresh receipt', async () => {
        const fake = makeFakeLauncher({ onSubmit: 'freshReceipt', categoryOptions: ['后端'] });
        const result = await transport(fake).publish({ content: liveContent, options: { categories: ['后端'] } });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(POST_RECEIPT_URL);
        expect(result.id).toBe('20261015001');
        expect(result.metadata).toMatchObject({
            publishStatus: 'public',
            confirmedBy: 'publish-confirmation',
        });
        expect(fake.calls).toContain(`fill:${BODY_EDITOR}|${liveContent.body}`);
        expect(fake.calls).toContain(`click:${PUBLISH_BUTTON}`);
        expect(fake.calls.some((call) => call === `click:${DRAFT_SAVE}`)).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('evaluate:(() => { // kk-cnblogs-category-commit'))).toBe(
            true,
        );
    });

    test('an options.profileDir override names that profile in the Result metadata', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const profileDir = join(TMP_DIR, 'profile-flag');
        const result = await transport(fake).publish({ content: draftContent, options: { profileDir } });
        expect(result.ok).toBe(true);
        expect(result.metadata?.profileDir).toBe(profileDir);
    });

    test('grounded controls attached but not visible refuse at the editor-readiness stage', async () => {
        const fake = makeFakeLauncher({ groundedInvisible: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'editor-readiness' });
        expect(result.error).toContain('grounded editor controls found but not visible');
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('grounded controls never attached refuse typed at the editor-readiness stage, never stage-less', async () => {
        // The readiness predicate gates on the title input, so a partially-rendered composer
        // (title present, body editor absent) passes preflight and must fail inside the flow
        // probe as a typed editor-readiness refusal, not a stage-less catch.
        const fake = makeFakeLauncher({ missingBodyEditor: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'editor-readiness' });
        expect(result.error).toContain('never attached');
        expect(result.error).toContain(CNBLOGS_LOGIN_INSTRUCTION);
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a dropped title is refused at the title-readback stage, never filled forward or saved', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('cnblogs title readback failed');
        expect(fake.calls.some((call) => call.startsWith(`fill:${BODY_EDITOR}`))).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a page crash during the title fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('cnblogs editor page crashed on fill');
        expect(result.error).not.toContain(CNBLOGS_LOGIN_INSTRUCTION);
    });

    test('a dropped body is refused at the body-readback stage before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'body-readback' });
        expect(result.error).toContain('cnblogs body readback failed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a digest fills the summary only when requested; a dropped summary readback refuses typed', async () => {
        const absent = makeFakeLauncher({ onDraftSave: 'freshId' });
        const ok = await transport(absent).publish({ content: draftContent });
        expect(ok.ok).toBe(true);
        expect(absent.calls.some((call) => call.startsWith(`fill:${SUMMARY_INPUT}`))).toBe(false);

        const present = makeFakeLauncher({ onDraftSave: 'freshId' });
        const digest = 'A short digest';
        const filled = await transport(present).publish({ content: { ...draftContent, metadata: { digest } } });
        expect(filled.ok).toBe(true);
        expect(present.calls).toContain(`fill:${SUMMARY_INPUT}|${digest}`);

        const dropped = makeFakeLauncher({ onDraftSave: 'freshId', summaryReadbackDrops: true });
        const refused = await transport(dropped).publish({ content: { ...draftContent, metadata: { digest } } });
        expect(refused.ok).toBe(false);
        expect(refused.metadata).toMatchObject({ stage: 'summary-commit' });
        expect(refused.error).toContain('cnblogs summary readback failed');
        expect(dropped.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('an unoffered, unchecked or panel-less category refuses at category-commit, never a first-match', async () => {
        for (const options of [
            { categoryOptions: ['前端'] },
            { categoryOptions: ['后端'], categoryNeverChecks: true },
            { missingCategoryPanel: true },
        ] as FakePageOptions[]) {
            const fake = makeFakeLauncher({ ...options, onDraftSave: 'freshId' });
            const result = await transport(fake).publish({ content: draftContent, options: { categories: ['后端'] } });
            expect(result.ok).toBe(false);
            expect(result.metadata).toMatchObject({ stage: 'category-commit' });
            expect(result.error).toContain('no checked checkbox labelled 「后端」');
            expect(result.error).toContain('refusing to save with a substituted, created or first-matched category');
            expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
        }
    });

    test('an idless state (stale receipt on screen, no fresh gain) is a typed draft-save failure', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingReceiptUrl: DRAFT_RECEIPT_URL });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('cnblogs draft-save not confirmed');
        expect(result.metadata?.evidence).toContain('1 pre-existing receipt-shaped url(s)');
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
    });

    test('a toast-only signal (which this flow never reads) never confirms the save', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingToasts: ['保存成功'] });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
    });

    test('a fresh receipt whose persisted state no longer matches refuses instead of claiming success', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId', persistedStateDrifts: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('no longer matches the requested content');
    });

    test('a save control that never becomes clickable refuses at its own leg, before any click', async () => {
        const draft = makeFakeLauncher({ submitNeverEnabled: true, onDraftSave: 'freshId' });
        const draftResult = await transport(draft).publish({ content: draftContent });
        expect(draftResult.ok).toBe(false);
        expect(draftResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(draftResult.error).toContain('cnblogs draft-save control never became clickable');
        expect(draft.calls.some((call) => call.startsWith('click:'))).toBe(false);

        const pub = makeFakeLauncher({ submitNeverEnabled: true });
        const pubResult = await transport(pub).publish({ content: liveContent });
        expect(pubResult.ok).toBe(false);
        expect(pubResult.metadata).toMatchObject({ stage: 'publish-open' });
        expect(pubResult.error).toContain('cnblogs publish-open control never became clickable');
        expect(pub.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });
});

describe('cnblogs-pub source hygiene (zero network, zero invented categories)', () => {
    test('no upload/XSRF/signing/OBS machinery in src; upload.cnblogs.com appears only in refusal prose', async () => {
        const sources = [
            await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8'),
        ];
        for (const src of sources) {
            expect(src).not.toMatch(/x-ca-/i);
            expect(src).not.toMatch(/x-obs-|myhuaweicloud|ObsClient|obsutil/i);
            expect(src).not.toMatch(/fetch\(|XMLHttpRequest/i);
            let cursor = src.indexOf('upload.cnblogs.com');
            while (cursor !== -1) {
                const window = src.slice(Math.max(0, cursor - 160), cursor + 220);
                expect(window).toMatch(/never|NOT/);
                cursor = src.indexOf('upload.cnblogs.com', cursor + 1);
            }
        }
        // Category names are exact-committed only — the refusal names the no-substitution rule.
        expect(sources[1]).toContain('refusing to save with a substituted, created or first-matched category');
    });
});

describe('cnblogs-pub environment restoration', () => {
    test('no cnblogs profile env leaks between suites', () => {
        expect(process.env.CNBLOGS_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
