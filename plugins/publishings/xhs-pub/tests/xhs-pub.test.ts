import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    createShadowProbe,
    getPublishTransport,
    main,
    makeDefaultOpenPage,
    type OpenPage,
    processPublishIO,
    validatePublishInput,
    wrapPlaywrightPage,
    XhsBrowserTransport,
    type XhsLocator,
    type XhsPage,
} from '../src/index';

const tmpRoot = join(process.cwd(), '.tmp-test-xhs');
const img = (n: number) => join(tmpRoot, `card-${n}.png`);
const PROFILE = join(homedir(), '.config', 'kk', 'browser-profiles', 'xhs');

interface FakeState {
    loggedIn: boolean;
    thumbCount: number | null; // null = nothing uploaded yet
    uploadThumbCount: number | null; // override count set on upload (mismatch scripting)
    publishConfirm: boolean;
    publishedUrl: string | null;
    /** The console's own draft counter, read back as `草稿箱(N)`. */
    draftCount: number;
    /** When true the draft control is clicked but the counter never moves. */
    draftSaveIsSilent: boolean;
    /** When false the closed-shadow publish bar exposes no control at all. */
    shadowBar: boolean;
    /** True while the image editor is open: the landing view's draft counter is gone. */
    inEditor: boolean;
    /** Set once a save prints a 保存于<timestamp> entry (the second confirmation signal). */
    draftSavedStamp: boolean;
    /** When true the counter is never readable, leaving the timestamp as the only signal. */
    counterUnreadable: boolean;
}

/** Labels XHS uses for the draft control, inside the closed shadow publish bar. */
const DRAFT_LABELS = new Set(['暂存离开', '存草稿', '保存草稿']);

/** Records every driver call and scripts the UI state the flow observes. */
function makeFakePage(initial: FakeState) {
    // Own the state: tests reuse a module-level `happy` fixture and driver steps mutate it.
    const state: FakeState = { ...initial };
    const calls: Array<{ op: string; args: unknown[] }> = [];
    let lastShadowLabel: string | null = null;
    let bodyTyped = false;
    const draftBoxText = () => (state.counterUnreadable || state.inEditor ? '' : `草稿箱(${state.draftCount})`);
    const page: XhsPage = {
        goto: async (url) => {
            calls.push({ op: 'goto', args: [url] });
        },
        locator: (selector) => {
            calls.push({ op: 'locator', args: [selector] });
            return {
                count: async () => {
                    // Attachment model: the counter exists only on the landing view, the save
                    // timestamp only once a save printed it, the file input always (hidden).
                    if (selector.includes('img') && !selector.includes('file')) return state.thumbCount ?? 0;
                    if (selector.startsWith('text=保存于')) return state.draftSavedStamp ? 1 : 0;
                    if (selector.includes('草稿箱')) return state.counterUnreadable || state.inEditor ? 0 : 1;
                    return state.loggedIn ? 1 : 0;
                },
                first: () => {
                    const isThumb = selector.includes('img') && !selector.includes('file');
                    // Upload widgets hide the real file input behind a drop zone: attached, never visible.
                    const isFileInput = selector.includes('file');
                    const isDraftBox = selector.includes('草稿箱');
                    const isPublishConfirm = selector.includes('发布成功') || selector === 'text=已发布';
                    const isStamp = selector.startsWith('text=保存于');
                    const visible =
                        state.loggedIn &&
                        !isFileInput &&
                        (isThumb
                            ? (state.thumbCount ?? 0) > 0
                            : isStamp
                              ? state.draftSavedStamp
                              : isPublishConfirm
                                ? state.publishConfirm
                                : true);
                    return {
                        count: async () => (isThumb ? ((state.thumbCount ?? 0) > 0 ? 1 : 0) : visible ? 1 : 0),
                        isVisible: async () => visible,
                        fill: async (text) => {
                            calls.push({ op: 'fill', args: [selector, text] });
                        },
                        click: async () => {
                            calls.push({ op: 'click', args: [selector] });
                        },
                        type: async (text) => {
                            calls.push({ op: 'type', args: [selector, text] });
                            // TipTap only registers typed content in this model.
                            if (selector.includes('tiptap')) bodyTyped = true;
                        },
                        textContent: async () => (isDraftBox ? draftBoxText() : ''),
                    };
                },
            };
        },
        setInputFiles: async (selector, paths) => {
            calls.push({ op: 'setInputFiles', args: [selector, [...paths]] });
            state.thumbCount = state.uploadThumbCount ?? paths.length;
        },
        waitForSelector: async () => null,
        url: () =>
            state.publishConfirm && state.publishedUrl
                ? state.publishedUrl
                : 'https://creator.xiaohongshu.com/publish/publish',
        clickInViewport: async (selector) => {
            calls.push({ op: 'clickInViewport', args: [selector] });
            // Entering the image tab replaces the landing header, taking the counter with it.
            state.inEditor = true;
            return state.loggedIn;
        },
        findShadowControl: async (labels) => {
            calls.push({ op: 'findShadowControl', args: [[...labels]] });
            if (!state.shadowBar) return null;
            const label = labels[0];
            if (label === undefined) return null;
            lastShadowLabel = label;
            return { label, x: 606, y: 855 };
        },
        clickAt: async (x, y) => {
            calls.push({ op: 'clickAt', args: [x, y] });
            // Only the draft control moves the console's draft counter and closes the editor,
            // and only once the TipTap body actually registered content.
            if (lastShadowLabel === null || !DRAFT_LABELS.has(lastShadowLabel)) return;
            if (state.draftSaveIsSilent || !bodyTyped) return;
            state.draftCount += 1;
            state.draftSavedStamp = true;
            state.inEditor = false;
        },
    };
    return { page, calls };
}

function makeOpenPage(state: FakeState) {
    const closed: number[] = [];
    const callLogs: Array<Array<{ op: string; args: unknown[] }>> = [];
    const open: OpenPage = async () => {
        const fake = makeFakePage(state);
        callLogs.push(fake.calls);
        return { page: fake.page, close: async () => void closed.push(1) };
    };
    return { open, closed, calls: callLogs };
}

function cardContent(over: Partial<Content['metadata']> = {}, n = 2): Content {
    return {
        title: '测试卡片',
        body: '正文',
        format: 'markdown',
        metadata: { images: Array.from({ length: n }, (_, i) => ({ path: img(i) })), ...over },
    };
}

async function seedImages(n = 2): Promise<void> {
    await mkdir(tmpRoot, { recursive: true });
    await Promise.all(Array.from({ length: n }, (_, i) => writeFile(img(i), 'png')));
}

const happy: FakeState = {
    loggedIn: true,
    thumbCount: null,
    uploadThumbCount: null,
    publishConfirm: true,
    publishedUrl: 'https://www.xiaohongshu.com/explore/abc123',
    draftCount: 0,
    draftSaveIsSilent: false,
    shadowBar: true,
    inEditor: false,
    draftSavedStamp: false,
    counterUnreadable: false,
};

describe('xhs-pub validation (no browser opens)', () => {
    test('default driver is script, kind browser', () => {
        const t = new XhsBrowserTransport();
        expect(t.kind).toBe('browser');
        expect(t.driver).toBe('script');
    });

    test('agent driver fails loud before any browser action', async () => {
        const { open, closed } = makeOpenPage(happy);
        const result = await new XhsBrowserTransport('agent', { openPage: open }).publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported driver');
        expect(closed).toHaveLength(0);
    });

    test('unknown publishStatus rejected', async () => {
        const r = await validatePublishInput(cardContent({ publishStatus: 'friends' }));
        expect(r.error).toContain('publishStatus');
    });

    test('empty images rejected', async () => {
        const r = await validatePublishInput(cardContent({ images: [] }));
        expect(r.error).toContain('non-empty');
    });

    test('relative path rejected', async () => {
        await seedImages();
        const c = cardContent({ images: [{ path: 'cards/card-0.png' }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('absolute');
    });

    test('unsupported extension rejected', async () => {
        await seedImages();
        const c = cardContent({ images: [{ path: join(tmpRoot, 'card-0.gif') }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('unsupported extension');
    });

    test('missing file rejected', async () => {
        const c = cardContent({ images: [{ path: join(tmpRoot, 'nope.png') }] });
        const r = await validatePublishInput(c);
        expect(r.error).toContain('does not exist');
    });

    test('transport fails before openPage on invalid images', async () => {
        const { open, closed } = makeOpenPage(happy);
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 50, submitSettleMs: 10 });
        const result = await t.publish({ content: cardContent({ images: [] }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('non-empty');
        expect(closed).toHaveLength(0);
    });
});

describe('xhs-pub script flow (fake page)', () => {
    test('draft: ordered paths in one setInputFiles call, confirmed save, no id', async () => {
        await seedImages();
        const { open, closed } = makeOpenPage(happy);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.id).toBeUndefined();
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.imageCount).toBe(2);
        expect(result.message).toContain(PROFILE);
        // R4: the draft control was read out of the closed shadow bar, never guessed
        expect(result.metadata?.draftControl).toBe('暂存离开');
        expect(result.metadata?.draftCountBefore).toBe(0);
        expect(result.metadata?.draftCountAfter).toBe(1);
        expect(result.metadata?.draftAttempts).toBe(1);
        expect(result.metadata?.draftClick).toBe('606,855');
        expect(closed).toHaveLength(1);
    });

    test('live console contract: in-viewport tab click, hidden input upload, TipTap body, shadow draft', async () => {
        await seedImages();
        const state = { ...happy };
        const { open, calls } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        const log = calls[0] ?? [];
        const ops = log.map((entry) => entry.op);
        expect(ops[0]).toBe('goto');
        // R1: the console opens on the video tab, so the image tab is entered before any upload.
        expect(ops.indexOf('clickInViewport')).toBeGreaterThan(ops.indexOf('goto'));
        expect(ops.indexOf('clickInViewport')).toBeLessThan(ops.indexOf('setInputFiles'));
        // R2: the note body is the TipTap editor (Quill was replaced in 2026-09), and it must be
        // TYPED — a synthetic value set leaves nothing for the save to persist.
        const typed = log.filter((entry) => entry.op === 'type').map((entry) => String(entry.args[0]));
        expect(typed).toContain('div.tiptap[contenteditable="true"]');
        const filled = log.filter((entry) => entry.op === 'fill').map((entry) => String(entry.args[0]));
        expect(filled).not.toContain('div.tiptap[contenteditable="true"]');
        // R3: previews are counted through XHS's own `preivew` class, and the image input is
        // the .jpg one (the video input has no accept list match).
        const selectors = log.filter((entry) => entry.op === 'locator').map((entry) => String(entry.args[0]));
        expect(selectors).toContain('img.preivew-image');
        expect(selectors).toContain('input[type="file"][accept*=".jpg"]');
        // R4: the submit control is resolved by label inside the closed shadow bar.
        const shadow = log.find((entry) => entry.op === 'findShadowControl');
        expect(shadow?.args[0]).toEqual(['暂存离开', '存草稿', '保存草稿']);
        expect(ops).toContain('clickAt');
    });

    test('no CDP shadow access fails loud instead of clicking a guessed coordinate', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy });
        const pageWithoutShadow: XhsPage = { ...fake.page, findShadowControl: undefined, clickAt: undefined };
        const open: OpenPage = async () => ({ page: pageWithoutShadow, close: async () => {} });
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('closed shadow root');
        expect(result.error).toContain('CDP');
    });

    test('closed shadow bar without the draft control fails loud naming the labels', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy, shadowBar: false });
        const open: OpenPage = async () => ({ page: fake.page, close: async () => {} });
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('publish bar');
        expect(result.error).toContain('暂存离开');
    });

    test('no in-viewport image tab fails loud rather than clicking an off-screen duplicate', async () => {
        await seedImages();
        const fake = makeFakePage({ ...happy });
        const open: OpenPage = async () => ({
            page: { ...fake.page, clickInViewport: async () => false },
            close: async () => {},
        });
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('in-viewport');
    });

    test('paths reach setInputFiles in payload order, single call', async () => {
        await seedImages(3);
        const state = { ...happy };
        const { open } = makeOpenPage(state);
        const captured: { uploaded: string[] | null; calls: number } = { uploaded: null, calls: 0 };
        const openSpy: OpenPage = async (profileDir) => {
            const inner = await open(profileDir);
            const wrapped: XhsPage = {
                ...inner.page,
                setInputFiles: async (selector, paths) => {
                    await inner.page.setInputFiles(selector, paths);
                    captured.calls += 1;
                    captured.uploaded = [...paths];
                },
            };
            return { page: wrapped, close: inner.close };
        };
        const t = new XhsBrowserTransport('script', {
            openPage: openSpy,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({}, 3) });
        expect(result.ok).toBe(true);
        expect(captured.calls).toBe(1);
        expect(captured.uploaded).toEqual([img(0), img(1), img(2)]);
    });

    test('public: explicit publishStatus publishes and reports observed url', async () => {
        await seedImages();
        const { open, closed } = makeOpenPage(happy);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 500,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({ publishStatus: 'public' }) });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.url).toBe('https://www.xiaohongshu.com/explore/abc123');
        expect(closed).toHaveLength(1);
    });

    test('login timeout fails loud with profile dir', async () => {
        await seedImages();
        const state = { ...happy, loggedIn: false };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', { openPage: open, loginTimeoutMs: 40, stepTimeoutMs: 40 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('login timeout');
        expect(result.error).toContain(PROFILE);
        expect(closed).toHaveLength(1);
    });

    test('thumbnail count mismatch fails naming the step', async () => {
        await seedImages();
        const state = { ...happy, uploadThumbCount: 1 };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 60,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('thumbnail count');
        expect(result.error).toContain('expected 2');
        expect(closed).toHaveLength(1);
    });

    test('draft confirmation fails naming the step when the counter does not move', async () => {
        await seedImages();
        const state: FakeState = { ...happy, draftSaveIsSilent: true };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('neither a fresh');
        expect(closed).toHaveLength(1);
    });

    test('draft confirmation can rest on the console save timestamp alone', async () => {
        await seedImages();
        const state: FakeState = { ...happy, counterUnreadable: true };
        const { open } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 300,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        // The counter is the editor-suppressed landing label: unreadable on this console.
        expect(result.metadata?.draftCountBefore).toBeNull();
        expect(result.metadata?.draftCountAfter).toBeNull();
    });

    test('ambiguous public submit warns about duplicate risk', async () => {
        await seedImages();
        const state: FakeState = { ...happy, publishConfirm: false };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 60,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
        });
        const result = await t.publish({ content: cardContent({ publishStatus: 'public' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('state unknown');
        expect(result.error).toContain('duplicate');
        expect(result.error).toContain('note manager');
        expect(closed).toHaveLength(1);
    });

    test('openPage failure (missing playwright) fails loud', async () => {
        await seedImages();
        const open: OpenPage = async () => {
            throw new Error(
                'launchPersistentBrowser requires the playwright package on the caller dependency tree — install with: bunx playwright install chromium',
            );
        };
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 50, submitSettleMs: 10 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('playwright');
    });
});

describe('xhs-pub playwright adapter', () => {
    test('wrapPlaywrightPage delegates to the raw page', async () => {
        const recorded: string[] = [];
        const stub = {
            goto: async (url: string) => {
                recorded.push(`goto:${url}`);
            },
            locator: (_selector: string) => ({
                count: async () => 2,
                nth: (index: number) => ({
                    boundingBox: async () =>
                        index === 0
                            ? { x: -60, y: 10, width: 80, height: 20 } // off-viewport duplicate
                            : { x: 12, y: 24, width: 80, height: 20 },
                    click: async (opts?: { force?: boolean }) => {
                        recorded.push(`nthClick:${index}:force=${String(opts?.force)}`);
                    },
                }),
                first: () => ({
                    count: async () => 7,
                    isVisible: async () => true,
                    fill: async (t: string) => {
                        recorded.push(`fill:${t}`);
                    },
                    click: async () => {
                        recorded.push('click');
                    },
                    pressSequentially: async (t: string) => {
                        recorded.push(`type:${t}`);
                    },
                    textContent: async () => '草稿箱(3)',
                }),
            }),
            setInputFiles: async (s: string, p: readonly string[]) => {
                recorded.push(`files:${s}:${p.join(',')}`);
            },
            waitForSelector: async (s: string) => s,
            url: () => 'https://example.com/done',
            viewportSize: () => ({ width: 1000, height: 800 }),
            mouse: {
                click: async (x: number, y: number) => {
                    recorded.push(`mouse:${x},${y}`);
                },
            },
        };
        const page = wrapPlaywrightPage(stub, {
            findControl: async (labels) => ({ label: labels[0] ?? '', x: 606, y: 855 }),
        });
        await page.goto('https://example.com');
        await page.setInputFiles('input', ['/a.png']);
        await page.locator('input').first().fill('hello');
        await page.locator('input').first().type?.('typed');
        await page.locator('input').first().click();
        expect(await page.locator('input').first().count()).toBe(7);
        expect(await page.locator('input').first().isVisible()).toBe(true);
        expect(await page.locator('input').first().textContent?.()).toBe('草稿箱(3)');
        expect(await page.waitForSelector('sel')).toBe('sel');
        expect(page.url()).toBe('https://example.com/done');
        // The in-viewport duplicate is the one clicked, and the tab click must be forced.
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(true);
        expect(await page.findShadowControl?.(['暂存离开'])).toEqual({ label: '暂存离开', x: 606, y: 855 });
        await page.clickAt?.(606, 855);
        expect(recorded).toEqual([
            'goto:https://example.com',
            'files:input:/a.png',
            'fill:hello',
            'type:typed',
            'click',
            'nthClick:1:force=true',
            'mouse:606,855',
        ]);
    });
});

/** Canned CDP session for the closed-shadow probe (no browser needed). */
function fakeCdp(tree: unknown, box?: { content: number[] }) {
    const calls: string[] = [];
    const session = {
        send: async (method: string, _params?: Record<string, unknown>) => {
            calls.push(method);
            if (method === 'DOM.getDocument') return { root: tree };
            if (method === 'DOM.getBoxModel') return box ? { model: box } : {};
            return {};
        },
    };
    return { session, calls };
}

const shadowButton = (label: string, id = 42) => ({
    nodeName: 'BUTTON',
    backendNodeId: id,
    children: [{ nodeName: '#text', nodeValue: label }],
});

const boxAt = (x1: number, y1: number, x3: number, y4: number) => ({
    content: [x1, y1, x3, y1, x3, y4, x1, y4],
});

describe('xhs-pub closed-shadow CDP probe (task 0174 R4)', () => {
    test('resolves a labelled control inside a closed shadow root to its centre', async () => {
        const tree = {
            nodeName: '#document',
            children: [
                {
                    nodeName: 'DIV',
                    children: [],
                    shadowRoots: [{ nodeName: '#document-fragment', children: [shadowButton('暂存离开')] }],
                },
            ],
        };
        const { session, calls } = fakeCdp(tree, boxAt(0, 0, 100, 40));
        const probe = await createShadowProbe({ newCDPSession: async () => session }, {});
        expect(probe).toBeDefined();
        expect(await probe?.findControl(['暂存离开'])).toEqual({ label: '暂存离开', x: 50, y: 20 });
        expect(calls).toContain('DOM.enable');
        expect(calls).toContain('DOM.getBoxModel');
    });

    test('finds a control nested in a shadow root inside a shadow root', async () => {
        const tree = {
            nodeName: '#document',
            children: [
                {
                    nodeName: 'DIV',
                    shadowRoots: [
                        {
                            nodeName: '#document-fragment',
                            children: [
                                {
                                    nodeName: 'SPAN',
                                    shadowRoots: [
                                        { nodeName: '#document-fragment', children: [shadowButton('发布', 7)] },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        const { session } = fakeCdp(tree, boxAt(10, 10, 30, 50));
        const probe = await createShadowProbe({ newCDPSession: async () => session }, {});
        expect(await probe?.findControl(['暂存离开', '发布'])).toEqual({ label: '发布', x: 20, y: 30 });
    });

    test('ignores non-button labels, missing matches and unusable geometry', async () => {
        const labelled = {
            nodeName: 'DIV',
            backendNodeId: 9,
            children: [{ nodeName: '#text', nodeValue: '暂存离开' }],
        };
        const tree = { nodeName: '#document', children: [labelled] };
        const noMatch = await createShadowProbe({ newCDPSession: async () => fakeCdp(tree).session }, {});
        // A div that merely carries the text is not the control.
        expect(await noMatch?.findControl(['暂存离开'])).toBeNull();

        const buttonTree = { nodeName: '#document', children: [shadowButton('暂存离开')] };
        const shortBox = await createShadowProbe(
            { newCDPSession: async () => fakeCdp(buttonTree, { content: [1, 2] }).session },
            {},
        );
        expect(await shortBox?.findControl(['暂存离开'])).toBeNull();

        const noBox = await createShadowProbe({ newCDPSession: async () => fakeCdp(buttonTree).session }, {});
        expect(await noBox?.findControl(['暂存离开'])).toBeNull();
    });

    test('returns undefined when CDP is unavailable, fails, or has no root', async () => {
        expect(await createShadowProbe({}, {})).toBeUndefined();
        const throwing = await createShadowProbe(
            {
                newCDPSession: async () => {
                    throw new Error('CDP unavailable');
                },
            },
            {},
        );
        expect(throwing).toBeUndefined();
        const rootless = await createShadowProbe({ newCDPSession: async () => fakeCdp(undefined).session }, {});
        expect(await rootless?.findControl(['暂存离开'])).toBeNull();
    });

    test('without a shadow probe the seam reports no shadow control', async () => {
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => 0,
                nth: () => ({ boundingBox: async () => null, click: async () => {} }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'about:blank',
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.findShadowControl?.(['暂存离开'])).toBeNull();
        // No viewport and no candidate boxes: nothing is clickable, so the tab step fails loud.
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(false);
    });

    // defaultOpenPage is intentionally not unit-tested: with playwright resolvable it
    // launches a real headed Chromium against the profile dir; without it the install-hint
    // throw path is trivial. It is exercised end-to-end by manual dogfood (task 0167 AC).
});

describe('xhs-pub CLI surface (unchanged contract)', () => {
    test('FakeBrowserTransport offline processPublishIO', async () => {
        const fake = new FakeBrowserTransport('script');
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'Parity', body: 'Body.', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeBrowserTransport);
            expect(getPublishTransport('script').kind).toBe('browser');
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without --in/--out and 0 on fake transport', async () => {
        const origArgv = process.argv;
        // An in-process CLI call must not decide the test runner's exit code: `main()` and its
        // error path write to `process.exitCode`, which would fail the suite with 0 test failures.
        const origExitCode = process.exitCode;
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        process.argv = ['bun', 'index.ts'];
        try {
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');
        } finally {
            restore();
            process.argv = origArgv;
            process.exitCode = origExitCode;
        }

        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        process.argv = ['bun', 'index.ts', '--in', inPath, '--out', outPath];
        try {
            expect(await main()).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            process.argv = origArgv;
            process.exitCode = origExitCode;
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
        const origExitCode = process.exitCode;
        await mkdir(tmpRoot, { recursive: true });
        const inPath = join(tmpRoot, 'in.json');
        const outPath = join(tmpRoot, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(
                await runInvoke({
                    plugin: 'xhs-pub',
                    inPath,
                    outPath,
                    pluginsRoot: join(process.cwd(), 'plugins'),
                }),
            ).toBe(0);
        } finally {
            process.exitCode = origExitCode;
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });
});

describe('xhs-pub default page opener (task 0174 wiring)', () => {
    const rawPage = () => ({
        goto: async () => {},
        locator: () => ({
            count: async () => 0,
            nth: () => ({ boundingBox: async () => null, click: async () => {} }),
            first: () => ({
                count: async () => 0,
                isVisible: async () => false,
                fill: async () => {},
                click: async () => {},
                textContent: async () => '',
            }),
        }),
        setInputFiles: async () => {},
        waitForSelector: async () => null,
        url: () => 'https://creator.xiaohongshu.com/publish/publish',
        viewportSize: () => ({ width: 1000, height: 800 }),
        mouse: { click: async () => {} },
    });

    test('wraps the existing page, wires the CDP probe, and closes the context', async () => {
        const closed: string[] = [];
        const launched: Array<{ profileDir: string; headless: boolean }> = [];
        const { session } = fakeCdp(
            { nodeName: '#document', children: [shadowButton('暂存离开')] },
            boxAt(0, 0, 40, 20),
        );
        const open = makeDefaultOpenPage(async (options) => {
            launched.push(options);
            return {
                pages: () => [rawPage()],
                newPage: async () => rawPage(),
                close: async () => void closed.push('closed'),
                newCDPSession: async () => session,
            };
        });
        const opened = await open('/tmp/profile');
        expect(launched).toEqual([{ profileDir: '/tmp/profile', headless: false }]);
        expect(opened.page.url()).toContain('creator.xiaohongshu.com');
        expect(await opened.page.findShadowControl?.(['暂存离开'])).toEqual({ label: '暂存离开', x: 20, y: 10 });
        await opened.close();
        expect(closed).toEqual(['closed']);
    });

    test('opens a page when the context has none, and names the install hint on launch failure', async () => {
        let created = 0;
        const open = makeDefaultOpenPage(async () => ({
            pages: () => [],
            newPage: async () => {
                created += 1;
                return rawPage();
            },
            close: async () => {},
        }));
        const opened = await open('/tmp/profile');
        expect(created).toBe(1);
        expect(opened.page.url()).toContain('creator.xiaohongshu.com');

        const failing = makeDefaultOpenPage(async () => {
            throw new Error('playwright missing');
        });
        await expect(failing('/tmp/profile')).rejects.toThrow(/browser launch: playwright missing/);
        await expect(failing('/tmp/profile')).rejects.toThrow(/playwright install chromium/);
    });
});

describe('xhs-pub seam without a typing capability (task 0174 R2)', () => {
    test('a seam that cannot type cannot confirm a draft, so it fails loud', async () => {
        await seedImages();
        const state = { ...happy };
        const fake = makeFakePage(state);
        const filled: string[] = [];
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                const inner = fake.page.locator(selector);
                const first = inner.first();
                return {
                    count: inner.count,
                    first: () => ({
                        count: first.count,
                        isVisible: first.isVisible,
                        click: first.click,
                        fill: async (text) => {
                            if (selector.includes('tiptap')) filled.push(String(text));
                            await first.fill?.(text);
                        },
                        // No `type`: the driver must fall back to fill, and TipTap will not
                        // register it — the save stays unobservable.
                        textContent: first.textContent,
                    }),
                };
            },
        };
        const open: OpenPage = async () => ({ page, close: async () => {} });
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(filled).toEqual(['正文']);
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
    });
});

describe('xhs-pub resilient probes (task 0174)', () => {
    test('clickInViewport skips a candidate whose box cannot be read and clicks the next one', async () => {
        const clicks: number[] = [];
        const stub = {
            goto: async () => {},
            locator: () => ({
                count: async () => 2,
                nth: (index: number) => ({
                    boundingBox: async () => {
                        if (index === 0) throw new Error('element detached');
                        return { x: 5, y: 6, width: 10, height: 10 };
                    },
                    click: async () => void clicks.push(index),
                }),
                first: () => ({
                    count: async () => 0,
                    isVisible: async () => false,
                    fill: async () => {},
                    click: async () => {},
                }),
            }),
            setInputFiles: async () => {},
            waitForSelector: async () => null,
            url: () => 'about:blank',
            viewportSize: () => ({ width: 100, height: 100 }),
            mouse: { click: async () => {} },
        };
        const page = wrapPlaywrightPage(stub);
        expect(await page.clickInViewport?.('div.creator-tab')).toBe(true);
        expect(clicks).toEqual([1]);
    });

    test('unreadable draft signals cannot confirm a save', async () => {
        await seedImages();
        const state = { ...happy };
        const fake = makeFakePage(state);
        const page: XhsPage = {
            ...fake.page,
            locator: (selector) => {
                if (selector.includes('草稿箱') || selector.startsWith('text=保存于')) {
                    // The save-label queries fail mid-flight (detached node).
                    return {
                        count: async () => {
                            throw new Error('element detached');
                        },
                        first: (): XhsLocator => ({
                            count: async () => {
                                throw new Error('element detached');
                            },
                            isVisible: async () => {
                                throw new Error('element detached');
                            },
                            fill: async () => {
                                throw new Error('element detached');
                            },
                            click: async () => {
                                throw new Error('element detached');
                            },
                        }),
                    };
                }
                return fake.page.locator(selector);
            },
        };
        const open: OpenPage = async () => ({ page, close: async () => {} });
        const t = new XhsBrowserTransport('script', {
            openPage: open,
            stepTimeoutMs: 200,
            loginTimeoutMs: 500,
            submitSettleMs: 10,
            submitAttempts: 2,
        });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(result.error).toContain('before=null');
    });
});
