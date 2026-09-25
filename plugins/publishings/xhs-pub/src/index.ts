import { dirname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeBrowserTransport,
    launchPersistentBrowser,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
    trySelectors,
} from '@gobing-ai/publish-harness';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

const CHANNEL = 'xhs';
const TARGET = 'xhs';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
const LOGIN_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 30_000;
const POLL_MS = 500;

/**
 * Selectors are verified against the live XHS creator UI during manual dogfood;
 * they are deliberately not frozen by the design (docs/design/xhs-image-cards.md
 * § Checks and limits). Each list is tried in order via the harness `trySelectors`.
 */
const SELECTORS = {
    editor: ['div[contenteditable="true"]', '.ql-editor', 'textarea[placeholder]'],
    login: ['text=扫码登录', 'text=登录', '.login-container'],
    imageTab: ['text=上传图文', '.creator-tab:has-text("图文")'],
    fileInput: ['input[type="file"]'],
    thumbnail: ['.img-preview img', '[class*="preview"] img', '[class*="thumb"] img'],
    title: ['#title-textarea input', 'input[placeholder*="标题"]', '.title-input input'],
    body: ['div[contenteditable="true"].ql-editor', '#post-textarea', '.ql-editor'],
    saveDraft: ['button:has-text("存草稿")', 'button:has-text("保存草稿")'],
    draftConfirm: ['text=草稿已保存', 'text=已保存至草稿箱'],
    publish: ['button:has-text("发布")'],
    publishConfirm: ['text=发布成功', 'text=已发布'],
} as const;

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

export interface XhsLocator {
    count(): Promise<number>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    fill(text: string, options?: { timeout?: number }): Promise<void>;
    click(options?: { timeout?: number }): Promise<void>;
}

/** Structural subset of the Playwright page the script driver uses. */
export interface XhsPage {
    goto(url: string, options?: { timeout?: number }): Promise<void>;
    locator(selector: string): { first(): XhsLocator };
    setInputFiles(selector: string, paths: readonly string[]): Promise<void>;
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
    url(): string;
}

export interface OpenedPage {
    page: XhsPage;
    close(): Promise<void>;
}

export type OpenPage = (profileDir: string) => Promise<OpenedPage>;

interface ValidationResult {
    paths?: string[];
    error?: string;
}

/** Pure pre-browser validation: image shape/abs/existence/extension + publishStatus. */
export async function validatePublishInput(content: Content): Promise<ValidationResult> {
    const status = content.metadata?.publishStatus;
    if (status !== undefined && status !== 'draft' && status !== 'public') {
        return { error: `images validation: unknown publishStatus '${String(status)}' (expected 'draft' or 'public')` };
    }
    const images = content.metadata?.images;
    if (!Array.isArray(images) || images.length === 0) {
        return { error: 'images validation: metadata.images must be a non-empty ordered array' };
    }
    const fs = createNodeFileSystem();
    const paths: string[] = [];
    for (const [i, image] of images.entries()) {
        const path = (image as { path?: unknown })?.path;
        if (typeof path !== 'string' || path.length === 0) {
            return { error: `images validation: images[${i}].path is missing` };
        }
        if (!isAbsolute(path)) {
            return { error: `images validation: images[${i}].path must be absolute, got '${path}'` };
        }
        if (!/\.(png|jpe?g|webp)$/i.test(path)) {
            return {
                error: `images validation: images[${i}].path has unsupported extension (expected png|jpg|jpeg|webp): '${path}'`,
            };
        }
        if (!(await fs.exists(path))) {
            return { error: `images validation: images[${i}].path does not exist: '${path}'` };
        }
        paths.push(path);
    }
    return { paths };
}

export function wrapPlaywrightPage(raw: unknown): XhsPage {
    const pw = raw as {
        goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
        locator(selector: string): { first(): Record<string, (...args: unknown[]) => unknown> & Promise<unknown> };
        setInputFiles(selector: string, paths: readonly string[]): Promise<void>;
        waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
        url(): string;
    };
    return {
        goto: (url, options) => pw.goto(url, options) as Promise<void>,
        locator: (selector) => ({
            first: () => {
                const loc = pw.locator(selector).first() as unknown as {
                    count(): Promise<number>;
                    isVisible(o?: Record<string, unknown>): Promise<boolean>;
                    fill(t: string, o?: Record<string, unknown>): Promise<void>;
                    click(o?: Record<string, unknown>): Promise<void>;
                };
                return {
                    count: () => loc.count(),
                    isVisible: (options) => loc.isVisible(options),
                    fill: (text, options) => loc.fill(text, options),
                    click: (options) => loc.click(options),
                };
            },
        }),
        setInputFiles: (selector, paths) => pw.setInputFiles(selector, paths),
        waitForSelector: (selector, options) => pw.waitForSelector(selector, options),
        url: () => pw.url(),
    };
}

/** Default seam: persistent Chromium on the channel profile, headed for first login. */
export const defaultOpenPage: OpenPage = async (profileDir) => {
    let context: unknown;
    try {
        context = await launchPersistentBrowser({ profileDir, headless: false });
    } catch (error) {
        throw new Error(
            `browser launch: ${error instanceof Error ? error.message : String(error)} — install with: bunx playwright install chromium`,
        );
    }
    const ctx = context as { pages(): unknown[]; newPage(): Promise<unknown>; close(): Promise<void> };
    const raw = ctx.pages()[0] ?? (await ctx.newPage());
    return { page: wrapPlaywrightPage(raw), close: () => ctx.close() };
};

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    return predicate();
}

async function findSelector(
    page: XhsPage,
    selectors: readonly string[],
    what: string,
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string> {
    const result = await waitUntil(() => trySelectors(page, selectors).then((r) => r.found), timeoutMs);
    if (!result) throw new Error(`${what}: no matching element observed`);
    const found = await trySelectors(page, selectors);
    const fallback = selectors[0];
    if (!fallback) throw new Error(`${what}: selector list is empty`);
    return found.selector ?? fallback;
}

export class XhsBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriverName;
    private readonly loginTimeoutMs: number;
    private readonly stepTimeoutMs: number;
    private readonly openPage: OpenPage;

    constructor(
        driver: BrowserDriverName = 'script',
        opts?: { loginTimeoutMs?: number; stepTimeoutMs?: number; openPage?: OpenPage },
    ) {
        this.driver = driver;
        this.loginTimeoutMs = opts?.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
        this.stepTimeoutMs = opts?.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.openPage = opts?.openPage ?? defaultOpenPage;
    }

    public async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(
                `unsupported driver '${this.driver}' for ${TARGET}: image posts require the script driver (Playwright setInputFiles)`,
            );
        }
        const override =
            typeof payload.options?.profileDir === 'string'
                ? payload.options.profileDir
                : (process.env.XHS_PROFILE_DIR ?? process.env.KK_BROWSER_PROFILE_DIR);
        const profileDir = resolveBrowserProfileDir(CHANNEL, override);
        const validation = await validatePublishInput(payload.content);
        if (validation.error) return fail(validation.error);
        const paths = validation.paths ?? [];
        const publishStatus = payload.content.metadata?.publishStatus === 'public' ? 'public' : 'draft';
        const base = { driver: this.driver, publishStatus, profileDir, imageCount: paths.length };

        let opened: OpenedPage;
        try {
            opened = await this.openPage(profileDir);
        } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
        }
        const { page, close } = opened;
        try {
            await page.goto(PUBLISH_URL, { timeout: this.loginTimeoutMs });
            const editor = await findSelector(page, SELECTORS.editor, 'login/editor wait', this.loginTimeoutMs).catch(
                () => null,
            );
            if (!editor) {
                return fail(
                    `login timeout after ${this.loginTimeoutMs}ms: no authenticated ${CHANNEL} session in ${profileDir}`,
                );
            }

            const step = (selectors: readonly string[], what: string) =>
                findSelector(page, selectors, what, this.stepTimeoutMs);
            await step(SELECTORS.imageTab, 'image-post tab');
            await step(SELECTORS.fileInput, 'file input');
            await page.setInputFiles(SELECTORS.fileInput[0], paths);

            const thumbSelector = await step(SELECTORS.thumbnail, 'thumbnail wait');
            const countMatches = await waitUntil(
                () =>
                    page
                        .locator(thumbSelector)
                        .first()
                        .count()
                        .then((n) => n >= paths.length),
                this.stepTimeoutMs,
            );
            const thumbCount = await page.locator(thumbSelector).first().count();
            if (!countMatches || thumbCount !== paths.length) {
                return fail(`thumbnail count: expected ${paths.length}, observed ${thumbCount}`);
            }

            await step(SELECTORS.title, 'title input');
            await page
                .locator(SELECTORS.title[0])
                .first()
                .fill(payload.content.title ?? '');
            await step(SELECTORS.body, 'note body');
            await page
                .locator(SELECTORS.body[0])
                .first()
                .fill(payload.content.body ?? '');

            if (publishStatus === 'draft') {
                await step(SELECTORS.saveDraft, 'save-draft button');
                await page.locator(SELECTORS.saveDraft[0]).first().click();
                const confirmed = await waitUntil(
                    () => trySelectors(page, SELECTORS.draftConfirm).then((r) => r.found),
                    this.stepTimeoutMs,
                );
                if (!confirmed) {
                    return fail('draft confirmation: draft-saved confirmation not observed; draft not confirmed');
                }
                return ResultSchema.parse({
                    ok: true,
                    target: TARGET,
                    message: `${TARGET} draft saved (unpublished) in profile ${profileDir}`,
                    metadata: base,
                });
            }

            await step(SELECTORS.publish, 'publish button');
            await page.locator(SELECTORS.publish[0]).first().click();
            const confirmed = await waitUntil(
                () => trySelectors(page, SELECTORS.publishConfirm).then((r) => r.found),
                this.stepTimeoutMs,
            );
            if (!confirmed) {
                return fail(
                    `publish submission: state unknown — the submit click was sent but no success state was observed. Check the ${CHANNEL} creator note manager before retrying: a retry could duplicate the post.`,
                );
            }
            const url = page.url();
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(url !== PUBLISH_URL ? { url } : {}),
                message: `${TARGET} post published`,
                metadata: base,
            });
        } finally {
            await close();
        }
    }
}

type BrowserDriverName = 'script' | 'agent';

export function getPublishTransport(driver: BrowserDriverName = 'script'): PublishTransport {
    if (process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT === 'fake') {
        return new FakeBrowserTransport(driver);
    }
    return new XhsBrowserTransport(driver);
}

async function writePublishResult(outputPath: string, result: Result): Promise<void> {
    const outDir = dirname(outputPath);
    if (outDir && outDir !== '.') await createNodeFileSystem().ensureDir(outDir);
    await createNodeFileSystem().writeFile(outputPath, JSON.stringify(result, null, 2));
}

export async function processPublishIO(
    inputPath: string,
    outputPath: string,
    transport: PublishTransport = getPublishTransport(),
): Promise<void> {
    await createNodeFileSystem().deleteFile(outputPath);
    let content: Content;
    let options: Record<string, unknown> | undefined;
    try {
        const raw = JSON.parse(await createNodeFileSystem().readFile(inputPath)) as Record<string, unknown>;
        content = ContentSchema.parse(raw);
        if (raw.options !== undefined && typeof raw.options === 'object' && raw.options !== null) {
            options = raw.options as Record<string, unknown>;
        }
    } catch (error: unknown) {
        const message = `Invalid Content input: ${error instanceof Error ? error.message : String(error)}`;
        await writePublishResult(outputPath, fail(message));
        throw new Error(message);
    }
    const result = ResultSchema.parse(await transport.publish({ content, options }));
    await writePublishResult(outputPath, result);
    if (!result.ok) throw new Error(result.error ?? 'Publish failed');
}

export async function main(): Promise<number> {
    let values: { in?: string; out?: string };
    try {
        ({ values } = parseArgs({ options: { in: { type: 'string' }, out: { type: 'string' } } }));
    } catch (error: unknown) {
        echoError(`Invalid arguments: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
    if (!values.in || !values.out) {
        echoError('Missing required arguments: --in and --out');
        return 1;
    }
    try {
        await processPublishIO(values.in, values.out);
        return 0;
    } catch (error: unknown) {
        echoError(`xhs-pub failed: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

if (import.meta.main) {
    process.exit(await main());
}
