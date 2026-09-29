import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeFileCliTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
} from '@gobing-ai/publish-harness';
import { BrowserProfileMissingError, openPersistentBrowser } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { BrowserContext, Cookie, Page } from 'playwright';

const TARGET = 'wechatmp';
const CONSOLE_URL = 'https://mp.weixin.qq.com/';

/** Proven console selectors (ported from the wt-publish-to-wechatmp Playwright flow). */
const SEL = {
    // Console home: an authenticated session lands on /cgi-bin/home; logged-out shows the QR scan page.
    loggedInFragment: '/cgi-bin/home',
    menuItem: '.new-creation__menu .new-creation__menu-item',
    // The 2024+ console editor renders title/body as two ProseMirror instances; the legacy
    // textarea#title is a hidden mirror. The title PM carries a 标题 placeholder — the only
    // reliable discriminator between the two editors.
    titleInput: '.ProseMirror[data-placeholder*="标题"]',
    authorInput: '#author',
    editor: '.ProseMirror:not([data-placeholder])',
    summaryInput: '#js_description',
    saveDraftBtn: 'button:has-text("保存为草稿")',
    originalSwitch: '.setting-group__switch.js_edit_ori',
    tagRow: '.allow_click_opr.js_article_tags_label',
    tagInput: 'input[placeholder*="合集"]',
    claimSourceCheckbox: '#js_claim_source_area .frm_checkbox_label',
    coverBtn: '.js_cover_btn_area',
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
    click(selector: string, timeoutMs?: number): Promise<void>;
    press?(key: string): Promise<void>;
    setInnerHtml(selector: string, html: string): Promise<void>;
    waitFor(selector: string, timeoutMs: number): Promise<void>;
    waitForAny(selectors: readonly string[], timeoutMs: number): Promise<string>;
    /** Resolves when the page URL contains the fragment (real browsers); absent on test fakes. */
    waitForUrlFragment?(fragment: string, timeoutMs: number): Promise<void>;
    setInputFiles?(selector: string, files: string): Promise<void>;
    waitForTimeout?(ms: number): Promise<void>;
    /** Evaluate a JS expression in the page (real browsers) - used for commit verification; absent on fakes. */
    evalJs?(expression: string): Promise<unknown>;
    /** Click and adopt the tab the console opens for the editor; absent on test fakes (same-page click). */
    clickAndAwaitNewPage?(selector: string): Promise<WechatPage>;
    /** Present on real browser pages; absent on test fakes. publish() closes it in finally. */
    close?(): Promise<void>;
}

export function isWechatLoggedIn(page: Page): boolean {
    return page.url().includes(SEL.loggedInFragment);
}

export type SessionCheck = (profileDir: string) => Promise<void>;

/** Cookies captured at login time — mp.weixin.qq.com grant cookies do not survive a Chromium restart
 * (the store drops them despite 4-day expiries), but the server session does, so we re-inject. */
export function storageStatePath(profileDir: string): string {
    return `${profileDir}/storage-state.json`;
}

/** Headless session preflight: throws (incl. BrowserProfileMissingError) when the profile cannot drive the console. */
export async function checkWechatSession(profileDir: string): Promise<void> {
    const { page, context } = await openWithState(profileDir, true);
    try {
        await pollLogin(page);
    } finally {
        await context.close();
    }
}

async function pollLogin(page: Page): Promise<void> {
    const deadline = Date.now() + CONSOLE_READY_TIMEOUT_MS;
    while (!isWechatLoggedIn(page)) {
        if (Date.now() > deadline) {
            throw new Error(
                `Authentication was not confirmed within ${CONSOLE_READY_TIMEOUT_MS}ms — the saved session state has ` +
                    'likely expired: re-run `bun src/profile-check.ts login` to sign in again.',
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
}

export interface WechatmpTransportOptions {
    openPage?: (profileDir: string) => Promise<WechatPage>;
    checkSession?: SessionCheck;
}

export function wrapPlaywrightPage(page: Page, context?: BrowserContext): WechatPage {
    return {
        goto: (url) => page.goto(url, { waitUntil: 'domcontentloaded' }).then(() => undefined),
        url: () => page.url(),
        fill: (selector, value) => page.locator(selector).first().fill(value),
        click: (selector, timeoutMs) =>
            page
                .locator(selector)
                .first()
                .click(timeoutMs ? { timeout: timeoutMs } : undefined),
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
        waitForUrlFragment: (fragment, timeoutMs) =>
            page
                .waitForURL(new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: timeoutMs })
                .then(() => undefined),
        setInputFiles: (selector, files) => page.locator(selector).first().setInputFiles(files),
        waitForTimeout: (ms) => page.waitForTimeout(ms),
        evalJs: (expression) => page.evaluate(expression),
        press: (key) => page.keyboard.press(key),
        clickAndAwaitNewPage: context
            ? async (selector) => {
                  const popup = context.waitForEvent('page', { timeout: 15000 }).catch(() => undefined);
                  await page.locator(selector).first().click();
                  const opened = await popup;
                  if (!opened) return wrapPlaywrightPage(page, context);
                  await opened.waitForLoadState('domcontentloaded').catch(() => {});
                  return wrapPlaywrightPage(opened, context);
              }
            : undefined,
        close: context ? () => context.close() : undefined,
    };
}

/** Launch, inject the saved login cookies, and land on the console. Caller owns closing the context. */
async function openWithState(profileDir: string, headless: boolean): Promise<{ page: Page; context: BrowserContext }> {
    const context = await openPersistentBrowser({ profileDir, headless });
    try {
        const stateFile = storageStatePath(profileDir);
        let state: { cookies?: Cookie[] } | undefined;
        try {
            state = JSON.parse(await createNodeFileSystem().readFile(stateFile));
        } catch {
            state = undefined; // absent or corrupt session state — reported below
        }
        const cookies = state?.cookies;
        if (!cookies || cookies.length === 0) {
            throw new BrowserProfileMissingError(
                `no saved console session state (${stateFile}) — run \`bun src/profile-check.ts login\` once`,
            );
        }
        await context.addCookies(cookies);
        const page = context.pages()[0] ?? (await context.newPage());
        await page.goto(CONSOLE_URL);
        return { page, context };
    } catch (error: unknown) {
        await context.close();
        throw error;
    }
}

async function defaultOpenPage(profileDir: string): Promise<WechatPage> {
    // Headless works end-to-end for the draft flow (probed 2026-09-29); no window is popped.
    const { page, context } = await openWithState(profileDir, true);
    return wrapPlaywrightPage(page, context);
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
        let enrichWarnings: string[] = [];
        try {
            await page.waitFor(SEL.menuItem, CONSOLE_READY_TIMEOUT_MS);
            // The console opens the article editor in a new tab — adopt it when it appears.
            const editor = page.clickAndAwaitNewPage
                ? await page.clickAndAwaitNewPage(`${SEL.menuItem}:has-text("图文"), ${SEL.menuItem}`)
                : page;
            if (editor === page) {
                await page.click(`${SEL.menuItem}:has-text("图文"), ${SEL.menuItem}`);
            }
            await editor.waitFor(SEL.titleInput, CONSOLE_READY_TIMEOUT_MS);
            await editor.fill(SEL.titleInput, title);
            await this.tryFill(editor, SEL.authorInput, String(content.metadata?.author ?? ''));
            await editor.waitFor(SEL.editor, CONSOLE_READY_TIMEOUT_MS);
            await editor.setInnerHtml(SEL.editor, markdownToWechatHtml(content.body));
            const digest = resolveDigest(content);
            if (digest) await this.tryFill(editor, SEL.summaryInput, digest);

            const enrichMeta = content.metadata?.wechatmp;
            if (enrichMeta && typeof enrichMeta === 'object' && !Array.isArray(enrichMeta)) {
                enrichWarnings = await this.enrichDraft(editor, enrichMeta as Record<string, unknown>);
            }

            if (want === 'draft') {
                await editor.click(SEL.saveDraftBtn);
            } else {
                await editor.click(SEL.publishBtn);
                await this.tryClick(editor, SEL.confirmBtn);
            }
            // Real consoles confirm the draft save by navigating from the isNew editor
            // (appmsg_edit_v2) to the saved-draft edit page carrying the new appmsgid.
            if (editor.waitForUrlFragment) {
                await editor.waitForUrlFragment('appmsg_edit&action=edit', CONSOLE_READY_TIMEOUT_MS);
            } else {
                const seen = await editor.waitForAny([SEL.toast], TOAST_TIMEOUT_MS);
                if (seen === '') {
                    return this.failed(
                        `save was clicked but no confirmation toast appeared within ${TOAST_TIMEOUT_MS}ms — verify the console manually`,
                    );
                }
            }
            const appmsgid = /appmsgid=(\d+)/.exec(editor.url())?.[1] ?? '';
            return {
                ok: true,
                target: TARGET,
                metadata: {
                    publishStatus: want,
                    note:
                        want === 'draft'
                            ? `saved to the WeChat MP draft box (草稿箱)${appmsgid ? ` as appmsgid ${appmsgid}` : ''}`
                            : 'published via the console 发表 flow',
                    ...(enrichWarnings.length > 0 ? { enrichWarnings } : {}),
                },
            };
        } catch (error: unknown) {
            const why = error instanceof Error ? error.message : String(error);
            const enrich = enrichWarnings.length > 0 ? ` (enrich warnings: ${enrichWarnings.join(' | ')})` : '';
            return this.failed(`console flow failed: ${why}${enrich}`);
        } finally {
            await page.close?.();
        }
    }

    /**
     * Set the operator's draft metadata (原创/作者/合集/创作来源/封面) in the v2 editor.
     * Runs on a FRESH draft only - the toggles are not state-aware (no idempotency for re-runs).
     * Per-field failures are collected into warnings and surfaced in the Result; the draft still saves.
     * Dialog mapping evidence (probes 2026-09-29, drafts 100000805/808): 原创 + 赞赏 share ONE dialog
     * (声明类型 radios, 作者 input, 确定) - the 赞赏 switch stays hidden for this account, so 赞赏 is a manual step;
     * 合集 dialog = 请选择合集 input + 确认; 创作来源 is an inline checkbox (no dialog); the 原文链接 row has
     * no reachable URL input in headless - also manual; cover accepts a direct input[type=file] set.
     * Commit verification (evalJs): the original dialog only closes when WeChat's validation passes - the
     * author is the reward (shang) account and must be picked from its search, which does not resolve for
     * this account headless; a non-closing dialog is swept and surfaced as a warning. Same for the
     * creation-source checkbox (DOM re-check).
     */
    private async enrichDraft(editor: WechatPage, meta: Record<string, unknown>): Promise<string[]> {
        const DIALOG = '.weui-desktop-dialog:visible';
        const CONFIRM = `${DIALOG} button:has-text("确认"), ${DIALOG} button:has-text("确定")`;
        const warnings: string[] = [];
        const str = (key: string) => (typeof meta[key] === 'string' ? (meta[key] as string) : '');
        const on = (key: string) => meta[key] === true;
        // Sweep any leaked dialog so the next step (especially 保存为草稿) is never overlay-blocked.
        const sweep = async () => {
            await this.tryClick(editor, 'button:has-text("取消")', 2000);
            await editor.press?.('Escape');
            await editor.waitForTimeout?.(400);
        };
        // One retry per step: the settings panel re-renders after dialog confirms and can briefly
        // detach rows (observed on the tags row right after the original-declaration confirm).
        const step = async (name: string, fn: () => Promise<void>) => {
            try {
                await fn();
                return;
            } catch {
                // retry once below
            }
            await sweep();
            await editor.waitForTimeout?.(1000);
            try {
                await fn();
            } catch (error) {
                warnings.push(`${name}: ${(error instanceof Error ? error.message : String(error)).slice(0, 120)}`);
                await sweep();
            }
        };
        if (on('original')) {
            await step('原创声明', async () => {
                await editor.click(SEL.originalSwitch, 10000);
                await editor.click(`${DIALOG} :text("文字原创")`, 8000);
                const author = str('author');
                if (author) await this.tryFill(editor, `${DIALOG} input[placeholder*="作者"]`, author);
                await editor.click(CONFIRM, 8000);
            });
            const committed = await editor.evalJs?.(
                `[...document.querySelectorAll('.weui-desktop-dialog')].every((d) => !d.offsetWidth)`,
            );
            if (committed === false) {
                warnings.push('原创声明: 未生效 - 作者须为赞赏账户(搜索选择)，请手动设置');
                await sweep();
            }
        }
        const collection = str('collection');
        if (collection) {
            await step('合集', async () => {
                await editor.click(SEL.tagRow, 8000);
                await editor.waitFor(SEL.tagInput, 8000);
                await editor.fill(SEL.tagInput, collection);
                await editor.waitForTimeout?.(1200);
                await editor.click(`${DIALOG} :text("${collection}")`, 8000);
                await editor.click(CONFIRM, 8000);
            });
        }
        if (on('aiGenerated')) {
            await step('创作来源', async () => {
                await editor.click(SEL.claimSourceCheckbox, 8000);
                // Probes show no dialog on current builds — the checkbox alone declares AI generation.
                const dialog = await editor.waitForAny([DIALOG], 3000);
                if (dialog) {
                    await editor.click(`${DIALOG} :text("内容由AI生成")`, 8000);
                    await editor.click(CONFIRM, 8000);
                }
            });
            const checked = await editor.evalJs?.(`!!document.querySelector('#js_claim_source_area input:checked')`);
            if (checked === false) warnings.push('创作来源: 勾选未生效，请手动设置');
        }
        const coverPath = str('coverPath');
        const putFile = editor.setInputFiles?.bind(editor);
        if (coverPath && putFile) {
            await step('封面', async () => {
                try {
                    await putFile('input[type="file"]', coverPath);
                } catch {
                    await editor.click(SEL.coverBtn, 8000);
                    await editor.waitForTimeout?.(1500);
                    await putFile('input[type="file"]', coverPath);
                }
                const cropBtn = await editor.waitForAny(
                    [`${DIALOG} button:has-text("完成")`, `${DIALOG} button:has-text("确定")`],
                    5000,
                );
                if (cropBtn) await editor.click(cropBtn, 8000);
            });
        }
        await sweep();
        return warnings;
    }

    private async tryFill(page: WechatPage, selector: string, value: string): Promise<void> {
        if (value === '') return;
        try {
            await page.fill(selector, value);
        } catch {
            // optional field — the console hides it for some account types
        }
    }

    private async tryClick(page: WechatPage, selector: string, timeoutMs?: number): Promise<void> {
        try {
            await page.click(selector, timeoutMs);
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
