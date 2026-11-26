/**
 * shipinhao-pub transport + flow (task 0296; four post kinds since 2026-11-10).
 *
 * The live post flow in `runPostFlow`, stage-typed on every `Result.metadata.stage`, shared by the
 * four declared operations (视频 shortVideo, 音频 audio, 音乐 music, 图文 image): root-resolve
 * (the wujie policy) → media-upload → media-processing → title-fill →
 * description-paste-readback → original-declare (only when `metadata.original === true`) →
 * cover-attach (when requested; never for 图文) → draft-save | publish-click → draft-receipt |
 * publish-receipt. Per-operation differences are data, not code: the file-input selector ladder,
 * the creation-page URL and the media payload gates (videoPath | audio(audioFile) | images).
 * The audio/image/music selectors are **Provisional** until the first logged-in live recon —
 * every one of them fails closed to a typed stage failure, never a wrong send.
 *
 * Root policy (shipinhao.js:3-5, 514-545, frozen by the task 0296 Design): if `wujie-app` is
 * present, wait at most `SHP_ROOT_WAIT_MS` (vendor ROOT_WAIT_MS 30000, shipinhao.js:38) for its
 * shadowRoot plus creator-form evidence inside it and NEVER fall back to document
 * (shipinhao.js:538-539); if no wujie-app exists, require the direct evidence probes
 * (shipinhao.js:516-518) with a unique video file input. Ambiguous or absent roots are typed
 * `root-resolve` refusals — no wrong-root, ever. All wujie-mode lookups are scoped inside the
 * shadow root (the vendor queries only `[document, wujieApp.shadowRoot]`, shipinhao.js:61-63);
 * Playwright locators pierce the open root natively and evaluate scripts re-derive the same
 * vendor root.
 *
 * Video attach uses `Locator.setInputFiles` on the local path — never the vendor's in-page
 * DataTransfer/blob fetch (shipinhao.js:609-631) — and the bare file assignment is explicitly
 * NOT success (shipinhao.js:623-625): the post-upload editing form (title input + description
 * editor) must appear at the 600s media ceiling before the flow proceeds. Description Markdown is
 * rendered to HTML, sanitized here first and pasted as text/html. The 声明原创 sequence (entry
 * checkbox → declare-body-wrapper agreement checkbox → 声明原创 confirm) runs ONLY on an explicit
 * operator assertion (`metadata.original === true`) and type-fails on missing/ambiguous evidence
 * — the vendor runs it unconditionally and degrades failures to logs (shipinhao.js:10-14,
 * 2270-2310); false/absent never touches originality. Success — draft or public — comes only
 * from a FRESH id-bearing receipt URL plus re-read persisted title/description(/cover/original)
 * state; stale, ambiguous or toast-only signals are typed failures.
 */

import { type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { BrowserDriver, PublishTransport, PublishTransportPayload } from '@gobing-ai/publish-harness';
import {
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    resolveChannelProfileDir,
    stateRestoringLauncher,
    waitUntil,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import { echoError } from '@gobing-ai/ts-utils';
import type { Locator, Page } from 'playwright';
import { runAudioPostFlow } from './audio-flow';
import { centerSquareCover } from './cover-crop';
import {
    isShipinhaoAuthenticated,
    readRootSnapshot,
    SHP_AUDIO_SELECTORS,
    SHP_CONFIG,
    SHP_COVER_SAVE_WAIT_MS,
    SHP_DESCRIPTION_MAX_CHARS,
    SHP_DRAFT_CONFIRM_DIALOG_TEXT,
    SHP_DRAFT_CONFIRM_PROCEED_LABEL,
    SHP_HOME_URL_BY_OPERATION,
    SHP_IMAGE_SELECTORS,
    SHP_MUSIC_SELECTORS,
    SHP_RECEIPT_URL_RES,
    SHP_ROOT_WAIT_MS,
    SHP_TARGET,
    SHP_UPLOAD_TIMEOUT_MS,
    SHP_VIDEO_SELECTORS,
    type ShipinhaoOperationName,
    type ShipinhaoRootSnapshot,
} from './selectors';

/** Steps (fill, upload, dialog) keep the shared 30s rail. */
const STEP_TIMEOUT_MS = 30_000;
/**
 * The read-only session preflight is a cold headless launch plus a readiness poll; the shipped
 * probe verifies the same profile with a 120s budget (`profile-check check --timeout 120000`) while
 * this call was capped at the 30s STEP budget, so a healthy session that takes 40-60s to paint read
 * as `Authentication was not confirmed` (2026-11-13: check verified, publish refused).
 */
const PREFLIGHT_TIMEOUT_MS = 180_000;
/**
 * Per-poll budget for the 合集 control probe inside the selection loop: the row either exists or
 * does not, so a long wait per attempt only delays the typed refusal (2026-11-16).
 */
const COLLECTION_PROBE_MS = 2_000;
/**
 * KK v1 local-media size bound (task 0296 Design freeze): 2 GiB, applied to every media kind. A
 * project-scoped product bound, not a platform limit — Channels' own ceiling is unpinned.
 */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const SHP_LOGIN_INSTRUCTION = 'bun plugins/publishings/shipinhao-pub/src/profile-check.ts login';

/** `ok: false` refusal Result with a bounded, single-line error. */
export function fail(target: string, error: string): Result {
    return ResultSchema.parse({ ok: false, target, error: boundedDetail(error) });
}

/**
 * A browser-stage failure: `ok: false` with `stage` (and optional evidence) in the Result metadata.
 *
 * `effect` defaults to `none`: every stage before the submit click only fills an editor, so nothing
 * was accepted by the channel and a bounded retry is safe. The receipt stages (after the click) pass
 * `unknown` explicitly — a clicked 发表 that produced no receipt may still have published.
 */
export function stageFail(
    target: string,
    error: string,
    stage: string,
    metadata: Record<string, unknown>,
    evidence?: string,
    effect: 'none' | 'unknown' = 'none',
): Result {
    return ResultSchema.parse({
        ok: false,
        target,
        error: boundedDetail(error),
        metadata: {
            ...metadata,
            stage,
            ...(evidence === undefined ? {} : { evidence: boundedDetail(evidence) }),
            ...(effect === 'none' ? { itcDelivery: { schemaVersion: 1, effect: 'none' } } : {}),
        },
    });
}

/** One short line, bounded: no DOM dump, cookie, token, stack or leaked media path ever reaches the Result. */
export function boundedDetail(detail: string): string {
    return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** A bounded, single-line rendering of an operator-supplied value for a refusal message. */
export function bounded(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
    return String(value).replace(/\s+/g, ' ').slice(0, 100);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Session failures whose one-liner must name the recovery command. */
function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

/** Whitespace-insensitive comparison: site normalizations must not fail a strict readback. */
function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
}

/** Plain text of sanitized HTML: block tags → newlines, then strip tags and decode entities. */
function htmlToPlainText(html: string): string {
    return html
        .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

/**
 * Build the description the 添加描述 editor can actually retain: plain text (the editor keeps
 * innerText, not markdown — headings lose `#`, links keep only their text) clipped to the 100-char
 * platform cap with the topic tags kept whole, then re-rendered to the HTML we paste. Exported for
 * the test contract (same pipeline the flow pastes).
 */
export function buildShipinhaoDescription(
    body: string,
    tags: readonly string[],
): { description: string; html: string } {
    const bodyPlain = htmlToPlainText(sanitizeShipinhaoHtml(markdownToHtml(body)));
    const topicLine = tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ');
    const budget = SHP_DESCRIPTION_MAX_CHARS - (tags.length > 0 ? Array.from(topicLine).length + 1 : 0);
    const clipped = Array.from(bodyPlain).slice(0, Math.max(budget, 0)).join('').trim();
    const description = tags.length > 0 ? `${clipped}\n${topicLine}` : clipped;
    return { description, html: sanitizeShipinhaoHtml(markdownToHtml(description)) };
}

/**
 * Plugin-local HTML sanitizer (task 0296 Design freeze — no new dependency): strips
 * script/style/iframe/embed/object containers, `on*` event attributes and `javascript:`/`data:`
 * URLs while preserving code/list/heading markup, before any paste reaches the editor. Mirrors the
 * xiaoyuzhou-pub sanitizer (0295) including its `data:` arm.
 */
export function sanitizeShipinhaoHtml(html: string): string {
    return html
        .replace(/<\s*(script|style|iframe|embed|object)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|style|iframe|embed|object)\b[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(\s(?:href|src)\s*=\s*)(["'])\s*(?:javascript|data):[^"']*\2/gi, '$1$2$2')
        .replace(/(\s(?:href|src)\s*=\s*)(?:javascript|data):[^\s>]*/gi, '$1""');
}

/**
 * The vendor root expression inside evaluate scripts: wujie mode derives exactly
 * `document.querySelector('wujie-app').shadowRoot` (shipinhao.js:61-63 — shadow ONLY, never
 * document); direct mode is document. Every page script re-derives this root instead of piercing
 * globally, so a wujie-mode lookup can never resolve a host-page (wrong-root) control.
 */
function rootExpression(mode: 'wujie' | 'direct'): string {
    return mode === 'wujie' ? "document.querySelector('wujie-app')?.shadowRoot ?? null" : 'document';
}

/** Shared script preamble: the vendor root plus the normalized-text/checked/label helpers. */
function rootScriptPrefix(mode: 'wujie' | 'direct'): string {
    return `(() => {
    const root = ${rootExpression(mode)};
    const norm = (v) => String(v ?? '').replace(/\\s+/g, '');
    const isChecked = (input) => Boolean(input && (input.checked
        || input.getAttribute('aria-checked') === 'true'
        || (input.closest && input.closest('.ant-checkbox-checked, [data-state="checked"]'))));
    const fieldLabel = (input) => [input.id, input.name, input.className,
        input.getAttribute && input.getAttribute('aria-label'), input.getAttribute && input.getAttribute('title'),
        input.getAttribute && input.getAttribute('data-testid')].filter(Boolean).join(' ');`;
}

/**
 * Bounded wujie root policy (stage `root-resolve`): waits at most `SHP_ROOT_WAIT_MS` for the
 * active creator root exactly like the vendor's `resolveRoot` (shipinhao.js:532-545) — wujie
 * present ⇒ its shadowRoot ONLY (no document fallback, shipinhao.js:538-539); no wujie ⇒ direct
 * evidence probes (shipinhao.js:516-518) with a UNIQUE video file input (the vendor's single
 * untyped-input rule, shipinhao.js:580-583). Ambiguous/absent = typed refusal naming the vendor
 * readiness reason (shipinhao.js:524-529).
 */
async function resolveCreatorRoot(
    page: Page,
): Promise<{ mode?: 'wujie' | 'direct'; error?: undefined } | { mode?: undefined; error: string }> {
    let last: ShipinhaoRootSnapshot | undefined;
    const ready = await waitUntil(
        async () => {
            const snapshot = await readRootSnapshot(page);
            last = snapshot;
            if (snapshot.wujiePresent) {
                return snapshot.shadowRootReady && snapshot.shadowFileInputs + snapshot.shadowTextEvidence > 0;
            }
            return snapshot.directFileInputs + snapshot.directTextEvidence > 0;
        },
        SHP_ROOT_WAIT_MS,
        500,
    );
    const snapshot = last ?? (await readRootSnapshot(page));
    if (!ready) {
        if (snapshot.wujiePresent && !snapshot.shadowRootReady) {
            return {
                error: `shipinhao creator form not ready (shadow_root_not_ready): wujie-app is present but its shadowRoot did not become ready within ${SHP_ROOT_WAIT_MS}ms — the vendor waits for the shadow root and never falls back to document (shipinhao.js:524-525, 538-539); refusing without a wrong-root`,
            };
        }
        if (snapshot.wujiePresent) {
            return {
                error: `shipinhao creator form not ready: the wujie-app shadowRoot is attached but no creator-form evidence (video file input or 添加描述/标题 placeholder) appeared inside it within ${SHP_ROOT_WAIT_MS}ms (shipinhao.js:516-518)`,
            };
        }
        return {
            error: `shipinhao creator form not ready (publish_root_selector_unmatched): no wujie-app and no direct evidence (input[type=file], 添加描述/标题 placeholder) within ${SHP_ROOT_WAIT_MS}ms on ${page.url()} (shipinhao.js:526-529) — run: ${SHP_LOGIN_INSTRUCTION}`,
        };
    }
    if (!snapshot.wujiePresent && snapshot.directFileInputs > 1) {
        return {
            error: `shipinhao creator form ambiguous: ${snapshot.directFileInputs} direct input[type=file] candidates without a wujie root — the vendor resolves a unique untyped input or nothing (shipinhao.js:580-583); refusing rather than picking a wrong upload target`,
        };
    }
    return { mode: snapshot.wujiePresent ? 'wujie' : 'direct' };
}

/**
 * Resolves the first attached candidate, scoped to the active creator root: wujie mode chains
 * through `wujie-app`'s open shadow root, direct mode searches the document. Polls to the
 * deadline; throws naming the label and every candidate when nothing attaches (typed at the call
 * site — every call site wraps this and turns the throw into a `stageFail`).
 */
async function resolveRootLocator(
    page: Page,
    mode: 'wujie' | 'direct',
    selectors: readonly string[],
    label: string,
    timeoutMs: number = STEP_TIMEOUT_MS,
): Promise<{ locator: Locator; selector: string }> {
    const scope = mode === 'wujie' ? page.locator('wujie-app') : page;
    const outcome = await expectOutcome(
        async () => {
            for (const selector of selectors) {
                if ((await scope.locator(selector).first().count()) > 0) return selector;
            }
            return null;
        },
        { timeoutMs, label: `${label} attach` },
    );
    if (!outcome.ok) throw new Error(`${label}: ${selectors.join(' | ')} not attached (${outcome.error})`);
    const selector = outcome.evidence;
    return { locator: scope.locator(selector).first(), selector };
}

/**
 * Shadow-safe rich-text paste: a synthetic `paste` ClipboardEvent (text/html + text/plain) and
 * input/change dispatch evaluated against the active root and the resolved editor selector, so
 * the editor is reached even inside the wujie shadow root (the shared `pasteHtml` helper
 * evaluates `document.querySelector`, which cannot pierce). Mirrors the harness paste mechanics
 * and the vendor's simulatePaste + event dispatch; runs via `page.evaluate` like every other
 * in-page script here — Playwright 1.55 evaluates a `Locator.evaluate` string as a bare
 * expression, so a function string silently never runs (found by the 0296 real-DOM fixture).
 */
async function pasteRichText(page: Page, mode: 'wujie' | 'direct', selector: string, html: string): Promise<void> {
    const outcome = String(
        await page.evaluate(`${rootScriptPrefix(mode)}
    const el = root === null ? null : root.querySelector(${JSON.stringify(selector)});
    if (el === null) return 'missing';
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const data = new DataTransfer();
    data.setData('text/html', ${JSON.stringify(html)});
    data.setData('text/plain', String(probe.textContent ?? ''));
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'pasted';
})()`),
    );
    if (outcome !== 'pasted') throw new Error(`pasteRichText: ${selector} not attached for paste`);
}

/** Root-scoped title input `value` readback. */
function titleValueScript(mode: 'wujie' | 'direct', selector: string): string {
    return `${rootScriptPrefix(mode)}
    const el = root === null ? null : root.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.value ?? '');
})()`;
}

/** Root-scoped editor text readback (innerText of the resolved description editor). */
function editorTextScript(mode: 'wujie' | 'direct', selector: string): string {
    return `${rootScriptPrefix(mode)}
    const el = root === null ? null : root.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.innerText ?? el.textContent ?? '');
})()`;
}

/**
 * Draft-save confirm dialog (Grounded live probe 2026-11-11): with 定时发表 active, clicking
 * 保存草稿 renders the confirm dialog whose exact text is SHP_DRAFT_CONFIRM_DIALOG_TEXT with
 * visible 不保存/保存 buttons — the save only proceeds after clicking the visible 保存. The same
 * dialog also exists as a hidden 0×0 template, so the click requires a rendered box; absent
 * dialog = normal no-op. **Audio known-gap**: the audio form's auto-cover slot stays
 * primary-loading ≥8 min (headless AND headed) and the vendor never posts the save — draft-save
 * for audio is a typed ceiling failure until a viable audio intake is pinned.
 */
function draftConfirmClickScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)} // kk-shp-draft-confirm
    const mark = ${JSON.stringify(SHP_DRAFT_CONFIRM_DIALOG_TEXT)};
    const proceed = ${JSON.stringify(SHP_DRAFT_CONFIRM_PROCEED_LABEL)};
    for (const scope of [document, root]) {
        if (!scope) continue;
        // Anchor from the button side: the dialog text repeats across nested toast/dialog spans and
        // the last text-bearing element is a leaf without buttons (Grounded live probe 2026-11-11).
        for (const button of scope.querySelectorAll('button')) {
            if (String(button.textContent || '').trim() !== proceed || button.disabled) continue;
            // Only click a genuinely rendered dialog button: the vendor ships this dialog as a
            // permanently hidden 0×0 template inside the form (Grounded live probe 2026-11-11) —
            // clicking the hidden copy is a silent no-op that would otherwise satisfy the rail.
            const rect = button.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0)) continue;
            let ancestor = button;
            for (let depth = 0; depth < 6 && ancestor; depth++) {
                if (String(ancestor.textContent || '').includes(mark)) {
                    button.click();
                    return JSON.stringify({ ok: true });
                }
                ancestor = ancestor.parentElement;
            }
        }
    }
    return JSON.stringify({ ok: false, reason: 'absent' });
})()`;
}

/**
 * Receipt-shaped URLs on screen (location + anchors across the vendor roots) — baseline and fresh
 * read for the receipt stage.
 */
async function readReceiptUrls(page: Page): Promise<readonly string[]> {
    const raw = await page.evaluate(`(() => { // kk-shp-receipt-urls
    const patterns = [${SHP_RECEIPT_URL_RES.map((re) => re.toString()).join(', ')}];
    const matches = (url) => patterns.some((re) => re.test(url));
    const urls = [];
    const roots = [document, (document.querySelector('wujie-app') || {}).shadowRoot].filter(Boolean);
    for (const root of roots) {
        if (root === document && matches(location.href)) urls.push(location.href);
        for (const a of root.querySelectorAll('a[href]')) {
            if (matches(a.href) && !urls.includes(a.href)) urls.push(a.href);
        }
    }
    return JSON.stringify(urls);
})()`);
    try {
        const parsed: unknown = JSON.parse(String(raw));
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch {
        return [];
    }
}

/** Works/record id from an observed receipt URL (shapes: `/record/detail/<id>`, `/post/<kind>/<id>`; provisional). */
function receiptIdFrom(url: string): string | undefined {
    return /\/(?:detail|video|audio|image|music)\/([0-9a-zA-Z_-]+)/.exec(url)?.[1];
}

interface MediaPathSpec {
    /** Metadata key named in every refusal (never the caller's raw value). */
    field: string;
    /** Kind word in the non-file/missing messages ('video', 'audio', 'image'). */
    kindLabel: string;
    /** Extension word in the unsupported-extension message ('MP4/MOV', 'MP3/M4A/...'). */
    extLabel: string;
    extRe: RegExp;
}

/**
 * Pre-browser media gate: the raw value must name an existing, regular, readable, nonempty local
 * file of the accepted extensions under the KK v1 2 GiB local cap (labeled local bound — not a
 * platform limit). Probed through the Bun file API (repo rule no-direct-fs-io) — never node:fs.
 */
async function resolveMediaPath(
    raw: unknown,
    spec: MediaPathSpec,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return {
            error: `metadata.${spec.field} must be a non-empty local ${spec.kindLabel} file path, got '${bounded(raw)}'`,
        };
    }
    const path = raw.trim();
    if (!spec.extRe.test(path)) {
        return {
            error: `metadata.${spec.field} must be a local ${spec.extLabel} file, got unsupported extension in '${bounded(path)}'`,
        };
    }
    // no-direct-fs-io: probe the file through the Bun API instead of node:fs.
    const file = Bun.file(path);
    const readable = await file.exists().catch(() => false);
    if (!readable || file.size === 0) {
        return {
            error: `metadata.${spec.field} does not resolve to a readable nonempty local ${spec.kindLabel} file`,
        };
    }
    if (file.size > MAX_VIDEO_BYTES) {
        return {
            error: `metadata.${spec.field} exceeds the KK v1 local ${spec.kindLabel} cap of 2 GiB (${file.size} bytes; a local product bound, not a platform limit)`,
        };
    }
    return { path };
}

/** Video gate over the generic media gate (task 0296 messages preserved verbatim). */
function resolveVideoPath(
    raw: unknown,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    return resolveMediaPath(raw, {
        field: 'videoPath',
        kindLabel: 'video',
        extLabel: 'MP4/MOV',
        extRe: /\.(mp4|mov)$/i,
    });
}

/**
 * Audio gate (音频/音乐): the daily episode mp3 rides `metadata.audioFile` (publish-prep's
 * spelling); the variant builders also restate it as `metadata.audio` — the transport accepts
 * either, so the field name in refusals names both.
 */
function resolveAudioPath(
    raw: unknown,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    return resolveMediaPath(raw, {
        field: 'audio (or audioFile)',
        kindLabel: 'audio',
        extLabel: 'MP3/M4A/WAV/AAC/FLAC',
        extRe: /\.(mp3|m4a|wav|aac|flac)$/i,
    });
}

/**
 * Image gate (图文): `metadata.images` is a non-empty array of local PNG/JPEG/WebP paths (plain
 * strings or `{ path }` objects, the cards-variant spelling), each probed like a single media
 * file. shortcut: no array-length cap — the platform's 图文 count limit is unpinned until live
 * recon.
 */
async function resolveImagesPath(
    raw: unknown,
): Promise<{ paths?: readonly string[]; error?: undefined } | { paths?: undefined; error: string }> {
    if (!Array.isArray(raw) || raw.length === 0) {
        return {
            error: `metadata.images must be a non-empty array of local image file paths, got '${bounded(raw)}'`,
        };
    }
    const paths: string[] = [];
    for (const entry of raw) {
        // The shared cards variant ships `images: [{ path }]`; the transport flattens to paths.
        const candidate =
            typeof entry === 'object' && entry !== null && 'path' in entry ? (entry as { path?: unknown }).path : entry;
        const one = await resolveMediaPath(candidate, {
            field: 'images[]',
            kindLabel: 'image',
            extLabel: 'PNG/JPEG/WebP',
            extRe: /\.(png|jpe?g|webp)$/i,
        });
        if (one.error !== undefined) return { error: one.error };
        paths.push(one.path as string);
    }
    return { paths };
}

/**
 * Pre-browser requested-cover gate: an optional local PNG/JPEG/WebP that must exist as a regular,
 * readable, nonempty file. Requested-but-absent or wrong-typed refuses here — a requested cover is
 * never silently skipped (the vendor type-fails a missing cover slot too, shipinhao.js:2147-2149).
 */
async function resolveCoverPath(
    raw: unknown,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    if (raw === undefined) return {};
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `metadata.coverPath must be a non-empty local file path when present, got '${bounded(raw)}'` };
    }
    const path = raw.trim();
    if (!/\.(png|jpe?g|webp)$/i.test(path)) {
        return {
            error: `metadata.coverPath must be a local PNG/JPEG/WebP file, got unsupported extension in '${bounded(path)}'`,
        };
    }
    // no-direct-fs-io: probe the file through the Bun API instead of node:fs.
    const file = Bun.file(path);
    const readable = await file.exists().catch(() => false);
    if (!readable || file.size === 0) {
        return {
            error: 'metadata.coverPath does not resolve to a readable nonempty local file (refusing, never a silent skip)',
        };
    }
    return { path };
}

/**
 * Pre-browser tags gate: optional array of nonempty strings; empties and non-strings refuse (the
 * vendor trims and strips leading `#` when writing topics, shipinhao.js:2689-2692 — the same
 * normalization is applied at paste time).
 */
function resolveTags(
    raw: unknown,
): { tags?: readonly string[]; error?: undefined } | { tags?: undefined; error: string } {
    if (raw === undefined) return { tags: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.tags must be an array of nonempty topic strings, got '${bounded(raw)}'` };
    }
    const tags: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.tags must contain only nonempty topic strings, got '${bounded(entry)}'` };
        }
        tags.push(entry.trim());
    }
    return { tags };
}

/** Pre-browser originality gate: optional boolean — only `true` authorizes the declaration sequence. */
function resolveOriginal(
    raw: unknown,
): { original?: boolean; error?: undefined } | { original?: undefined; error: string } {
    if (raw === undefined) return { original: false };
    if (typeof raw !== 'boolean') {
        return { error: `metadata.original must be a boolean when present, got '${bounded(raw)}'` };
    }
    return { original: raw };
}

/**
 * Pre-browser 合集 gate (2026-11-16): an optional non-empty collection title, applied to the AUDIO
 * post only. A collection that cannot be committed is a typed failure *before* the submit click —
 * the operator asked for the episode to live in 合集 `每日AI乱炖`, so publishing without it is not
 * a degraded success, it is the wrong result.
 */
function resolveCollection(
    raw: unknown,
): { collection?: string; error?: undefined } | { collection?: undefined; error: string } {
    if (raw === undefined) return {};
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `collection must be a nonempty string when present, got '${bounded(raw)}'` };
    }
    return { collection: raw.trim() };
}

/**
 * Unsupported requested fields, per operation: fields that mean nothing to the requested flow —
 * images/videoPath outside their own operation, coverPath for 图文 — are typed unsupported-field
 * refusals, never silently ignored. categories and publishTime/scheduling are refused for every
 * operation (定时 is an unported vendor enhancement, shipinhao.js:7-9). `tags`/`original`/
 * `coverPath` (except on image) are implemented and validated in their resolvers.
 */
function unsupportedFields(payload: PublishTransportPayload, operation: ShipinhaoOperationName): readonly string[] {
    // `collection` is implemented for AUDIO only (2026-11-16): the other three kinds must keep
    // their exact current behaviour, so a collection request on them is refused by name instead of
    // silently ignored.
    const perOperation: Record<ShipinhaoOperationName, readonly string[]> = {
        shortVideo: ['images', 'categories', 'publishTime', 'scheduling', 'collection'],
        audio: ['videoPath', 'images', 'categories', 'publishTime', 'scheduling'],
        music: ['videoPath', 'images', 'categories', 'publishTime', 'scheduling', 'collection'],
        image: ['videoPath', 'coverPath', 'categories', 'publishTime', 'scheduling', 'collection'],
    };
    const refused: string[] = [];
    for (const [container, source] of [
        ['options', payload.options] as const,
        ['metadata', payload.content.metadata] as const,
    ]) {
        if (source === undefined || source === null || typeof source !== 'object') continue;
        for (const key of perOperation[operation]) {
            if (key in source) refused.push(`${container}.${key}`);
        }
    }
    return refused;
}

/**
 * Per-operation flow data: the shared rails' selector table, the media file-input ladder, and the
 * message label used by every upload/media-processing stage failure.
 */
interface PostFlowSpec {
    selectors: typeof SHP_VIDEO_SELECTORS;
    fileSelectors: readonly string[];
    mediaLabel: string;
}

const POST_FLOW_SPECS: Record<ShipinhaoOperationName, PostFlowSpec> = {
    shortVideo: { selectors: SHP_VIDEO_SELECTORS, fileSelectors: SHP_VIDEO_SELECTORS.videoInput, mediaLabel: 'video' },
    audio: { selectors: SHP_AUDIO_SELECTORS, fileSelectors: SHP_AUDIO_SELECTORS.audioInput, mediaLabel: 'audio' },
    music: { selectors: SHP_MUSIC_SELECTORS, fileSelectors: SHP_MUSIC_SELECTORS.audioInput, mediaLabel: 'music' },
    image: { selectors: SHP_IMAGE_SELECTORS, fileSelectors: SHP_IMAGE_SELECTORS.imagesInput, mediaLabel: 'image' },
};

/** Post-upload media-processing probe: the editing form (title input + description editor) must appear in the active root — the assignment itself is never success (shipinhao.js:623-625, 2676-2683). */
function editingFormReadyScript(mode: 'wujie' | 'direct', titleSelector: string, editorSelector: string): string {
    return `${rootScriptPrefix(mode)}
    const title = root === null ? null : root.querySelector(${JSON.stringify(titleSelector)});
    const editor = root === null ? null : root.querySelector(${JSON.stringify(editorSelector)});
    return JSON.stringify({ ready: title !== null && editor !== null });
})()`;
}

/**
 * 合集 (collection) control, one parameterised page script (2026-11-16).
 *
 * The audio form's collection row ships without a stable class, so this works from text alone:
 * `click-entry` finds the rendered row whose own text starts with the 合集 label and clicks it,
 * `click-option` picks the option whose own text equals the requested collection (exact, never by
 * index) — a native `<select>` is served by assigning the matching option's value — and `read`
 * re-reads the row afterwards so a click that did not commit is never mistaken for a selection.
 */
function collectionScript(
    mode: 'wujie' | 'direct',
    action: 'click-entry' | 'click-option' | 'read',
    label: string,
    name: string,
): string {
    return `${rootScriptPrefix(mode)} // kk-shp-collection
    const label = ${JSON.stringify(label)};
    const name = ${JSON.stringify(name)};
    const action = ${JSON.stringify(action)};
    const roots = [document, root].filter(Boolean);
    const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent || '').trim()).join(' ').trim();
    const rendered = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const all = [];
    for (const scope of roots) {
        if (!scope || !scope.querySelectorAll) continue;
        for (const el of scope.querySelectorAll('*')) all.push(el);
    }
    const row = all.find((el) => rendered(el) && ownText(el).startsWith(label));
    if (action === 'click-entry') {
        if (!row) return JSON.stringify({ ok: false, reason: 'entry-absent' });
        const target = row.closest('button, div, li, label') || row;
        target.click();
        return JSON.stringify({ ok: true, text: String(row.textContent || '').trim().slice(0, 80) });
    }
    if (action === 'click-option') {
        const exact = all.filter((el) => rendered(el) && ownText(el) === name);
        if (exact.length > 0) {
            const option = exact[exact.length - 1];
            (option.closest('li, div, label, button') || option).click();
            return JSON.stringify({ ok: true, how: 'text' });
        }
        const near = all.filter((el) => rendered(el) && ownText(el).includes(name)).map((el) => ownText(el).slice(0, 40));
        return JSON.stringify({ ok: false, reason: 'option-absent', seen: [...new Set(near)].slice(0, 8) });
    }
    const state = row === undefined ? '' : String(row.textContent || '').trim().slice(0, 120);
    return JSON.stringify({ ok: state.includes(name), text: state });
})()`;
}

/**
 * 声明原创 entry checkbox locator, vendor scoring ported verbatim (shipinhao.js:2233-2261):
 * 原创/original attribute evidence, an associated 原创 label, or a short 原创 ancestor text;
 * candidates inside `div.declare-body-wrapper` are excluded (shipinhao.js:2235-2236). The single
 * top-scoring candidate is the entry; zero = missing, several top scorers = ambiguous (the
 * operator-assertion contract type-fails where the vendor degrades to a log, shipinhao.js:2274).
 * `action: 'ensure'` clicks an unchecked entry (the vendor clicks the raw transparent input
 * directly, shipinhao.js:2225-2227, 2281).
 */
function originalEntryScript(mode: 'wujie' | 'direct', action: 'probe' | 'ensure'): string {
    const ensure = action === 'ensure';
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ ok: false, reason: 'no-root' });
    const boxes = Array.from(root.querySelectorAll('input[type="checkbox"]')).filter(
        (input) => !(input.closest && input.closest('div.declare-body-wrapper')));
    const labels = Array.from(root.querySelectorAll('label'));
    const scored = [];
    boxes.forEach((input, index) => {
        let score = /原创|original/i.test(fieldLabel(input)) ? 120 : 0;
        const label = labels.find((candidate) => candidate === (input.closest && input.closest('label'))
            || (input.id && candidate.htmlFor === input.id) || (candidate.contains && candidate.contains(input)));
        if (label && /原创|声明原创/.test(norm(label.textContent))) score += 200;
        let parent = input.parentElement;
        for (let depth = 0; parent && depth < 4; depth += 1) {
            if (/^(BODY|MAIN|FORM)$/.test(parent.tagName || '')) break;
            const text = norm(parent.textContent);
            if (text.length <= 80 && /原创|声明原创/.test(text)) { score += 100 - depth * 10; break; }
            parent = parent.parentElement;
        }
        if (score > 0) scored.push({ index, score });
    });
    if (scored.length === 0) return JSON.stringify({ ok: false, reason: 'missing' });
    const top = Math.max.apply(null, scored.map((candidate) => candidate.score));
    const best = scored.filter((candidate) => candidate.score === top);
    if (best.length > 1) return JSON.stringify({ ok: false, reason: 'ambiguous', count: best.length });
    const input = boxes[best[0].index];
    const checked = isChecked(input);
    if (${ensure} && !checked) input.click();
    return JSON.stringify({ ok: true, checked, clicked: ${ensure} && !checked });
})()`;
}

/**
 * The declare-body-wrapper agreement checkbox (shipinhao.js:2285-2287); `action: 'ensure'` clicks
 * it when unchecked (shipinhao.js:2291-2294). Missing wrapper checkbox = typed failure where the
 * vendor abandons the declaration (shipinhao.js:2288-2289).
 */
function originalAgreementScript(mode: 'wujie' | 'direct', action: 'probe' | 'ensure'): string {
    const ensure = action === 'ensure';
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ ok: false, reason: 'no-root' });
    const box = root.querySelector('div.declare-body-wrapper input[type="checkbox"].ant-checkbox-input');
    if (!box) return JSON.stringify({ ok: false, reason: 'missing' });
    const checked = isChecked(box);
    if (${ensure} && !checked) box.click();
    return JSON.stringify({ ok: true, checked, clicked: ${ensure} && !checked });
})()`;
}

/**
 * The 声明原创 confirm button, exact normalized text, exactly one expected
 * (shipinhao.js:2296-2301). Zero = missing, several = ambiguous — both typed failures where the
 * vendor abandons (shipinhao.js:2300-2301).
 */
function originalConfirmScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ ok: false, reason: 'no-root' });
    const buttons = Array.from(root.querySelectorAll('button, [role="button"]'))
        .filter((button) => norm(button.textContent) === ${JSON.stringify(SHP_VIDEO_SELECTORS.originalConfirmLabel)});
    if (buttons.length === 0) return JSON.stringify({ ok: false, reason: 'missing' });
    if (buttons.length > 1) return JSON.stringify({ ok: false, reason: 'ambiguous', count: buttons.length });
    buttons[0].click();
    return JSON.stringify({ ok: true });
})()`;
}

/**
 * Declaration commit probe: after the confirm click the vendor waits for the 弹层 to close
 * (shipinhao.js:2302-2305) — the declare-body-wrapper dialog must be gone; the committed checked
 * entry state is probed separately via `originalEntryScript('probe')`.
 */
function originalClosedScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ closed: false });
    const wrapper = root.querySelector('div.declare-body-wrapper');
    return JSON.stringify({ closed: wrapper === null || wrapper.getClientRects().length === 0 });
})()`;
}

/**
 * Vertical-cover slot evidence (vendor attribute filter `coverStateAttributes`,
 * shipinhao.js:1461-1467, plus img src). Canvas pixels are deliberately NOT read: canvas presence
 * alone is insufficient evidence (shipinhao.js:2111) — the committed state is the slot's
 * data-* and src descriptor changing after the dialog closes.
 */
function coverSlotEvidenceScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ found: false });
    const slot = root.querySelector('div.cover-preview-wrap > div');
    if (slot === null) return JSON.stringify({ found: false });
    const attrs = (slot.getAttributeNames ? slot.getAttributeNames() : [])
        .filter((name) => /^(?:data-(?:src|url))$/i.test(name) || /^data-(?:cover|upload)[-_]/i.test(name))
        .sort().map((name) => name + '=' + (slot.getAttribute(name) || '')).join(';');
    const img = slot.querySelector('img[src]');
    return JSON.stringify({ found: true, descriptor: attrs + '|' + (img === null ? '' : String(img.getAttribute('src') || '')) });
})()`;
}

/** Clicks the vertical-cover edit entry (shipinhao.js:2145-2147); missing entry = typed failure. */
function coverEntryClickScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ ok: false, reason: 'no-root' });
    const entry = root.querySelector('div.cover-preview-wrap > div');
    if (entry === null) return JSON.stringify({ ok: false, reason: 'missing' });
    entry.click();
    return JSON.stringify({ ok: true });
})()`;
}

/**
 * Cover dialog probe (vendor `findCoverControl`, shipinhao.js:2144-2149): the first matching
 * container selector that holds a file input OR reads 封面|直接编辑|确认. Returns the matched
 * selector so the flow can scope the dialog's own file input and confirm buttons to it.
 */
function coverDialogProbeScript(mode: 'wujie' | 'direct'): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ found: false });
    const selectors = ${JSON.stringify(SHP_VIDEO_SELECTORS.coverDialog)};
    for (const selector of selectors) {
        for (const control of root.querySelectorAll(selector)) {
            const hasFileInput = control.querySelector('input[type="file"]') !== null;
            if (hasFileInput || /封面|直接编辑|确认/.test(norm(control.textContent))) {
                return JSON.stringify({ found: true, selector, hasFileInput });
            }
        }
    }
    return JSON.stringify({ found: false });
})()`;
}

/**
 * Cover confirm click, vendor label ladder (shipinhao.js:1853-1871): the exact 确认 footer button
 * inside `div.finder-dialog-footer` first, then 确认|完成|保存|应用|确定 within the control — the
 * crop-confirm → outer-submit ladder the vendor walks with its previous-button guard
 * (shipinhao.js:1883-1916) is driven by these labels only; a missing control/confirm is a typed
 * failure, never a silent skip.
 */
function coverConfirmClickScript(mode: 'wujie' | 'direct', dialogSelector: string): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ ok: false, reason: 'no-root' });
    const controls = Array.from(root.querySelectorAll(${JSON.stringify(dialogSelector)}))
        .filter((control) => control.querySelector('input[type="file"]') !== null
            || /封面|直接编辑|确认/.test(norm(control.textContent)));
    if (controls.length === 0) return JSON.stringify({ ok: false, reason: 'missing-control' });
    const control = controls[0];
    const footer = Array.from(control.querySelectorAll(${JSON.stringify(SHP_VIDEO_SELECTORS.coverConfirmFooter)}))
        .find((button) => norm(button.textContent) === '确认');
    const labels = ${JSON.stringify(SHP_VIDEO_SELECTORS.coverConfirmLabels)};
    const button = footer || Array.from(control.querySelectorAll('button, [role="button"]'))
        .find((candidate) => labels.includes(norm(candidate.textContent)));
    if (!button) return JSON.stringify({ ok: false, reason: 'missing-confirm' });
    button.click();
    return JSON.stringify({ ok: true, label: norm(button.textContent) });
})()`;
}

/**
 * Persisted-state readback at receipt time: the title input and description editor still hold the
 * requested content, and when a declaration was requested the 弹层 is still closed, and when a
 * cover was requested the slot still exposes readable evidence. Frozen success rule — a fresh id
 * alone never confirms (the vendor re-reads the final page after its own re-renders,
 * shipinhao.js:2705-2722).
 */
function persistedStateScript(
    mode: 'wujie' | 'direct',
    titleSelector: string,
    title: string,
    editorSelector: string,
    html: string,
): string {
    return `${rootScriptPrefix(mode)}
    if (root === null) return JSON.stringify({ titleOk: false, editorOk: false, originalOk: false, coverUnknown: true });
    const title = root.querySelector(${JSON.stringify(titleSelector)});
    const titleOk = title !== null && norm(title.value) === norm(${JSON.stringify(title)});
    const editor = root.querySelector(${JSON.stringify(editorSelector)});
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const editorText = String((editor && (editor.innerText ?? editor.textContent)) ?? '');
    const editorOk = editor !== null && editorText.length > 0 && norm(editorText) === norm(probe.textContent);
    const wrapper = root.querySelector('div.declare-body-wrapper');
    const originalOk = wrapper === null || wrapper.getClientRects().length === 0;
    const slot = root.querySelector('div.cover-preview-wrap > div');
    const coverUnknown = slot === null;
    return JSON.stringify({ titleOk, editorOk, originalOk, coverUnknown });
})()`;
}

/**
 * Shipinhao browser transport on the shared rails (ADR-027): a headless session preflight, one
 * headed flow, and success only from a fresh persisted receipt plus persisted field state.
 * publishStatus absent or 'draft' (the frozen default) saves through the 保存草稿 candidate;
 * 'public' publishes through the scoped 发表 button and requires a NEW works receipt; any unknown
 * value refuses before the browser (ladder in `publish()`).
 */
export class ShipinhaoBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: ShipinhaoOperationName;
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    private readonly preflightTimeoutMs: number;
    constructor(
        operation: ShipinhaoOperationName = 'shortVideo',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number; preflightTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        // Every context this transport opens re-injects the captured console session first
        // (2026-11-26): the profile's cookie store does not survive a restart, so one scan is not one
        // publish. A profile without a snapshot is untouched, so a fresh login still works.
        this.launcher = stateRestoringLauncher(deps.launcher ?? kkBrowserLauncher);
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.preflightTimeoutMs = deps.preflightTimeoutMs ?? PREFLIGHT_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a shipinhao post (per the resolved operation) — a draft (default)
     * or public work.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed fresh persisted receipt.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // The operation was resolved (and unknown names refused) before this transport existed;
        // the remaining ladder is all pre-browser: driver → publishStatus → format → title → body
        // → video file → cover → tags → original → unsupported fields → session preflight.
        if (this.driver !== 'script') {
            return fail(
                SHP_TARGET,
                `unsupported driver '${bounded(this.driver)}' for ${SHP_TARGET}: expected one of script (the shipinhao-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested !== undefined && requested !== 'draft' && requested !== 'public') {
            return fail(
                SHP_TARGET,
                `unknown publishStatus '${bounded(requested)}' for ${SHP_TARGET}: expected 'draft', 'public' or absent (absent defaults to draft)`,
            );
        }
        // Only the shortVideo flow pins Content.format; the other flows accept the episode/article
        // Content as-is (the daily episode payload is format markdown).
        if (this.operation === 'shortVideo' && payload.content.format !== 'video') {
            return fail(
                SHP_TARGET,
                `shipinhao shortVideo requires Content.format 'video', got '${bounded(payload.content.format)}'`,
            );
        }
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                SHP_TARGET,
                `shipinhao ${this.operation} requires a non-empty Content.title (the 短标题 input, shipinhao.js:638-654)`,
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                SHP_TARGET,
                `shipinhao ${this.operation} requires non-empty Content.body Markdown (the 添加描述 description is pasted as sanitized text/html, shipinhao.js:669-674)`,
            );
        }
        // Per-operation media payload: shortVideo videoPath, audio/music audio(audioFile), image
        // images[]; the cover is requested-only and never read for image (图文 has no cover rails).
        const metadataRecord = (payload.content.metadata ?? {}) as Record<string, unknown>;
        let media: readonly string[];
        let coverPath: string | undefined;
        if (this.operation === 'shortVideo') {
            const video = await resolveVideoPath(metadataRecord.videoPath);
            if (video.error !== undefined) return fail(SHP_TARGET, video.error);
            media = [video.path as string];
            const cover = await resolveCoverPath(payload.content.metadata?.coverPath ?? payload.options?.coverPath);
            if (cover.error !== undefined) return fail(SHP_TARGET, cover.error);
            coverPath = cover.path;
        } else if (this.operation === 'audio' || this.operation === 'music') {
            const audio = await resolveAudioPath(metadataRecord.audio ?? metadataRecord.audioFile);
            if (audio.error !== undefined) return fail(SHP_TARGET, audio.error);
            media = [audio.path as string];
            // 封面 source ladder: an explicit coverPath, else the bundle's own cover image. WHY the
            // fallback (2026-11-16): the publish matrix builds the payload through ContentSchema,
            // which strips the variant's top-level `options` block, so a daily episode arrives with
            // `metadata.coverImage` only — and the 音频 form REFUSES to submit without a 封面
            // (「请上传封面」), which is how every earlier audio publish ended `unknown`.
            const cover = await resolveCoverPath(
                payload.content.metadata?.coverPath ?? payload.options?.coverPath ?? metadataRecord.coverImage,
            );
            if (cover.error !== undefined) return fail(SHP_TARGET, cover.error);
            // 2026-11-26: the 音频 form wants a square 封面 and its own crop dialog is what refused
            // every backfill with 「请上传封面」. Crop the widest centre square ourselves; a host
            // without `sips` (or an unreadable file) keeps the original and the dialog path.
            const square = centerSquareCover(cover.path as string);
            if ('error' in square) {
                echoError(`shipinhao-pub: square 封面 not derived (${square.error}) — keeping the original`);
            }
            coverPath = 'path' in square ? square.path : (cover.path as string);
        } else {
            const images = await resolveImagesPath(metadataRecord.images);
            if (images.error !== undefined) return fail(SHP_TARGET, images.error);
            media = images.paths as readonly string[];
        }
        const tags = resolveTags(payload.content.metadata?.tags ?? payload.options?.tags);
        if (tags.error !== undefined) return fail(SHP_TARGET, tags.error);
        const original = resolveOriginal(payload.content.metadata?.original);
        if (original.error !== undefined) return fail(SHP_TARGET, original.error);
        const collection = resolveCollection(payload.options?.collection ?? payload.content.metadata?.collection);
        if (collection.error !== undefined) return fail(SHP_TARGET, collection.error);
        const unsupported = unsupportedFields(payload, this.operation);
        if (unsupported.length > 0) {
            return fail(
                SHP_TARGET,
                `unsupported field(s) ${unsupported.join(', ')} for shipinhao ${this.operation}: implemented fields are title/description/tags/media/cover/original declaration only, and scheduling/publishTime is an unported vendor enhancement (shipinhao.js:7-9)`,
            );
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(SHP_TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(SHP_CONFIG, {
            profileDir,
            launcher: this.launcher,
            // The channel's own posture decides the pass order: `SHP_CONFIG.checkHeadedOnly` is the
            // operator's measured setting (the console refuses the headless probe even on a live
            // session), and only `runProfileCli` read it before — so `check` verified what `publish`
            // kept refusing (2026-11-23).
            headedOnly: SHP_CONFIG.checkHeadedOnly === true,
            // Headless first, then one read-only headed pass (same rail as xhs-pub): shipinhao's
            // dashboard regularly paints past a 30-90s headless poll on a healthy session, and the
            // shipped probe (`profile-check check`) has always used this fallback — the publish
            // preflight was the only caller that disabled it, so `check` verified what `publish`
            // refused (2026-11-13).
            timeoutMs: this.preflightTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated. Effect none: no console visit
            // happened, so the bounded retry may resend it.
            return stageFail(
                SHP_TARGET,
                `${SHP_TARGET} session preflight refused — run: ${SHP_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
                'session-preflight',
                { operation: this.operation, publishStatus: 'draft' },
                undefined,
                'none',
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: SHP_HOME_URL_BY_OPERATION[this.operation],
                    isAuthenticated: isShipinhaoAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => {
                    // 音频 has its own surface (`/platform/post/createAudio`); driving it through the
                    // video rails is what made every audio publish end `uncertain` (2026-11-15).
                    // shortVideo/image/music keep the flow below untouched.
                    if (this.operation === 'audio') {
                        return runAudioPostFlow({
                            page,
                            title,
                            body,
                            tags: tags.tags as readonly string[],
                            media,
                            coverPath,
                            collection: collection.collection,
                            publishPublic: requested === 'public',
                            operation: this.operation,
                            profileDir,
                            stepTimeoutMs: this.stepTimeoutMs,
                        });
                    }
                    return this.runPostFlow(
                        page,
                        POST_FLOW_SPECS[this.operation],
                        title,
                        body,
                        tags.tags as readonly string[],
                        original.original === true,
                        collection.collection,
                        media,
                        coverPath,
                        requested === 'public',
                        profileDir,
                    );
                },
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                SHP_TARGET,
                needsLogin(error)
                    ? `${SHP_TARGET} session failed — run: ${SHP_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The live post flow on the already-navigated dashboard (recon-Grounded 2026-11-11: ALL
     * operations enter through the dashboard — direct per-kind URLs redirect there): dashboard
     * create-entry click-through (发表视频 → /platform/post/create) → the bounded wujie root
     * policy (never a wrong root) → media attach with editing-form verification → title fill with
     * readback → sanitized description/topics paste with readback → requested-only 声明原创 →
     * optional committed cover → the draft save or the explicit-public 发表 → fresh-receipt
     * confirmation.
     */
    private async runPostFlow(
        page: Page,
        spec: PostFlowSpec,
        title: string,
        body: string,
        tags: readonly string[],
        declareOriginal: boolean,
        collection: string | undefined,
        media: readonly string[],
        coverPath: string | undefined,
        publishPublic: boolean,
        profileDir: string,
    ): Promise<Result> {
        const publishStatus = publishPublic ? ('public' as const) : ('draft' as const);
        const metadata = {
            operation: this.operation,
            driver: this.driver,
            publishStatus,
            profileDir,
            ...(declareOriginal ? { original: true } : {}),
            ...(collection !== undefined ? { collection } : {}),
        };

        // Dashboard click-through: the entry button opens the unified /platform/post/create
        // surface (recon-Grounded 2026-11-11); the create page is confirmed by a media file input
        // appearing in the active root. Already-open create pages (defensive re-entry) skip the
        // click.
        const entrySnapshot = await readRootSnapshot(page);
        if (entrySnapshot.shadowFileInputs + entrySnapshot.directFileInputs === 0) {
            const entryRoot = await resolveCreatorRoot(page);
            if (entryRoot.error !== undefined) return stageFail(SHP_TARGET, entryRoot.error, 'root-resolve', metadata);
            try {
                const entry = (
                    await resolveRootLocator(
                        page,
                        entryRoot.mode as 'wujie' | 'direct',
                        spec.selectors.createEntry,
                        'shipinhao create entry',
                        this.stepTimeoutMs,
                    )
                ).locator;
                await entry.click();
            } catch (error) {
                return stageFail(
                    SHP_TARGET,
                    `shipinhao create entry click failed — ${errorMessage(error)}`,
                    'entry-open',
                    metadata,
                );
            }
            const opened = await expectOutcome(
                async () => {
                    const snapshot = await readRootSnapshot(page);
                    return snapshot.shadowFileInputs + snapshot.directFileInputs > 0 ? 'create surface open' : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'shipinhao create surface' },
            );
            if (!opened.ok)
                return stageFail(
                    SHP_TARGET,
                    `shipinhao create surface never opened after the entry click — no media file input appeared in the active root — ${opened.error}`,
                    'entry-open',
                    metadata,
                );
        }

        // Root-resolve BEFORE any upload: the bounded wujie policy — wujie shadowRoot only, or the
        // unique direct creator form; ambiguity/absence refuses here (see `resolveCreatorRoot`).
        const root = await resolveCreatorRoot(page);
        if (root.error !== undefined) return stageFail(SHP_TARGET, root.error, 'root-resolve', metadata);
        const mode = root.mode as 'wujie' | 'direct';

        // Video attach: setInputFiles of the local file on the active root's file input — the
        // vendor's in-page DataTransfer/blob fetch is never used (shipinhao.js:609-631). The bare
        // untyped candidate is accepted only when exactly one input matches (vendor
        // shipinhao.js:580-583), enforced before the assignment.
        try {
            const resolved = await resolveRootLocator(
                page,
                mode,
                spec.fileSelectors,
                `shipinhao ${spec.mediaLabel} file input`,
                this.stepTimeoutMs,
            );
            if (resolved.selector === 'input[type="file"]' && (await resolved.locator.count()) !== 1) {
                return stageFail(
                    SHP_TARGET,
                    `shipinhao ${spec.mediaLabel} file input ambiguous: the untyped input[type=file] candidate matched more than one input in the ${mode === 'wujie' ? 'wujie shadowRoot' : 'document'} root — the vendor resolves a unique untyped input or nothing (shipinhao.js:580-583)`,
                    'root-resolve',
                    metadata,
                );
            }
            await resolved.locator.setInputFiles(media.length === 1 ? (media[0] as string) : media, {
                timeout: this.stepTimeoutMs,
            });
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao ${spec.mediaLabel} file input/attach failed on ${page.url()}: ${errorMessage(error)}`,
                'upload-timeout',
                metadata,
            );
        }

        // Media processing: the post-upload editing form (title input + description editor) must
        // appear at the 600s media ceiling — the vendor marks media applied only when the editing
        // form appears (shipinhao.js:2676-2683) and never treats the file assignment as success
        // (shipinhao.js:623-625). FORM_WAIT_MS 90000 / PROCESSING_WAIT_MS 120000
        // (shipinhao.js:39,43) are subsumed by this single verified ceiling.
        let titleSelector: string;
        let editorSelector: string;
        try {
            titleSelector = (
                await resolveRootLocator(
                    page,
                    mode,
                    spec.selectors.titleInput,
                    'shipinhao title input',
                    this.stepTimeoutMs,
                )
            ).selector;
            editorSelector = (
                await resolveRootLocator(
                    page,
                    mode,
                    spec.selectors.descriptionEditor,
                    'shipinhao description editor',
                    this.stepTimeoutMs,
                )
            ).selector;
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao media processing not confirmed: the file was assigned but the post-upload editing form never appeared — ${errorMessage(error)}; refusing to claim an uploaded ${spec.mediaLabel}`,
                'upload-processing',
                metadata,
            );
        }
        const formReady = await expectOutcome(
            async () => {
                const raw = String(await page.evaluate(editingFormReadyScript(mode, titleSelector, editorSelector)));
                return JSON.parse(raw).ready === true ? 'editing form observed in the active root' : null;
            },
            { timeoutMs: SHP_UPLOAD_TIMEOUT_MS, label: 'shipinhao media processing' },
        );
        if (!formReady.ok) {
            return stageFail(
                SHP_TARGET,
                `shipinhao media processing not confirmed within the ${SHP_UPLOAD_TIMEOUT_MS}ms ceiling — the file was assigned but no editing form appeared; refusing to claim an uploaded ${spec.mediaLabel}`,
                'upload-processing',
                metadata,
            );
        }

        // Title: native fill (Playwright fill dispatches input/change) on the root-scoped input,
        // then a normalized value readback (the vendor reads the written title back,
        // shipinhao.js:1332-1341).
        try {
            const titleInput = (
                await resolveRootLocator(
                    page,
                    mode,
                    spec.selectors.titleInput,
                    'shipinhao title input',
                    this.stepTimeoutMs,
                )
            ).locator;
            await titleInput.fill(title);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(titleValueScript(mode, titleSelector)))) ===
                    normalizeText(title)
                        ? 'title read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'shipinhao title readback' },
            );
            if (!readback.ok)
                return stageFail(
                    SHP_TARGET,
                    `shipinhao title readback failed — the editor did not retain the requested title — ${readback.error}`,
                    'title-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao title fill failed — ${errorMessage(error)}`,
                'title-readback',
                metadata,
            );
        }

        // Description + topics: the editor retains plain text only (headings lose `#`, links
        // keep just their text) and hard-truncates any paste to 100 chars (Grounded live probe
        // 2026-11-11), so the pasted content IS the clipped plain description (topics appended as
        // `#tag`, the vendor strips `#`/trims the same way before writing, shipinhao.js:2689-2692),
        // and the readback asserts that same string. Topic-token conversion (the vendor's
        // per-topic paste + Enter, shipinhao.js:1414) is not asserted — the readback is
        // text-level, and the receipt stage re-verifies persistence.
        const { description, html } = buildShipinhaoDescription(body, tags);
        try {
            const editorSelector = (
                await resolveRootLocator(
                    page,
                    mode,
                    spec.selectors.descriptionEditor,
                    'shipinhao description editor',
                    this.stepTimeoutMs,
                )
            ).selector;
            await pasteRichText(page, mode, editorSelector, html);
            const readback = await expectOutcome(
                async () => {
                    const editorText = String(await page.evaluate(editorTextScript(mode, editorSelector)));
                    return editorText.length > 0 &&
                        normalizeText(editorText).includes(normalizeText(description)) &&
                        tags.every((tag) => editorText.includes(`#${tag.replace(/^#/, '')}`))
                        ? 'description and topics read back'
                        : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'shipinhao description paste readback' },
            );
            if (!readback.ok)
                return stageFail(
                    SHP_TARGET,
                    `shipinhao description readback failed — the editor did not retain the pasted description/topics — ${readback.error}`,
                    'description-paste-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao description paste failed — ${errorMessage(error)}`,
                'description-paste-readback',
                metadata,
            );
        }

        // 合集: AUDIO only, and only when requested (2026-11-16). Ordered after the description —
        // the row renders with the rest of the post-upload rails on that form — and before the
        // declaration/cover/submit so a collection that cannot be committed refuses while nothing
        // has been published yet.
        if (collection !== undefined) {
            const collected = await this.selectCollectionFlow(page, mode, spec, collection, metadata);
            if (collected !== undefined) return collected;
        }

        // 声明原创: ONLY on the explicit operator assertion (metadata.original === true); the
        // vendor's unconditional run and log-only degradation (shipinhao.js:10-14, 2270-2310) are
        // deliberately not mirrored. Ordering matches the vendor: after description, before cover
        // (shipinhao.js:2702-2703).
        if (declareOriginal) {
            const declaration = await this.declareOriginalFlow(page, mode, metadata);
            if (declaration !== undefined) return declaration;
        }

        // Cover: only when requested, through the vendor-grounded dialog rails (see
        // `attachCoverFlow`). A missing control is a typed failure, never a silent skip.
        if (coverPath !== undefined) {
            const coverOutcome = await this.attachCoverFlow(page, mode, coverPath, metadata);
            if (coverOutcome !== undefined) return coverOutcome;
        }

        // Submission: draft (default) through the exact-visible 保存草稿 candidate (provisional —
        // the vendor never saves a draft), or explicit public through the scoped exact-发表 button
        // (shipinhao.js:2312-2316). Missing current control = typed failure, never a manufactured
        // draft and never a publish fallback for a requested draft.
        const stage = publishPublic ? 'publish-click' : 'draft-save';
        const submitSelectors = publishPublic ? spec.selectors.publishButton : spec.selectors.saveButton;
        let submitLocator: Locator;
        try {
            const resolved = await resolveRootLocator(
                page,
                mode,
                submitSelectors,
                'shipinhao submit control',
                this.stepTimeoutMs,
            );
            submitLocator = resolved.locator;
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                publishPublic
                    ? `shipinhao publish control never attached: ${errorMessage(error)} (the vendor resolves 发表 by exact text, shipinhao.js:2312-2316)`
                    : `shipinhao draft-save control never attached: ${errorMessage(error)} — the vendor never saves a draft, so a missing current control is a typed failure, not a manufactured draft and never a publish click`,
                stage,
                metadata,
            );
        }
        if (!(await submitLocator.isVisible().catch(() => false))) {
            return stageFail(
                SHP_TARGET,
                'shipinhao submit control attached but not visible; refusing to submit through a hidden control',
                stage,
                metadata,
            );
        }
        const enabled = await expectOutcome(async () => ((await submitLocator.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'shipinhao submit control enabled',
        });
        if (!enabled.ok) {
            return stageFail(
                SHP_TARGET,
                `shipinhao submit control never became clickable — ${enabled.error}`,
                stage,
                metadata,
            );
        }

        // Receipt: baseline before the click (fresh-signal rule), then only a FRESH id-bearing URL
        // plus persisted title/description(/original/cover) state confirms. The vendor never reads
        // a receipt — a clicked 发表 without a works record is unknown (shipinhao.js:6-9, 2326) —
        // so stale, ambiguous or receipt-less states are typed failures, never invented success.
        const receiptStage = publishPublic ? 'publish-receipt' : 'draft-receipt';
        const beforeReceipts = new Set(await readReceiptUrls(page));
        await submitLocator.click();
        const confirmed = await expectOutcome(
            async () => {
                if (!publishPublic) {
                    // 定时发表 guard (Grounded 2026-11-11): a draft save opens the confirm dialog;
                    // absent dialog = no-op. Fail-closed stays with the receipt ceiling below.
                    const confirmRaw = String(await page.evaluate(draftConfirmClickScript(mode)));
                    const confirm = JSON.parse(confirmRaw) as { ok: boolean; reason?: string };
                    if (confirm.ok) return null; // 保存 clicked — receipts land on a later poll
                }
                const fresh = (await readReceiptUrls(page)).filter((candidate) => !beforeReceipts.has(candidate));
                if (fresh.length === 0) return null;
                const ids = new Set(fresh.map(receiptIdFrom).filter((id): id is string => id !== undefined));
                if (ids.size === 0) return `ambiguous-receipt: ${fresh[0] ?? ''}`; // no id-bearing works URL
                if (ids.size > 1) return `ambiguous-receipt: ${ids.size} disagreeing fresh works ids`;
                const url = fresh.find((candidate) => receiptIdFrom(candidate) !== undefined);
                if (url === undefined) return `ambiguous-receipt: ${fresh[0] ?? ''}`;
                const raw = String(
                    await page.evaluate(persistedStateScript(mode, titleSelector, title, editorSelector, html)),
                );
                const state = JSON.parse(raw) as {
                    titleOk: boolean;
                    editorOk: boolean;
                    originalOk: boolean;
                    coverUnknown: boolean;
                };
                if (!state.titleOk || !state.editorOk) return `stale-state: ${url ?? ''}`; // fields no longer matching is not success
                if (declareOriginal && !state.originalOk)
                    return `stale-state: original dialog reopened or state lost (${url ?? ''})`;
                if (coverPath !== undefined && state.coverUnknown)
                    return `stale-state: cover slot evidence unreadable (${url ?? ''})`;
                return url;
            },
            { timeoutMs: this.stepTimeoutMs, label: `shipinhao ${receiptStage} confirmation` },
        );
        if (!confirmed.ok) {
            return stageFail(
                SHP_TARGET,
                publishPublic
                    ? 'shipinhao publish-receipt not confirmed — no fresh id-bearing works/record receipt with persisted state appeared; a clicked 发表 without a works record is unknown (shipinhao.js:2326) and is never reported as published'
                    : 'shipinhao draft-receipt not confirmed — no fresh id-bearing receipt with persisted title/description state appeared; fill alone is never a saved draft',
                receiptStage,
                metadata,
                `still on ${page.url()}; ${beforeReceipts.size} pre-existing receipt-shaped url(s)`,
                'unknown',
            );
        }
        if (confirmed.evidence.startsWith('stale-state: ') || confirmed.evidence.startsWith('ambiguous-receipt: ')) {
            return stageFail(
                SHP_TARGET,
                confirmed.evidence.startsWith('stale-state: ')
                    ? 'shipinhao receipt appeared but the persisted title/description(/original/cover) state no longer matches the requested content; refusing to claim success'
                    : 'shipinhao receipt is ambiguous (no single id-bearing works URL among the fresh receipts); refusing to claim success',
                receiptStage,
                metadata,
                confirmed.evidence,
                'unknown',
            );
        }
        const url = confirmed.evidence;
        return ResultSchema.parse({
            ok: true,
            target: SHP_TARGET,
            id: receiptIdFrom(url),
            url,
            message: `shipinhao ${this.operation} ${publishStatus} confirmed in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: receiptStage },
        });
    }

    /**
     * 合集 selection for the AUDIO post (2026-11-16): open the row, click the option by exact text,
     * then require the row to read back the requested collection. Every step type-fails — a missing
     * row, an absent option or a click that did not commit — because the operator's requirement is
     * that the episode lives in that collection: publishing without it is the wrong result, not a
     * degraded one.
     */
    private async selectCollectionFlow(
        page: Page,
        mode: 'wujie' | 'direct',
        spec: PostFlowSpec,
        collection: string,
        metadata: Record<string, unknown>,
    ): Promise<Result | undefined> {
        const failCollection = (message: string, stage: string, evidence?: string): Result =>
            stageFail(SHP_TARGET, message, stage, metadata, evidence);
        const label = spec.selectors.collectionLabel;
        const read = (raw: string): { ok: boolean; reason?: string; text?: string; seen?: string[] } => {
            try {
                return JSON.parse(raw) as { ok: boolean; reason?: string; text?: string; seen?: string[] };
            } catch {
                return { ok: false, reason: 'unreadable-probe' };
            }
        };
        const entry = read(String(await page.evaluate(collectionScript(mode, 'click-entry', label, collection))));
        if (!entry.ok) {
            return failCollection(
                `shipinhao 合集 (collection) row not found on the ${this.operation} form — refusing to publish outside the requested 合集 '${collection}'`,
                'collection-select',
                entry.reason,
            );
        }
        const option = await expectOutcome(
            async () => {
                const picked = read(
                    String(await page.evaluate(collectionScript(mode, 'click-option', label, collection))),
                );
                if (picked.ok) return 'option clicked';
                // A native `<select>` renders no clickable option node: Playwright's own selectOption
                // is the write path for it (no page-script value assignment — the flow never writes
                // `.value`). It pierces open shadow roots, and a select without that label throws, so
                // a missing collection stays a typed refusal.
                const selects = page.locator('select');
                const count = await selects.count();
                for (let i = 0; i < count; i++) {
                    try {
                        await selects.nth(i).selectOption({ label: collection }, { timeout: COLLECTION_PROBE_MS });
                        return 'option selected';
                    } catch {
                        // Not this select — keep looking; the refusal below still fires.
                    }
                }
                return null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao 合集 option' },
        );
        if (!option.ok) {
            const seen = read(String(await page.evaluate(collectionScript(mode, 'click-option', label, collection))));
            return failCollection(
                `shipinhao 合集 '${collection}' is not among the collections the account offers — refusing to publish outside it`,
                'collection-select',
                `${option.error}; seen: ${(seen.seen ?? []).join(' | ')}`,
            );
        }
        const commit = await expectOutcome(
            async () => {
                const state = read(String(await page.evaluate(collectionScript(mode, 'read', label, collection))));
                return state.ok ? 'collection read back' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao 合集 readback' },
        );
        if (!commit.ok) {
            const state = read(String(await page.evaluate(collectionScript(mode, 'read', label, collection))));
            return failCollection(
                `shipinhao 合集 '${collection}' was clicked but the form does not show it committed — refusing to submit`,
                'collection-readback',
                `row text: ${state.text ?? '<absent>'} — ${commit.error}`,
            );
        }
        return undefined;
    }

    /**
     * The requested-only 声明原创 sequence; returns a typed-failure `Result`, or `undefined` when
     * the declaration committed with verified state: entry checkbox clicked and read back checked
     * (shipinhao.js:2276-2283), agreement checkbox inside the 弹层 (shipinhao.js:2285-2294), exact
     * 声明原创 confirm (shipinhao.js:2296-2301), dialog closed afterward (shipinhao.js:2302-2305).
     * Every missing/ambiguous/unchecked outcome type-fails instead of the vendor's
     * log-and-continue (shipinhao.js:2274, 2289, 2301, 2307-2309).
     */
    private async declareOriginalFlow(
        page: Page,
        mode: 'wujie' | 'direct',
        metadata: Record<string, unknown>,
    ): Promise<Result | undefined> {
        const failDeclaration = (message: string, evidence?: string): Result =>
            stageFail(SHP_TARGET, message, 'original-declare', metadata, evidence);
        const entry = JSON.parse(String(await page.evaluate(originalEntryScript(mode, 'ensure')))) as {
            ok: boolean;
            reason?: string;
            count?: number;
            checked?: boolean;
        };
        if (!entry.ok) {
            return failDeclaration(
                entry.reason === 'ambiguous'
                    ? `shipinhao 声明原创 entry checkbox is ambiguous (${entry.count} equally-scored 原创 candidates, shipinhao.js:2233-2261); refusing the requested declaration rather than guessing`
                    : 'shipinhao 声明原创 entry checkbox not found — the requested original declaration cannot be verified on this page; refusing (the vendor skips with a log only because it never treats the claim as operator-asserted, shipinhao.js:2274)',
            );
        }
        const entryChecked = await expectOutcome(
            async () => {
                const probe = JSON.parse(String(await page.evaluate(originalEntryScript(mode, 'probe')))) as {
                    ok: boolean;
                    checked?: boolean;
                };
                return probe.ok && probe.checked === true ? 'entry checkbox committed checked' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao 声明原创 entry checked state' },
        );
        if (!entryChecked.ok)
            return failDeclaration(
                'shipinhao 声明原创 entry checkbox did not commit to a checked state',
                entryChecked.error,
            );
        const agreement = JSON.parse(String(await page.evaluate(originalAgreementScript(mode, 'ensure')))) as {
            ok: boolean;
            reason?: string;
        };
        if (!agreement.ok) {
            return failDeclaration(
                'shipinhao 声明原创 agreement checkbox (div.declare-body-wrapper) never appeared — refusing the requested declaration (shipinhao.js:2285-2289)',
            );
        }
        const agreementChecked = await expectOutcome(
            async () => {
                const probe = JSON.parse(String(await page.evaluate(originalAgreementScript(mode, 'probe')))) as {
                    ok: boolean;
                    checked?: boolean;
                };
                return probe.ok && probe.checked === true ? 'agreement checkbox committed checked' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao 声明原创 agreement checked state' },
        );
        if (!agreementChecked.ok)
            return failDeclaration(
                'shipinhao 声明原创 agreement checkbox did not commit to a checked state',
                agreementChecked.error,
            );
        const confirm = JSON.parse(String(await page.evaluate(originalConfirmScript(mode)))) as {
            ok: boolean;
            reason?: string;
            count?: number;
        };
        if (!confirm.ok) {
            return failDeclaration(
                confirm.reason === 'ambiguous'
                    ? `shipinhao 声明原创 confirm ambiguous: ${confirm.count} exact 「声明原创」 buttons on the page (shipinhao.js:2296-2299); refusing rather than clicking the wrong one`
                    : 'shipinhao 声明原创 confirm button not found — refusing the requested declaration (shipinhao.js:2300-2301)',
            );
        }
        const closed = await expectOutcome(
            async () => {
                const state = JSON.parse(String(await page.evaluate(originalClosedScript(mode)))) as {
                    closed: boolean;
                };
                return state.closed ? 'declare-body-wrapper closed' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao 声明原创 dialog closure' },
        );
        if (!closed.ok)
            return failDeclaration(
                'shipinhao 声明原创 dialog did not close after the confirm click; the committed declaration is unverifiable',
                closed.error,
            );
        return undefined;
    }

    /**
     * The optional requested cover through the vendor-grounded dialog rails: slot evidence read
     * BEFORE (shipinhao.js:1461-1467) → edit entry click (shipinhao.js:2145-2147) → scoped cover
     * dialog with its own file input (shipinhao.js:2144-2149) → `setInputFiles` → labeled confirm
     * ladder with the vendor's two-stage re-click guard (shipinhao.js:1853-1871, 1883-1916) →
     * dialog closure with the slot descriptor CHANGED, verified at the COVER_SAVE_WAIT_MS 60000
     * ceiling (shipinhao.js:42, 1976). Canvas pixels are never read (canvas presence alone is
     * insufficient, shipinhao.js:2111). Any missing control or unconfirmed commit is a typed
     * failure — the vendor's unattributable/timeout `unknown` outcomes (shipinhao.js:2009, 2095,
     * 2111) become refusals because a requested cover is never silently skipped.
     */
    private async attachCoverFlow(
        page: Page,
        mode: 'wujie' | 'direct',
        coverPath: string,
        metadata: Record<string, unknown>,
    ): Promise<Result | undefined> {
        const failCover = (message: string, stage: string, evidence?: string): Result =>
            stageFail(SHP_TARGET, message, stage, metadata, evidence);
        const before = JSON.parse(String(await page.evaluate(coverSlotEvidenceScript(mode)))) as {
            found: boolean;
            descriptor?: string;
        };
        if (!before.found || before.descriptor === undefined) {
            return failCover(
                'shipinhao vertical cover slot (个人主页卡片 3:4, div.cover-preview-wrap) not found — refusing the requested cover (shipinhao.js:2128-2144)',
                'cover-open',
            );
        }
        const clicked = JSON.parse(String(await page.evaluate(coverEntryClickScript(mode)))) as {
            ok: boolean;
            reason?: string;
        };
        if (!clicked.ok)
            return failCover('shipinhao cover edit entry click failed — refusing the requested cover', 'cover-open');
        const dialog = await expectOutcome(
            async () => {
                const probe = JSON.parse(String(await page.evaluate(coverDialogProbeScript(mode)))) as {
                    found: boolean;
                    selector?: string;
                    hasFileInput?: boolean;
                };
                if (!probe.found || probe.selector === undefined) return null;
                if (probe.hasFileInput !== true) return `dialog-without-file-input: ${probe.selector}`;
                return probe.selector;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'shipinhao cover dialog' },
        );
        if (!dialog.ok) {
            return failCover(
                'shipinhao cover dialog never appeared after the edit-entry click — refusing the requested cover (shipinhao.js:2147-2149)',
                'cover-open',
                dialog.error,
            );
        }
        if (dialog.evidence.startsWith('dialog-without-file-input: ')) {
            return failCover(
                'shipinhao cover dialog resolved but exposes no input[type=file] — refusing to attach a cover through an unverifiable control',
                'cover-open',
                dialog.evidence,
            );
        }
        const dialogSelector = dialog.evidence;
        try {
            const fileInput = await resolveRootLocator(
                page,
                mode,
                [`${dialogSelector} input[type="file"]`],
                'shipinhao cover dialog file input',
                this.stepTimeoutMs,
            );
            await fileInput.locator.setInputFiles(coverPath, { timeout: this.stepTimeoutMs });
        } catch (error) {
            return failCover(
                `shipinhao cover file attach failed — refusing the requested cover: ${errorMessage(error)}`,
                'cover-attach',
            );
        }
        // Confirm ladder: first click, then — while the dialog persists — the NEXT labeled button
        // (vendor previous-button guard, shipinhao.js:1893-1901) up to three clicks, then closure
        // with changed slot evidence at the COVER_SAVE_WAIT_MS ceiling.
        const committed = await expectOutcome(
            async () => {
                const probe = JSON.parse(String(await page.evaluate(coverDialogProbeScript(mode)))) as {
                    found: boolean;
                };
                if (!probe.found) {
                    const after = JSON.parse(String(await page.evaluate(coverSlotEvidenceScript(mode)))) as {
                        found: boolean;
                        descriptor?: string;
                    };
                    if (!after.found || after.descriptor === undefined) return 'slot-evidence-unreadable-after-closure';
                    return after.descriptor !== before.descriptor
                        ? 'cover committed and verified after dialog closure'
                        : null;
                }
                const click = JSON.parse(
                    String(await page.evaluate(coverConfirmClickScript(mode, dialogSelector))),
                ) as { ok: boolean; reason?: string; label?: string };
                if (!click.ok) {
                    return click.reason === 'missing-confirm'
                        ? `missing-confirm: no labeled confirm inside the cover dialog (${dialogSelector})`
                        : null; // crop dialog re-render; keep polling within the ceiling
                }
                return null; // clicked; poll for closure or the next labeled button
            },
            { timeoutMs: SHP_COVER_SAVE_WAIT_MS, label: 'shipinhao cover commit' },
        );
        if (!committed.ok) {
            return failCover(
                'shipinhao cover commit not confirmed — the dialog never closed with changed slot evidence at the ceiling — refusing to claim an attached cover (canvas presence alone is insufficient, shipinhao.js:2111)',
                'cover-attach',
                committed.error,
            );
        }
        if (
            committed.evidence.startsWith('missing-confirm: ') ||
            committed.evidence.startsWith('slot-evidence-unreadable')
        ) {
            return failCover(
                'shipinhao cover commit unverifiable — no labeled confirm control or unreadable post-closure slot evidence — refusing the requested cover (shipinhao.js:2009, 2111)',
                'cover-attach',
                committed.evidence,
            );
        }
        return undefined;
    }
}
