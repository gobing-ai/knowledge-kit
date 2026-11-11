import type { Content, Result } from '@gobing-ai/kk-core';
import { ResultSchema } from '@gobing-ai/kk-core';
import { trySelectors } from '@gobing-ai/publish-harness';
import {
    expectOutcome,
    markdownToHtml,
    pasteHtml,
    readScopedSignal,
    uploadFile,
} from '@gobing-ai/publish-harness/browser';
import type { Page } from 'playwright';
import {
    AccountRiskControlError,
    ContentTooLongError,
    DraftVerifyError,
    PublishError,
    TitleTooLongError,
} from './errors';
import {
    artifactPaths,
    type ModeInput,
    PUBLISH_URL,
    PUBLISHED_MARKER,
    TARGET,
    XHS_NOTE_BODY_MAX,
    XHS_NOTE_TITLE_MAX,
    type XhsOperation,
} from './modes';
import { clickCreatorTab, findAttachedSelector, findSelector, POLL_MS, waitUntil, type XhsPage } from './page';

/**
 * The four xhs flows (ADR-029: the operations own their flow, selector table and success signal)
 * plus the rails they share — mode entry, the scoped signal probe, the 暂存离开 click and publish.
 *
 * `docs/design/xhs-ui-discovery.md` is the evidence for every selector here; where the recorded
 * evidence does not cover a detail the code says so rather than inventing one.
 */

const NOTE_TITLE = [
    'input.d-text[placeholder="填写标题会有更多赞哦"]',
    'input[placeholder*="标题"]',
    '#title-textarea input',
];
// The note body is TipTap ProseMirror since 2026-09 (it was Quill `.ql-editor`).
const NOTE_BODY = [
    'div.tiptap[contenteditable="true"]',
    'div[contenteditable="true"].ql-editor',
    '#post-textarea',
    '.ql-editor',
];
// Uploaded previews carry XHS's own class spelling (`preivew`, not `preview`).
const NOTE_THUMBNAIL = ['img.preivew-image', '.img-preview img'];
// The image input is distinguishable from the video input by its accept list (`.jpg` first).
const IMAGE_FILE_INPUT = [
    'input[type="file"][accept*=".jpg"]',
    'input[type="file"].upload-input',
    'input[type="file"]',
];
const VIDEO_FILE_INPUT = ['input[type="file"][accept*=".mp4"]', 'input[type="file"].upload-input'];
const VIDEO_EDITOR = ['div.tiptap.ProseMirror', 'div.tiptap[contenteditable="true"]', '.ProseMirror'];

// 写长文: the landing offers 新的创作 (author in place) and 导入链接 (excluded — it is fed from a
// 公众号 source, which would put another platform's publishing and censorship in the critical
// path), then an in-page ProseMirror editor with 暂存离开 and 一键排版.
const ARTICLE_NEW = ['text=新的创作', 'button:has-text("新的创作")'];
const ARTICLE_EDITOR = ['div.tiptap.ProseMirror.ProseMirror-focused', 'div.tiptap.ProseMirror', '.ProseMirror'];
// The clickable `一键排版` is the button (measured: `button.d-button…` at the editor's action bar);
// the `ailayout-*` divs are its label wrappers.
const ARTICLE_LAYOUT = ['button:has-text("一键排版")', 'div.ailayout-btn_wrp', 'div.ailayout-btn_label'];

// 发播客: 上传音频 opens a modal carrying the audio picker AND the cover picker; the two inputs
// are told apart by their accept lists.
const PODCAST_OPEN = ['text=上传音频', 'button:has-text("上传音频")'];
const PODCAST_MODAL = ['div.creator-modal-sty', '.d-modal.d-modal-centered', '.d-modal'];
const PODCAST_AUDIO_INPUT = ['input[type="file"][accept*=".mp3"]', 'input[type="file"][accept*=".wav"]'];
const PODCAST_MODAL_ADVANCE = ['去发布'];
/* Measured post-attach flow (2026-11-06 headless probe, 10-min mp3 + 1:1 png): a raw
 * input.files assignment registers the AUDIO (`上传成功` appears) but the COVER card never
 * advances and `去发布` stays `disabled` — only clicking the cover card and handing the file to
 * the native file chooser the site opens takes both. `去发布` is then just the ADVANCE control: the
 * next page is the full podcast editor carrying the closed-shadow bar (`暂存离开`@left, `发布`@right),
 * so a draft run may click it too — it does not publish on its own. */
const PODCAST_COVER_ZONE = '.d-modal div:has-text("设置封面")';
const PODCAST_UPLOAD_ACK = '上传成功';

// Task 0350 R4: the podcast editor's fields — measured in the 2026-11-11 discovery (智能标题 chip,
// a 0/1000 body counter, an 加入播客合集 entry in the bottom bar's closed shadow), none of them
// selector-measured. These probe chains name what they try; every apply is followed by a
// counter/verify read that fails loud when the field did not take.
const PODCAST_TITLE_SELECTORS = ['input.d-text', 'input[placeholder*="标题"]', 'textarea[placeholder*="标题"]'];
const PODCAST_COLLECTION_SELECTORS = ['button:has-text("加入播客合集")', 'text=加入播客合集', 'text=合集'];
const PODCAST_COLLECTION_DEFAULT = '咸话咸说之每日AI乱炖';

/**
 * The `暂存离开` labels, newest first: XHS renamed the control, and the older labels stay as
 * fallbacks. The control is a `BUTTON.ce-btn.white` inside the publish bar.
 */
const DRAFT_LABELS = ['暂存离开', '存草稿', '保存草稿'];
const PUBLISH_LABELS = ['发布'];
/** The console's publish confirmation text, read as a scoped signal (the URL marker is primary). */
const PUBLISH_CONFIRM = ['发布成功', '已发布'];
/** The draft toast measured on save (`保存成功`); read only from notification containers. */
const DRAFT_TOASTS = ['保存成功'];

/** The submit bar is the custom element `<XHS-PUBLISH-BTN>`, whose shadow root is CLOSED. */
const SHADOW_BAR = 'the xhs publish bar (closed shadow root)';

/**
 * Where each mode's action-bar controls (`暂存离开` and `发布`) live, in the order the flow tries it.
 *
 * Measured (discovery §3): the 图文 action bar is the closed-shadow `<XHS-PUBLISH-BTN>` — a
 * light-DOM search over every open shadow root finds **zero** matches, so a text selector there
 * could only ever hit a mirrored clone. The same labels ARE in the light DOM in 写长文, which is why
 * that mode tries the normal locator first and keeps the CDP path as the fallback; the three bar
 * modes go straight to CDP, where the label and box are read rather than guessed.
 */
const MODE_ACTION_PATHS: Record<XhsOperation, readonly ActionPath[]> = {
    上传图文: ['shadow'],
    上传视频: ['shadow'],
    写长文: ['light', 'shadow'],
    发播客: ['shadow'],
};

type ActionPath = 'shadow' | 'light';

/** Everything the flows need besides the validated mode input. */
export interface ModeRunDeps {
    page: XhsPage;
    content: Content;
    publishStatus: 'draft' | 'public';
    profileDir: string;
    driver: string;
    stepTimeoutMs: number;
    submitSettleMs: number;
    submitAttempts: number;
    /** Draft evidence captured before the mode was entered (the counter only exists on the landing view). */
    draftBaseline: DraftBaseline;
}

function fail(error: string): Result {
    return ResultSchema.parse({ ok: false, target: TARGET, error });
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The shared helpers are declared against Playwright's `Page`, while the flows drive the
 * structural `XhsPage` seam (which is what lets the offline tests script the console). Every
 * member those helpers touch — `locator`, `evaluate`, `setInputFiles` — is implemented by
 * `wrapPlaywrightPage`, so this is a type-level bridge over the same object, not a second page.
 */
function asPlaywrightPage(page: XhsPage): Page {
    return page as unknown as Page;
}

/** Enter a console mode: the tab bar must be mounted, then the ON-SCREEN tab is clicked. */
async function enterMode(deps: ModeRunDeps, label: string): Promise<void> {
    await clickCreatorTab(deps.page, label, { timeoutMs: deps.stepTimeoutMs });
}

/**
 * Click a labelled control inside the CLOSED shadow publish bar. The label and box come from CDP,
 * so the click is aimed at a read target rather than a guessed coordinate; a driver without that
 * capability fails loud instead of clicking blind.
 */
async function clickShadowControl(
    page: XhsPage,
    labels: readonly string[],
): Promise<{ ok: true; label: string; x: number; y: number } | { ok: false; error: string }> {
    if (!page.findShadowControl || !page.clickAt) {
        return {
            ok: false,
            error: `submit control: ${SHADOW_BAR} and this driver has no CDP access to resolve it`,
        };
    }
    const control = await page.findShadowControl(labels);
    if (!control) {
        return {
            ok: false,
            error: `submit control: none of [${labels.join(', ')}] found in ${SHADOW_BAR}`,
        };
    }
    await page.clickAt(control.x, control.y);
    return { ok: true, label: control.label, x: control.x, y: control.y };
}

/** Click a labelled control that lives in the light DOM (写长文's action bar). */
async function clickLightControl(
    page: XhsPage,
    labels: readonly string[],
    timeoutMs: number,
    what: string,
): Promise<{ ok: true; label: string; selector: string } | { ok: false; error: string }> {
    const candidates = labels.flatMap((label) => [`button:has-text("${label}")`, `text=${label}`]);
    let selector: string;
    try {
        selector = await findSelector(
            page,
            candidates,
            `${what} (light DOM) none of [${labels.join(', ')}]`,
            timeoutMs,
        );
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const label = labels.find((candidate) => selector.includes(candidate)) ?? labels[0];
    // No `force`: the actionability check is what keeps a covered or detached control from being
    // clicked, and the site signal afterwards is what decides whether the click did anything.
    await page.locator(selector).first().click({ timeout: timeoutMs });
    return { ok: true, label: label ?? '', selector };
}

interface ActionClick {
    ok: true;
    path: ActionPath;
    label: string;
    /** Coordinates for the shadow path, the resolved selector for the light path. */
    click: string;
}

/**
 * Invoke the draft-save method the action bar exposes on its `xhs-publish-btn` host. The bar
 * renders inside a CLOSED shadow root, so synthetic coordinate clicks from an automated context
 * are no-ops (OpenCLI#1606); the host method is the reliable trigger. Returns the method name,
 * or null when no visible host carries a save method (the click fallback then runs).
 */
async function invokeHostSave(page: XhsPage): Promise<string | null> {
    try {
        const verdict = await page.evaluate(`(() => {
            const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter((el) => {
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
            });
            for (const el of hosts) {
                for (const name of ['_onSave', '_onSaveDraft', '_onDraft']) {
                    const fn = el[name];
                    if (typeof fn === 'function') { fn.call(el); return 'kk-host-save:' + name; }
                }
            }
            return 'kk-host-save-none';
        })()`);
        const called = typeof verdict === 'string' ? verdict : '';
        return called.startsWith('kk-host-save:') ? called.slice('kk-host-save:'.length) : null;
    } catch {
        return null;
    }
}

/**
 * Layered server-response capture (task 0350 R1, vendor-proven from
 * `vendors/xiaohongshu-skills/scripts/xhs/publish.py`): the save/publish response is the only
 * truth about whether a note persisted — the console toast has lied while the API returned
 * `HTTPBizError` (2026-11-09/10 runs). Three layers race for the first matching payload — XHR
 * `loadend`, wrapped `fetch`, console output — and the first capture wins. Signatures are
 * content-based, not URL-based: `HTTPBizError`, a −913x code, `禁止发笔记`, or `note_id`.
 * Arming is idempotent; a page that refused injection degrades to the legacy UI signals. The
 * sentinel markers keep a mocked evaluate from ever reading as a real capture.
 */
const CAPTURE_INJECT_EXPR = `/* kk-capture-inject */ (() => {
    const w = window;
    if (w.__kkXhsArmed) return 'kk-capture-armed';
    w.__kkXhsArmed = true;
    w.__kkXhsOutcome = null;
    const signatures = [/HTTPBizError/, /"code"\\s*:\\s*-913\\d/, /禁止发笔记/, /note_id/];
    const matches = (text) => signatures.some((re) => re.test(text));
    const record = (source, text) => {
        if (w.__kkXhsOutcome) return;
        const asString = String(text || '');
        if (!asString || !matches(asString)) return;
        w.__kkXhsOutcome = { source: source, text: asString.slice(0, 800) };
    };
    const proto = XMLHttpRequest.prototype;
    if (!proto.__kkPatched) {
        proto.__kkPatched = true;
        const open = proto.open;
        const send = proto.send;
        proto.open = function (method, url) { this.__kkUrl = url; return open.apply(this, arguments); };
        proto.send = function () {
            this.addEventListener('loadend', () => {
                try { record('xhr', (this.__kkUrl || '') + ' ' + this.responseText); } catch (e) {}
            });
            return send.apply(this, arguments);
        };
    }
    if (typeof w.fetch === 'function' && !w.fetch.__kkPatched) {
        const original = w.fetch;
        w.fetch = function () {
            return original.apply(this, arguments).then((response) => {
                try {
                    response.clone().text().then((text) => record('fetch', (response.url || '') + ' ' + text)).catch(() => {});
                } catch (e) {}
                return response;
            });
        };
        w.fetch.__kkPatched = true;
    }
    if (!console.__kkPatched) {
        console.__kkPatched = true;
        for (const key of ['error', 'warn', 'log']) {
            const original = console[key].bind(console);
            console[key] = function () {
                try { record('console', Array.prototype.map.call(arguments, String).join(' ')); } catch (e) {}
                original.apply(console, arguments);
            };
        }
    }
    return 'kk-capture-armed';
})()`;
const CAPTURE_READ_EXPR = `/* kk-capture-read */ (() => {
    const captured = window.__kkXhsOutcome;
    return captured ? JSON.stringify(captured) : 'kk-capture-none';
})()`;

interface OutcomeCapture {
    source: string;
    text: string;
}

async function armOutcomeCapture(page: XhsPage): Promise<void> {
    try {
        await page.evaluate(CAPTURE_INJECT_EXPR);
    } catch {
        // No injection, no capture: the legacy UI signals remain the only outcome evidence.
    }
}

async function readOutcomeCapture(page: XhsPage): Promise<OutcomeCapture | null> {
    try {
        const read = await page.evaluate(CAPTURE_READ_EXPR);
        if (typeof read !== 'string' || !read.startsWith('{')) return null;
        const parsed = JSON.parse(read) as Partial<OutcomeCapture>;
        return typeof parsed.source === 'string' && typeof parsed.text === 'string'
            ? { source: parsed.source, text: parsed.text }
            : null;
    } catch {
        return null;
    }
}

const RISK_SIGNATURE = /禁止发笔记|违反|违规/;
const CODE_SIGNATURE = /"code"\s*:\s*(-?\d+)/;
const NOTE_ID_SIGNATURE = /"note_id"\s*:\s*"([^"]+)"/;

function classifyOutcome(text: string): {
    verdict: 'risk' | 'biz' | 'ok';
    code: string | null;
    noteId: string | null;
} {
    const code = CODE_SIGNATURE.exec(text)?.[1] ?? null;
    const noteId = NOTE_ID_SIGNATURE.exec(text)?.[1] ?? null;
    if ((code !== null && /^-913\d$/.test(code)) || RISK_SIGNATURE.test(text)) {
        return { verdict: 'risk', code, noteId };
    }
    if (noteId !== null && (code === null || code === '0')) return { verdict: 'ok', code, noteId };
    return { verdict: 'biz', code, noteId };
}

/**
 * A captured refusal outranks every UI signal (vendor first-wins): risk control is a typed
 * no-retry abort, a platform biz error a typed failure. Ok verdicts ride the Result metadata.
 */
function assertCapturedOutcome(capture: OutcomeCapture | null): void {
    if (capture === null) return;
    const { verdict, code } = classifyOutcome(capture.text);
    if (verdict === 'risk') {
        throw new AccountRiskControlError(
            `AccountRiskControlError: the ${capture.source} response matched risk-control signatures (code ${code ?? 'unknown'}, matched: ${RISK_SIGNATURE.exec(capture.text)?.[0] ?? '-913x code'}) — the account is restricted from posting on ${TARGET}; not retryable`,
        );
    }
    if (verdict === 'biz') {
        throw new PublishError(
            `PublishError: the ${capture.source} response reported a platform error (code ${code ?? 'unknown'}): ${capture.text.slice(0, 200)}`,
        );
    }
}

function captureMetadata(capture: OutcomeCapture | null): Record<string, unknown> {
    if (capture === null) return {};
    const { verdict, code, noteId } = classifyOutcome(capture.text);
    return {
        serverCapture: {
            source: capture.source,
            verdict,
            ...(code !== null ? { code } : {}),
            ...(noteId !== null ? { noteId } : {}),
        },
    };
}

/** Click an action-bar control of this mode, on the path its evidence says that bar lives on. */
async function clickActionControl(
    operation: XhsOperation,
    deps: ModeRunDeps,
    labels: readonly string[],
    what: string,
): Promise<ActionClick | { ok: false; error: string }> {
    let lastError = '';
    for (const path of MODE_ACTION_PATHS[operation]) {
        if (path === 'shadow') {
            const clicked = await clickShadowControl(deps.page, labels);
            if (clicked.ok) return { ok: true, path, label: clicked.label, click: `${clicked.x},${clicked.y}` };
            lastError = clicked.error;
            continue;
        }
        const clicked = await clickLightControl(deps.page, labels, deps.stepTimeoutMs, what);
        if (clicked.ok) return { ok: true, path, label: clicked.label, click: `selector:${clicked.selector}` };
        lastError = clicked.error;
    }
    return { ok: false, error: lastError };
}

/** Draft evidence captured before the editor opens (the counter only exists on that view). */
export interface DraftBaseline {
    count: number | null;
    stamps: string[];
}

/**
 * Read the console's draft counter (`草稿箱(N)`). It exists only on the landing view: the image
 * editor replaces the header, so this must be read before entering the mode. Returns null when the
 * label carries no number yet.
 */
async function readDraftCount(page: XhsPage): Promise<number | null> {
    for (const selector of ['text=/草稿箱\\(\\d+\\)/', 'text=草稿箱']) {
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
 * Timestamps the console prints for a saved draft, e.g. `保存于2026-09-25 21:37`. The current and
 * previous two minutes are accepted so a save near a minute boundary still confirms.
 */
function draftSavedStamps(now = new Date()): string[] {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [0, 1, 2].map((minutesAgo) => {
        const stamp = new Date(now.getTime() - minutesAgo * 60_000);
        return `保存于${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
    });
}

/** Which candidate save stamps are already on the page — the baseline a later check diffs against. */
async function readDraftStamps(page: XhsPage): Promise<string[]> {
    const present: string[] = [];
    for (const stamp of draftSavedStamps()) {
        const attached = await page
            .locator(`text=${stamp}`)
            .count()
            .catch(() => 0);
        if (attached > 0) present.push(stamp);
    }
    return present;
}

/** Draft evidence captured before the mode is entered (the counter only exists on the landing view). */
export async function readDraftBaseline(page: XhsPage): Promise<DraftBaseline> {
    return { count: await readDraftCount(page), stamps: await readDraftStamps(page) };
}

/**
 * A draft counts as observed only from a DELTA against the pre-entry baseline: the console's draft
 * counter moved, or a save timestamp appeared that was not already there. A readable counter with
 * no usable baseline is NOT evidence — XHS autosaves uploads, so "the counter exists" says nothing
 * about this save.
 */
async function isDraftRowSaved(page: XhsPage, baseline: DraftBaseline): Promise<boolean> {
    const stamps = await readDraftStamps(page);
    if (stamps.some((stamp) => !baseline.stamps.includes(stamp))) return true;
    const after = await readDraftCount(page);
    if (baseline.count === null || after === null) return false;
    return after > baseline.count;
}

/**
 * The observed draft signal, or null (rail: success only from a signal the site actually showed).
 *
 * The URL does not change on save (measured: `保存成功` + `草稿箱(N)` with the URL untouched), so
 * the signals are the toast and the counter/timestamp delta. The toast is read through
 * `readScopedSignal`, scoped to the page's notification containers — never an unscoped
 * `:text(...)`, which the note body this flow just pasted would satisfy.
 */
async function draftSignalEvidence(page: XhsPage, baseline: DraftBaseline): Promise<string | null> {
    const toast = await readScopedSignal(asPlaywrightPage(page), DRAFT_TOASTS);
    if (toast !== null) return `toast:${toast}`;
    if (await isDraftRowSaved(page, baseline)) return 'draft-row';
    return null;
}

async function applyNoteTitle(deps: ModeRunDeps): Promise<void> {
    const selector = await findSelector(deps.page, NOTE_TITLE, 'title input', deps.stepTimeoutMs);
    await deps.page
        .locator(selector)
        .first()
        .fill(deps.content.title ?? '');
    // Task 0350 R2: counter-verified in the editor before any save.
    await assertPlatformCounter(deps.page, TITLE_COUNTER_EXPR, XHS_NOTE_TITLE_MAX, 'title');
}

async function typeNoteBody(
    deps: ModeRunDeps,
    selectors: readonly string[],
    what: string,
    text?: string,
): Promise<void> {
    const selector = await findSelector(deps.page, selectors, what, deps.stepTimeoutMs);
    const body = deps.page.locator(selector).first();
    const value = text ?? deps.content.body ?? '';
    // Type rather than fill: TipTap ignores a synthetic value set, so a filled body leaves the
    // note unsaved and the draft never becomes observable.
    if (typeof body.type === 'function') {
        await body.click();
        await body.type(value, { delay: 5 });
    } else {
        await body.fill(value);
    }
    // Task 0350 R2: the platform counter is ground truth once the text is in the editor — the
    // client-side cap below cannot see xhs's 2-half-width-chars-per-unit counting.
    await assertPlatformCounter(deps.page, BODY_COUNTER_EXPR, XHS_NOTE_BODY_MAX, 'body');
}

/**
 * Platform-counter probes (task 0350 R2). Measured: the note title counter is
 * `div.title-container div.max_suffix` reading `N/20`. The body counter is observed as `0/1000`
 * but not selector-measured — the read scans the editor containers for a leaf `N/M` element and
 * `kk-counter-none` means unreadable (the client-side caps in modes.ts stay the only gate).
 * xhs counts units, not JS chars: 2 half-width chars = 1 unit.
 */
const TITLE_COUNTER_EXPR = `/* kk-counter-title */ (() => {
    const el = document.querySelector('div.title-container div.max_suffix');
    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    for (const node of document.querySelectorAll('div.title-container *')) {
        const t = (node.textContent || '').trim();
        if (/^\\d+\\/\\d+$/.test(t) && node.children.length === 0) return t;
    }
    return 'kk-counter-none';
})()`;
const BODY_COUNTER_EXPR = `/* kk-counter-body */ (() => {
    const err = document.querySelector('div.edit-container div.length-error');
    if (err && err.textContent && err.textContent.trim()) return err.textContent.trim();
    for (const node of document.querySelectorAll('div.edit-container *, div.title-container *')) {
        const t = (node.textContent || '').trim();
        if (/^\\d+\\/\\d+$/.test(t) && node.children.length === 0) return t;
    }
    return 'kk-counter-none';
})()`;

/** The counter's current value in units; null when it does not read `N/M`. */
function counterUnits(counter: string): number | null {
    const current = Number.parseInt(counter.split('/')[0] ?? '', 10);
    return Number.isFinite(current) ? current : null;
}

async function readPlatformCounter(page: XhsPage, expression: string): Promise<string | null> {
    try {
        const read = await page.evaluate(expression);
        if (typeof read !== 'string' || read.includes('kk-counter-none')) return null;
        return read.trim();
    } catch {
        return null;
    }
}

/**
 * Reject before any save when the platform's own counter says the field is over its limit
 * (task 0350 R2). Unreadable counters return silently — the client-side caps in modes.ts remain
 * the only gate, and a real overflow then surfaces in verifyDraft instead.
 */
async function assertPlatformCounter(
    page: XhsPage,
    expression: string,
    max: number,
    what: 'title' | 'body',
): Promise<void> {
    const counter = await readPlatformCounter(page, expression);
    if (counter === null) return;
    const units = counterUnits(counter);
    if (units === null || units <= max) return;
    const message = `the ${what} counter reads '${counter}' — ${units} units over the platform limit of ${max}; shorten the ${what} before saving (xhs counts units: 2 half-width chars = 1 unit)`;
    throw what === 'title'
        ? new TitleTooLongError(`TitleTooLongError: ${message}`)
        : new ContentTooLongError(`ContentTooLongError: ${message}`);
}

/**
 * A `blob:`/`data:` src is the instant local preview — it proves nothing about the server-side
 * copy. The durable https src appears only after the upload round-trip; saving while any
 * thumbnail still showed a blob src persisted a draft whose images were gone (2026-11-10 run).
 * Note the durable src itself can be a geo-fenced CDN host (sns-creator-preview.xhscdn.com):
 * from a non-CN egress the preview may render dead even when the ref is valid, so naturalWidth
 * is NOT a reliable completion signal cross-region — the src scheme is.
 */

/** The uploaded-preview count must match the payload, and every src must be durable (uploaded). */
async function confirmThumbnails(deps: ModeRunDeps, expected: number): Promise<void> {
    const selector = await findSelector(deps.page, NOTE_THUMBNAIL, 'thumbnail wait', deps.stepTimeoutMs);
    const allDurable = async (): Promise<boolean> => {
        // Sentinel strings, not booleans: a generic mocked evaluate must never read as a real
        // DOM verdict — a false positive would let the save run before uploads finish.
        const verdict = await deps.page.evaluate(`(() => {
            const imgs = Array.from(document.querySelectorAll("${selector}"));
            if (imgs.length < ${expected}) return 'kk-thumb-pending';
            return imgs.every((img) => /^https?:/.test(img.getAttribute("src") || ""))
                ? 'kk-thumb-all-durable'
                : 'kk-thumb-pending';
        })()`);
        return verdict === 'kk-thumb-all-durable';
    };
    const matches = await waitUntil(allDurable, deps.stepTimeoutMs);
    const observed = await deps.page.locator(selector).count();
    if (!matches || observed !== expected) {
        const pending = await deps.page.evaluate(`/* kk-count-local-srcs */ (() => {
            return Array.from(document.querySelectorAll("${selector}"))
                .filter((img) => !/^https?:/.test(img.getAttribute("src") || "")).length;
        })()`);
        throw new Error(
            `thumbnail count: expected ${expected} durable previews, observed ${observed} previews with ${String(pending)} still on a local (blob/data) src — the ${deps.stepTimeoutMs}ms window expired before the console finished uploading`,
        );
    }
}

async function composeImageText(input: { operation: '上传图文'; images: string[] }, deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, input.operation);
    const fileSelector = await findAttachedSelector(
        deps.page,
        IMAGE_FILE_INPUT,
        'image file input',
        deps.stepTimeoutMs,
    );
    // One ordered call: the console keeps the batch in payload order, and that order is the post.
    await deps.page.setInputFiles(fileSelector, input.images);
    await confirmThumbnails(deps, input.images.length);
    await applyNoteTitle(deps);
    await typeNoteBody(deps, NOTE_BODY, 'note body');
}

async function composeVideo(input: { operation: '上传视频'; video: string }, deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, input.operation);
    const fileSelector = await findAttachedSelector(
        deps.page,
        VIDEO_FILE_INPUT,
        'video file input',
        deps.stepTimeoutMs,
    );
    await uploadFile(asPlaywrightPage(deps.page), fileSelector, input.video, { timeoutMs: deps.stepTimeoutMs });
    // The note editor only exists once the video is attached (discovery §2).
    await findSelector(deps.page, VIDEO_EDITOR, 'video note editor', deps.stepTimeoutMs);
    // The video note is the same note composer as 图文 (`话题` / `用户` / `表情` / `关联`), so the
    // title field is the shared note title. Not re-measured for the video tab in the walk.
    await applyNoteTitle(deps);
    await typeNoteBody(deps, NOTE_BODY, 'note body');
}

async function composeArticle(deps: ModeRunDeps): Promise<void> {
    await enterMode(deps, '写长文');
    const newArticle = await findAttachedSelector(deps.page, ARTICLE_NEW, '新的创作 control', deps.stepTimeoutMs);
    await deps.page.locator(newArticle).first().click();
    const editor = await findSelector(deps.page, ARTICLE_EDITOR, 'long-article editor', deps.stepTimeoutMs);
    // Authored IN PLACE: the raw markdown is the input (no 导入链接 — that is fed from a 公众号
    // source), and the insertion is a real paste through the shared E91-D4 helper. It is pasted as
    // rendered HTML because ProseMirror would otherwise keep the markdown syntax as literal text;
    // `一键排版` is what then formats the pasted content for the platform.
    await pasteHtml(asPlaywrightPage(deps.page), editor, markdownToHtml(deps.content.body), {
        timeoutMs: deps.stepTimeoutMs,
    });
    // 一键排版 applies the layout DIRECTLY on xhs. Measured live (dogfood 2026-10-05): a
    // hit-test-verified click produced no option menu — the only new text was `自动保存于 …` — and a
    // CDP-pierced scan found none either. The `保留源格式 / 匹配目标格式 / 仅保留文本` trio is WeChat
    // MP's option set, not xhs's, and requiring it here failed a real draft run. So: click it when
    // the control exists, and treat its absence as a non-event — the layout step is an enhancement,
    // never a gate on saving.
    try {
        const layout = await findSelector(deps.page, ARTICLE_LAYOUT, '一键排版 control', deps.stepTimeoutMs);
        await deps.page.locator(layout).first().click();
    } catch {
        // No layout control on this editor build — the draft still saves.
    }
}

async function isPodcastModalOpen(page: XhsPage): Promise<boolean> {
    return trySelectors(page, PODCAST_MODAL)
        .then((found) => found.found)
        .catch(() => false);
}

async function clickPodcastModalDomFallback(page: XhsPage): Promise<string> {
    const res = await page
        .evaluate(
            `(() => {
                const modals = Array.from(document.querySelectorAll('.d-modal, div.creator-modal-sty'));
                const buttons = Array.from(document.querySelectorAll('.d-modal button, div.creator-modal-sty button, .d-modal-mask button'));
                const confirmLabels = ['确定', '完成', '确认', '保存'];
                const cropBtn = buttons.find((b) => {
                    const t = (b.textContent || '').trim();
                    return confirmLabels.includes(t) && !b.classList.contains('cancel-btn') && !b.dataset.kkClicked;
                }) || (modals.length > 1 ? Array.from(modals[modals.length - 1].querySelectorAll('button')).find((b) => !b.classList.contains('cancel-btn') && b.classList.contains('bg-red') && !(b.textContent || '').includes('去发布') && !b.dataset.kkClicked) : null);
                if (cropBtn && typeof cropBtn.click === 'function') {
                    cropBtn.dataset.kkClicked = '1';
                    cropBtn.click();
                    return JSON.stringify({ modals: modals.length, clickedCrop: true, clickedAdvance: false });
                }
                const advBtns = buttons.filter((b) => (b.textContent || '').includes('去发布') && !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true');
                const adv = advBtns[advBtns.length - 1];
                let clickedAdvance = false;
                if (adv && !adv.dataset.kkClicked && typeof adv.click === 'function') {
                    adv.dataset.kkClicked = '1';
                    adv.click();
                    clickedAdvance = true;
                }
                return JSON.stringify({
                    modals: modals.length,
                    clickedCrop: false,
                    clickedAdvance,
                    buttons: buttons.map((b) => ({ text: (b.textContent || '').trim(), cls: b.className, disabled: b.hasAttribute('disabled') })),
                });
            })()`,
        )
        .catch(() => '');
    return typeof res === 'string' ? res : '';
}

/**
 * Leave the 发播客 modal. 0236 R3 is now measured (2026-11-06 headless probe): the modal's only
 * controls are `取消` and the light-DOM `去发布`, and `去发布` does not publish — it opens the full
 * podcast editor whose action bar is the same closed-shadow `暂存离开`/`发布` pair every other mode
 * uses, so BOTH publish statuses take the same advance click and the draft decision moves to the
 * editor's action bar (MODE_ACTION_PATHS['发播客'] already routes `shadow`). Draft saving
 * waits for the modal to close by itself first — only that timed-dead path names what it saw.
 */
async function leavePodcastModal(deps: ModeRunDeps): Promise<void> {
    const closed = () => isPodcastModalOpen(deps.page).then((open) => !open);
    if (!(await isPodcastModalOpen(deps.page))) return;
    let usedFallback = false;
    let lastDiag = '';
    try {
        const advance = await clickLightControl(
            deps.page,
            PODCAST_MODAL_ADVANCE,
            Math.min(deps.stepTimeoutMs, 2_500),
            'podcast modal advance',
        );
        if (!advance.ok) {
            lastDiag = await clickPodcastModalDomFallback(deps.page);
            if (!lastDiag.startsWith('{')) throw new Error(advance.error);
            usedFallback = true;
        }
    } catch {
        lastDiag = await clickPodcastModalDomFallback(deps.page);
        usedFallback = true;
    }
    if (
        await waitUntil(async () => {
            if (await closed()) return true;
            if (usedFallback) {
                lastDiag = await clickPodcastModalDomFallback(deps.page);
            }
            return false;
        }, deps.stepTimeoutMs)
    ) {
        return;
    }
    const diagSuffix = lastDiag ? ` [modal=${lastDiag}]` : '';
    throw new Error(
        `podcast modal: the 发播客 modal stayed open ${deps.stepTimeoutMs}ms after the advance click; the measured 2026-11-06 flow moves to the podcast editor page with the closed-shadow '${DRAFT_LABELS[0]}' bar, so a fast re-measure with a fresh probe is the next step, not a retry${diagSuffix}`,
    );
}

async function composePodcast(
    input: { operation: '发播客'; audio: string; cover: string },
    deps: ModeRunDeps,
): Promise<void> {
    await enterMode(deps, input.operation);
    const open = await findAttachedSelector(deps.page, PODCAST_OPEN, '上传音频 control', deps.stepTimeoutMs);
    await deps.page.locator(open).first().click();
    await findSelector(deps.page, PODCAST_MODAL, 'podcast modal', deps.stepTimeoutMs);
    const audioInput = await findAttachedSelector(
        deps.page,
        PODCAST_AUDIO_INPUT,
        'podcast audio input',
        deps.stepTimeoutMs,
    );
    await uploadFile(asPlaywrightPage(deps.page), audioInput, input.audio, { timeoutMs: deps.stepTimeoutMs });
    // The audio card's acknowledgement is the registration signal: no ack in the window means the
    // assignment did not take, and the cover chooser would then find `去发布` disabled and stall.
    const ack = await waitUntil(async () => {
        try {
            return (await deps.page.locator(`text=${PODCAST_UPLOAD_ACK}`).count()) > 0;
        } catch {
            return false;
        }
    }, deps.stepTimeoutMs);
    if (!ack) {
        throw new Error(
            `podcast modal: the audio card never showed '${PODCAST_UPLOAD_ACK}' within ${deps.stepTimeoutMs}ms of the file assignment; mimic-file upload of ${input.audio.split('/').pop()} did not register`,
        );
    }
    await uploadPodcastCover(deps, input.cover);
    await podcastAdvanceReady(deps);
    await leavePodcastModal(deps);
    // Task 0350 R4: fill the podcast editor's fields — title, derived ≤1000-unit body, 合集 chip.
    await applyPodcastFields(deps);
}

/** The 合集 the episode joins: the content's declared collection, else the daily show's. */
function podcastCollection(content: Content): string {
    const declared = content.metadata?.collection;
    return typeof declared === 'string' && declared.trim().length > 0 ? declared.trim() : PODCAST_COLLECTION_DEFAULT;
}

function clipLine(text: string, cap: number): string {
    return text.length > cap ? `${text.slice(0, cap - 1)}…` : text;
}

/**
 * The podcast editor's body is derived, never the raw article: the episode content carries the
 * full multi-thousand-char markdown while the field caps at 1000 counter units — a raw
 * pass-through overflows every save (the manual-repair failure mode task 0350 closes). Mechanical
 * derivation: the intro line, one `· ` bullet per `## ` headline, and the closing line. Headlines
 * drop first when the budget runs out; intro/closing are clipped; the final slice is the hard
 * guarantee. The platform counter re-verifies after typing.
 */
export function derivePodcastBody(content: Content, max = XHS_NOTE_BODY_MAX): string {
    const lines = (content.body ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const prose = lines.filter((line) => !line.startsWith('#'));
    const introSource = prose[0] ?? content.title ?? '';
    const intro = clipLine(introSource, 80);
    const closing = prose.length > 1 ? clipLine(prose[prose.length - 1] ?? '', 60) : '';
    const budget = max - (closing.length > 0 ? closing.length + 1 : 0);
    const parts: string[] = [intro];
    let used = intro.length;
    for (const line of lines.filter((line) => line.startsWith('## '))) {
        const bullet = `· ${line.slice(3).trim()}`;
        if (used + bullet.length + 1 > budget) break;
        parts.push(bullet);
        used += bullet.length + 1;
    }
    if (closing.length > 0) parts.push(closing);
    return parts.join('\n').slice(0, max);
}

/**
 * Fill the podcast editor's fields (task 0350 R4). The title input, the 0/1000 body counter and
 * the 加入播客合集 chip were measured in the 2026-11-11 discovery but not selector-measured —
 * the probe chains name what they try, and the platform counters plus verifyDraft fail loud when
 * a field did not take.
 */
async function applyPodcastFields(deps: ModeRunDeps): Promise<void> {
    const title = deps.content.title ?? '';
    if (title.length > 0) {
        const selector = await findSelector(
            deps.page,
            PODCAST_TITLE_SELECTORS,
            'podcast title input',
            deps.stepTimeoutMs,
        );
        await deps.page.locator(selector).first().fill(title);
    }
    await assertPlatformCounter(deps.page, TITLE_COUNTER_EXPR, XHS_NOTE_TITLE_MAX, 'title');
    const body = derivePodcastBody(deps.content, XHS_NOTE_BODY_MAX);
    await typeNoteBody(deps, NOTE_BODY, 'podcast body', body);
    const collection = podcastCollection(deps.content);
    const chip = await findSelector(
        deps.page,
        PODCAST_COLLECTION_SELECTORS,
        '加入播客合集 control',
        deps.stepTimeoutMs,
    );
    await deps.page.locator(chip).first().click({ timeout: deps.stepTimeoutMs });
    await deps.page.locator(`text=${collection}`).first().click({ timeout: deps.stepTimeoutMs });
}

async function uploadPodcastCover(deps: ModeRunDeps, cover: string): Promise<void> {
    const zone = deps.page.locator(PODCAST_COVER_ZONE).first();
    const box = await zone.boundingBox().catch(() => null);
    if (!box) {
        throw new Error(`podcast modal: the cover card ('${PODCAST_COVER_ZONE}') has no bounding box to click`);
    }
    if (!deps.page.mouse) {
        throw new Error('podcast modal: the page seam does not expose a raw mouse for the cover-card coordinate click');
    }
    const chooser = deps.page.waitForEvent?.('filechooser', { timeout: 8_000 }).catch(() => null) as Promise<
        unknown | null
    >;
    await deps.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const pending = Symbol('pending');
    const quick = await Promise.race([
        chooser,
        new Promise<typeof pending>((resolve) => setTimeout(() => resolve(pending), 400)),
    ]);
    let diag = '';
    if (quick === pending) {
        const fallback = await deps.page
            .evaluate(
                `(() => {
                    const modal = document.querySelector('.d-modal') || document.body;
                    const inputs = Array.from(modal.querySelectorAll('input[type="file"]'));
                    const coverInput = inputs.find((i) => !String(i.getAttribute('accept') || '').includes('.mp3'));
                    const all = Array.from(modal.querySelectorAll('*')).filter((el) => (el.textContent || '').includes('设置封面'));
                    const leaf = all[all.length - 1];
                    let card = leaf;
                    while (card && card.parentElement && card.parentElement !== modal) {
                        const pt = card.parentElement.textContent || '';
                        if (pt.includes('上传成功') || pt.includes('点击上传') || pt.includes('去发布')) break;
                        card = card.parentElement;
                    }
                    let clickedInput = false;
                    if (coverInput && typeof coverInput.click === 'function') {
                        coverInput.click();
                        clickedInput = true;
                    } else {
                        if (card && typeof card.click === 'function') card.click();
                        if (leaf && typeof leaf.click === 'function') leaf.click();
                    }
                    const rect = card ? card.getBoundingClientRect() : null;
                    return JSON.stringify({
                        clickedInput,
                        x: rect ? Math.round(rect.left + rect.width / 2) : null,
                        y: rect ? Math.round(rect.top + rect.height * 0.35) : null,
                        inputs: inputs.map((i) => ({ accept: i.getAttribute('accept'), cls: i.className })),
                        cardTag: card ? card.tagName + '.' + String(card.className) : null,
                        cardRect: rect ? [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] : null,
                    });
                })()`,
            )
            .catch(() => '');
        if (typeof fallback === 'string' && fallback.startsWith('{')) {
            diag = ` [modal=${fallback}]`;
            try {
                const parsed = JSON.parse(fallback) as {
                    clickedInput?: boolean;
                    x?: number | null;
                    y?: number | null;
                };
                if (!parsed.clickedInput && typeof parsed.x === 'number' && typeof parsed.y === 'number') {
                    await deps.page.mouse.click(parsed.x, parsed.y);
                }
            } catch {
                // ignore parse errors on diagnostic payload
            }
        }
    }
    const opened = quick === pending ? await chooser : quick;
    if (!opened) {
        throw new Error(
            `podcast modal: clicking the cover card did not open a native file chooser within 8000ms${diag}`,
        );
    }
    await (opened as { setFiles(path: string): Promise<void> }).setFiles(cover);
}

/** Wait until the advance control is enabled — `去发布` stays `disabled` until BOTH cards took. */
async function podcastAdvanceReady(deps: ModeRunDeps): Promise<void> {
    if (deps.publishStatus !== 'draft') {
        return;
    }
    const enabled = await waitUntil(async () => {
        try {
            if ((await deps.page.locator('button:has-text("去发布")').count()) === 0) return false;
            const disabled = await deps.page
                .locator('button:has-text("去发布")[disabled], button:has-text("去发布")[aria-disabled="true"]')
                .count();
            return disabled === 0;
        } catch {
            return false;
        }
    }, deps.stepTimeoutMs);
    if (!enabled) {
        throw new Error(
            `podcast modal: '${PODCAST_MODAL_ADVANCE[0]}' stayed disabled — the cards were not both accepted; check the audio ack '${PODCAST_UPLOAD_ACK}' and retry with the cover chooser path`,
        );
    }
}

/** Compose the requested mode's post. Exhaustive over {@link ModeInput}. */
async function compose(input: ModeInput, deps: ModeRunDeps): Promise<void> {
    switch (input.operation) {
        case '上传图文':
            await composeImageText(input, deps);
            return;
        case '上传视频':
            await composeVideo(input, deps);
            return;
        case '写长文':
            await composeArticle(deps);
            return;
        case '发播客':
            await composePodcast(input, deps);
            return;
    }
}

function baseMetadata(input: ModeInput, deps: ModeRunDeps): Record<string, unknown> {
    return {
        operation: input.operation,
        driver: deps.driver,
        publishStatus: deps.publishStatus,
        profileDir: deps.profileDir,
        artifactPaths: artifactPaths(input),
        ...(input.operation === '上传图文' ? { imageCount: input.images.length } : {}),
    };
}

/**
 * Save the post as a draft: settle, click this mode's 暂存离开, then require an OBSERVED signal.
 * The click is retried (the console drops one that lands while the note is still settling) but the
 * signal is never assumed: an unobserved save is `ok:false` naming the label and the deadline.
 */
async function saveDraft(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    let clicked: ActionClick | null = null;
    let signal: string | null = null;
    let attempts = 0;
    let capture: OutcomeCapture | null = null;
    await armOutcomeCapture(deps.page);
    while (signal === null && attempts < deps.submitAttempts) {
        attempts += 1;
        await sleep(deps.submitSettleMs);
        // Host-method save first: the closed-shadow bar swallows synthetic coordinate clicks.
        const method = await invokeHostSave(deps.page);
        const control: Awaited<ReturnType<typeof clickActionControl>> =
            method !== null
                ? { ok: true, path: 'shadow', label: `_onSave:${method}`, click: 'shadow-host-method' }
                : await clickActionControl(input.operation, deps, DRAFT_LABELS, 'draft control');
        if (!control.ok) return fail(control.error);
        clicked = control;
        // The capture is refreshed inside the probe (expectOutcome swallows probe throws by
        // design — the refusal is classified OUTSIDE, so it propagates as a typed error).
        const outcome = await expectOutcome(
            async () => {
                if (capture === null) capture = await readOutcomeCapture(deps.page);
                return draftSignalEvidence(deps.page, deps.draftBaseline);
            },
            {
                timeoutMs: deps.submitSettleMs,
                label: `draft confirmation '${control.label}'`,
                pollMs: POLL_MS,
            },
        );
        if (outcome.ok) signal = outcome.evidence;
        else {
            // A captured refusal must not be retried: refresh and re-check before another click.
            capture = capture ?? (await readOutcomeCapture(deps.page));
            assertCapturedOutcome(capture);
        }
    }
    if (capture === null) capture = await readOutcomeCapture(deps.page);
    // The captured server response outranks every UI signal — a toast can lie while the API
    // refused (2026-11-09/10 runs) — so it is classified before any success is reported.
    assertCapturedOutcome(capture);
    const draftCountAfter = await readDraftCount(deps.page);
    if (signal === null || clicked === null) {
        return fail(
            `draft confirmation: '${clicked?.label ?? DRAFT_LABELS[0]}' was clicked ${attempts}× but neither a fresh ${TARGET} save timestamp, a moved draft counter, nor a scoped '${DRAFT_TOASTS[0]}' toast was observed within ${deps.submitSettleMs}ms (before=${String(deps.draftBaseline.count)}, after=${String(draftCountAfter)})`,
        );
    }
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        message: `${TARGET} draft saved (unpublished) in profile ${deps.profileDir} via '${clicked.label}' (${input.operation})`,
        metadata: {
            ...baseMetadata(input, deps),
            draftControl: clicked.label,
            draftClick: clicked.click,
            draftPath: clicked.path,
            draftAttempts: attempts,
            draftSignal: signal,
            draftCountBefore: deps.draftBaseline.count,
            draftCountAfter,
            ...captureMetadata(capture),
        },
    });
}

/**
 * Publish the post. Reached only for an explicit `publishStatus: 'public'` — the transport refuses
 * every other value before a browser opens, so no other path can click a publish control. ONE
 * click, no retry: an unobserved publish must never be repeated, and the console drops a click that
 * lands while the note is still settling.
 */
async function publishNote(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    await sleep(deps.submitSettleMs);
    let capture: OutcomeCapture | null = null;
    await armOutcomeCapture(deps.page);
    const submitted = await clickActionControl(input.operation, deps, PUBLISH_LABELS, 'publish control');
    if (!submitted.ok) return fail(submitted.error);

    const urlBeforeSubmit = deps.page.url();
    const confirmed = await waitUntil(async () => {
        // The captured refusal aborts immediately — waitUntil propagates the typed throw, and a
        // publish click is never retried (unlike the draft loop there is no next attempt).
        if (capture === null) capture = await readOutcomeCapture(deps.page);
        assertCapturedOutcome(capture);
        // The console rewrites its URL to `…published=true` once the post is accepted; the toast is
        // the fallback, read scoped (never from the document at large).
        if (deps.page.url().includes(PUBLISHED_MARKER)) return true;
        return (await readScopedSignal(asPlaywrightPage(deps.page), PUBLISH_CONFIRM)) !== null;
    }, deps.stepTimeoutMs);
    if (!confirmed) {
        // A refusal that lands late still outranks the "state unknown" timeout message.
        capture = capture ?? (await readOutcomeCapture(deps.page));
        assertCapturedOutcome(capture);
        return fail(
            `publish submission: state unknown — the '${submitted.label}' click (${submitted.click}) was sent from ${urlBeforeSubmit} but no success state was observed (now ${deps.page.url()}). Check the ${TARGET} creator note manager before retrying: a retry could duplicate the post.`,
        );
    }
    const url = deps.page.url();
    return ResultSchema.parse({
        ok: true,
        target: TARGET,
        ...(url !== PUBLISH_URL ? { url } : {}),
        message: `${TARGET} ${input.operation} post published`,
        metadata: {
            ...baseMetadata(input, deps),
            publishControl: submitted.label,
            publishPath: submitted.path,
            publishClick: submitted.click,
            publishSignal: url.includes(PUBLISHED_MARKER) ? `url:${PUBLISHED_MARKER}` : 'toast',
            ...captureMetadata(capture),
        },
    });
}

/** What the reopened draft must show for the save to count as server-side complete (R3). */
interface DraftExpectation {
    slots: number | null;
    title: boolean;
    body: boolean;
    collection: string | null;
}

function draftExpectation(input: ModeInput, deps: ModeRunDeps): DraftExpectation {
    switch (input.operation) {
        case '上传图文':
            return {
                slots: input.images.length,
                title: true,
                body: (deps.content.body ?? '').trim().length > 0,
                collection: null,
            };
        case '上传视频':
            return { slots: null, title: true, body: (deps.content.body ?? '').trim().length > 0, collection: null };
        case '写长文':
            return { slots: null, title: false, body: true, collection: null };
        case '发播客':
            return { slots: null, title: true, body: true, collection: podcastCollection(deps.content) };
    }
}

const DRAFT_NAV_SELECTOR = 'text=草稿箱';
const DRAFT_EDIT_SELECTOR = 'text=编辑';
const VERIFY_SLOTS_EXPR = `/* kk-verify-slots */ (() => JSON.stringify({ count: document.querySelectorAll('img.preivew-image').length }))()`;
const VERIFY_SRCS_EXPR = `/* kk-verify-srcs */ (() => JSON.stringify(Array.from(document.querySelectorAll('img.preivew-image')).map((img) => img.getAttribute('src') || '')))()`;
const VERIFY_TITLE_EXPR = `/* kk-verify-title */ (() => {
    const input = document.querySelector('input.d-text') || document.querySelector('textarea[placeholder*="标题"]');
    return input ? (input.value || '') : '';
})()`;
const VERIFY_BODY_EXPR = `/* kk-verify-body */ (() => {
    for (const node of document.querySelectorAll('div.edit-container *, div.title-container *')) {
        const t = (node.textContent || '').trim();
        if (/^\\d+\\/\\d+$/.test(t) && node.children.length === 0) return JSON.stringify({ counter: t });
    }
    const editor = document.querySelector('div.tiptap, .ProseMirror, .ql-editor');
    return JSON.stringify({ textLen: (editor?.textContent || '').trim().length });
})()`;

function collectionProbeExpr(collection: string): string {
    return `/* kk-verify-collection */ (() => (document.body.innerText.includes('${collection}') ? 'kk-verify-collection:yes' : 'kk-verify-collection:no'))()`;
}

/**
 * Task 0350 R3 — verifyDraft: the save click proves nothing about the SERVER-side copy (the
 * 2026-11-09/10 incidents: drafts whose images were blob-only, fields never persisted). The flow
 * reopens the saved draft (草稿箱 → the list's 编辑) and asserts what must have persisted: the
 * exact slot count with every src durable https, the title/body/合集 fields. A violated assertion
 * is a typed failure — the draft stays in the box for a manual pass, but the run reports failure.
 *
 * Evidence note (2026-11-11 discovery): the 草稿箱 counter is measured; the draft LIST and its
 * 编辑 control are not selector-measured — these probes say so by naming what they try.
 */
async function verifyDraft(input: ModeInput, deps: ModeRunDeps): Promise<Record<string, unknown>> {
    const expectation = draftExpectation(input, deps);
    const nav = deps.page.locator(DRAFT_NAV_SELECTOR);
    if ((await nav.count().catch(() => 0)) === 0) {
        throw new DraftVerifyError(
            `DraftVerifyError: could not reopen the saved draft — '${DRAFT_NAV_SELECTOR}' matched nothing after the save; verify the draft box manually in profile ${deps.profileDir}`,
        );
    }
    await nav.first().click({ timeout: deps.stepTimeoutMs });
    const edit = deps.page.locator(DRAFT_EDIT_SELECTOR);
    if ((await edit.count().catch(() => 0)) === 0) {
        throw new DraftVerifyError(
            `DraftVerifyError: the draft list shows no '${DRAFT_EDIT_SELECTOR}' control to reopen the saved note (2026-11-11 evidence: 编辑 1/18 on the draft list)`,
        );
    }
    await edit.first().click({ timeout: deps.stepTimeoutMs });
    const problems: string[] = [];
    if (expectation.slots !== null) {
        const slotsRead = await deps.page.evaluate(VERIFY_SLOTS_EXPR);
        const count = typeof slotsRead === 'string' ? (JSON.parse(slotsRead) as { count?: number }).count : null;
        if (count !== expectation.slots) {
            problems.push(
                `expected ${expectation.slots} thumbnails on the reopened draft, the editor shows ${String(count)}`,
            );
        } else {
            const srcsRead = await deps.page.evaluate(VERIFY_SRCS_EXPR);
            const srcs = typeof srcsRead === 'string' ? (JSON.parse(srcsRead) as string[]) : [];
            const local = srcs
                .map((src, index) => (src.startsWith('https://') ? null : index + 1))
                .filter((slot) => slot !== null);
            if (local.length > 0) {
                problems.push(
                    `slots ${local.join(', ')} still carry a non-https (blob/data/local) src — the server-side copy is missing`,
                );
            }
        }
    }
    if (expectation.title) {
        const editorTitle = String((await deps.page.evaluate(VERIFY_TITLE_EXPR)) ?? '');
        if (editorTitle !== (deps.content.title ?? '')) {
            problems.push(`title mismatch: content '${deps.content.title ?? ''}' vs reopened draft '${editorTitle}'`);
        }
    }
    if (expectation.body) {
        const bodyRead = await deps.page.evaluate(VERIFY_BODY_EXPR);
        const parsed =
            typeof bodyRead === 'string' ? (JSON.parse(bodyRead) as { counter?: string; textLen?: number }) : {};
        const units = parsed.counter !== undefined ? counterUnits(parsed.counter) : null;
        if (!((units ?? 0) > 0) && !((parsed.textLen ?? 0) > 0)) {
            problems.push('body: the reopened draft shows neither a readable N/M counter nor editor text');
        }
    }
    if (expectation.collection !== null) {
        const verdict = await deps.page.evaluate(collectionProbeExpr(expectation.collection));
        if (verdict !== 'kk-verify-collection:yes') {
            problems.push(`collection: the reopened podcast draft does not show '${expectation.collection}'`);
        }
    }
    // Leave the reopened editor WITHOUT saving: a 暂存离开 here would re-save and move the draft
    // counter the next run baselines against. Navigating away is the exit that touches nothing.
    await deps.page.goto(PUBLISH_URL);
    if (problems.length > 0) {
        throw new DraftVerifyError(
            `DraftVerifyError: the saved draft does not verify after reopen — ${problems.join('; ')}`,
        );
    }
    return {
        ...(expectation.slots !== null ? { slots: expectation.slots } : {}),
        ...(expectation.title ? { titleChecked: true } : {}),
        ...(expectation.body ? { bodyChecked: true } : {}),
        ...(expectation.collection !== null ? { collection: expectation.collection } : {}),
    };
}

/**
 * Run one validated operation end to end: compose the post, then take it to a draft or (only on an
 * explicit live request) publish it. A draft only counts when the REOPENED copy verifies
 * (task 0350 R3) — a save that cannot survive its own reopen fails the run.
 */
export async function runMode(input: ModeInput, deps: ModeRunDeps): Promise<Result> {
    await compose(input, deps);
    if (deps.publishStatus === 'public') return publishNote(input, deps);
    const saved = await saveDraft(input, deps);
    if (!saved.ok) return saved;
    let verified: Record<string, unknown>;
    try {
        verified = await verifyDraft(input, deps);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return fail(`draft saved but the reopen verification failed: ${reason}`);
    }
    return ResultSchema.parse({ ...saved, metadata: { ...saved.metadata, draftVerified: verified } });
}
