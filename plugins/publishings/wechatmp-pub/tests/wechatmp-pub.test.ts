import { describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ResultSchema } from '@gobing-ai/kk-core';
import { FakeFileCliTransport } from '@gobing-ai/publish-harness';
import { BrowserProfileMissingError } from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { Page } from 'playwright';
import { runInvoke } from '../../../../apps/cli/src/invoke';
import {
    checkWechatSession,
    getPublishTransport,
    isWechatLoggedIn,
    main,
    markdownToWechatHtml,
    processPublishIO,
    WechatmpBrowserTransport,
    type WechatPage,
    wrapPlaywrightPage,
} from '../src/index';

interface RecordedCall {
    op: string;
    args: unknown[];
}

function makeFakePage(log: RecordedCall[]): WechatPage {
    const page: WechatPage = {
        goto: async (url) => {
            log.push({ op: 'goto', args: [url] });
        },
        url: () => 'https://mp.weixin.qq.com/cgi-bin/home?t=home',
        fill: async (selector, value) => {
            log.push({ op: 'fill', args: [selector, value] });
        },
        click: async (selector) => {
            log.push({ op: 'click', args: [selector] });
        },
        setInnerHtml: async (selector, html) => {
            log.push({ op: 'setInnerHtml', args: [selector, html] });
        },
        waitFor: async (selector) => {
            log.push({ op: 'waitFor', args: [selector] });
        },
        waitForAny: async () => '.weui-desktop-toast',
    };
    return page;
}

const ARTICLE = {
    title: '每日 AI 资讯 — 2026-09-29',
    body: '# 今日头条\n\n模型发布 **重点** 摘要。\n\n```ts\nconst x = 1;\n```',
    format: 'markdown',
};

describe('wechatmp-pub plugin', () => {
    test('markdownToWechatHtml maps headings, paragraphs, and code', () => {
        const html = markdownToWechatHtml('# Title\n\nHello **world**.\n\n```\nconst x = 1;\n```');
        expect(html).toContain('<h1>Title</h1>');
        expect(html).toContain('<strong>world</strong>');
        expect(html).toContain('<pre><code>');
        expect(html).toContain('const x = 1;');
    });

    test('draft flow: preflight, editor fill, save-draft click, toast confirmation', async () => {
        const log: RecordedCall[] = [];
        const checks: string[] = [];
        const transport = new WechatmpBrowserTransport({
            openPage: async () => makeFakePage(log),
            checkSession: async () => {
                checks.push('preflight');
            },
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(checks).toEqual(['preflight']);
        const ops = log.map((call) => call.op);
        expect(ops).toContain('setInnerHtml');
        const editorCall = log.find((call) => call.op === 'setInnerHtml');
        expect(String(editorCall?.args[1])).toContain('<h1>今日头条</h1>');
        expect(String(editorCall?.args[1])).toContain('<strong>重点</strong>');
        expect(log.some((call) => call.op === 'click' && String(call.args[0]).includes('js_save_draft'))).toBe(true);
        expect(log.some((call) => call.op === 'click' && String(call.args[0]).includes('js_publish'))).toBe(false);
    });

    test('public flow clicks the publish control and its confirm dialog', async () => {
        const log: RecordedCall[] = [];
        const transport = new WechatmpBrowserTransport({
            openPage: async () => makeFakePage(log),
            checkSession: async () => {},
        });
        const result = await transport.publish({
            content: ARTICLE,
            options: { target: 'wechatmp', operation: 'live' },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(log.some((call) => call.op === 'click' && String(call.args[0]).includes('js_publish'))).toBe(true);
        expect(
            log.filter((call) => call.op === 'click' && String(call.args[0]).includes('确定')).length,
        ).toBeGreaterThan(0);
    });

    test('sessionless preflight refuses fast with an ok:false non-blocking result', async () => {
        const transport = new WechatmpBrowserTransport({
            openPage: async () => {
                throw new Error('must not open a headed browser');
            },
            checkSession: async () => {
                throw new BrowserProfileMissingError('/tmp/profile');
            },
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('profile-check.ts login');
    });

    test('preflight error other than missing profile names the failure', async () => {
        const transport = new WechatmpBrowserTransport({
            openPage: async () => {
                throw new Error('must not open');
            },
            checkSession: async () => {
                throw new Error('timeout waiting for /cgi-bin/home');
            },
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('timeout waiting');
    });

    test('no toast after save is a loud failure, not a silent ok', async () => {
        const page = makeFakePage([]);
        page.waitForAny = async () => '';
        const transport = new WechatmpBrowserTransport({
            openPage: async () => page,
            checkSession: async () => {},
        });
        const result = await transport.publish({ content: ARTICLE, options: { target: 'wechatmp' } });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('no confirmation toast');
    });

    test('invalid publishStatus and missing body fail validation without opening a browser', async () => {
        let opened = 0;
        const transport = new WechatmpBrowserTransport({
            openPage: async () => {
                opened += 1;
                return makeFakePage([]);
            },
            checkSession: async () => {},
        });
        const badStatus = await transport.publish({
            content: { ...ARTICLE, metadata: { publishStatus: 'archived' } },
            options: { target: 'wechatmp' },
        });
        expect(badStatus.ok).toBe(false);
        const noBody = await transport.publish({
            content: { title: 'T', body: '', format: 'markdown' },
            options: { target: 'wechatmp' },
        });
        expect(noBody.ok).toBe(false);
        expect(opened).toBe(0);
    });

    test('processPublishIO uses FakeFileCliTransport offline', async () => {
        const fake = new FakeFileCliTransport();
        const tmpDir = join(process.cwd(), '.tmp-test-wechat');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        try {
            await processPublishIO(inPath, outPath, fake);
            expect(ResultSchema.parse(JSON.parse(await readFile(outPath, 'utf-8'))).ok).toBe(true);
        } finally {
            await rm(tmpDir, { recursive: true, force: true });
        }
    });

    test('getPublishTransport fake switch', () => {
        expect(getPublishTransport()).toBeInstanceOf(WechatmpBrowserTransport);
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            expect(getPublishTransport()).toBeInstanceOf(FakeFileCliTransport);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        }
    });

    test('main returns 1 without args and 0 on fake transport', async () => {
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
        const tmpDir = join(process.cwd(), '.tmp-test-wechat-main');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
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
        const tmpDir = join(process.cwd(), '.tmp-test-wechat-invoke');
        await mkdir(tmpDir, { recursive: true });
        const inPath = join(tmpDir, 'in.json');
        const outPath = join(tmpDir, 'out.json');
        await writeFile(inPath, JSON.stringify({ title: 'T', body: 'B', format: 'markdown' }));
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            const code = await runInvoke({
                plugin: 'wechatmp-pub',
                inPath,
                outPath,
                pluginsRoot: join(process.cwd(), 'plugins'),
            });
            expect(code).toBe(0);
        } finally {
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            await rm(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('markdownToWechatHtml inline safety (R9)', () => {
    test('a quote in a link destination cannot close the href attribute', () => {
        const html = markdownToWechatHtml('[y](a" onclick="z)');
        expect(html).not.toContain(' onclick=');
    });

    test('a javascript: destination is not turned into a link', () => {
        const html = markdownToWechatHtml('[x](javascript:alert(1))');
        expect(html).not.toContain('<a');
        expect(html).not.toContain('javascript:');
        expect(html).toContain('x');
    });

    test('an http(s) destination still renders a link', () => {
        expect(markdownToWechatHtml('[ok](https://example.com)')).toContain('<a href="https://example.com">ok</a>');
    });

    test('double quotes in text are escaped', () => {
        expect(markdownToWechatHtml('He said "hi"')).toContain('&quot;hi&quot;');
    });
});

describe('wrapPlaywrightPage (real adapter, offline via stub page)', () => {
    type Log = { fills: [string, string][]; clicks: string[]; evals: [string, string][] };
    function stubRawPage(log: Log, visible: string | null = null): Page {
        return {
            url: () => 'https://mp.weixin.qq.com/cgi-bin/home',
            goto: async () => undefined,
            locator: (selector: string) => ({
                first: () => ({
                    fill: async (value: string) => {
                        log.fills.push([selector, value]);
                    },
                    click: async () => {
                        log.clicks.push(selector);
                    },
                    waitFor: async () => {
                        if (visible !== selector) throw new Error('not visible');
                    },
                    evaluate: async (cb: (node: unknown, value: string) => void, arg: string) => {
                        cb({ dispatchEvent: () => undefined }, arg);
                        log.evals.push([selector, arg]);
                    },
                }),
            }),
        } as unknown as Page;
    }

    test('delegates goto/url/fill/click/setInnerHtml', async () => {
        const log: Log = { fills: [], clicks: [], evals: [] };
        const page = wrapPlaywrightPage(stubRawPage(log, '#js_description'));
        await page.goto('https://mp.weixin.qq.com/');
        expect(page.url()).toContain('/cgi-bin/home');
        await page.fill('#title', 't');
        await page.click('.js_save_draft');
        await page.setInnerHtml('.ProseMirror', '<p>hi</p>');
        await page.waitFor('#js_description', 1);
        expect(log.fills).toEqual([['#title', 't']]);
        expect(log.clicks).toEqual(['.js_save_draft']);
        expect(log.evals).toEqual([['.ProseMirror', '<p>hi</p>']]);
    });

    test('waitForAny returns the first visible selector, or an empty string when none appears', async () => {
        const hit = wrapPlaywrightPage(stubRawPage({ fills: [], clicks: [], evals: [] }, '.js_save_draft'));
        expect(await hit.waitForAny(['.js_publish', '.js_save_draft'], 800)).toBe('.js_save_draft');
        const miss = wrapPlaywrightPage(stubRawPage({ fills: [], clicks: [], evals: [] }));
        expect(await miss.waitForAny(['.js_publish'], 300)).toBe('');
    });

    test('isWechatLoggedIn reads the console home fragment', () => {
        expect(isWechatLoggedIn(stubRawPage({ fills: [], clicks: [], evals: [] }))).toBe(true);
    });
});

describe('checkWechatSession (preflight)', () => {
    test('uses the dedicated wechatmp profile with headless reuse and console readiness', async () => {
        // The real withProfilePage would launch a browser; here we only pin the seam: without a
        // profile dir override this fails fast on CI rather than opening anything headed.
        process.env.WECHATMP_PROFILE_DIR = '/tmp/nonexistent-wechat-profile-test';
        try {
            await expect(checkWechatSession('/tmp/nonexistent-wechat-profile-test')).rejects.toThrow();
        } finally {
            delete process.env.WECHATMP_PROFILE_DIR;
        }
    });
});
