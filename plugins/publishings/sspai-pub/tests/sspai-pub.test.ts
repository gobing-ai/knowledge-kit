/**
 * Task 0294 chunk C2 — behavior tests for the sspai-pub draft-only publisher, layered like the
 * cnblogs-pub precedent (0293):
 *
 * 1. declared surface/manifest — the selector-table shape, the `--in/--out` operation contract and
 *    the plugin.json kind/entry/check/browserSession fields (profileName `sspai`);
 * 2. refusals — every typed pre-browser refusal observed with ZERO browser launches, including the
 *    draft-only slice: publishStatus 'public' and unknown values refuse before the browser, and a
 *    requested cover that is not a readable nonempty PNG/JPEG/WebP refuses instead of the source's
 *    silent skip;
 * 3. sanitizer — `sanitizeArticleHtml(markdownToHtml(body))` strips script/style/iframe/embed/
 *    object, `on*` attributes and `javascript:` URLs while preserving heading/code/list markup,
 *    asserted both directly and through the exact HTML the fake page captured at paste time;
 * 4. payload mapping — FakeBrowserTransport verifies only the Content→Result mapping and the
 *    `--in/--out` CLI routing (real DOM behavior is the dom fixture's job, never duplicated here);
 * 5. session preflight — the headless read-only pass, the recovery command on refusal, and the
 *    readiness predicate that requires the site-owned editor controls (a 登录 body alone is no
 *    session);
 * 6. flow — an offline fake page executing the real `evaluate` scripts (title/cover/body readback
 *    → exact-visible 保存草稿|保存 → fresh persisted receipt); the preview control is probed and
 *    never clicked; stale receipts, toasts and drifted persisted state never confirm;
 * 7. source hygiene — no eval/new Function, exactly one paste site and it is the sanitized chain,
 *    no upload/vendor endpoint machinery, `.click(` only on the save control, and the provisional
 *    selectors carry their Provisional labels.
 *
 * Every test is offline: fake pages only. No test ever calls sspai.com.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { markdownToHtml } from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { SSPAI_LOGIN_INSTRUCTION, SspaiBrowserTransport, sanitizeArticleHtml } from '../src/flow';
import { getPublishTransport, main, processPublishIO, resolveOperation, SSPAI_OPERATIONS } from '../src/index';
import {
    isSspaiAuthenticated,
    SSPAI_ARTICLE_SELECTORS,
    SSPAI_EDIT_URL,
    SSPAI_HOME_URL,
    SSPAI_LOGIN_URL_RE,
    SSPAI_RECEIPT_URL_RES,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.tmp-test-sspai-pub-main');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'sspai');
const SIGNIN_URL = 'https://account.sspai.com/signin?return_to=%2Fpost%2Fwrite';
/** Draft receipt: the public-post id shape the receipt regexes pin (the fresh URL gain). */
const DRAFT_RECEIPT_URL = 'https://sspai.com/post/20261015200';
const TITLE_INPUT = SSPAI_ARTICLE_SELECTORS.titleInput[0];
const BODY_EDITOR = SSPAI_ARTICLE_SELECTORS.bodyEditor[0];
const DRAFT_SAVE = SSPAI_ARTICLE_SELECTORS.draftSave[0];
const PREVIEW_BUTTON = SSPAI_ARTICLE_SELECTORS.previewButton[0];

const draftContent: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };

/**
 * A body whose Markdown output carries every dangerous shape the sanitizer must strip (Bun's
 * markdown passes raw HTML through) plus the markup that must survive (heading/list/code/img).
 */
const dirtyBody = [
    '# Heading',
    '',
    '<script>alert(1)</script>',
    '',
    '- item one',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '<img onerror="alert(3)" src="https://example.com/a.png">',
    '',
    '<iframe src="https://evil.example"></iframe>',
].join('\n');

/** The channel's selector table, dereferenced by role — the compile-time shape under test. */
const SELECTORS: Record<keyof typeof SSPAI_ARTICLE_SELECTORS, readonly string[]> = SSPAI_ARTICLE_SELECTORS;

/** Every fake-page dial an sspai article flow can observe. */
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
    /** The editor drops the pasted HTML, so the paste/readback must fail. */
    bodyReadbackDrops?: boolean;
    /** The cover file input never attaches (a requested cover with no input). */
    missingCoverInput?: boolean;
    /** The file assignment lands but the cover readback never verifies it. */
    coverReadbackDrops?: boolean;
    /** The draft-save control never attaches (draft saving documented historically only). */
    saveMissing?: boolean;
    /** The draft-save control attaches but stays hidden. */
    saveInvisible?: boolean;
    /** The save control never becomes clickable. */
    submitNeverEnabled?: boolean;
    /** What clicking the save control emits: a fresh receipt URL, or nothing. */
    onDraftSave?: 'freshId' | 'none';
    /** A receipt-shaped URL already on screen before the save (a stale/ambiguous signal). */
    existingReceiptUrl?: string;
    /** Toasts already on screen (the flow never reads them — they alone never confirm). */
    existingToasts?: string[];
    /** The fresh receipt appears but the persisted title/body state no longer matches. */
    persistedStateDrifts?: boolean;
    /** Whether the grounded preview control is present (probed read-only, never clicked). */
    previewPresent?: boolean;
    /** The title fill itself throws (a page crash mid-flow). */
    fillThrows?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

const plainText = (html: string): string => html.replace(/<[^>]*>/g, ' ');
const squish = (value: string): string => value.replace(/\s+/g, '');
const receiptShaped = (candidate: string): boolean => SSPAI_RECEIPT_URL_RES.some((re) => re.test(candidate));

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). The evaluate branch keyed on the real scripts' `kk-sspai-*` markers executes
 * their contracts against scripted page state, so dropped readbacks, an unverified cover, a stale
 * receipt and a drifted persisted state are all reachable offline.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let titleValue = '';
    let editorHtml = '';
    let assignedCoverPath: string | null = null;

    const attached = (selector: string): number =>
        options.groundedMissing === true ||
        (options.missingBodyEditor === true && SELECTORS.bodyEditor.includes(selector)) ||
        (options.missingCoverInput === true && SELECTORS.coverInput.includes(selector)) ||
        (options.saveMissing === true && SELECTORS.draftSave.includes(selector)) ||
        (options.previewPresent === false && SELECTORS.previewButton.includes(selector))
            ? 0
            : 1;
    const visible = (selector: string): boolean =>
        attached(selector) > 0 &&
        options.groundedInvisible !== true &&
        !(options.saveInvisible === true && SELECTORS.draftSave.includes(selector));
    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => visible(selector),
        isEnabled: async () => options.submitNeverEnabled !== true,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            if (options.fillThrows === true) throw new Error('sspai editor page crashed on fill');
            if (SELECTORS.titleInput.includes(selector)) titleValue = text;
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (SELECTORS.draftSave.includes(selector) && options.onDraftSave === 'freshId') {
                url = DRAFT_RECEIPT_URL;
            }
        },
    });

    const jsonArg = (expression: string, anchor: RegExp): string | null => {
        const match = anchor.exec(expression);
        return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
    };
    const selectorArg = (expression: string): string =>
        jsonArg(expression, /document\.querySelector\(("(?:[^"\\]|\\.)*")\)/) ?? '';

    return {
        async goto(target: string) {
            calls.push(`goto:${target}`);
            url = options.landedUrl ?? target;
        },
        url: () => url,
        locator(selector: string) {
            return { first: () => leaf(selector), count: async () => attached(selector) };
        },
        async setInputFiles(selector: string, files: string | readonly string[]) {
            const path = Array.isArray(files) ? files[0] : files;
            calls.push(`setInputFiles:${selector}|${path}`);
            assignedCoverPath = path;
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 44)}`);
            if (expression.includes('kk-sspai-input-value')) {
                return SELECTORS.titleInput.includes(selectorArg(expression))
                    ? options.titleReadbackDrops === true
                        ? ''
                        : titleValue
                    : '';
            }
            if (expression.includes('kk-sspai-cover-assigned')) {
                return JSON.stringify({
                    assigned: assignedCoverPath !== null && options.coverReadbackDrops !== true,
                });
            }
            if (expression.includes('kk-sspai-editor-readback')) {
                const html = jsonArg(expression, /probe\.innerHTML = ("(?:[^"\\]|\\.)*");/) ?? '';
                const editorText = options.bodyReadbackDrops === true ? '' : plainText(editorHtml);
                return JSON.stringify({
                    ok: editorText.length > 0 && squish(editorText) === squish(plainText(html)),
                });
            }
            if (expression.includes('kk-sspai-persisted')) {
                const wantedTitle =
                    jsonArg(expression, /squish\(title\.value\) === squish\(("(?:[^"\\]|\\.)*")\)/) ?? '';
                const wantedHtml = jsonArg(expression, /probe\.innerHTML = ("(?:[^"\\]|\\.)*");/) ?? '';
                const healthy = options.persistedStateDrifts !== true;
                const editorText = options.bodyReadbackDrops === true ? '' : plainText(editorHtml);
                return JSON.stringify({
                    titleOk: healthy && squish(titleValue) === squish(wantedTitle),
                    editorOk: healthy && editorText.length > 0 && squish(editorText) === squish(plainText(wantedHtml)),
                    coverOk: !expression.includes('files[0].name') || assignedCoverPath !== null,
                });
            }
            if (expression.includes('kk-sspai-receipt-urls')) {
                const urls: string[] = [];
                if (receiptShaped(url)) urls.push(url);
                const anchor = options.existingReceiptUrl;
                if (anchor !== undefined && receiptShaped(anchor) && !urls.includes(anchor)) urls.push(anchor);
                return JSON.stringify(urls);
            }
            if (expression.includes("ClipboardEvent('paste'")) {
                const html = jsonArg(expression, /data\.setData\('text\/html', ("(?:[^"\\]|\\.)*")\)/) ?? '';
                calls.push(`pasteHtml:${selectorArg(expression)}|${html}`);
                editorHtml = html;
                return true;
            }
            if (expression.includes("el.textContent ?? ''")) {
                return (options.bodyReadbackDrops === true ? '' : plainText(editorHtml)).trim();
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

function transport(fake: LauncherHandle, stepTimeoutMs = 250): SspaiBrowserTransport {
    return new SspaiBrowserTransport('article', 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.SSPAI_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.SSPAI_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.SSPAI_PROFILE_DIR;
    else process.env.SSPAI_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

/** Reads the comment block immediately above a declaration and asserts the Provisional label. */
function expectProvisionalLabel(src: string, declaration: string): void {
    const before = src.slice(0, src.indexOf(declaration));
    const close = before.lastIndexOf('*/');
    const open = before.lastIndexOf('/**', close);
    expect(before.slice(open, close + 2)).toContain('Provisional');
}

describe('sspai-pub declared surface and manifest', () => {
    test('the article selector table covers exactly the five flow roles, grounded pairs first', () => {
        expect(Object.keys(SELECTORS).sort()).toEqual(
            ['bodyEditor', 'coverInput', 'draftSave', 'previewButton', 'titleInput'].sort(),
        );
        // The grounded pair must never be empty — the readiness probe asserts on it.
        expect(SELECTORS.titleInput.length).toBeGreaterThan(0);
        expect(SELECTORS.bodyEditor.length).toBeGreaterThan(0);
        // The cover input is scoped to the active article editor's form only — the source's
        // page-first shape is deliberately not a fallback (an unrelated global input could be
        // "verified" by mistake), and the contenteditable node itself cannot host the input
        // (the body paste replaces the editor's children).
        expect(SELECTORS.coverInput).toEqual(['form:has(div[contenteditable="true"]) input[type="file"]']);
        // The draft-save leg is exact-text only, most specific wording first, no broad fallback.
        expect([...SELECTORS.draftSave]).toEqual(['button:text-is("保存草稿")', 'button:text-is("保存")']);
        expect(SELECTORS.previewButton).toEqual(['a.editor-extra-button-preview']);
    });

    test('home/edit URLs and the login marker/receipt shapes partition the page states', () => {
        expect(SSPAI_HOME_URL).toBe('https://sspai.com/');
        expect(SSPAI_EDIT_URL).toBe('https://sspai.com/post/write');
        expect(SSPAI_LOGIN_URL_RE.test(SIGNIN_URL)).toBe(true);
        expect(SSPAI_LOGIN_URL_RE.test('https://sspai.com/signin')).toBe(true);
        expect(SSPAI_LOGIN_URL_RE.test(SSPAI_EDIT_URL)).toBe(false);
        expect(SSPAI_RECEIPT_URL_RES.some((re) => re.test(DRAFT_RECEIPT_URL))).toBe(true);
        expect(SSPAI_RECEIPT_URL_RES.some((re) => re.test('https://sspai.com/me/drafts/999'))).toBe(true);
        expect(SSPAI_RECEIPT_URL_RES.some((re) => re.test(SSPAI_EDIT_URL))).toBe(false);
    });

    test('only the article operation is declared, with metadata fallback and options precedence', () => {
        expect([...SSPAI_OPERATIONS]).toEqual(['article']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'article' });
        expect(resolveOperation(undefined, { ...draftContent, metadata: { operation: 'article' } })).toEqual({
            operation: 'article',
        });
        const unknown = resolveOperation({ operation: 'page' }, draftContent);
        expect(unknown.error).toContain(`unsupported operation 'page' for sspai: expected one of article`);
        const fallback = resolveOperation(undefined, { ...draftContent, metadata: { operation: 'note' } });
        expect(fallback.error).toContain('note');
        const precedence = resolveOperation(
            { operation: 'article' },
            { ...draftContent, metadata: { operation: 'note' } },
        );
        expect(precedence).toEqual({ operation: 'article' });
    });

    test('plugin.json declares the publish kind, entry, check and the sspai browser session', async () => {
        const manifest = JSON.parse(await readFile(join(import.meta.dir, '..', 'plugin.json'), 'utf-8')) as Record<
            string,
            unknown
        >;
        expect(manifest.name).toBe('sspai-pub');
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        expect(manifest.browserSession).toMatchObject({ profileName: 'sspai', homeUrl: 'https://sspai.com/' });
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
        expect(getPublishTransport('article')).toBeInstanceOf(SspaiBrowserTransport);
    });

    test('the readiness predicate passes only on the site-owned editor — a 登录 body alone is no session', async () => {
        const editor = makeFakePage({}, []);
        await editor.goto(SSPAI_EDIT_URL);
        expect(await isSspaiAuthenticated(editor)).toBe(true);
        // A page showing only the logged-out body (no `textarea` title input) refuses even on the
        // edit URL — sspai.js:60 reads the missing editor as 未登录, body text is never read.
        const loggedOut = makeFakePage({ groundedMissing: true }, []);
        await loggedOut.goto(SSPAI_EDIT_URL);
        expect(await isSspaiAuthenticated(loggedOut)).toBe(false);
        // A login/passport redirect refuses even when the composer is otherwise rendered.
        const signin = makeFakePage({ landedUrl: SIGNIN_URL }, []);
        await signin.goto(SSPAI_EDIT_URL);
        expect(await isSspaiAuthenticated(signin)).toBe(false);
    });
});

describe('sspai-pub refusals before any browser', () => {
    test('publishStatus public is REFUSED (draft-only slice) with zero launches', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('saves drafts only');
        expect(result.error).toContain(`metadata.publishStatus 'public' is refused before any browser opens`);
        expect(result.error).toContain(`omit publishStatus or pass 'draft'`);
        expect(fake.requests).toHaveLength(0);
    });

    test('an unknown publishStatus refuses with the expected set and zero launches', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { publishStatus: 'scheduled' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`unknown publishStatus 'scheduled' for sspai`);
        expect(result.error).toContain(`expected 'draft' or absent`);
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty title and an empty body are refused by name, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const noTitle = await transport(fake).publish({
            content: { title: '   ', body: 'Body', format: 'markdown' },
        });
        expect(noTitle.ok).toBe(false);
        expect(noTitle.error).toContain('sspai article requires a non-empty Content.title');

        const noBody = await transport(fake).publish({
            content: { title: 'Title', body: '   ', format: 'markdown' },
        });
        expect(noBody.ok).toBe(false);
        expect(noBody.error).toContain('sspai article requires non-empty Content.body Markdown');
        expect(fake.requests).toHaveLength(0);
    });

    test('unsupported images/tags/categories refuse by container+key, before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...draftContent, metadata: { images: ['https://example.com/a.png'] } },
            options: { images: ['https://example.com/b.png'], tags: ['后端'], categories: ['前端'] },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            'unsupported field(s) options.images, options.tags, options.categories, metadata.images for sspai',
        );
        expect(result.error).toContain('title/body/cover only');
        expect(result.error).toContain('implements none of images/tags/categories');
        expect(fake.requests).toHaveLength(0);
    });

    test('a requested cover that is not a readable nonempty PNG/JPEG/WebP refuses, never a silent skip', async () => {
        const fake = makeFakeLauncher();
        const badExtension = await transport(fake).publish({
            content: draftContent,
            options: { coverPath: join(TMP_DIR, 'cover.gif') },
        });
        expect(badExtension.ok).toBe(false);
        expect(badExtension.error).toContain('metadata.coverPath must be a local PNG/JPEG/WebP file');
        expect(badExtension.error).toContain('unsupported extension');

        const nonexistent = await transport(fake).publish({
            content: draftContent,
            options: { coverPath: join(TMP_DIR, 'missing.png') },
        });
        expect(nonexistent.ok).toBe(false);
        expect(nonexistent.error).toContain('metadata.coverPath does not resolve to a readable nonempty local file');
        expect(nonexistent.error).toContain('never a silent skip');

        const emptyPath = join(TMP_DIR, 'empty.png');
        await writeFile(emptyPath, '');
        const empty = await transport(fake).publish({ content: draftContent, options: { coverPath: emptyPath } });
        expect(empty.ok).toBe(false);
        expect(empty.error).toContain('does not resolve to a readable nonempty local file');

        const notString = await transport(fake).publish({
            content: { ...draftContent, metadata: { coverPath: 42 } },
        });
        expect(notString.ok).toBe(false);
        expect(notString.error).toContain('metadata.coverPath must be a non-empty local file path when present');
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-script driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new SspaiBrowserTransport('article', 'agent', { launcher: fake.launcher });
        const result = await agent.publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(`unsupported driver 'agent'`);
        expect(result.error).toContain('expected one of script');
        expect(fake.requests).toHaveLength(0);
    });
});

describe('sspai-pub sanitizer (markdownToHtml then plugin-local strip)', () => {
    test('script/style/iframe/embed/object containers, on* attrs and javascript: URLs are stripped', () => {
        const sanitized = sanitizeArticleHtml(
            [
                '<p onclick="evil()">keep</p>',
                '<script>alert(1)</script>',
                '<style>.x{}</style>',
                '<iframe src="https://evil.example"></iframe>',
                '<embed src="x.swf">',
                '<object data="x.swf"></object>',
                '<a href="javascript:alert(4)">x</a>',
            ].join('\n'),
        );
        expect(sanitized).not.toMatch(/<script|<style|<iframe|<embed|<object/i);
        expect(sanitized).not.toMatch(/\son[a-z]+\s*=|javascript:/i);
        expect(sanitized).toContain('keep');
    });

    test('heading/code/list markup survives sanitization', () => {
        const sanitized = sanitizeArticleHtml(markdownToHtml('# T\n\n- a\n\n```js\nconst x = 1;\n```'));
        expect(sanitized).toContain('<h1>T</h1>');
        expect(sanitized).toContain('<ul>');
        expect(sanitized).toContain('<li>a</li>');
        expect(sanitized).toContain('<pre><code');
    });

    test('the paste HTML captured by the fake page is exactly the sanitized chain output', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({ content: { ...draftContent, body: dirtyBody } });
        expect(result.ok).toBe(true);
        const pasted =
            fake.calls
                .find((call) => call.startsWith(`pasteHtml:${BODY_EDITOR}|`))
                ?.split('|')
                .slice(1)
                .join('|') ?? '';
        expect(pasted).toBe(sanitizeArticleHtml(markdownToHtml(dirtyBody)));
        expect(pasted).toContain('<h1>Heading</h1>');
        expect(pasted).toContain('<ul>');
        expect(pasted).toContain('<pre><code');
        expect(pasted).toContain('<img src="https://example.com/a.png">');
        expect(pasted).not.toMatch(/<script|<iframe|onerror/i);
    });
});

describe('sspai-pub payload mapping and --in/--out IO (FakeBrowserTransport)', () => {
    test('processPublishIO publishes offline on the fake transport and writes a schema-valid Result', async () => {
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'nested', 'out.json');
        await writeFile(inPath, JSON.stringify(draftContent));
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

    test('fake mode does not bypass the deterministic refusals: public/unknown publishStatus refuses offline', async () => {
        // No transport injection: the real transport's pre-browser ladder refuses offline even so.
        const inPath = join(TMP_DIR, 'status-in.json');
        const outPath = join(TMP_DIR, 'status-out.json');
        await writeFile(inPath, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'public' } }));
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/saves drafts only/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('sspai');
        expect(written.error?.split('\n')).toHaveLength(1);

        const unknownIn = join(TMP_DIR, 'unknown-in.json');
        const unknownOut = join(TMP_DIR, 'unknown-out.json');
        await writeFile(unknownIn, JSON.stringify({ ...draftContent, metadata: { publishStatus: 'archived' } }));
        await expect(processPublishIO(unknownIn, unknownOut)).rejects.toThrow(/unknown publishStatus 'archived'/);
        expect(ResultSchema.parse(JSON.parse(await readFile(unknownOut, 'utf-8'))).ok).toBe(false);
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
        await writeFile(driverIn, JSON.stringify({ ...draftContent, options: { driver: 'agent' } }));
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
            expect(errTarget.text()).toContain('sspai-pub failed:');
        } finally {
            restore();
            process.argv = origArgv;
        }
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error).toContain("unknown publishStatus 'unlisted'");
    });
});

describe('sspai-pub session preflight', () => {
    test('an unauthenticated session refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: SIGNIN_URL });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('sspai session preflight refused');
        expect(result.error).toContain(`run: ${SSPAI_LOGIN_INSTRUCTION}`);
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
        const result = await new SspaiBrowserTransport('article', 'script', { launcher }).publish({
            content: draftContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(`no sspai browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(SSPAI_LOGIN_INSTRUCTION);
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
        const result = await new SspaiBrowserTransport('article', 'script', { launcher, stepTimeoutMs: 250 }).publish({
            content: draftContent,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('sspai session failed');
        expect(result.error).toContain(SSPAI_LOGIN_INSTRUCTION);
        expect(requests.map((request) => request.headless)).toEqual([true, false]);
    });
});

describe('sspai-pub article flow (offline fake page)', () => {
    test('absent publishStatus defaults to draft: the exact 保存草稿 control confirms a fresh receipt URL', async () => {
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
            confirmedBy: 'draft-receipt',
        });
        expect(fake.calls).toContain(`fill:${TITLE_INPUT}|Parity`);
        expect(fake.calls.some((call) => call.startsWith(`pasteHtml:${BODY_EDITOR}|<p>Body text</p>`))).toBe(true);
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
        // The preview control is never clicked in the draft path.
        expect(fake.calls.some((call) => call === `click:${PREVIEW_BUTTON}`)).toBe(false);
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

    test('a requested cover is setInputFiles-assigned, verified, and read back at save time', async () => {
        const coverPath = join(TMP_DIR, 'cover.png');
        await writeFile(coverPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const fake = makeFakeLauncher({ onDraftSave: 'freshId' });
        const result = await transport(fake).publish({ content: draftContent, options: { coverPath } });
        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(true);
        expect(result.metadata).toMatchObject({ confirmedBy: 'draft-receipt' });
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

    test('a composer missing the body editor refuses at the preflight — the missing editor is the logged-out marker', async () => {
        // sspai.js:60 reads the missing contenteditable editor as 未登录, so the readiness
        // predicate gates on BOTH grounded controls: a partially-rendered composer never passes
        // preflight, and no headed flow ever opens (one headless pass, then the typed refusal).
        const fake = makeFakeLauncher({ missingBodyEditor: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('sspai session preflight refused');
        expect(result.error).toContain(SSPAI_LOGIN_INSTRUCTION);
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        expect(fake.closeCount()).toBe(1);
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a dropped title is refused at the title-readback stage, never filled forward or saved', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('sspai title readback failed');
        expect(fake.calls.some((call) => call.startsWith('pasteHtml:'))).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a page crash during the title fill is reported without the login hint', async () => {
        const fake = makeFakeLauncher({ fillThrows: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('sspai title fill failed');
        expect(result.error).toContain('sspai editor page crashed on fill');
        expect(result.error).not.toContain(SSPAI_LOGIN_INSTRUCTION);
    });

    test('a requested cover with no file input is a typed cover-attach failure, never a silent skip', async () => {
        const coverPath = join(TMP_DIR, 'cover.png');
        await writeFile(coverPath, 'png-bytes');
        const fake = makeFakeLauncher({ onDraftSave: 'freshId', missingCoverInput: true });
        const result = await transport(fake).publish({ content: draftContent, options: { coverPath } });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-attach' });
        expect(result.error).toContain('sspai cover attach failed');
        expect(fake.calls.some((call) => call.startsWith('pasteHtml:'))).toBe(false);
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a cover that lands but never verifies its assignment refuses instead of claiming success', async () => {
        const coverPath = join(TMP_DIR, 'cover.png');
        await writeFile(coverPath, 'png-bytes');
        const fake = makeFakeLauncher({ onDraftSave: 'freshId', coverReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent, options: { coverPath } });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-attach' });
        expect(result.error).toContain('cover assignment could not be verified');
        expect(result.error).toContain('refusing rather than claiming an unverified cover');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a dropped paste is refused at the body-paste-readback stage before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'body-paste-readback' });
        expect(result.error).toContain('sspai body paste failed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('the preview control is probed read-only, reported, and never clicked in the draft path', async () => {
        const present = makeFakeLauncher({ onDraftSave: 'freshId' });
        const ok = await transport(present).publish({ content: draftContent });
        expect(ok.ok).toBe(true);
        expect(ok.metadata?.previewButtonObserved).toBe(true);
        expect(present.calls.some((call) => call === `click:${PREVIEW_BUTTON}`)).toBe(false);

        const absent = makeFakeLauncher({ onDraftSave: 'freshId', previewPresent: false });
        const okAbsent = await transport(absent).publish({ content: draftContent });
        expect(okAbsent.ok).toBe(true);
        expect(okAbsent.metadata?.previewButtonObserved).toBe(false);
    });

    test('a missing save control is a typed draft-save failure, never a manufactured draft', async () => {
        const fake = makeFakeLauncher({ saveMissing: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('draft-save control never attached');
        expect(result.error).toContain('not a manufactured draft');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a hidden or never-clickable save control refuses at its own leg, before any click', async () => {
        const hidden = makeFakeLauncher({ saveInvisible: true });
        const hiddenResult = await transport(hidden).publish({ content: draftContent });
        expect(hiddenResult.ok).toBe(false);
        expect(hiddenResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(hiddenResult.error).toContain('attached but not visible');
        expect(hidden.calls.some((call) => call.startsWith('click:'))).toBe(false);

        const disabled = makeFakeLauncher({ submitNeverEnabled: true, onDraftSave: 'freshId' });
        const disabledResult = await transport(disabled).publish({ content: draftContent });
        expect(disabledResult.ok).toBe(false);
        expect(disabledResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(disabledResult.error).toContain('draft-save control never became clickable');
        expect(disabled.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('an idless state (stale receipt on screen, no fresh gain) is a typed draft-receipt failure', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingReceiptUrl: DRAFT_RECEIPT_URL });
        const result = await transport(fake).publish({ content: draftContent });

        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('draft-receipt not confirmed');
        expect(result.metadata?.evidence).toContain('1 pre-existing receipt-shaped url(s)');
        expect(result.metadata?.evidence).toContain('not clicked');
        expect(fake.calls).toContain(`click:${DRAFT_SAVE}`);
    });

    test('a toast-only signal (which this flow never reads) never confirms the save', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'none', existingToasts: ['保存成功'] });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('never a saved draft');
    });

    test('a fresh receipt whose persisted state no longer matches refuses instead of claiming success', async () => {
        const fake = makeFakeLauncher({ onDraftSave: 'freshId', persistedStateDrifts: true });
        const result = await transport(fake).publish({ content: draftContent });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('no longer matches the requested content');
    });
});

describe('sspai-pub source hygiene (no eval, one sanitized paste, no vendor endpoints)', () => {
    test('no eval/new Function and no upload/vendor endpoint machinery in src', async () => {
        const sources = [
            await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8'),
        ];
        for (const src of sources) {
            expect(src).not.toMatch(/\beval\(|new Function/);
            expect(src).not.toMatch(/fetch\(|XMLHttpRequest/i);
            expect(src).not.toMatch(/x-ca-|x-obs-|myhuaweicloud|ObsClient|upload\.cnblogs/i);
        }
    });

    test('exactly one paste site and it is the sanitize(markdownToHtml) chain; click sites touch only the save control', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        // The only pasteHtml call feeds the sanitized chain output, never raw body markdown.
        expect(flow.match(/pasteHtml\(/g)).toHaveLength(1);
        expect(flow).toContain('const html = sanitizeArticleHtml(markdownToHtml(body));');
        expect(flow).toContain('pasteHtml(page, editorSelector, html,');
        // The preview control is only probed (visible:false); every `.click(` site is the save control.
        expect(flow.match(/\.click\(/g)?.every((occurrence) => occurrence === '.click(') ?? false).toBe(true);
        const clickLines = flow.split('\n').filter((line) => /\.click\(/.test(line));
        expect(clickLines.length).toBeGreaterThan(0);
        for (const line of clickLines) expect(line).toContain('saveButton');
        const previewLine = flow.split('\n').find((line) => line.includes('previewButton'));
        expect(previewLine).toContain('trySelectors');
    });

    test('the provisional selectors and URLs carry their Provisional labels', async () => {
        const selectors = await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8');
        expectProvisionalLabel(selectors, 'export const SSPAI_EDIT_URL');
        expectProvisionalLabel(selectors, 'export const SSPAI_LOGIN_URL_RE');
        expectProvisionalLabel(selectors, 'export const SSPAI_RECEIPT_URL_RES');
        expectProvisionalLabel(selectors, 'draftSave:');
        // Grounded controls are labeled Grounded, never Provisional.
        const groundedBlock = selectors.slice(
            selectors.indexOf('/** Title textarea.'),
            selectors.indexOf('coverInput:'),
        );
        expect(groundedBlock).toContain('**Grounded**');
        expect(groundedBlock).not.toContain('Provisional');
    });
});

describe('sspai-pub environment restoration', () => {
    test('no sspai profile env leaks between suites', () => {
        expect(process.env.SSPAI_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
