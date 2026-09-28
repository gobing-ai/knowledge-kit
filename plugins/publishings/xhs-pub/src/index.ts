import { dirname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    FakeBrowserTransport,
    type PublishTransport,
    type PublishTransportPayload,
    resolveBrowserProfileDir,
    trySelectors,
} from '@gobing-ai/publish-harness';
import { openPersistentBrowser } from '@gobing-ai/ts-browser-automation';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';

export const CHANNEL = 'xhs';
const TARGET = 'xhs';
export const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish';
/** The console marks a completed publish in its own URL (measured live 2026-09-26). */
const PUBLISHED_MARKER = 'published=true';
export const LOGIN_TIMEOUT_MS = 120_000;
const STEP_TIMEOUT_MS = 30_000;
const POLL_MS = 500;
/** The console drops a submit click that lands while the note is still settling (live run 2026-09-25). */
const SUBMIT_SETTLE_MS = 2_500;
const SUBMIT_ATTEMPTS = 3;

/**
 * Selectors measured against the live XHS creator UI (2026-09-25 dogfood). Each list is
 * tried in order via the harness `trySelectors`.
 */
const SELECTORS = {
    // Login/UI gate. The creator console renders the image-post tab only for an
    // authenticated session, and it opens on the VIDEO tab — the note editor does not
    // exist until the image tab is entered.
    imageTab: ['div.creator-tab:has-text("图文")', 'text=上传图文'],
    // The image input is distinguishable from the video input by its accept list.
    fileInput: ['input[type="file"][accept*=".jpg"]', 'input[type="file"]'],
    // Uploaded previews carry XHS's own class spelling (`preivew`, not `preview`).
    thumbnail: ['img.preivew-image', '.img-preview img'],
    title: ['input[placeholder*="标题"]', '#title-textarea input'],
    // The note body is TipTap ProseMirror since 2026-09 (it was Quill `.ql-editor`).
    body: [
        'div.tiptap[contenteditable="true"]',
        'div[contenteditable="true"].ql-editor',
        '#post-textarea',
        '.ql-editor',
    ],
    draftBox: ['text=/草稿箱\\(\\d+\\)/', 'text=草稿箱'],
    publishConfirm: ['text=发布成功', 'text=已发布'],
} as const;

/**
 * The submit bar is the custom element `<XHS-PUBLISH-BTN>`, whose shadow root is CLOSED
 * (`shadowRoot === null`), so no CSS or text selector can reach it — `button:has-text(…)
 * and `text=…` can never match. Labels are resolved through CDP (`DOM.getDocument` with
 * `pierce: true` plus `DOM.getBoxModel`) and the control is clicked at its measured
 * centre, so the target is read, never guessed. XHS renamed the draft control to
 * `暂存离开`; the older labels stay as fallbacks.
 */
const SHADOW_CONTROLS = {
    draft: ['暂存离开', '存草稿', '保存草稿'],
    publish: ['发布'],
} as const;

export interface ShadowControl {
    label: string;
    x: number;
    y: number;
}

/** Locates a labelled control inside a closed shadow root (CDP-backed in production). */
export interface ShadowProbe {
    findControl(labels: readonly string[]): Promise<ShadowControl | null>;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

export interface XhsLocator {
    count(): Promise<number>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    fill(text: string, options?: { timeout?: number }): Promise<void>;
    click(options?: { timeout?: number; force?: boolean }): Promise<void>;
    /**
     * Type into the element. The XHS note body is a TipTap/ProseMirror editor: `fill` sets
     * the DOM text without the editor registering content, so a later save has nothing to
     * save and produces no observable draft.
     */
    type?(text: string, options?: { timeout?: number; delay?: number }): Promise<void>;
    textContent?(): Promise<string>;
}

/** Structural subset of the Playwright page the script driver uses. */
export interface XhsPage {
    goto(url: string, options?: { timeout?: number }): Promise<void>;
    locator(selector: string): { first(): XhsLocator; count(): Promise<number> };
    setInputFiles(selector: string, paths: readonly string[]): Promise<void>;
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
    url(): string;
    /** Click the first match inside the viewport — the console renders the tabs 3×. */
    clickInViewport?(selector: string): Promise<boolean>;
    /** Resolve a labelled control inside a closed shadow root. */
    findShadowControl?(labels: readonly string[]): Promise<ShadowControl | null>;
    /** Click at viewport coordinates. */
    clickAt?(x: number, y: number): Promise<void>;
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

export function wrapPlaywrightPage(raw: unknown, shadow?: ShadowProbe): XhsPage {
    const pw = raw as {
        goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
        locator(selector: string): {
            count(): Promise<number>;
            nth(index: number): {
                boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
                click(options?: Record<string, unknown>): Promise<void>;
            };
            first(): Record<string, (...args: unknown[]) => unknown> & Promise<unknown>;
        };
        setInputFiles(selector: string, paths: readonly string[]): Promise<void>;
        waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
        url(): string;
        viewportSize?(): { width: number; height: number } | null;
        mouse: { click(x: number, y: number): Promise<void> };
    };
    return {
        goto: (url, options) => pw.goto(url, options) as Promise<void>,
        locator: (selector) => ({
            count: () => pw.locator(selector).count(),
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
                    type: (text, options) =>
                        (
                            loc as unknown as {
                                pressSequentially(text: string, options?: { delay?: number }): Promise<void>;
                            }
                        ).pressSequentially(text, options),
                    textContent: () => (loc as unknown as { textContent(): Promise<string> }).textContent(),
                };
            },
        }),
        setInputFiles: (selector, paths) => pw.setInputFiles(selector, paths),
        waitForSelector: (selector, options) => pw.waitForSelector(selector, options),
        url: () => pw.url(),
        clickInViewport: async (selector) => {
            // The console renders the image tab several times; only the in-viewport instance is
            // the live control. Without a readable viewport those duplicates cannot be told
            // apart, so the step fails loud instead of clicking a maybe-off-screen copy.
            const viewport = pw.viewportSize?.() ?? null;
            if (viewport === null) return false;
            const total = await pw.locator(selector).count();
            for (let index = 0; index < total; index += 1) {
                const candidate = pw.locator(selector).nth(index);
                const box = await candidate.boundingBox().catch(() => null);
                if (!box || box.width === 0) continue;
                const outside = box.x < 0 || box.y < 0 || box.x >= viewport.width || box.y >= viewport.height;
                if (outside) continue;
                // The tab's inner span intercepts the hit test, so the click must be forced.
                await candidate.click({ force: true });
                return true;
            }
            return false;
        },
        findShadowControl: async (labels) => (shadow ? shadow.findControl(labels) : null),
        clickAt: (x, y) => pw.mouse.click(x, y),
    };
}

interface CdpSession {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

interface CdpNode {
    nodeName: string;
    nodeValue?: string;
    backendNodeId?: number;
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
}

/**
 * Resolve a labelled control inside a CLOSED shadow root via Chrome DevTools Protocol.
 * `pierce: true` is the only way in: the light DOM exposes neither the label nor the node,
 * so this is what makes the publish bar reachable without guessing coordinates.
 */
async function findControlViaCdp(session: CdpSession, labels: readonly string[]): Promise<ShadowControl | null> {
    const document = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as { root?: CdpNode };
    if (!document.root) return null;
    const wanted = new Set(labels);
    const text = (node: CdpNode): string =>
        node.nodeName === '#text' ? (node.nodeValue ?? '') : (node.children ?? []).map(text).join('');
    const hits: { label: string; backendNodeId: number }[] = [];
    const walk = (node: CdpNode): void => {
        if (hits.length > 0) return;
        for (const shadowRoot of node.shadowRoots ?? []) {
            walk(shadowRoot);
            if (hits.length > 0) return;
        }
        if (node.nodeName === 'BUTTON') {
            const label = text(node).replace(/\s+/g, '');
            if (wanted.has(label) && typeof node.backendNodeId === 'number') {
                hits.push({ label, backendNodeId: node.backendNodeId });
                return;
            }
        }
        for (const child of node.children ?? []) {
            walk(child);
            if (hits.length > 0) return;
        }
    };
    walk(document.root);
    const hit = hits[0];
    if (!hit) return null;
    const box = (await session.send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId })) as {
        model?: { content?: number[] };
    };
    const quad = box.model?.content;
    if (!quad || quad.length < 8) return null;
    // Quad layout is [x1,y1, x2,y2, x3,y3, x4,y4]; the centre is ((x1+x3)/2, (y1+y4)/2).
    const [x1 = 0, y1 = 0, x3 = 0, , , y4 = 0] = quad;
    return {
        label: hit.label,
        x: Math.round((x1 + x3) / 2),
        y: Math.round((y1 + y4) / 2),
    };
}

/** CDP is Chromium-only; when unavailable the submit step fails loud instead of guessing. */
export async function createShadowProbe(
    context: { newCDPSession?(page: unknown): Promise<CdpSession> },
    page: unknown,
): Promise<ShadowProbe | undefined> {
    if (typeof context.newCDPSession !== 'function') return undefined;
    try {
        const session = await context.newCDPSession(page);
        await session.send('DOM.enable');
        return { findControl: (labels) => findControlViaCdp(session, labels) };
    } catch {
        return undefined;
    }
}

/**
 * XHS-owned readiness predicate: the image-post tab renders only for an authenticated
 * creator console. Shared by the publish login gate and the profile-session capability
 * (src/profile-check.ts) so both spell the authentication signal exactly once.
 */
export async function isXhsConsoleReady(page: XhsPage): Promise<boolean> {
    return trySelectors(page, SELECTORS.imageTab).then((r) => r.found);
}

/**
 * Production launcher: the upstream typed persistent-context opener (0177). Named so the
 * migration is provable offline — tests assert this binding, never launch a real browser.
 */
export const defaultLauncher: (options: { profileDir: string; headless: boolean }) => Promise<unknown> =
    openPersistentBrowser;

/**
 * Build the default page opener. The launcher is injected so the seam (page wrapping, shadow
 * probe wiring, context close, launch-failure message) is testable without launching a browser;
 * production uses the upstream typed `openPersistentBrowser` (@gobing-ai/ts-browser-automation).
 */
export function makeDefaultOpenPage(
    launch: (options: { profileDir: string; headless: boolean }) => Promise<unknown> = defaultLauncher,
): OpenPage {
    return async (profileDir) => {
        let context: unknown;
        try {
            context = await launch({ profileDir, headless: false });
        } catch (error) {
            throw new Error(
                `browser launch: ${error instanceof Error ? error.message : String(error)} — install with: bunx playwright install chromium`,
            );
        }
        const ctx = context as {
            pages(): unknown[];
            newPage(): Promise<unknown>;
            close(): Promise<void>;
            newCDPSession?(page: unknown): Promise<CdpSession>;
        };
        const raw = ctx.pages()[0] ?? (await ctx.newPage());
        const shadow = await createShadowProbe(ctx, raw);
        return { page: wrapPlaywrightPage(raw, shadow), close: () => ctx.close() };
    };
}

/** Default seam: persistent Chromium on the channel profile, headed for first login. */
export const defaultOpenPage: OpenPage = makeDefaultOpenPage();

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
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const found = await trySelectors(page, selectors);
        if (found.found && found.selector) return found.selector;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`${what}: no matching element observed`);
}

/**
 * Find the first selector that is ATTACHED, ignoring visibility. Upload widgets hide the
 * real `<input type="file">` behind a styled drop zone, and `trySelectors` filters on
 * visibility by default — so a hidden input needs this probe. Uploading into the wrong
 * input is still caught: the thumbnail count must match the payload afterwards.
 */
async function findAttachedSelector(
    page: XhsPage,
    selectors: readonly string[],
    what: string,
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (const selector of selectors) {
            const attached = await page
                .locator(selector)
                .count()
                .catch(() => 0);
            if (attached > 0) return selector;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`${what}: no matching element observed`);
}

export class XhsBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriverName;
    private readonly loginTimeoutMs: number;
    private readonly stepTimeoutMs: number;
    private readonly submitSettleMs: number;
    private readonly submitAttempts: number;
    private readonly openPage: OpenPage;

    constructor(
        driver: BrowserDriverName = 'script',
        opts?: {
            loginTimeoutMs?: number;
            stepTimeoutMs?: number;
            submitSettleMs?: number;
            submitAttempts?: number;
            openPage?: OpenPage;
        },
    ) {
        this.driver = driver;
        this.loginTimeoutMs = opts?.loginTimeoutMs ?? LOGIN_TIMEOUT_MS;
        this.stepTimeoutMs = opts?.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.submitSettleMs = opts?.submitSettleMs ?? SUBMIT_SETTLE_MS;
        this.submitAttempts = opts?.submitAttempts ?? SUBMIT_ATTEMPTS;
        this.openPage = opts?.openPage ?? defaultOpenPage;
    }

    /**
     * Read the console's draft counter (`草稿箱(N)`). It exists only on the landing view: the
     * image editor replaces the header, so this must be read before entering the tab. Returns
     * null when the label carries no number yet.
     */
    private async readDraftCount(page: XhsPage): Promise<number | null> {
        for (const selector of SELECTORS.draftBox) {
            // Attachment, not visibility: the label lives in a panel that may be collapsed.
            const attached = await page
                .locator(selector)
                .count()
                .catch(() => 0);
            if (attached === 0) continue;
            const locator = page.locator(selector).first();
            if (!locator.textContent) continue;
            const text = await locator.textContent().catch(() => '');
            const match = /草稿箱\s*[（(]\s*(\d+)\s*[）)]/.exec(text);
            if (match?.[1] !== undefined) return Number(match[1]);
        }
        return null;
    }

    /**
     * Timestamps the console prints for a saved draft, e.g. `保存于2026-09-25 21:37`.
     * The current and previous two minutes are accepted so a save near a minute boundary
     * still confirms.
     */
    private static draftSavedStamps(now = new Date()): string[] {
        const pad = (value: number) => String(value).padStart(2, '0');
        return [0, 1, 2].map((minutesAgo) => {
            const stamp = new Date(now.getTime() - minutesAgo * 60_000);
            return `保存于${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
        });
    }

    /**
     * A draft counts as observed when the console prints a fresh save timestamp, or the draft
     * counter (readable again once the save dismisses the editor) has moved past its pre-entry
     * value. Anything else stays an explicit failure — XHS autosave means "no signal" is not
     * evidence of a saved draft.
     */
    /**
     * Which candidate save stamps are already on the page — the baseline a later check diffs
     * against, so a pre-existing entry can never be read as this run's save.
     */
    private async readDraftStamps(page: XhsPage): Promise<string[]> {
        const present: string[] = [];
        for (const stamp of XhsBrowserTransport.draftSavedStamps()) {
            const attached = await page
                .locator(`text=${stamp}`)
                .count()
                .catch(() => 0);
            if (attached > 0) present.push(stamp);
        }
        return present;
    }

    /** Draft evidence captured before the editor opens (the counter only exists on that view). */
    private async readDraftBaseline(page: XhsPage): Promise<{ count: number | null; stamps: string[] }> {
        return { count: await this.readDraftCount(page), stamps: await this.readDraftStamps(page) };
    }

    /**
     * A draft counts as observed only from a DELTA against the pre-entry baseline: the console's
     * draft counter moved, or a save timestamp appeared that was not already there. A readable
     * counter with no usable baseline is NOT evidence — XHS autosaves uploads, so "the counter
     * exists" says nothing about this save. No delta ⇒ the caller fails loud.
     */
    private async isDraftSaved(
        page: XhsPage,
        baseline: { count: number | null; stamps: readonly string[] },
    ): Promise<boolean> {
        const stamps = await this.readDraftStamps(page);
        if (stamps.some((stamp) => !baseline.stamps.includes(stamp))) return true;
        const after = await this.readDraftCount(page);
        if (baseline.count === null || after === null) return false;
        return after > baseline.count;
    }

    /**
     * Click a labelled control inside the CLOSED shadow publish bar. The label and box come
     * from CDP, so the click is aimed at a read target rather than a guessed coordinate; a
     * driver without that capability fails loud instead of clicking blind.
     */
    private async clickShadowControl(
        page: XhsPage,
        labels: readonly string[],
    ): Promise<{ ok: true; label: string; x: number; y: number } | { ok: false; error: string }> {
        if (!page.findShadowControl || !page.clickAt) {
            return {
                ok: false,
                error: `submit control: the ${CHANNEL} publish bar lives in a closed shadow root and this driver has no CDP access to resolve it`,
            };
        }
        const control = await page.findShadowControl(labels);
        if (!control) {
            return {
                ok: false,
                error: `submit control: none of [${labels.join(', ')}] found in the ${CHANNEL} publish bar (closed shadow root)`,
            };
        }
        await page.clickAt(control.x, control.y);
        return { ok: true, label: control.label, x: control.x, y: control.y };
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
        const act = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
            try {
                return await fn();
            } catch (error) {
                throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
            }
        };
        try {
            await act('creator page goto', () => page.goto(PUBLISH_URL, { timeout: this.loginTimeoutMs }));

            // Login/UI gate: the image-post tab is rendered only for an authenticated
            // creator console, and it is what the driver must switch to before the note
            // editor exists (the console opens on the video tab).
            const gated = await waitUntil(() => isXhsConsoleReady(page), this.loginTimeoutMs);
            if (!gated) {
                return fail(
                    `login timeout after ${this.loginTimeoutMs}ms: no authenticated ${CHANNEL} creator console in ${profileDir}`,
                );
            }

            const step = (selectors: readonly string[], what: string) =>
                findSelector(page, selectors, what, this.stepTimeoutMs);
            // The draft counter and any save timestamps exist only on the landing view, so the
            // baseline is captured before the tab switch replaces the header with the editor.
            const draftBaseline =
                publishStatus === 'draft' ? await this.readDraftBaseline(page) : { count: null, stamps: [] };
            const tabSelector = await step(SELECTORS.imageTab, 'image-post tab');
            const clickInViewport = page.clickInViewport;
            if (clickInViewport) {
                const switched = await act('image-post tab click', () => clickInViewport.call(page, tabSelector));
                if (!switched) return fail('image-post tab click: no in-viewport image tab found');
            } else {
                await act('image-post tab click', () => page.locator(tabSelector).first().click({ force: true }));
            }

            const fileSelector = await findAttachedSelector(
                page,
                SELECTORS.fileInput,
                'image file input',
                this.stepTimeoutMs,
            );
            await act('image upload', () => page.setInputFiles(fileSelector, paths));

            const thumbSelector = await step(SELECTORS.thumbnail, 'thumbnail wait');
            const countMatches = await waitUntil(
                () =>
                    act('thumbnail count read', () => page.locator(thumbSelector).count()).then(
                        (n) => n >= paths.length,
                    ),
                this.stepTimeoutMs,
            );
            const thumbCount = await act('thumbnail count read', () => page.locator(thumbSelector).count());
            if (!countMatches || thumbCount !== paths.length) {
                return fail(`thumbnail count: expected ${paths.length}, observed ${thumbCount}`);
            }

            const titleSelector = await step(SELECTORS.title, 'title input');
            await act('title fill', () =>
                page
                    .locator(titleSelector)
                    .first()
                    .fill(payload.content.title ?? ''),
            );
            const bodySelector = await step(SELECTORS.body, 'note body');
            // Type rather than fill: TipTap ignores a synthetic value set, so a filled body
            // leaves the note unsaved and the draft never becomes observable.
            await act('body fill', async () => {
                const body = page.locator(bodySelector).first();
                const text = payload.content.body ?? '';
                if (typeof body.type === 'function') {
                    await body.click();
                    await body.type(text, { delay: 5 });
                    return;
                }
                await body.fill(text);
            });

            if (publishStatus === 'draft') {
                // "暂存离开" needs the image editor's content to have registered; a click that
                // lands mid-settle is dropped, so settle, click, then give the save a window in
                // which to become observable — bounded, and never a blind coordinate guess.
                let submitted: { label: string; x: number; y: number } | null = null;
                let confirmed = false;
                let attempts = 0;
                while (!confirmed && attempts < this.submitAttempts) {
                    attempts += 1;
                    await new Promise((resolve) => setTimeout(resolve, this.submitSettleMs));
                    const clicked = await this.clickShadowControl(page, SHADOW_CONTROLS.draft);
                    if (!clicked.ok) return fail(clicked.error);
                    submitted = clicked;
                    confirmed = await waitUntil(() => this.isDraftSaved(page, draftBaseline), this.submitSettleMs);
                }
                const draftCountAfter = await this.readDraftCount(page);
                if (!confirmed || submitted === null) {
                    return fail(
                        `draft confirmation: '${submitted?.label ?? SHADOW_CONTROLS.draft[0]}' was clicked ${attempts}× but neither a fresh ${CHANNEL} save timestamp nor a moved draft counter was observed (before=${String(draftBaseline.count)}, after=${String(draftCountAfter)})`,
                    );
                }
                return ResultSchema.parse({
                    ok: true,
                    target: TARGET,
                    message: `${TARGET} draft saved (unpublished) in profile ${profileDir} via '${submitted.label}'`,
                    metadata: {
                        ...base,
                        draftControl: submitted.label,
                        draftClick: `${submitted.x},${submitted.y}`,
                        draftAttempts: attempts,
                        draftCountBefore: draftBaseline.count,
                        draftCountAfter,
                    },
                });
            }

            // Publish: ONE click, no retry — an unobserved publish must never be repeated, and the
            // console drops a click that lands while the note is still settling (measured live).
            await new Promise((resolve) => setTimeout(resolve, this.submitSettleMs));
            const submitted = await this.clickShadowControl(page, SHADOW_CONTROLS.publish);
            if (!submitted.ok) return fail(submitted.error);

            const urlBeforeSubmit = page.url();
            const confirmed = await waitUntil(async () => {
                // The console rewrites its URL to `…published=true` once the post is accepted;
                // the text hints stay as fallbacks for console variants.
                if (page.url().includes(PUBLISHED_MARKER)) return true;
                return trySelectors(page, SELECTORS.publishConfirm)
                    .then((r) => r.found)
                    .catch(() => false);
            }, this.stepTimeoutMs);
            if (!confirmed) {
                return fail(
                    `publish submission: state unknown — the '${submitted.label}' click at ${submitted.x},${submitted.y} was sent from ${urlBeforeSubmit} but no success state was observed (now ${page.url()}). Check the ${CHANNEL} creator note manager before retrying: a retry could duplicate the post.`,
                );
            }
            const url = page.url();
            return ResultSchema.parse({
                ok: true,
                target: TARGET,
                ...(url !== PUBLISH_URL ? { url } : {}),
                message: `${TARGET} post published`,
                metadata: {
                    ...base,
                    publishControl: submitted.label,
                    publishClick: `${submitted.x},${submitted.y}`,
                    publishSignal: url.includes(PUBLISHED_MARKER) ? `url:${PUBLISHED_MARKER}` : 'text',
                },
            });
        } catch (error) {
            return fail(error instanceof Error ? error.message : String(error));
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
