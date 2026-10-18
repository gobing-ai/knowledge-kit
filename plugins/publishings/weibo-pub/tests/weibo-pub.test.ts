import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { runProfileCli } from '@gobing-ai/publish-harness/browser';
import type { BrowserLauncher, ProfileLaunchRequest } from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    LOGIN_INSTRUCTION,
    LOGIN_URL_RE,
    main,
    processPublishIO,
    resolveOperation,
    WEIBO_ARTICLE_SELECTORS,
    WEIBO_ARTICLE_URL,
    WEIBO_CONFIG,
    WEIBO_HOME_URL,
    WEIBO_MOBILE_COMPOSE_URL,
    WEIBO_OPERATIONS,
    WEIBO_POST_SELECTORS,
    WeiboBrowserTransport,
} from '../src/index';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-weibo-pub');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'weibo');
const LOGIN_URL = 'https://passport.weibo.com/sso/login?entry=weibo';
const DRAFT_URL = 'https://card.weibo.com/article/v3/editor?draft_id=4901234567890';
const ARTICLE_LIVE_URL = 'https://weibo.com/ttarticle/p/show?id=2309404901234567890';
const STATUS_URL = 'https://weibo.com/1234567890/PabcDEF123';
/** Mobile success shape: the composer navigates to `/detail/<id>` — the URL carries the new id. */
const MOBILE_STATUS_URL = 'https://m.weibo.cn/detail/5001234567890';
const COVER_PATH = join(TMP_DIR, 'cover.png');

const content: Content = { title: 'Parity', body: 'Body text', format: 'markdown' };
const liveContent: Content = { ...content, metadata: { publishStatus: 'public' } };
const livePost: Content = {
    title: 'Hello',
    body: 'Hello Weibo',
    format: 'markdown',
    metadata: { publishStatus: 'public' },
};

/** Every fake-page dial a weibo flow can observe. */
interface FakePageOptions {
    /** URL the readiness predicate sees after `goto` — a login URL means the session expired. */
    landedUrl?: string;
    /** The home composer never attaches (a page that is not the feed). */
    missingComposer?: boolean;
    /** The article title field never attaches. */
    missingTitle?: boolean;
    /** The article body editor never attaches. */
    missingBody?: boolean;
    /** The paste leaves the editor empty, so `pasteHtml`'s post-condition must fail. */
    emptyPaste?: boolean;
    /** Readback returns nothing, so the composer read-back check must fail. */
    emptyReadback?: boolean;
    /** The cover never renders, so the attachment signal must fail. */
    coverAttached?: boolean;
    /** What clicking 保存草稿 emits. */
    onSaveDraft?: 'url' | 'toast' | 'none';
    /** What clicking the article publish control emits. */
    onPublish?: 'article' | 'none';
    /** What clicking 发送 emits: a feed card, the mobile composer's own navigation, or nothing. */
    onSend?: 'feedCard' | 'mobileUrl' | 'none';
    /** First visible dialog/verification text on the page, as the R5 diagnostic reads it. */
    dialogText?: string;
    /** A fresh failure toast the send emits (the site's own reason for a rejected post). */
    sendFailureToast?: string;
    /** Toasts already on screen before any click (a stale signal). */
    existingToasts?: string[];
    /** Feed-card hrefs already on screen before the send (a stale signal). */
    existingFeed?: string[];
    /** Text of the card the send creates; defaults to the submitted composer text. */
    feedText?: string;
    /** What the page's own mobile API answers to a submit: an id (success) or a status/detail. */
    apiSubmit?: { id?: string; status?: number; detail?: string };
    /** The image id the composer exposes after an upload; '' means "not readable". */
    picId?: string;
    /** A fresh toast the submit emits (the site's own reason for a rejection). */
    submitFailureToast?: string;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

/**
 * Fake `Page` over the primitives the flow may use (`goto`, `url`, `locator`, `evaluate`,
 * `setInputFiles`). Signals are scripted per option so a stale signal, a dropped field and an
 * unobserved outcome are all reachable.
 */
function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let url = 'about:blank';
    let editorText = 'Body text';
    let images = 0;
    const values = new Map<string, string>();
    const toasts = [...(options.existingToasts ?? [])];
    const cards: Array<{ href: string; text: string }> = (options.existingFeed ?? []).map((href) => ({
        href,
        text: 'existing card',
    }));

    const post = WEIBO_POST_SELECTORS as unknown as Record<string, readonly string[]>;
    const article = WEIBO_ARTICLE_SELECTORS as unknown as Record<string, readonly string[]>;

    const attached = (selector: string): number => {
        if (post.composer?.includes(selector)) return options.missingComposer === true ? 0 : 1;
        if (article.title?.includes(selector)) return options.missingTitle === true ? 0 : 1;
        if (article.body?.includes(selector)) return options.missingBody === true ? 0 : 1;
        return 1;
    };

    const leaf = (selector: string) => ({
        count: async () => attached(selector),
        isVisible: async () => attached(selector) > 0,
        fill: async (text: string) => {
            calls.push(`fill:${selector}|${text}`);
            values.set(selector, text);
        },
        click: async () => {
            calls.push(`click:${selector}`);
            if (article.saveDraft?.includes(selector)) {
                if (options.onSaveDraft === 'url') url = DRAFT_URL;
                if (options.onSaveDraft === 'toast') toasts.push('保存成功');
            }
            if (article.publish?.includes(selector) && options.onPublish === 'article') url = ARTICLE_LIVE_URL;
            if (post.send?.includes(selector) && options.onSend === 'feedCard') {
                cards.push({
                    href: STATUS_URL,
                    text: options.feedText ?? values.get(post.composer?.[0] ?? '') ?? 'Hello Weibo',
                });
            }
            if (post.send?.includes(selector) && options.onSend === 'mobileUrl') url = MOBILE_STATUS_URL;
            if (post.send?.includes(selector) && options.sendFailureToast !== undefined) {
                toasts.push(options.sendFailureToast);
            }
        },
    });

    const scriptArg = (expression: string): string => {
        const match = /document\.querySelector\("((?:[^"\\]|\\.)*)"\)/.exec(expression);
        return match?.[1] === undefined ? '' : (JSON.parse(`"${match[1]}"`) as string);
    };

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
            if (options.coverAttached !== false) images += 1;
        },
        async evaluate(expression: string) {
            calls.push(`evaluate:${expression.slice(0, 40)}`);
            if (expression.includes('ClipboardEvent')) {
                editorText = options.emptyPaste === true ? '' : 'Body text';
                return true;
            }
            if (expression.includes('kk-weibo-readback')) {
                if (options.emptyReadback === true) return '';
                const selector = scriptArg(expression);
                return values.get(selector) ?? editorText;
            }
            if (expression.includes('kk-weibo-cover')) return String(images);
            if (expression.includes('kk-weibo-picid')) return options.picId ?? '';
            if (expression.includes('kk-weibo-submit')) {
                const api = options.apiSubmit ?? {};
                calls.push(expression.includes('pic_id') ? 'submit:with-pic' : 'submit:no-pic');
                if (options.submitFailureToast !== undefined) toasts.push(options.submitFailureToast);
                const id = api.id ?? '';
                return JSON.stringify({
                    status: api.status ?? (id === '' ? 500 : 200),
                    id,
                    detail: id === '' ? (api.detail ?? '{"ok":0}') : '',
                });
            }
            if (expression.includes('kk-weibo-dialog')) return options.dialogText ?? '';
            if (expression.includes('kk-weibo-toasts')) return JSON.stringify(toasts);
            if (expression.includes('kk-weibo-feed')) return JSON.stringify(cards.map((card) => card.href));
            if (expression.includes('kk-weibo-card-text')) {
                // The probe skips non-matching links (`link.href !== "..."`) before reading the card.
                const href = JSON.parse(
                    expression.slice(expression.indexOf('link.href !== ') + 14).split(')')[0] ?? '""',
                );
                return cards.find((card) => card.href === href)?.text ?? '';
            }
            return editorText;
        },
    };
    return page as unknown as Page;
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

function transport(fake: LauncherHandle, operation: 'post' | 'article' = 'article', stepTimeoutMs = 250) {
    return new WeiboBrowserTransport(operation, 'script', { launcher: fake.launcher, stepTimeoutMs });
}

const originalChannelDir = process.env.WEIBO_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

beforeEach(async () => {
    delete process.env.WEIBO_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(COVER_PATH, 'png');
});

afterEach(async () => {
    if (originalChannelDir === undefined) delete process.env.WEIBO_PROFILE_DIR;
    else process.env.WEIBO_PROFILE_DIR = originalChannelDir;
    if (originalSharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalSharedDir;
    if (originalFake === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalFake;
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('weibo-pub refusals before any browser (R3, R5, R8)', () => {
    test('only post and article are declared; an unknown operation is refused by name', () => {
        expect([...WEIBO_OPERATIONS]).toEqual(['post', 'article']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'post' });
        expect(resolveOperation({ operation: 'article' }, content)).toEqual({ operation: 'article' });
        const mode = resolveOperation({ operation: 'repost' }, content);
        expect(mode.error).toContain("unsupported operation 'repost'");
        expect(mode.error).toContain('post, article');
        expect(resolveOperation(undefined, { ...content, metadata: { operation: 'dm' } })?.error).toContain('dm');
    });

    test('operation precedence: options.operation wins over metadata.operation', () => {
        const both = resolveOperation({ operation: 'article' }, { ...content, metadata: { operation: 'post' } });
        expect(both).toEqual({ operation: 'article' });
    });

    test('an injected transport refuses an unknown operation by name without a launch', async () => {
        const fake = makeFakeLauncher();
        const unknown = new WeiboBrowserTransport('repost' as never, 'script', { launcher: fake.launcher });
        const result = await unknown.publish({ content: livePost });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported operation 'repost'");
        expect(fake.requests).toHaveLength(0);
    });

    test('the agent driver is refused by name with the supported set, before any launch', async () => {
        const fake = makeFakeLauncher();
        const agent = new WeiboBrowserTransport('article', 'agent' as never, { launcher: fake.launcher });
        const result = await agent.publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported driver 'agent'");
        expect(result.error).toContain('script');
        expect(fake.requests).toHaveLength(0);
    });

    test('processPublishIO refuses a driver option before resolving a transport', async () => {
        const fake = new FakeBrowserTransport('script');
        const inPath = join(TMP_DIR, 'driver-in.json');
        const outPath = join(TMP_DIR, 'driver-out.json');
        await writeFile(
            inPath,
            JSON.stringify({ title: 'T', body: 'B', format: 'markdown', options: { driver: 'agent' } }),
        );
        await expect(processPublishIO(inPath, outPath, fake)).rejects.toThrow(/unsupported driver 'agent'/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.target).toBe('weibo');
    });

    test('an unknown publishStatus is refused pre-browser', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: { ...content, metadata: { publishStatus: 'unlisted' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unknown publishStatus 'unlisted'");
        expect(fake.requests).toHaveLength(0);
    });

    test('a post without publishStatus public is refused before any browser opens', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'post').publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('weibo post has no draft; set publishStatus: public');
        expect(fake.requests).toHaveLength(0);
    });

    test('an empty post text is refused pre-browser', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'post').publish({
            content: { body: '   ', title: '  ', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Content.body or Content.title');
        expect(fake.requests).toHaveLength(0);
    });

    test('a relative, wrong-extension or missing cover is refused before any browser opens', async () => {
        const fake = makeFakeLauncher();
        for (const coverPath of ['cover.png', '/tmp/cover.txt', join(TMP_DIR, 'absent.png')]) {
            const result = await transport(fake).publish({ content, options: { coverPath } });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('image');
        }
        expect(fake.requests).toHaveLength(0);
    });

    test('an article cover outside .png/.jpg/.jpeg/.webp is refused pre-browser; a post still takes a gif', async () => {
        const gif = join(TMP_DIR, 'cover.gif');
        await writeFile(gif, 'gif');
        const refused = makeFakeLauncher();
        const article = await transport(refused).publish({ content, options: { coverPath: gif } });
        expect(article.ok).toBe(false);
        expect(article.error).toContain('.png, .jpg, .jpeg, .webp');
        expect(refused.requests).toHaveLength(0);

        const accepted = makeFakeLauncher({ apiSubmit: { id: '5001' }, picId: 'PIC123' });
        const post = await transport(accepted, 'post').publish({ content: livePost, options: { coverPath: gif } });
        expect(post.ok).toBe(true);
    });
});

describe('weibo-pub session preflight (R6)', () => {
    test('an absent or unauthenticated profile refuses with the login command and one headless pass', async () => {
        const fake = makeFakeLauncher({ landedUrl: LOGIN_URL });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(LOGIN_INSTRUCTION);
        expect(LOGIN_URL_RE.test(LOGIN_URL)).toBe(true);
        // One headless pass only: no headed window ever opens on a refused preflight.
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        // The preflight closes the one context it opened; there is no second launch to close.
        expect(fake.closeCount()).toBe(1);
    });

    test('a missing profile is refused with the login command and no stack', async () => {
        const requests: ProfileLaunchRequest[] = [];
        const launcher: BrowserLauncher = {
            async launch(request) {
                requests.push(request);
                throw new Error('BrowserProfileMissingError: no profile');
            },
        };
        const result = await new WeiboBrowserTransport('article', 'script', { launcher }).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(requests).toHaveLength(1);
    });

    test('checkHeadedOnly on the config never makes the publish preflight headed', async () => {
        const previous = WEIBO_CONFIG.checkHeadedOnly;
        WEIBO_CONFIG.checkHeadedOnly = true;
        try {
            const fake = makeFakeLauncher({ landedUrl: LOGIN_URL });
            const result = await transport(fake).publish({ content });
            expect(result.ok).toBe(false);
            expect(fake.requests.map((request) => request.headless)).toEqual([true]);
        } finally {
            WEIBO_CONFIG.checkHeadedOnly = previous ?? false;
        }
    });
});

describe('weibo-pub article flow (R2, R4)', () => {
    test('a draft run clicks 保存草稿, never the publish control, and reports the draft URL', async () => {
        const fake = makeFakeLauncher({ onSaveDraft: 'url' });
        const result = await transport(fake).publish({ content });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_URL);
        expect(result.message).toContain('draft saved');
        expect(result.metadata).toEqual({
            operation: 'article',
            driver: 'script',
            publishStatus: 'draft',
            profileDir: DEFAULT_DIR,
        });
        expect(fake.calls.some((call) => call.startsWith(`click:${WEIBO_ARTICLE_SELECTORS.saveDraft[0]}`))).toBe(true);
        expect(fake.calls.some((call) => call.startsWith(`click:${WEIBO_ARTICLE_SELECTORS.publish[0]}`))).toBe(false);
        expect(fake.calls).toContain(`goto:${WEIBO_ARTICLE_URL}`);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.closeCount()).toBe(2);
    });

    test('a draft confirmed by a fresh 保存成功 toast is a success', async () => {
        const fake = makeFakeLauncher({ onSaveDraft: 'toast' });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(true);
        expect(result.url).toBe('保存成功');
    });

    test('a public run clicks the publish control and requires the published article URL', async () => {
        const fake = makeFakeLauncher({ onPublish: 'article' });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(ARTICLE_LIVE_URL);
        expect(result.id).toBe('2309404901234567890');
        expect(fake.calls.some((call) => call.startsWith(`click:${WEIBO_ARTICLE_SELECTORS.publish[0]}`))).toBe(true);
    });

    test('an already-visible toast is not draft evidence, and no signal is a refusal naming the step', async () => {
        const fake = makeFakeLauncher({ onSaveDraft: 'none', existingToasts: ['保存成功'] });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('weibo article draft');
        expect(result.error).toContain('no outcome observed within');
        expect(result.error).toContain('250ms');
    });

    test('a public run whose URL never leaves the editor is refused', async () => {
        const fake = makeFakeLauncher({ onPublish: 'none' });
        const result = await transport(fake).publish({ content: liveContent });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('weibo article publish');
    });

    test('an unreachable 头条文章 editor (the measured entitlement gate) is refused, never a silent draft', async () => {
        // Measured 2026-10-12 (task 0246, docs/design/weibo-ui-discovery.md §5): for an account without
        // the 头条文章 entitlement the legacy editor URL redirects to the home page, so no editor control
        // attaches. That must stay a loud refusal naming the step — never an ok:true draft that was not saved.
        const fake = makeFakeLauncher({ landedUrl: WEIBO_HOME_URL, missingTitle: true, missingBody: true });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('article title input');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a dropped title is refused on readback before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ emptyReadback: true });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('article title readback');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a missing body editor is refused naming the step', async () => {
        const fake = makeFakeLauncher({ missingBody: true });
        const result = await transport(fake).publish({ content });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('article body editor');
    });

    test('a cover upload is used and an unobserved attachment is refused', async () => {
        const ok = makeFakeLauncher({ onSaveDraft: 'url' });
        const uploaded = await transport(ok).publish({ content, options: { coverPath: COVER_PATH } });
        expect(uploaded.ok).toBe(true);
        expect(
            ok.calls.some((call) =>
                call.startsWith(`setInputFiles:${WEIBO_ARTICLE_SELECTORS.fileInput[0]}|${COVER_PATH}`),
            ),
        ).toBe(true);

        const refused = makeFakeLauncher({ onSaveDraft: 'url', coverAttached: false });
        const result = await transport(refused).publish({
            content: { ...content, metadata: { coverImage: COVER_PATH } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('cover attachment');
    });
});

describe('weibo-pub post flow (R3, R4, R9)', () => {
    test('a public post fills the mobile composer and submits through the page api', async () => {
        const fake = makeFakeLauncher({ apiSubmit: { id: '5001234567890' } });
        const result = await transport(fake, 'post').publish({ content: livePost });

        expect(result.ok).toBe(true);
        expect(result.id).toBe('5001234567890');
        expect(result.url).toBe('https://m.weibo.cn/detail/5001234567890');
        expect(fake.calls).toContain(`goto:${WEIBO_MOBILE_COMPOSE_URL}`);
        expect(fake.calls.some((call) => call.startsWith(`fill:${WEIBO_POST_SELECTORS.composer[0]}|Hello Weibo`))).toBe(
            true,
        );
        expect(fake.calls).toContain('submit:no-pic');
    });

    test('a one-image post uploads the cover and submits its pic id', async () => {
        const fake = makeFakeLauncher({ apiSubmit: { id: '5001' }, picId: 'PIC123' });
        const result = await transport(fake, 'post').publish({ content: livePost, options: { coverPath: COVER_PATH } });

        expect(result.ok).toBe(true);
        expect(
            fake.calls.some((call) =>
                call.startsWith(`setInputFiles:${WEIBO_POST_SELECTORS.fileInput[0]}|${COVER_PATH}`),
            ),
        ).toBe(true);
        expect(fake.calls).toContain('submit:with-pic');
    });

    test('an uploaded image whose id cannot be read is refused, never posted text-only', async () => {
        const fake = makeFakeLauncher({ apiSubmit: { id: '5001' } });
        const result = await transport(fake, 'post').publish({ content: livePost, options: { coverPath: COVER_PATH } });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('could not be read');
        expect(fake.calls.some((call) => call.startsWith('submit:'))).toBe(false);
    });

    test("a refused submit reports the site's own bounded error", async () => {
        const fake = makeFakeLauncher({
            apiSubmit: { status: 403, detail: '{"ok":0,"msg":"\u9700\u8981\u9a8c\u8bc1"}' },
        });
        const result = await transport(fake, 'post').publish({ content: livePost });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('mobile api refused');
        expect(result.error).toContain('HTTP 403');
    });

    test("an account-state refusal names the site's errno, message and activation link", async () => {
        const siteRefusal = JSON.stringify({
            ok: 0,
            errno: '200001',
            msg: '\u60a8\u7684\u5fae\u535a\u8d26\u53f7\u5904\u4e8e\u5f02\u5e38\u72b6\u6001\uff0c\u8bf7\u7acb\u5373\u6fc0\u6d3b\u8d26\u53f7',
            title: '\u8d26\u53f7\u5f02\u5e38',
            btn: { text: '\u7acb\u5373\u6fc0\u6d3b', url: 'http://m.weibo.cn/security?callback=http' },
        });
        const fake = makeFakeLauncher({ apiSubmit: { status: 200, detail: siteRefusal } });
        const result = await transport(fake, 'post').publish({ content: livePost });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('errno 200001');
        expect(result.error).toContain('\u60a8\u7684\u5fae\u535a\u8d26\u53f7\u5904\u4e8e\u5f02\u5e38\u72b6\u6001');
        expect(result.error).toContain('m.weibo.cn/security');
    });

    test('a failed submit reports the post-click diagnosis', async () => {
        const fake = makeFakeLauncher({
            apiSubmit: { status: 500, detail: 'boom' },
            dialogText: '\u8bf7\u5148\u5b8c\u6210\u624b\u673a\u9a8c\u8bc1',
            submitFailureToast: '\u53d1\u9001\u5931\u8d25',
        });
        const result = await transport(fake, 'post').publish({ content: livePost });

        expect(result.ok).toBe(false);
        expect(result.error).toContain('composer ');
        expect(result.error).toContain('\u8bf7\u5148\u5b8c\u6210\u624b\u673a\u9a8c\u8bc1');
        expect(result.error).toContain('site said: \u53d1\u9001\u5931\u8d25');
    });

    test('more than one image, a non-image path and an oversized file are refused by name', async () => {
        const fake = makeFakeLauncher({ apiSubmit: { id: '5001' } });
        const many = await transport(fake, 'post').publish({
            content: livePost,
            options: { images: [COVER_PATH, COVER_PATH] },
        });
        expect(many.ok).toBe(false);
        expect(many.error).toContain('only one image');
        const wrong = await transport(fake, 'post').publish({
            content: livePost,
            options: { coverPath: join(TMP_DIR, 'notes.txt') },
        });
        expect(wrong.ok).toBe(false);
        expect(wrong.error).toContain('.png, .jpg, .jpeg, .webp, .gif, .bmp');
        const big = join(TMP_DIR, 'big.png');
        await writeFile(big, Buffer.alloc(5 * 1024 * 1024 + 1));
        const oversized = await transport(fake, 'post').publish({ content: livePost, options: { coverPath: big } });
        expect(oversized.ok).toBe(false);
        expect(oversized.error).toContain('MB');
        expect(fake.requests).toHaveLength(0);
    });

    test('a blank body falls back to the title as the post text', async () => {
        const fake = makeFakeLauncher({ apiSubmit: { id: '5001' } });
        const result = await transport(fake, 'post').publish({
            content: { body: '  ', title: 'Only a title', format: 'markdown', metadata: { publishStatus: 'public' } },
        });
        expect(result.ok).toBe(true);
        expect(fake.calls.some((call) => call.includes('fill:') && call.includes('Only a title'))).toBe(true);
    });
});

describe('weibo-pub profile-check (R7)', () => {
    test('profile precedence is --profile > WEIBO_PROFILE_DIR > KK_BROWSER_PROFILE_DIR > default', async () => {
        const lines: string[] = [];
        const stdout = (line: string) => lines.push(line);

        const explicit = makeFakeLauncher();
        expect(
            await runProfileCli(WEIBO_CONFIG, ['check', '--profile', '/tmp/kk-weibo-flag'], {
                launcher: explicit.launcher,
                stdout,
            }),
        ).toBe(0);
        expect(explicit.requests[0]?.profileDir).toBe('/tmp/kk-weibo-flag');

        const channel = makeFakeLauncher();
        process.env.KK_BROWSER_PROFILE_DIR = '~/from-shared';
        process.env.WEIBO_PROFILE_DIR = '~/from-channel';
        expect(await runProfileCli(WEIBO_CONFIG, ['check'], { launcher: channel.launcher, stdout })).toBe(0);
        expect(channel.requests[0]?.profileDir).toBe(join(homedir(), 'from-channel'));

        const shared = makeFakeLauncher();
        delete process.env.WEIBO_PROFILE_DIR;
        expect(await runProfileCli(WEIBO_CONFIG, ['check'], { launcher: shared.launcher, stdout })).toBe(0);
        expect(shared.requests[0]?.profileDir).toBe(join(homedir(), 'from-shared'));

        const fallback = makeFakeLauncher();
        delete process.env.KK_BROWSER_PROFILE_DIR;
        expect(await runProfileCli(WEIBO_CONFIG, ['check'], { launcher: fallback.launcher, stdout })).toBe(0);
        expect(fallback.requests[0]?.profileDir).toBe(DEFAULT_DIR);
        expect(lines.every((line) => line.length > 0)).toBe(true);
    });

    test('exit codes are 0 verified, 1 refused and 2 usage', async () => {
        const lines: string[] = [];
        const stdout = (line: string) => lines.push(line);

        const verified = makeFakeLauncher();
        expect(await runProfileCli(WEIBO_CONFIG, ['check'], { launcher: verified.launcher, stdout })).toBe(0);

        const refused = makeFakeLauncher({ landedUrl: LOGIN_URL });
        expect(
            await runProfileCli(WEIBO_CONFIG, ['check', '--timeout', '300'], { launcher: refused.launcher, stdout }),
        ).toBe(1);

        expect(await runProfileCli(WEIBO_CONFIG, ['bogus'], { stdout })).toBe(2);
        expect(lines.join('\n')).toContain('usage');
    });

    test('the login command verifies the session through the shared CLI', async () => {
        const fake = makeFakeLauncher();
        const lines: string[] = [];
        const code = await runProfileCli(WEIBO_CONFIG, ['login'], {
            launcher: fake.launcher,
            stdout: (l) => lines.push(l),
        });
        expect(code).toBe(0);
        expect(fake.requests[0]?.headless).toBe(false);
        expect(lines.join(' ')).toContain('profile login verified');
    });

    test('the profile-check entry is a usage error with no browser when run bare', () => {
        const proc = Bun.spawnSync({
            cmd: [process.execPath, 'plugins/publishings/weibo-pub/src/profile-check.ts', 'nope'],
            cwd: process.cwd(),
            stdout: 'pipe',
            stderr: 'pipe',
        });
        expect(proc.exitCode).toBe(2);
        expect(proc.stdout.toString()).toContain('usage');
    });
});

describe('weibo-pub fake transport and IO (R9)', () => {
    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the script FakeBrowserTransport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const fake = getPublishTransport('article');
            expect(fake).toBeInstanceOf(FakeBrowserTransport);
            expect(fake.driver).toBe('script');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
        expect(getPublishTransport()).toBeInstanceOf(WeiboBrowserTransport);
    });

    test('processPublishIO posts offline on the fake transport and writes a schema-valid Result', async () => {
        const inPath = join(TMP_DIR, 'in.json');
        const outPath = join(TMP_DIR, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        await processPublishIO(inPath, outPath, new FakeBrowserTransport('script'));
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(true);
    });

    test('fake mode does not bypass the deterministic refusals', async () => {
        const inPath = join(TMP_DIR, 'fake-in.json');
        const outPath = join(TMP_DIR, 'fake-out.json');
        await writeFile(
            inPath,
            JSON.stringify({
                title: 'T',
                body: 'B',
                format: 'markdown',
                metadata: { publishStatus: 'public' },
                // Two images is the deterministic pre-browser refusal now that a post accepts one
                // (0246 R9) — this case must never reach a transport, real or fake.
                options: { operation: 'post', images: [COVER_PATH, COVER_PATH] },
            }),
        );
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/only one image/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
    });

    test('malformed input reports a single-line failure and never a stack', async () => {
        const inPath = join(TMP_DIR, 'bad-in.json');
        const outPath = join(TMP_DIR, 'bad-out.json');
        await writeFile(inPath, JSON.stringify({ title: 42 }));
        await expect(processPublishIO(inPath, outPath)).rejects.toThrow(/Invalid Content input/);
        const written = ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8')));
        expect(written.ok).toBe(false);
        expect(written.error?.split('\n')).toHaveLength(1);
        expect(written.error?.length).toBeLessThanOrEqual(300);
    });

    test('main returns 1 without args and 0 on the fake transport', async () => {
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
        const inPath = join(TMP_DIR, 'main-in.json');
        const outPath = join(TMP_DIR, 'main-out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
        }
    });

    test('invocable via runInvoke', async () => {
        const inPath = join(TMP_DIR, 'invoke-in.json');
        const outPath = join(TMP_DIR, 'invoke-out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'Hello', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({ plugin: 'weibo-pub', inPath, outPath, pluginsRoot: join(process.cwd(), 'plugins') }),
            ).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });
});

describe('weibo-pub environment restoration', () => {
    test('no weibo profile env leaks between suites', () => {
        expect(process.env.WEIBO_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
    });

    test('empty publishStatus metadata is treated as absent', async () => {
        const fake = makeFakeLauncher({ onSaveDraft: 'url' });
        const result = await transport(fake).publish({ content: { ...content, metadata: {} } });
        expect(result.ok).toBe(true);
    });
});
