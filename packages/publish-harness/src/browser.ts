import { parseArgs } from 'node:util';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    type IsAuthenticatedPredicate,
    loginWithProfile,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import { echo } from '@gobing-ai/ts-utils';
import type { Page } from 'playwright';
import { resolveBrowserProfileDir, trySelectors } from './index';

/** Upstream seam types re-exported so a channel plugin needs one import for its config and deps. */
export type { BrowserLauncher, IsAuthenticatedPredicate };

/**
 * Shared browser command library for the script-driven publish channels (E91, ADR-027).
 *
 * Exported as the `@gobing-ai/publish-harness/browser` sub-path so API-only plugins never load
 * this module (R5). Site selectors and flows stay in each channel plugin (E91-D3): these helpers
 * receive selectors, they never embed URLs.
 *
 * No `console.*` here — callers get thrown errors, and the CLI takes an injected `stdout`.
 * The module never touches cookies or `storageState`; the profile directory is the login artifact.
 */

/** Site-owned config for one channel's browser session. */
export interface ChannelBrowserConfig {
    /** Channel slug; `'infoq'` resolves `<INFOQ>_PROFILE_DIR`. */
    channel: string;
    /** Page opened for `login` / `check`. */
    homeUrl: string;
    /** Site-owned readiness predicate, re-exported upstream type. */
    isAuthenticated: IsAuthenticatedPredicate;
    /** Deadline for the interactive login wait (default 180_000). */
    loginTimeoutMs?: number;
}

/** Outcome of a channel session check: what was observed, or the refusal reason. */
export interface ChannelSessionResult {
    /** `verified` only when the site readiness predicate passed; otherwise `refused`. */
    status: 'verified' | 'refused';
    /** Profile directory the check read; the only profile detail that ever leaves this module. */
    profileDir: string;
    /** One-line verdict: what was observed (headless or headed) or why it was refused. */
    detail: string;
}

/**
 * Options for {@link checkChannelSession}: which profile to open, the launcher seam, and the
 * fallback/deadline knobs. A check never creates the profile.
 */
export interface ChannelSessionOptions {
    /** Existing profile directory to reopen read-only. */
    profileDir: string;
    /** Launcher override (tests / custom browser provisioning). */
    launcher?: BrowserLauncher;
    /** `false` keeps a refusal to the single headless pass (publish preflight). Default true. */
    headedFallback?: boolean;
    /** Deadline per pass (default 30_000). */
    timeoutMs?: number;
}

/**
 * Injectable seams for {@link runProfileCli}: the browser launcher and the line writer used
 * instead of the default ts-utils `echo` stdout target.
 */
export interface ProfileCliDeps {
    /** Launcher override (tests / custom browser provisioning). */
    launcher?: BrowserLauncher;
    /** Line-writer override; defaults to the ts-utils `echo` stdout seam. */
    stdout?: (line: string) => void;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 180_000;
/**
 * A session check is a bounded read-only probe, not an interactive login: it uses the
 * `xhs-pub` preflight scale (30s per pass), never the login wait.
 */
const DEFAULT_CHECK_TIMEOUT_MS = 30_000;
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 500;
const ATTACH_POLL_MS = 100;

/**
 * Resolves the persistent profile directory for a channel.
 *
 * Precedence: `override` > `<CHANNEL>_PROFILE_DIR` > `KK_BROWSER_PROFILE_DIR` >
 * `resolveBrowserProfileDir(channel)`. Blank strings count as unset, so an empty flag/env value
 * falls through instead of resolving to the cwd.
 */
export function resolveChannelProfileDir(channel: string, override?: string): string {
    const tiers = [override, process.env[`${channel.toUpperCase()}_PROFILE_DIR`], process.env.KK_BROWSER_PROFILE_DIR];
    const chosen = tiers.find((tier) => tier !== undefined && tier.trim().length > 0);
    return resolveBrowserProfileDir(channel, chosen);
}

/**
 * Read-only readiness check on the channel profile: one `homeUrl` visit plus selector reads, no
 * click and no content. The headless pass runs first; a refusal is retried once headed unless
 * `headedFallback` is `false` (ADR-025 shape — an unattended publish preflight must not pop a
 * window before the flow itself opens).
 *
 * A missing profile is refused immediately: upstream never creates a headless profile, so a
 * headed retry would fabricate a session out of a fresh directory.
 */
export async function checkChannelSession(
    config: ChannelBrowserConfig,
    opts: ChannelSessionOptions,
): Promise<ChannelSessionResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
    const passes: readonly boolean[] = opts.headedFallback === false ? [true] : [true, false];
    let lastDetail = `${config.channel} readiness was never probed`;

    for (const headless of passes) {
        try {
            await withProfilePage(
                {
                    profileDir: opts.profileDir,
                    headless,
                    url: config.homeUrl,
                    isAuthenticated: config.isAuthenticated,
                    timeoutMs,
                    launcher: opts.launcher,
                },
                async () => true,
            );
            return {
                status: 'verified',
                profileDir: opts.profileDir,
                detail: `authenticated ${config.channel} session observed ${
                    headless ? 'headlessly' : 'via headed fallback'
                } via profile ${opts.profileDir} (read-only)`,
            };
        } catch (error) {
            if (error instanceof BrowserProfileMissingError) {
                return {
                    status: 'refused',
                    profileDir: opts.profileDir,
                    detail: `no ${config.channel} browser profile at ${opts.profileDir} — run the login command first`,
                };
            }
            lastDetail = `${headless ? 'headless' : 'headed'} ${config.channel} readiness refused: ${errorMessage(error)}`;
        }
    }

    return { status: 'refused', profileDir: opts.profileDir, detail: lastDetail };
}

/**
 * `login|check [--profile <dir>] [--timeout <ms>]` for one channel.
 *
 * `login` opens the headed browser and returns only once the site readiness predicate passes;
 * `check` runs {@link checkChannelSession}. Exit codes: 0 verified, 1 refused, 2 usage error.
 * Output goes through the injected `stdout` (one line per message), so the CLI is testable and
 * this module holds no `console.*`; the default writer is the ts-utils `echo` seam.
 */
export async function runProfileCli(
    config: ChannelBrowserConfig,
    argv: string[] = process.argv.slice(2),
    deps: ProfileCliDeps = {},
): Promise<number> {
    const stdout =
        deps.stdout ??
        ((line: string) => {
            echo(line);
        });
    const usage = `usage: ${config.channel} profile-check [login|check] [--profile <dir>] [--timeout <ms>]`;

    let command: string;
    let profileDir: string;
    let timeoutMs: number | undefined;
    try {
        const { positionals, values } = parseArgs({
            args: argv,
            allowPositionals: true,
            options: { profile: { type: 'string' }, timeout: { type: 'string' } },
        });
        command = positionals[0] ?? 'check';
        if (command !== 'login' && command !== 'check') {
            throw new Error(`unknown command '${command}'`);
        }
        if (values.timeout !== undefined) {
            timeoutMs = Number(values.timeout);
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
                throw new Error(`--timeout must be a non-negative number of ms, got '${values.timeout}'`);
            }
        }
        profileDir = resolveChannelProfileDir(config.channel, values.profile);
    } catch (error) {
        stdout(`${config.channel} profile-check: ${errorMessage(error)} — ${usage}`);
        return 2;
    }

    if (command === 'login') {
        try {
            await loginWithProfile({
                profileDir,
                url: config.homeUrl,
                isAuthenticated: config.isAuthenticated,
                timeoutMs: timeoutMs ?? config.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS,
                launcher: deps.launcher,
            });
            stdout(`${config.channel} profile login verified: ${profileDir}`);
            return 0;
        } catch (error) {
            stdout(`${config.channel} profile login failed: ${errorMessage(error)}`);
            return 1;
        }
    }

    const result = await checkChannelSession(config, {
        profileDir,
        launcher: deps.launcher,
        timeoutMs,
    });
    stdout(JSON.stringify(result));
    if (result.status === 'verified') {
        return 0;
    }
    stdout(`${config.channel} profile check refused: ${result.detail}`);
    return 1;
}

/**
 * Poll `predicate` every `pollMs` until the deadline, then evaluate it one final time.
 * The trailing call matters: the condition often becomes true exactly at the boundary.
 */
export async function waitUntil(
    predicate: () => Promise<boolean>,
    timeoutMs: number,
    pollMs = DEFAULT_POLL_MS,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return predicate();
}

/**
 * Inserts `html` into a rich-text editor the way a human paste does: a synthetic `paste`
 * `ClipboardEvent` carrying both `text/html` and `text/plain`. ProseMirror, TipTap and Draft.js
 * all read the event's `clipboardData`; assigning `innerHTML` bypasses their state.
 *
 * Throws when the selector never attaches or the editor text is still empty at the deadline.
 */
export async function pasteHtml(
    page: Page,
    selector: string,
    html: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'pasteHtml', timeoutMs);
    await page.evaluate(pasteScript(selector, html));
    const filled = await waitUntil(
        async () => String(await page.evaluate(editorTextScript(selector))).length > 0,
        timeoutMs,
        ATTACH_POLL_MS,
    );
    if (!filled) {
        throw new Error(`pasteHtml: ${selector}: editor text is empty ${timeoutMs}ms after the paste`);
    }
}

/**
 * Fills a markdown editor: CodeMirror 6 (`view.dispatch`) → CodeMirror 5 (`CodeMirror.setValue`)
 * → `keyboard.insertText` fallback for editors exposing neither API (bytemd and friends), then
 * asserts the editor text is non-empty.
 */
export async function fillCodeMirror(
    page: Page,
    selector: string,
    markdown: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'fillCodeMirror', timeoutMs);

    const mode = String(await page.evaluate(codeMirrorScript(selector, markdown)));
    if (mode === 'missing') {
        throw new Error(`fillCodeMirror: ${selector} not attached within ${timeoutMs}ms`);
    }
    if (mode === 'keyboard') {
        await page.keyboard.insertText(markdown);
    }
    // Post-condition, as in `pasteHtml`: neither CodeMirror API reports back, and the keyboard
    // fallback is a silent no-op when the focus was stolen — so an empty editor is a failed fill
    // rather than a saved draft with no article in it (0183 residual 8e326537).
    const filled = await waitUntil(
        async () => String(await page.evaluate(editorTextScript(selector))).length > 0,
        timeoutMs,
        ATTACH_POLL_MS,
    );
    if (!filled) {
        throw new Error(`fillCodeMirror: ${selector}: editor text is empty ${timeoutMs}ms after the fill`);
    }
}

/**
 * Sets the file on an attached `<input type="file">`. Visibility is not required — Playwright's
 * `setInputFiles` is CDP-backed, and cover/image inputs are routinely hidden behind a styled label.
 */
export async function uploadFile(
    page: Page,
    selector: string,
    filePath: string,
    opts: { timeoutMs?: number } = {},
): Promise<void> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    await requireAttached(page, selector, 'uploadFile', timeoutMs);
    await page.setInputFiles(selector, filePath);
}

/**
 * Success only from an observed browser signal (E91-D6): polls `probe` for evidence — a draft id,
 * URL, or toast text — and never reports success the browser did not show.
 */
export async function expectOutcome(
    probe: () => Promise<string | null>,
    opts: { timeoutMs: number; label: string; pollMs?: number },
): Promise<{ ok: true; evidence: string } | { ok: false; error: string }> {
    let evidence = '';
    let lastProbeError: string | null = null;
    const observed = await waitUntil(
        async () => {
            let result: string | null;
            try {
                result = await probe();
            } catch (error) {
                // A probe that rejects (a `page.evaluate` whose document is replaced by a
                // navigation) is "no signal *yet*", not a broken rail: keep polling and report the
                // last rejection if the deadline passes. Letting it escape turned the
                // never-report-unseen-success rail into an unhandled rejection (residual 0190).
                lastProbeError = error instanceof Error ? error.message : String(error);
                return false;
            }
            // An empty string is a probe that fired without a signal (no id, URL, or toast text):
            // treating it as success would report an outcome the browser never showed (E91-D6).
            if (result === null || result.length === 0) {
                return false;
            }
            evidence = result;
            return true;
        },
        opts.timeoutMs,
        opts.pollMs ?? DEFAULT_POLL_MS,
    );
    if (observed && evidence.length > 0) {
        return { ok: true, evidence };
    }
    const detail = lastProbeError === null ? '' : ` (last probe error: ${lastProbeError})`;
    return { ok: false, error: `${opts.label}: no outcome observed within ${opts.timeoutMs}ms${detail}` };
}

/**
 * Containers that carry a transient site signal (toast / notice). Article content is never inside
 * them, which is the whole point: see {@link readScopedSignal}.
 */
export const DEFAULT_SIGNAL_CONTAINERS: readonly string[] = [
    '[class*="toast" i]',
    '[class*="notification" i]',
    '[role="alert"]',
    '[class*="message" i]',
];

/**
 * Reads a transient site signal (a toast/notice carrying one of `texts`) scoped to the page's
 * notification containers.
 *
 * Scoping is load-bearing (residuals 0195/0196): an unscoped `:text(...)` match also hits the
 * article body the flow itself pasted a few steps earlier, so a body containing `保存成功`
 * satisfied the draft probe and reported a success the browser never showed — the operator then
 * sees a saved draft that does not exist. Only the containers are searched, and the label must be
 * reachable through one of them.
 */
export async function readScopedSignal(
    page: Page,
    texts: readonly string[],
    containers: readonly string[] = DEFAULT_SIGNAL_CONTAINERS,
): Promise<string | null> {
    for (const text of texts) {
        for (const container of containers) {
            const locator = page.locator(`${container} :text("${text}")`).first();
            if ((await locator.count().catch(() => 0)) === 0) continue;
            if (!(await locator.isVisible().catch(() => false))) continue;
            const observed = (await locator.textContent().catch(() => null))?.trim();
            return observed !== undefined && observed.length > 0 ? observed : text;
        }
    }
    return null;
}

/** Minimal CDP session surface the closed-shadow probe needs (Playwright's `CDPSession` satisfies it). */
export interface ShadowCdpSession {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** A control resolved inside a closed shadow root, in viewport coordinates. */
export interface ShadowControl {
    label: string;
    x: number;
    y: number;
}

interface CdpNode {
    nodeName?: string;
    nodeValue?: string;
    backendNodeId?: number;
    children?: CdpNode[];
    shadowRoots?: CdpNode[];
}

const cdpNodeText = (node: CdpNode): string =>
    node.nodeName === '#text' ? (node.nodeValue ?? '') : (node.children ?? []).map(cdpNodeText).join('');

/**
 * Resolves a labelled control that lives inside a **closed** shadow root, returning its viewport
 * centre so the caller can click it with a real mouse event.
 *
 * `DOM.getDocument({ pierce: true })` is the only way in: a closed root reports
 * `shadowRoot === null`, so no CSS or `:text(...)` selector can reach the node — measured live on
 * the xhs console, whose `<XHS-PUBLISH-BTN>` save bar states its label in neither (ADR-029 rail).
 * Labels match after whitespace is stripped, because the rendered text carries layout whitespace.
 *
 * **Only shadow trees are matched.** A light-DOM control is a normal locator's job, and matching
 * one here would let a channel resolve a mirrored label (sites duplicate their own chrome) instead
 * of the real control — so the helper returns `null` rather than guessing. Light DOM is still
 * *traversed*, because a closed root hangs off a light-DOM host element.
 */
export async function findShadowControl(
    session: ShadowCdpSession,
    labels: readonly string[],
): Promise<ShadowControl | null> {
    const document = (await session.send('DOM.getDocument', { depth: -1, pierce: true })) as {
        root?: CdpNode;
    };
    if (!document.root) return null;
    const wanted = new Set(labels);
    const findNode = (node: CdpNode, insideShadow: boolean): { label: string; backendNodeId: number } | null => {
        if (insideShadow && node.nodeName === 'BUTTON' && typeof node.backendNodeId === 'number') {
            const label = cdpNodeText(node).replace(/\s+/g, '');
            if (wanted.has(label)) return { label, backendNodeId: node.backendNodeId };
        }
        for (const shadowRoot of node.shadowRoots ?? []) {
            const hit = findNode(shadowRoot, true);
            if (hit) return hit;
        }
        for (const child of node.children ?? []) {
            const hit = findNode(child, insideShadow);
            if (hit) return hit;
        }
        return null;
    };
    const hit = findNode(document.root, false);
    if (hit === null) return null;

    const box = (await session.send('DOM.getBoxModel', { backendNodeId: hit.backendNodeId })) as {
        model?: { content?: number[] };
    };
    const quad = box.model?.content;
    if (quad === undefined || quad.length < 8) return null;
    // Quad layout is [x1,y1, x2,y2, x3,y3, x4,y4]; the centre is ((x1+x3)/2, (y1+y4)/2).
    const [x1 = 0, y1 = 0, x3 = 0, , , y4 = 0] = quad;
    return { label: hit.label, x: Math.round((x1 + x3) / 2), y: Math.round((y1 + y4) / 2) };
}

/**
 * Opens a CDP session and returns a finder bound to it, or `undefined` when the platform exposes
 * no CDP (Safari/iOS). Callers fail loud on `undefined` rather than falling back to guessed
 * coordinates: a wrong click on a publish bar is worse than a reported missing capability.
 */
export async function createShadowFinder(
    context: { newCDPSession?(page: unknown): Promise<ShadowCdpSession> },
    page: unknown,
): Promise<((labels: readonly string[]) => Promise<ShadowControl | null>) | undefined> {
    if (typeof context.newCDPSession !== 'function') return undefined;
    try {
        const session = await context.newCDPSession(page);
        await session.send('DOM.enable');
        return (labels) => findShadowControl(session, labels);
    } catch {
        return undefined;
    }
}

/** Markdown → HTML through the Bun built-in (E91-D4); GFM tables, fenced code and task lists. */
export const markdownToHtml: (markdown: string) => string = (markdown) => Bun.markdown.html(markdown);

/** Polls until the selector has at least one attached match, then throws naming it and the deadline. */
async function requireAttached(page: Page, selector: string, action: string, timeoutMs: number): Promise<void> {
    await resolveSelector(page, [selector], { timeoutMs, label: action });
}

/**
 * Resolves the first attached candidate selector, polling to the deadline.
 *
 * Attachment — not visibility — is the readiness signal, the same rule `requireAttached` applies;
 * Playwright's own actionability wait covers visibility at the click or fill that follows. The
 * candidate list stays site-owned in the calling plugin (E91-D3): this helper receives selectors
 * and never embeds a URL.
 *
 * Throws naming `label` (default `selector`), every candidate it tried, and the deadline.
 */
export async function resolveSelector(
    page: Page,
    selectors: readonly string[],
    opts: { timeoutMs?: number; label?: string } = {},
): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    const found: { selector: string | null } = { selector: null };
    const attached = await waitUntil(
        async () => {
            const result = await trySelectors(page, selectors, { visible: false });
            found.selector = result.selector;
            return result.found && result.selector !== null;
        },
        timeoutMs,
        ATTACH_POLL_MS,
    );
    const selector = found.selector;
    if (!attached || selector === null) {
        throw new Error(`${opts.label ?? 'selector'}: ${selectors.join(' | ')} not attached within ${timeoutMs}ms`);
    }
    return selector;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Browser-side scripts. They are strings because the harness tsconfig has no DOM lib: the
 * expression is evaluated in the page, and the parameters are JSON-encoded into the source.
 */
function pasteScript(selector: string, html: string): string {
    const text = html
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const data = new DataTransfer();
    data.setData('text/html', ${JSON.stringify(html)});
    data.setData('text/plain', ${JSON.stringify(text)});
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    return true;
})()`;
}

function editorTextScript(selector: string): string {
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    return el ? (el.textContent ?? '').trim() : '';
})()`;
}

function codeMirrorScript(selector: string, markdown: string): string {
    const value = JSON.stringify(markdown);
    return `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return 'missing';
    const nodes = [el, el.querySelector('.cm-content'), el.querySelector('.cm-editor')];
    for (const node of nodes) {
        const view = node && node.cmView ? (node.cmView.rootView ?? node.cmView) : null;
        if (view && typeof view.dispatch === 'function' && view.state && view.state.doc) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: ${value} } });
            return 'cm6';
        }
    }
    const cm5 = el.CodeMirror ?? (el.querySelector('.CodeMirror') && el.querySelector('.CodeMirror').CodeMirror);
    if (cm5 && typeof cm5.setValue === 'function') {
        cm5.setValue(${value});
        return 'cm5';
    }
    el.focus();
    return 'keyboard';
})()`;
}
