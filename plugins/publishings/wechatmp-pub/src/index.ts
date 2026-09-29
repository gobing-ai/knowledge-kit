import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeFileCliTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
} from '@gobing-ai/publish-harness';
import { BrowserProfileMissingError, withProfilePage } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { Page } from 'playwright';

const TARGET = 'wechatmp';
const CONSOLE_URL = 'https://mp.weixin.qq.com/';

/** Proven console selectors (ported from the wt-publish-to-wechatmp Playwright flow). */
const SEL = {
    // Console home: an authenticated session lands on /cgi-bin/home; logged-out shows the QR scan page.
    loggedInFragment: '/cgi-bin/home',
    menuItem: '.new-creation__menu .new-creation__menu-item',
    titleInput: '#title',
    authorInput: '#author',
    editor: '.ProseMirror',
    summaryInput: '#js_description',
    saveDraftBtn: '.js_save_draft, button:has-text("保存为草稿"), button:has-text("保存草稿")',
    publishBtn: '.js_publish, button:has-text("发表"), button:has-text("发布")',
    confirmBtn: '.weui-desktop-dialog .weui-desktop-btn_primary, button:has-text("确定")',
    toast: '.weui-desktop-toast',
} as const;

const CONSOLE_READY_TIMEOUT_MS = 30_000;
const TOAST_TIMEOUT_MS = 15_000;

function fail(message: string): never {
    throw new Error(message);
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Harvested subset of wt md-to-wechat: headings, paragraphs, fenced code, lists, inline.
 * TypeScript only — no Python, no theme CLI.
 */
export function markdownToWechatHtml(markdown: string): string {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let inCode = false;
    let code: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const closeList = (): void => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };

    const inline = (text: string): string =>
        escapeHtml(text)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // `href` is already HTML-escaped (inline() escapes before replacing), so a `"` can no
            // longer close the attribute. The scheme allowlist is still required: escaping does not
            // neutralise `javascript:`. Non-http(s) links degrade to their label text.
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) =>
                /^https?:\/\//i.test(href) ? `<a href="${href}">${text}</a>` : text,
            );

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (inCode) {
                out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
                code = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            continue;
        }
        if (inCode) {
            code.push(line);
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading?.[1] && heading[2]) {
            closeList();
            const level = Math.min(heading[1].length, 3);
            out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
            continue;
        }
        const ul = line.match(/^[-*]\s+(.+)$/);
        if (ul?.[1]) {
            if (listType !== 'ul') {
                closeList();
                listType = 'ul';
                out.push('<ul>');
            }
            out.push(`<li>${inline(ul[1])}</li>`);
            continue;
        }
        const ol = line.match(/^\d+\.\s+(.+)$/);
        if (ol?.[1]) {
            if (listType !== 'ol') {
                closeList();
                listType = 'ol';
                out.push('<ol>');
            }
            out.push(`<li>${inline(ol[1])}</li>`);
            continue;
        }
        closeList();
        if (line.trim().length === 0) continue;
        out.push(`<p>${inline(line.trim())}</p>`);
    }
    closeList();
    if (inCode) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    return out.join('');
}

function resolveTitle(content: Content): string {
    if (typeof content.title === 'string' && content.title.trim() !== '') return content.title.trim();
    return fail('wechatmp-pub: content.title is required');
}

function resolveDigest(content: Content): string | undefined {
    const body = typeof content.body === 'string' ? content.body : '';
    if (body.trim() === '') return undefined;
    const first = body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line !== '');
    return first ? first.slice(0, 54) : undefined;
}

// ---------------------------------------------------------------------------
// Browser flow (ts-browser-automation; pattern mirrors xhs-pub)
// ---------------------------------------------------------------------------

export interface WechatPage {
    goto(url: string): Promise<void>;
    url(): string;
    fill(selector: string, value: string): Promise<void>;
    click(selector: string): Promise<void>;
    setInnerHtml(selector: string, html: string): Promise<void>;
    waitFor(selector: string, timeoutMs: number): Promise<void>;
    waitForAny(selectors: readonly string[], timeoutMs: number): Promise<string>;
}

function isWechatLoggedIn(page: Page): boolean {
    return page.url().includes(SEL.loggedInFragment);
}

export type SessionCheck = (profileDir: string) => Promise<void>;

/** Headless session preflight: throws (incl. BrowserProfileMissingError) when the profile cannot drive the console. */
export async function checkWechatSession(profileDir: string): Promise<void> {
    await withProfilePage(
        {
            profileDir,
            headless: true,
            url: CONSOLE_URL,
            isAuthenticated: isWechatLoggedIn,
            timeoutMs: CONSOLE_READY_TIMEOUT_MS,
        },
        async () => {},
    );
}

export interface WechatmpTransportOptions {
    openPage?: (profileDir: string) => Promise<WechatPage>;
    checkSession?: SessionCheck;
}

function wrapPlaywrightPage(page: Page): WechatPage {
    return {
        goto: (url) => page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => undefined),
        url: () => page.url(),
        fill: (selector, value) => page.locator(selector).first().fill(value),
        click: (selector) => page.locator(selector).first().click(),
        setInnerHtml: (selector, html) =>
            page
                .locator(selector)
                .first()
                .evaluate((node, value) => {
                    node.innerHTML = value;
                    node.dispatchEvent(new Event('input', { bubbles: true }));
                }, html),
        waitFor: (selector, timeoutMs) =>
            page
                .locator(selector)
                .first()
                .waitFor({ state: 'visible', timeout: timeoutMs })
                .then(() => undefined),
        waitForAny: async (selectors, timeoutMs) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                for (const selector of selectors) {
                    try {
                        await page.locator(selector).first().waitFor({ state: 'visible', timeout: 250 });
                        return selector;
                    } catch {
                        // try the next candidate
                    }
                }
            }
            return '';
        },
    };
}

async function defaultOpenPage(profileDir: string): Promise<WechatPage> {
    return withProfilePage({ profileDir, headless: false, url: CONSOLE_URL }, async (handle) =>
        wrapPlaywrightPage(handle.page),
    );
}

export class WechatmpBrowserTransport implements PublishTransport {
    readonly kind = 'browser';
    private readonly openPage: (profileDir: string) => Promise<WechatPage>;
    private readonly checkSession: SessionCheck;

    constructor(options: WechatmpTransportOptions = {}) {
        this.openPage = options.openPage ?? defaultOpenPage;
        this.checkSession = options.checkSession ?? ((profileDir) => checkWechatSession(profileDir));
    }

    async publish(payload: PublishTransportPayload): Promise<Result> {
        const { content, options } = payload;
        const want =
            options?.operation === 'live'
                ? 'public'
                : ((content.metadata?.publishStatus as string | undefined) ?? 'draft');
        if (want !== 'draft' && want !== 'public') {
            return this.failed(`publishStatus "${want}" is not draft|public`);
        }
        const title = resolveTitle(content);
        if (typeof content.body !== 'string' || content.body.trim() === '') {
            return this.failed('wechatmp-pub: content.body is required');
        }
        const profileDir = resolveBrowserProfileDir(TARGET, process.env.WECHATMP_PROFILE_DIR);

        try {
            await this.checkSession(profileDir);
        } catch (error: unknown) {
            const why =
                error instanceof BrowserProfileMissingError
                    ? 'no saved console profile — log in once via `bun src/profile-check.ts login`'
                    : `console session preflight failed (${error instanceof Error ? error.message : String(error)})`;
            // Non-blocking contract (mirrors xhs-pub): a sessionless run refuses fast and stays draftless —
            // it must never open a headed login wall inside an unattended run.
            return this.failed(`wechatmp-pub: ${why}`);
        }

        const page = await this.openPage(profileDir);
        try {
            await page.waitFor(SEL.menuItem, CONSOLE_READY_TIMEOUT_MS);
            await page.click(`${SEL.menuItem}:has-text("图文"), ${SEL.menuItem}`);
            await page.waitFor(SEL.titleInput, CONSOLE_READY_TIMEOUT_MS);
            await page.fill(SEL.titleInput, title);
            await this.tryFill(page, SEL.authorInput, String(content.metadata?.author ?? ''));
            await page.waitFor(SEL.editor, CONSOLE_READY_TIMEOUT_MS);
            await page.setInnerHtml(SEL.editor, markdownToWechatHtml(content.body));
            const digest = resolveDigest(content);
            if (digest) await this.tryFill(page, SEL.summaryInput, digest);

            if (want === 'draft') {
                await page.click(SEL.saveDraftBtn);
            } else {
                await page.click(SEL.publishBtn);
                await this.tryClick(page, SEL.confirmBtn);
            }
            const seen = await page.waitForAny([SEL.toast], TOAST_TIMEOUT_MS);
            if (seen === '') {
                return this.failed(
                    `save was clicked but no confirmation toast appeared within ${TOAST_TIMEOUT_MS}ms — verify the console manually`,
                );
            }
            return {
                ok: true,
                target: TARGET,
                metadata: {
                    publishStatus: want,
                    note:
                        want === 'draft'
                            ? 'saved to the WeChat MP draft box (草稿箱)'
                            : 'published via the console 发表 flow',
                },
            };
        } catch (error: unknown) {
            const why = error instanceof Error ? error.message : String(error);
            return this.failed(`console flow failed: ${why}`);
        }
    }

    private async tryFill(page: WechatPage, selector: string, value: string): Promise<void> {
        if (value === '') return;
        try {
            await page.fill(selector, value);
        } catch {
            // optional field — the console hides it for some account types
        }
    }

    private async tryClick(page: WechatPage, selector: string): Promise<void> {
        try {
            await page.click(selector);
        } catch {
            // confirm dialogs are not shown for every account type
        }
    }

    private failed(error: string): Result {
        return { ok: false, target: TARGET, error, metadata: { publishStatus: 'draft' } };
    }
}

export function getPublishTransport(): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') return new FakeFileCliTransport();
    return new WechatmpBrowserTransport();
}

export async function processPublishIO(inPath: string, outPath: string, transport?: PublishTransport): Promise<void> {
    const fs = createNodeFileSystem();
    const raw = JSON.parse(await fs.readFile(inPath));
    const content = ContentSchema.parse(raw);
    const result = await (transport ?? getPublishTransport()).publish({ content, options: { target: TARGET } });
    await fs.writeFile(outPath, JSON.stringify(ResultSchema.parse(result), null, 2));
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
    const { values } = parseArgs({
        argv,
        options: {
            in: { type: 'string' },
            out: { type: 'string' },
        },
    });
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in <content.json> --out <result.json>');
        return 1;
    }
    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`wechatmp-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
