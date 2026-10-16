/**
 * shipinhao-pub transport + flow (task 0296).
 *
 * The live short-video flow in `runShortVideoFlow`, stage-typed on every `Result.metadata.stage`:
 * root-resolve (the wujie policy) → video-upload → media-processing → title-fill →
 * description-paste-readback → original-declare (only when `metadata.original === true`) →
 * cover-attach (when requested) → draft-save | publish-click → draft-receipt | publish-receipt.
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
    waitUntil,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import type { Locator, Page } from 'playwright';
import {
    isShipinhaoAuthenticated,
    readRootSnapshot,
    SHP_CONFIG,
    SHP_COVER_SAVE_WAIT_MS,
    SHP_HOME_URL,
    SHP_RECEIPT_URL_RES,
    SHP_ROOT_WAIT_MS,
    SHP_TARGET,
    SHP_UPLOAD_TIMEOUT_MS,
    SHP_VIDEO_SELECTORS,
    type ShipinhaoRootSnapshot,
} from './selectors';

const STEP_TIMEOUT_MS = 30_000;
/**
 * KK v1 local-video size bound (task 0296 Design freeze): 2 GiB. A project-scoped product bound,
 * not a platform limit — Channels' own ceiling is unpinned.
 */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const SHP_LOGIN_INSTRUCTION = 'bun plugins/publishings/shipinhao-pub/src/profile-check.ts login';

/** `ok: false` refusal Result with a bounded, single-line error. */
export function fail(target: string, error: string): Result {
    return ResultSchema.parse({ ok: false, target, error: boundedDetail(error) });
}

/** A browser-stage failure: `ok: false` with `stage` (and optional evidence) in the Result metadata. */
export function stageFail(
    target: string,
    error: string,
    stage: string,
    metadata: Record<string, unknown>,
    evidence?: string,
): Result {
    return ResultSchema.parse({
        ok: false,
        target,
        error: boundedDetail(error),
        metadata: { ...metadata, stage, ...(evidence === undefined ? {} : { evidence: boundedDetail(evidence) }) },
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

/** Works/record id from an observed receipt URL (shapes: `/record/detail/<id>`, `/post/video/<id>`; provisional). */
function receiptIdFrom(url: string): string | undefined {
    return /\/(?:detail|video)\/([0-9a-zA-Z_-]+)/.exec(url)?.[1];
}

/**
 * Pre-browser required-video gate: `metadata.videoPath` must name an existing, regular, readable,
 * nonempty local MP4/MOV under the KK v1 2 GiB local cap (labeled local bound — not a platform
 * limit). Probed through the Bun file API (repo rule no-direct-fs-io) — never node:fs.
 */
async function resolveVideoPath(
    raw: unknown,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return { error: `metadata.videoPath must be a non-empty local video file path, got '${bounded(raw)}'` };
    }
    const path = raw.trim();
    if (!/\.(mp4|mov)$/i.test(path)) {
        return {
            error: `metadata.videoPath must be a local MP4/MOV file, got unsupported extension in '${bounded(path)}'`,
        };
    }
    // no-direct-fs-io: probe the file through the Bun API instead of node:fs.
    const file = Bun.file(path);
    const readable = await file.exists().catch(() => false);
    if (!readable || file.size === 0) {
        return { error: 'metadata.videoPath does not resolve to a readable nonempty local video file' };
    }
    if (file.size > MAX_VIDEO_BYTES) {
        return {
            error: `metadata.videoPath exceeds the KK v1 local video cap of 2 GiB (${file.size} bytes; a local product bound, not a platform limit)`,
        };
    }
    return { path };
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
 * Unsupported requested fields for this flow: images, categories, publishTime/scheduling are not
 * implemented (定时 is an unported vendor enhancement, shipinhao.js:7-9), so any of them — in
 * options or metadata — is a typed unsupported-field refusal, never a silent claim of applied.
 * `tags`/`original`/`coverPath` are implemented and validated in their resolvers.
 */
function unsupportedFields(payload: PublishTransportPayload): readonly string[] {
    const refused: string[] = [];
    for (const [container, keys] of [
        ['options', ['images', 'categories', 'publishTime', 'scheduling'] as const],
        ['metadata', ['images', 'categories', 'publishTime', 'scheduling'] as const],
    ] as const) {
        const source: unknown = container === 'options' ? payload.options : payload.content.metadata;
        for (const key of keys) {
            if (source !== undefined && source !== null && typeof source === 'object' && key in source) {
                refused.push(`${container}.${key}`);
            }
        }
    }
    return refused;
}

/** Post-upload media-processing probe: the editing form (title input + description editor) must appear in the active root — the assignment itself is never success (shipinhao.js:623-625, 2676-2683). */
function editingFormReadyScript(mode: 'wujie' | 'direct', titleSelector: string, editorSelector: string): string {
    return `${rootScriptPrefix(mode)}
    const title = root === null ? null : root.querySelector(${JSON.stringify(titleSelector)});
    const editor = root === null ? null : root.querySelector(${JSON.stringify(editorSelector)});
    return JSON.stringify({ ready: title !== null && editor !== null });
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
    private readonly operation: 'shortVideo';
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: 'shortVideo' = 'shortVideo',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a shipinhao short-video draft (default) or public work.
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
        if (payload.content.format !== 'video') {
            return fail(
                SHP_TARGET,
                `shipinhao shortVideo requires Content.format 'video', got '${bounded(payload.content.format)}'`,
            );
        }
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                SHP_TARGET,
                'shipinhao shortVideo requires a non-empty Content.title (the 短标题 input, shipinhao.js:638-654)',
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                SHP_TARGET,
                'shipinhao shortVideo requires non-empty Content.body Markdown (the 添加描述 description is pasted as sanitized text/html, shipinhao.js:669-674)',
            );
        }
        const video = await resolveVideoPath(payload.content.metadata?.videoPath);
        if (video.error !== undefined) return fail(SHP_TARGET, video.error);
        const cover = await resolveCoverPath(payload.content.metadata?.coverPath ?? payload.options?.coverPath);
        if (cover.error !== undefined) return fail(SHP_TARGET, cover.error);
        const tags = resolveTags(payload.content.metadata?.tags ?? payload.options?.tags);
        if (tags.error !== undefined) return fail(SHP_TARGET, tags.error);
        const original = resolveOriginal(payload.content.metadata?.original);
        if (original.error !== undefined) return fail(SHP_TARGET, original.error);
        const unsupported = unsupportedFields(payload);
        if (unsupported.length > 0) {
            return fail(
                SHP_TARGET,
                `unsupported field(s) ${unsupported.join(', ')} for shipinhao: this flow implements title/description/tags/video/cover/original declaration only, and scheduling/publishTime is an unported vendor enhancement (shipinhao.js:7-9)`,
            );
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(SHP_TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(SHP_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                SHP_TARGET,
                `${SHP_TARGET} session preflight refused — run: ${SHP_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: SHP_HOME_URL,
                    isAuthenticated: isShipinhaoAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runShortVideoFlow(
                        page,
                        title,
                        body,
                        tags.tags as readonly string[],
                        original.original === true,
                        video.path as string,
                        cover.path,
                        requested === 'public',
                        profileDir,
                    ),
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
     * The live short-video flow on the already-navigated publishing page (`SHP_HOME_URL`): the
     * bounded wujie root policy (never a wrong root) → video attach with editing-form verification
     * → title fill with readback → sanitized description/topics paste with readback →
     * requested-only 声明原创 → optional committed cover → the draft save or the explicit-public
     * 发表 → fresh-receipt confirmation.
     */
    private async runShortVideoFlow(
        page: Page,
        title: string,
        body: string,
        tags: readonly string[],
        declareOriginal: boolean,
        videoPath: string,
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
        };

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
                SHP_VIDEO_SELECTORS.videoInput,
                'shipinhao video file input',
                this.stepTimeoutMs,
            );
            if (resolved.selector === 'input[type="file"]' && (await resolved.locator.count()) !== 1) {
                return stageFail(
                    SHP_TARGET,
                    `shipinhao video file input ambiguous: the untyped input[type=file] candidate matched more than one input in the ${mode === 'wujie' ? 'wujie shadowRoot' : 'document'} root — the vendor resolves a unique untyped input or nothing (shipinhao.js:580-583)`,
                    'root-resolve',
                    metadata,
                );
            }
            await resolved.locator.setInputFiles(videoPath, { timeout: this.stepTimeoutMs });
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao video file input/attach failed on ${page.url()}: ${errorMessage(error)}`,
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
                    SHP_VIDEO_SELECTORS.titleInput,
                    'shipinhao title input',
                    this.stepTimeoutMs,
                )
            ).selector;
            editorSelector = (
                await resolveRootLocator(
                    page,
                    mode,
                    SHP_VIDEO_SELECTORS.descriptionEditor,
                    'shipinhao description editor',
                    this.stepTimeoutMs,
                )
            ).selector;
        } catch (error) {
            return stageFail(
                SHP_TARGET,
                `shipinhao media processing not confirmed: the file was assigned but the post-upload editing form never appeared — ${errorMessage(error)}; refusing to claim an uploaded video`,
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
                `shipinhao media processing not confirmed within the ${SHP_UPLOAD_TIMEOUT_MS}ms ceiling — the file was assigned but no editing form appeared; refusing to claim an uploaded video`,
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
                    SHP_VIDEO_SELECTORS.titleInput,
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

        // Description + topics: Markdown → sanitized HTML (topics appended as `#tag` lines, the
        // vendor strips `#`/trims the same way before writing, shipinhao.js:2689-2692) pasted as
        // text/html through the root-scoped locator, then a strict text readback. Topic-token
        // conversion (the vendor's per-topic paste + Enter, shipinhao.js:1414) is not asserted —
        // the readback is text-level, and the receipt stage re-verifies persistence.
        const html = sanitizeShipinhaoHtml(
            markdownToHtml(
                tags.length === 0 ? body : `${body}\n\n${tags.map((tag) => `#${tag.replace(/^#/, '')}`).join('  ')}`,
            ),
        );
        try {
            const editorSelector = (
                await resolveRootLocator(
                    page,
                    mode,
                    SHP_VIDEO_SELECTORS.descriptionEditor,
                    'shipinhao description editor',
                    this.stepTimeoutMs,
                )
            ).selector;
            await pasteRichText(page, mode, editorSelector, html);
            const readback = await expectOutcome(
                async () => {
                    const editorText = String(await page.evaluate(editorTextScript(mode, editorSelector)));
                    return editorText.length > 0 &&
                        normalizeText(editorText).includes(normalizeText(body)) &&
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
        const submitSelectors = publishPublic ? SHP_VIDEO_SELECTORS.publishButton : SHP_VIDEO_SELECTORS.saveButton;
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
            );
        }
        const url = confirmed.evidence;
        return ResultSchema.parse({
            ok: true,
            target: SHP_TARGET,
            id: receiptIdFrom(url),
            url,
            message: `shipinhao shortVideo ${publishStatus} confirmed in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: receiptStage },
        });
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
