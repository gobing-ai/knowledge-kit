import { trySelectors } from '@gobing-ai/publish-harness';
import { waitUntil } from '@gobing-ai/publish-harness/browser';
import type { Page, Request } from 'playwright';

/**
 * The console's page seam (ADR-029) and the probes every wechatmp operation shares.
 *
 * `WechatPage` is deliberately a structural subset of the Playwright `Page`: the flows are driven
 * through it so the offline tests can script the console (fake page) instead of launching a
 * browser, while the shared `@gobing-ai/publish-harness/browser` helpers (pasteHtml, uploadFile,
 * expectOutcome, readScopedSignal) reach the same object through the type-level bridge in `./flow`.
 *
 * `OpenedConsole` is context-level, not page-level, because the console opens the editor in a NEW
 * TAB (discovery §1: `pages()` becomes 2 after a creation-type click) — a flow bound to one page
 * object never sees the editor, so the seam has to expose the sibling pages.
 */

export const POLL_MS = 500;
export const STEP_TIMEOUT_MS = 30_000;

/** Browser evidence may retain navigation context, but never its session query credentials. */
export function sanitizeSessionEvidence(value: string): string {
    return value.replace(/([?&](?:token|ticket|authkey)=)[^&\s"'<>)]*/gi, '$1[REDACTED]');
}

/** The playwright-shaped locator surface the flows and the shared helpers read. */
export interface WechatLocator {
    count(): Promise<number>;
    isVisible(options?: { timeout?: number }): Promise<boolean>;
    fill(text: string, options?: { timeout?: number }): Promise<void>;
    click(options?: { timeout?: number; force?: boolean }): Promise<void>;
    /**
     * Type into the element. Both ProseMirror blocks (title and body) register content only from
     * real input events — a value set leaves the editor empty, so the save has nothing to persist.
     */
    type?(text: string, options?: { timeout?: number; delay?: number }): Promise<void>;
    /** Wait for an element state; the enrichment rail waits on dialogs and pickers. */
    waitFor?(options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>;
    textContent?(): Promise<string>;
    /** A form control's value — how the `textarea#title` mirror trap is detected (discovery §5.2). */
    inputValue?(): Promise<string>;
}

export interface WechatPage {
    /** Click the native article save and await its successful, fully received acknowledgement. */
    saveDraftAndWait?(selector: string, timeoutMs: number): Promise<void>;
    goto(url: string, options?: { timeout?: number }): Promise<void>;
    locator(selector: string): { first(): WechatLocator; count(): Promise<number> };
    setInputFiles(selector: string, paths: readonly string[] | string): Promise<void>;
    url(): string;
    /** Page-side script evaluation; the enrichment rail's commit checks run through it. */
    evaluate(expression: string): Promise<unknown>;
    waitForTimeout?(ms: number): Promise<void>;
    /** A page-level key press (the enrichment rail's dialog sweep). */
    press?(key: string): Promise<void>;
    /** The page's frames, for naming what a failed read actually contained. */
    frames?(): WechatFrame[];
}

/** One frame of the console page: enough to name it and count a signal inside it. */
export interface WechatFrame {
    url(): string;
    locator(selector: string): { count(): Promise<number> };
}

/** One browser context: the console home, plus every page it holds (the editor opens in a new tab). */
export interface OpenedConsole {
    /** The entry page the flows start from — the console home, where the 草稿箱 lives. */
    page: WechatPage;
    /** Every page the context holds, entry first. */
    pages(): WechatPage[];
    /** Opens an extra tab; the token-derived editor fallback uses it so the home stays readable. */
    newPage(): Promise<WechatPage>;
    /** Best-effort authenticated state snapshot owned by the launcher; absent for read-only seams. */
    persistSession?: () => Promise<void>;
    close(): Promise<void>;
}

export type OpenConsole = (profileDir: string) => Promise<OpenedConsole>;

/**
 * Modal state measured from the live DOM. A throwing or non-boolean probe is `unknown` — never
 * `closed` (task 0260 R3: an unreadable overlay must not be treated as cleaned up, or a later step
 * clicks through a footer it cannot see).
 */
export async function modalState(page: WechatPage): Promise<'closed' | 'open' | 'unknown'> {
    try {
        const raw = await page.evaluate(
            `[...document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog')].some((d) => d.offsetWidth)`,
        );
        return raw === true ? 'open' : raw === false ? 'closed' : 'unknown';
    } catch {
        return 'unknown';
    }
}

/** A selector with an ATTACHED match (hidden inputs included), or `undefined` at the deadline. */
async function tryFindAttachedSelector(
    page: WechatPage,
    selectors: readonly string[],
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string | undefined> {
    let found: string | undefined;
    await waitUntil(async () => {
        for (const selector of selectors) {
            const attached = await page
                .locator(selector)
                .count()
                .catch(() => 0);
            if (attached > 0) {
                found = selector;
                return true;
            }
        }
        return false;
    }, timeoutMs);
    return found;
}

/** A selector with a VISIBLE match, or `undefined` at the deadline (the menu renders closed). */
export async function tryFindSelector(
    page: WechatPage,
    selectors: readonly string[],
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string | undefined> {
    let found: string | undefined;
    await waitUntil(async () => {
        const result = await trySelectors(page, selectors).catch(() => ({ found: false, selector: null }));
        if (result.found && result.selector) {
            found = result.selector;
            return true;
        }
        return false;
    }, timeoutMs);
    return found;
}

/** Polls until a visible match exists, then throws naming `what`, the candidates and the deadline. */
export async function findSelector(
    page: WechatPage,
    selectors: readonly string[],
    what: string,
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string> {
    const found = await tryFindSelector(page, selectors, timeoutMs);
    if (found === undefined) {
        throw new Error(`${what}: none of [${selectors.join(' | ')}] visible within ${timeoutMs}ms`);
    }
    return found;
}

/**
 * Polls until an ATTACHED match exists, then throws naming `what`.
 *
 * Attachment — not visibility — is the rule for upload inputs: the media modals hide the real
 * `input[type=file]` behind a styled control, and `trySelectors` filters on visibility by default.
 */
export async function findAttachedSelector(
    page: WechatPage,
    selectors: readonly string[],
    what: string,
    timeoutMs = STEP_TIMEOUT_MS,
): Promise<string> {
    const found = await tryFindAttachedSelector(page, selectors, timeoutMs);
    if (found === undefined) {
        throw new Error(`${what}: none of [${selectors.join(' | ')}] attached within ${timeoutMs}ms`);
    }
    return found;
}

/**
 * Follow the tab a creation-type click opens (discovery §1: "`ctx.pages()` becomes 2 … any walker
 * must follow the newest page"). Returns `undefined` at the deadline instead of quietly staying on
 * the entry page — a flow that keeps driving the console home would type into nothing.
 */
export async function followNewPage(
    pages: () => WechatPage[],
    before: number,
    timeoutMs: number,
): Promise<WechatPage | undefined> {
    const opened = await waitUntil(async () => pages().length > before, timeoutMs);
    if (!opened) return undefined;
    const all = pages();
    return all[all.length - 1];
}

/** Click the first match of `selector`, waiting for actionability within the step timeout. */
export async function clickSelector(page: WechatPage, selector: string, timeoutMs = STEP_TIMEOUT_MS): Promise<void> {
    await page.locator(selector).first().click({ timeout: timeoutMs });
}

/** Fill the first match of `selector`; no `force`, so a covered control is never written through. */
export async function fillSelector(page: WechatPage, selector: string, value: string): Promise<void> {
    await page.locator(selector).first().fill(value);
}

interface PlaywrightLike {
    goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
    locator(selector: string): {
        count(): Promise<number>;
        first(): {
            count(): Promise<number>;
            isVisible(options?: { timeout?: number }): Promise<boolean>;
            fill(text: string, options?: Record<string, unknown>): Promise<void>;
            click(options?: Record<string, unknown>): Promise<void>;
            pressSequentially(text: string, options?: { delay?: number }): Promise<void>;
            waitFor(options?: Record<string, unknown>): Promise<void>;
            textContent(): Promise<string | null>;
            inputValue(): Promise<string>;
        };
    };
    setInputFiles(selector: string, paths: readonly string[] | string): Promise<void>;
    url(): string;
    evaluate(expression: string): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    keyboard: { press(key: string): Promise<void> };
}

/** The production adapter: the structural seam over a real Playwright page. */
/** The raw Playwright frame surface the inventory needs (see `wrapPlaywrightPage`). */
interface RawFrame {
    url(): string;
    locator(selector: string): { count(): Promise<number> };
}

/** Match a new full-article save, excluding reads and other operations at the shared endpoint. */
function isArticleSave(request: Request, origin: string): boolean {
    if (request.method() !== 'POST') return false;
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname !== '/cgi-bin/operate_appmsg') return false;
    if (!['create', 'update', 'edit'].includes(url.searchParams.get('sub') ?? '')) return false;
    const data = request.postData() ?? '';
    const form = new URLSearchParams(data);
    return (
        (form.has('content0') && form.has('title0')) ||
        (data.includes('name="content0"') && data.includes('name="title0"'))
    );
}

function saveResponseSucceeded(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const body = value as Record<string, unknown>;
    const base =
        body.base_resp !== null && typeof body.base_resp === 'object'
            ? (body.base_resp as Record<string, unknown>)
            : {};
    const codes = [body.ret, body.errcode, base.ret].filter((code) => code !== undefined);
    // The live editor returns top-level ret as "0" alongside numeric base_resp.ret.
    if (codes.some((code) => code !== 0 && code !== '0')) return false;
    if (codes.length > 0) return true;
    const info =
        body.appMsgInfo !== null && typeof body.appMsgInfo === 'object'
            ? (body.appMsgInfo as Record<string, unknown>)
            : body;
    return typeof info.appMsgId === 'string' || typeof info.appMsgId === 'number'
        ? /^\d{1,12}$/.test(String(info.appMsgId))
        : false;
}

/** Observe the native request before clicking; neither response headers nor a URL change is completion. */
async function saveNativeDraft(raw: Page, selector: string, timeoutMs: number): Promise<void> {
    const origin = new URL(raw.url()).origin;
    const marker = `__kkNativeSave_${crypto.randomUUID()}`;
    const button = raw.locator(selector).first();
    await button.evaluate((element, key) => {
        const state = { clickedAt: 0 };
        const handler = () => {
            state.clickedAt = Date.now();
        };
        (globalThis as unknown as Record<string, unknown>)[key] = { state, element, handler };
        element.addEventListener('click', handler, { capture: true, once: true });
    }, marker);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const responseComplete = raw
        .waitForRequest(
            async (request) => {
                if (!isArticleSave(request, origin)) return false;
                const clickedAt = await raw
                    .evaluate(`globalThis[${JSON.stringify(marker)}]?.state?.clickedAt ?? 0`)
                    .catch(() => 0);
                if (typeof clickedAt !== 'number' || clickedAt <= 0) return false;
                // Playwright populates request timing when response headers arrive; before that
                // the live Chrome request reports startTime=0. Keep the click stamp across navigation.
                if (!(await request.response())) return false;
                return request.timing().startTime >= clickedAt;
            },
            { timeout: timeoutMs },
        )
        .then(async (request) => {
            const response = await request.response();
            if (response === null || response.status() < 200 || response.status() >= 300)
                throw new Error('HTTP refusal');
            if (await response.finished()) throw new Error('Incomplete response');
            if (!saveResponseSucceeded(await response.json())) throw new Error('Save refused');
        });
    try {
        await Promise.race([
            Promise.all([responseComplete, button.click({ timeout: timeoutMs })]),
            new Promise<never>((_resolve, reject) => {
                deadline = setTimeout(() => reject(new Error('Save timeout')), timeoutMs);
            }),
        ]);
    } catch {
        // Playwright errors and server bodies may contain session URLs; retain no vendor payload.
        throw new Error('Native article save was not acknowledged successfully before the deadline');
    } finally {
        if (deadline !== undefined) clearTimeout(deadline);
        await raw
            .evaluate(`(() => {
                const key = ${JSON.stringify(marker)};
                const records = globalThis;
                const value = records[key];
                if (value?.element && value.handler) value.element.removeEventListener('click', value.handler, true);
                delete records[key];
            })()`)
            .catch(() => undefined);
    }
}

export function wrapPlaywrightPage(raw: unknown): WechatPage {
    const pw = raw as PlaywrightLike;
    return {
        saveDraftAndWait: (selector, timeoutMs) => saveNativeDraft(raw as Page, selector, timeoutMs),
        goto: (url, options) => pw.goto(url, { waitUntil: 'domcontentloaded', ...options }).then(() => undefined),
        locator: (selector) => ({
            count: () => pw.locator(selector).count(),
            first: () => {
                const loc = pw.locator(selector).first();
                return {
                    count: () => loc.count(),
                    isVisible: (options) => loc.isVisible(options),
                    fill: (text, options) => loc.fill(text, options),
                    click: (options) => loc.click(options),
                    type: (text, options) => loc.pressSequentially(text, options),
                    waitFor: (options) => loc.waitFor(options),
                    textContent: async () => (await loc.textContent()) ?? '',
                    inputValue: () => loc.inputValue(),
                };
            },
        }),
        setInputFiles: (selector, paths) => pw.setInputFiles(selector, paths),
        url: () => pw.url(),
        evaluate: (expression) => pw.evaluate(expression),
        waitForTimeout: (ms) => pw.waitForTimeout(ms),
        press: (key) => pw.keyboard.press(key),
        // MP's console renders some lists inside frames, and the flows must be able to NAME what they
        // actually saw when a read comes back empty (2026-10-05: the 草稿箱 row existed and no
        // main-frame read found it). Only the two calls the inventory needs are exposed.
        frames: () => {
            const source = raw as { frames?: () => RawFrame[] };
            return (source.frames?.() ?? []).map((frame) => ({
                url: () => frame.url(),
                locator: (selector: string) => ({ count: () => frame.locator(selector).count() }),
            }));
        },
    };
}

/**
 * Wrap one browser context as the launcher seam. Wrappers are cached per raw page, so
 * `pages()[0]` and `page` are the same object by reference — the flows take the newest page and
 * compare page identity, and a second wrapper would break that check.
 */
export function wrapPlaywrightContext(raw: unknown, entryPage: unknown): OpenedConsole {
    const context = raw as { pages(): unknown[]; newPage(): Promise<unknown>; close(): Promise<void> };
    const cache = new WeakMap<object, WechatPage>();
    const wrap = (page: unknown): WechatPage => {
        const key = page as object;
        const cached = cache.get(key);
        if (cached !== undefined) return cached;
        const wrapped = wrapPlaywrightPage(page);
        cache.set(key, wrapped);
        return wrapped;
    };
    return {
        page: wrap(entryPage),
        pages: () => context.pages().map(wrap),
        newPage: async () => wrap(await context.newPage()),
        close: () => context.close(),
    };
}

/** Polls a selector list for visibility; optionally returns `undefined` instead of throwing. */
export async function waitForVisible(
    page: WechatPage,
    selector: string,
    timeoutMs: number,
    opts: { required?: boolean } = {},
): Promise<string | undefined> {
    const visible = await waitUntil(
        async () => {
            const found = await trySelectors(page, [selector]).catch(() => ({ found: false, selector: null }));
            return found.found;
        },
        timeoutMs,
        POLL_MS,
    );
    if (visible) return selector;
    if (opts.required === false) return undefined;
    throw new Error(`${selector}: not visible within ${timeoutMs}ms`);
}
