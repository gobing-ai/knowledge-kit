import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    getPublishTransport,
    main,
    type OpenPage,
    processPublishIO,
    validatePublishInput,
    wrapPlaywrightPage,
    XhsBrowserTransport,
    type XhsPage,
} from '../src/index';

const tmpRoot = join(process.cwd(), '.tmp-test-xhs');
const img = (n: number) => join(tmpRoot, `card-${n}.png`);
const PROFILE = join(homedir(), '.config', 'kk', 'browser-profiles', 'xhs');

interface FakeState {
    loggedIn: boolean;
    thumbCount: number | null; // null = nothing uploaded yet
    uploadThumbCount: number | null; // override count set on upload (mismatch scripting)
    draftConfirm: boolean;
    publishConfirm: boolean;
    publishedUrl: string | null;
}

/** Records every driver call and scripts the UI state the flow observes. */
function makeFakePage(state: FakeState) {
    const calls: Array<{ op: string; args: unknown[] }> = [];
    const page: XhsPage = {
        goto: async (url) => {
            calls.push({ op: 'goto', args: [url] });
        },
        locator: (selector) => ({
            count: async () => (selector.includes('img') && !selector.includes('file') ? (state.thumbCount ?? 0) : 1),
            first: () => {
                const isThumb = selector.includes('img') && !selector.includes('file');
                const isDraftConfirm = selector.includes('草稿已保存') || selector.includes('已保存至草稿箱');
                const isPublishConfirm = selector.includes('发布成功') || selector === 'text=已发布';
                const visible =
                    state.loggedIn &&
                    (isThumb
                        ? (state.thumbCount ?? 0) > 0
                        : isDraftConfirm
                          ? state.draftConfirm
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
                };
            },
        }),
        setInputFiles: async (selector, paths) => {
            calls.push({ op: 'setInputFiles', args: [selector, [...paths]] });
            state.thumbCount = state.uploadThumbCount ?? paths.length;
        },
        waitForSelector: async () => null,
        url: () =>
            state.publishConfirm && state.publishedUrl
                ? state.publishedUrl
                : 'https://creator.xiaohongshu.com/publish/publish',
    };
    return { page, calls };
}

function makeOpenPage(state: FakeState) {
    const closed: number[] = [];
    const open: OpenPage = async () => {
        const { page } = makeFakePage(state);
        return { page, close: async () => void closed.push(1) };
    };
    return { open, closed };
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
    draftConfirm: true,
    publishConfirm: true,
    publishedUrl: 'https://www.xiaohongshu.com/explore/abc123',
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
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 50 });
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
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 500, loginTimeoutMs: 500 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(true);
        expect(result.id).toBeUndefined();
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.driver).toBe('script');
        expect(result.metadata?.imageCount).toBe(2);
        expect(result.message).toContain(PROFILE);
        expect(closed).toHaveLength(1);
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
        const t = new XhsBrowserTransport('script', { openPage: openSpy, stepTimeoutMs: 500, loginTimeoutMs: 500 });
        const result = await t.publish({ content: cardContent({}, 3) });
        expect(result.ok).toBe(true);
        expect(captured.calls).toBe(1);
        expect(captured.uploaded).toEqual([img(0), img(1), img(2)]);
    });

    test('public: explicit publishStatus publishes and reports observed url', async () => {
        await seedImages();
        const { open, closed } = makeOpenPage(happy);
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 500, loginTimeoutMs: 500 });
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
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 60, loginTimeoutMs: 500 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('thumbnail count');
        expect(result.error).toContain('expected 2');
        expect(closed).toHaveLength(1);
    });

    test('missing draft confirmation fails naming the step', async () => {
        await seedImages();
        const state: FakeState = { ...happy, draftConfirm: false };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 60, loginTimeoutMs: 500 });
        const result = await t.publish({ content: cardContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('draft confirmation');
        expect(closed).toHaveLength(1);
    });

    test('ambiguous public submit warns about duplicate risk', async () => {
        await seedImages();
        const state: FakeState = { ...happy, publishConfirm: false };
        const { open, closed } = makeOpenPage(state);
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 60, loginTimeoutMs: 500 });
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
        const t = new XhsBrowserTransport('script', { openPage: open, stepTimeoutMs: 50 });
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
                first: () => ({
                    count: async () => 7,
                    isVisible: async () => true,
                    fill: async (t: string) => {
                        recorded.push(`fill:${t}`);
                    },
                    click: async () => {
                        recorded.push('click');
                    },
                }),
            }),
            setInputFiles: async (s: string, p: readonly string[]) => {
                recorded.push(`files:${s}:${p.join(',')}`);
            },
            waitForSelector: async (s: string) => s,
            url: () => 'https://example.com/done',
        };
        const page = wrapPlaywrightPage(stub);
        await page.goto('https://example.com');
        await page.setInputFiles('input', ['/a.png']);
        await page.locator('input').first().fill('hello');
        await page.locator('input').first().click();
        expect(await page.locator('input').first().count()).toBe(7);
        expect(await page.locator('input').first().isVisible()).toBe(true);
        expect(await page.waitForSelector('sel')).toBe('sel');
        expect(page.url()).toBe('https://example.com/done');
        expect(recorded).toEqual(['goto:https://example.com', 'files:input:/a.png', 'fill:hello', 'click']);
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
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });

    test('invocable via runInvoke', async () => {
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
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpRoot, { recursive: true, force: true });
        }
    });
});
