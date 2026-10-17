import { trySelectors } from '@gobing-ai/publish-harness';
import { waitUntil } from '@gobing-ai/publish-harness/browser';

/**
 * The console's page seam (ADR-029) and the helpers every xhs operation shares.
 *
 * `XhsPage` is deliberately a structural subset of the Playwright `Page`: the flows are driven
 * through it so the offline tests can script the console (fake page) instead of launching a
 * browser. Anything the shared `@gobing-ai/publish-harness/browser` helpers need on a real
 * Playwright page is part of this seam, never reached around it.
 */

/**
 * Connect faults this origin produces intermittently (2026-10-16: `net::ERR_TIMED_OUT` at the
 * publish page; 2026-10-13: the preflight's `Timeout 30000ms exceeded — waiting until "load"`).
 * One retry absorbs the flake; a second failure is reported as it is, so a real outage still fails.
 */
const TRANSIENT_NAVIGATION =
    /net::ERR_(?:TIMED_OUT|CONNECTION_(?:RESET|CLOSED|TIMED_OUT|ABORTED|REFUSED|FAILED)|NETWORK_(?:CHANGED|IO_SUSPENDED)|EMPTY_RESPONSE|ADDRESS_UNREACHABLE|NAME_NOT_RESOLVED)/;

/** Whether a navigation failed for a reason a single retry can plausibly clear. */
function isTransientNavigationError(error: unknown): boolean {
    return TRANSIENT_NAVIGATION.test(error instanceof Error ? error.message : String(error));
}

export const POLL_MS = 500;

// The shared poll (0184 R2); re-exported so flow/index keep importing it from here.
export { waitUntil };
export const STEP_TIMEOUT_MS = 30_000;

/** The console's mode tab bar; it mounts late and renders every tab several times over. */
export const CREATOR_TAB_BAR = 'div.creator-tab';
/** 上传视频 / 上传图文 / 写长文 / 发播客 — the bar is only usable once all four are laid out. */
export const CREATOR_TAB_COUNT = 4;

/** A control resolved inside a closed shadow root, in viewport coordinates. */
export interface ShadowControl {
    label: string;
    x: number;
    y: number;
}

/** Locates a labelled control inside a closed shadow root (CDP-backed in production). */
export interface ShadowProbe {
    findControl(labels: readonly string[]): Promise<ShadowControl | null>;
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
    /** Playwright accepts one path or a list; the flows use both (one video, or an image batch). */
    setInputFiles(selector: string, paths: readonly string[] | string): Promise<void>;
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
    url(): string;
    /** Page-side script evaluation; the shared paste helper runs its clipboard script through it. */
    evaluate(expression: string): Promise<unknown>;
    /** How many matches are laid out at an on-screen box (the tab-clone filter). */
    countOnScreen(selector: string): Promise<number>;
    /** Click the first on-screen match — the console renders the tabs 3×. */
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

/** The `div.creator-tab` carrying one mode's label. */
export function creatorTabSelector(label: string): string {
    return `${CREATOR_TAB_BAR}:has-text("${label}")`;
}

/**
 * Enter one console mode by clicking the tab bar's **on-screen** instance.
 *
 * Hazard (measured 2026-10-05, `docs/design/xhs-ui-discovery.md` §1): every tab is rendered at
 * least three times — an `aria-hidden="true"` clone, a clone laid out far off-viewport (measured
 * `x=-9726, y=-9918`), and the live node — and the whole bar mounts late and varies. A
 * `...:has-text(label).first()` binds to a clone and hangs for the full step timeout (measured:
 * 30 s, reported as "no real node"), and `:not([aria-hidden="true"])` alone still matches an
 * off-screen clone. So the bar is waited on first (≥4 laid-out, on-screen tabs) and the click
 * then targets the first candidate whose box is inside the viewport.
 */
export async function clickCreatorTab(
    page: XhsPage,
    label: string,
    opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? STEP_TIMEOUT_MS;
    const pollMs = opts.pollMs ?? POLL_MS;
    // A count read that throws (a detached node while the bar is still mounting) is "not yet",
    // not a broken rail: the deadline below is what reports the observed state.
    const onScreenCount = () => page.countOnScreen(CREATOR_TAB_BAR).catch(() => 0);
    const mounted = await waitUntil(
        () => onScreenCount().then((count) => count >= CREATOR_TAB_COUNT),
        timeoutMs,
        pollMs,
    );
    if (!mounted) {
        const observed = await onScreenCount();
        throw new Error(
            `mode entry: the console tab bar did not mount within ${timeoutMs}ms (${observed} of ${CREATOR_TAB_COUNT} on-screen '${CREATOR_TAB_BAR}' nodes) — every tab renders aria-hidden and off-viewport clones`,
        );
    }
    if (!page.clickInViewport) {
        throw new Error(
            `mode entry: this driver cannot read viewport geometry, so the on-screen '${label}' tab cannot be told apart from its off-screen clones`,
        );
    }
    const clicked = await page.clickInViewport(creatorTabSelector(label));
    if (!clicked) {
        throw new Error(
            `mode entry: no in-viewport '${label}' tab found (only aria-hidden or off-screen clones matched) — the mode was not entered`,
        );
    }
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
        setInputFiles(selector: string, paths: readonly string[] | string): Promise<void>;
        waitForSelector(selector: string, options?: Record<string, unknown>): Promise<unknown>;
        url(): string;
        viewportSize?(): { width: number; height: number } | null;
        evaluate(expression: string): Promise<unknown>;
        mouse: { click(x: number, y: number): Promise<void> };
    };

    /**
     * The matches of `selector` that are laid out at a readable box inside the viewport. A
     * `display:none` node reports no box at all (`boundingBox()` → null), which is the non-hidden
     * half of the tab-bar rule; an off-screen clone keeps its box and is rejected on coordinates.
     * Without a readable viewport nothing qualifies — the duplicates cannot be told apart, so the
     * caller fails loud instead of clicking a maybe-off-screen copy.
     */
    const onScreen = async (
        selector: string,
    ): Promise<Array<{ index: number; box: { x: number; y: number; width: number; height: number } }>> => {
        const viewport = pw.viewportSize?.() ?? null;
        if (viewport === null) return [];
        const total = await pw.locator(selector).count();
        const found: Array<{ index: number; box: { x: number; y: number; width: number; height: number } }> = [];
        for (let index = 0; index < total; index += 1) {
            const candidate = pw.locator(selector).nth(index);
            const box = await candidate.boundingBox().catch(() => null);
            if (!box || box.width === 0 || box.height === 0) continue;
            const outside = box.x < 0 || box.y < 0 || box.x >= viewport.width || box.y >= viewport.height;
            if (outside) continue;
            found.push({ index, box });
        }
        return found;
    };

    return {
        // `domcontentloaded`, never Playwright's `load` default: the console keeps long-lived
        // subresources open, so a `load` wait turns a healthy visit into a timeout (2026-10-13
        // preflight). Pinned here once, the way wechatmp-pub/src/page.ts already pins it.
        goto: async (url, options) => {
            const navigate = (): Promise<unknown> => pw.goto(url, { waitUntil: 'domcontentloaded', ...options });
            try {
                await navigate();
            } catch (error) {
                if (!isTransientNavigationError(error)) throw error;
                await navigate();
            }
        },
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
        evaluate: (expression) => pw.evaluate(expression),
        countOnScreen: async (selector) => (await onScreen(selector)).length,
        clickInViewport: async (selector) => {
            const [candidate] = await onScreen(selector);
            if (candidate === undefined) return false;
            // The tab's inner span intercepts the hit test, so the click must be forced.
            await pw.locator(selector).nth(candidate.index).click({ force: true });
            return true;
        },
        findShadowControl: async (labels) => (shadow ? shadow.findControl(labels) : null),
        clickAt: (x, y) => pw.mouse.click(x, y),
    };
}

/** Polls the candidate list until one selector has an attached match; throws naming `what`. */
export async function findSelector(
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
export async function findAttachedSelector(
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
