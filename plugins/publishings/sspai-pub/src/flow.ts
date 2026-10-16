/**
 * sspai-pub transport + flow (task 0294).
 *
 * The live editor flow in `runArticleFlow`, stage-typed on every `Result.metadata.stage`:
 * editor-readiness → title-readback → cover-attach (when requested) → body-paste-readback →
 * draft-save → draft-receipt. This slice saves drafts ONLY: publishStatus absent or 'draft' (the
 * frozen default) activates the exact-visible 保存草稿|保存 candidate; 'public' refuses before the
 * browser (final publication/submission on sspai is not evidenced — sspai.js itself stops at the
 * preview click, sspai.js:15-16).
 *
 * Mechanism (sspai.js:5, 8-13, 18): Markdown is rendered to HTML and pasted into the
 * contenteditable editor as `text/html` (the source's `simulatePaste`, sspai.js:62-65 — it does
 * no Markdown preprocessing, sspai.js:18); the pasted HTML is sanitized here first (script/style/
 * iframe/embed/object, `on*` attributes and `javascript:` URLs stripped; code/list/heading markup
 * preserved) with no new dependency. Success is confirmed only by a FRESH persisted receipt (a
 * draft-id URL that was not on screen before the click) plus re-read persisted title/body (and
 * cover-assignment) state — never a stale assignment, a toast, or the preview control
 * (sspai.js:68, probed read-only, never clicked). The draft-save control and receipt shapes are
 * provisional (the archived official guide documents draft saving historically only); a missing
 * current save control is a typed failure, never a manufactured draft.
 */

import { basename } from 'node:path';
import { type Result, ResultSchema } from '@gobing-ai/kk-core';
import {
    type BrowserDriver,
    type PublishTransport,
    type PublishTransportPayload,
    trySelectors,
} from '@gobing-ai/publish-harness';
import {
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    pasteHtml,
    resolveChannelProfileDir,
    resolveSelector,
    uploadFile,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import type { Page } from 'playwright';
import {
    isSspaiAuthenticated,
    SSPAI_ARTICLE_SELECTORS,
    SSPAI_CONFIG,
    SSPAI_EDIT_URL,
    SSPAI_RECEIPT_URL_RES,
    SSPAI_TARGET,
} from './selectors';

const STEP_TIMEOUT_MS = 30_000;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const SSPAI_LOGIN_INSTRUCTION = 'bun plugins/publishings/sspai-pub/src/profile-check.ts login';

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

/** One short line, bounded: no DOM dump, cookie, token, stack or leaked image path ever reaches the Result. */
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

/** Input/textarea `value` property readback (title textarea). */
function inputValueScript(selector: string): string {
    return `(() => { // kk-sspai-input-value
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.value ?? '');
})()`;
}

/**
 * Plugin-local HTML sanitizer (task 0294 Design freeze — no new dependency): strips
 * script/style/iframe/embed/object containers, `on*` event attributes and `javascript:` URLs
 * while preserving code/list/heading markup, before any paste reaches the editor.
 */
export function sanitizeArticleHtml(html: string): string {
    return html
        .replace(/<\s*(script|style|iframe|embed|object)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|style|iframe|embed|object)\b[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(\s(?:href|src)\s*=\s*)(["'])\s*(?:javascript|data):[^"']*\2/gi, '$1$2$2')
        .replace(/(\s(?:href|src)\s*=\s*)(?:javascript|data):[^\s>]*/gi, '$1""');
}

/**
 * Body paste readback: the editor still holds non-empty markup whose text equals the sanitized
 * HTML's text (whitespace-insensitive) — a dropped or transformed paste refuses before any save.
 */
function editorReadbackScript(selector: string, html: string): string {
    return `(() => { // kk-sspai-editor-readback
    const editor = document.querySelector(${JSON.stringify(selector)});
    if (editor === null) return JSON.stringify({ ok: false });
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const squish = (v) => String(v ?? '').replace(/\\s+/g, '');
    return JSON.stringify({ ok: editor.innerHTML.length > 0 && squish(editor.innerText) === squish(probe.textContent) });
})()`;
}

/**
 * Persisted-state readback for save confirmation: the title textarea and editor still hold the
 * requested content and, when a cover was requested, the editor-scoped file input still carries
 * exactly that file assignment (frozen success rule — a fresh id alone never confirms).
 */
function persistedStateScript(
    titleSelector: string,
    title: string,
    editorSelector: string,
    html: string,
    cover: { selector: string; fileName: string } | undefined,
): string {
    return `(() => { // kk-sspai-persisted
    const title = document.querySelector(${JSON.stringify(titleSelector)});
    const editor = document.querySelector(${JSON.stringify(editorSelector)});
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const squish = (v) => String(v ?? '').replace(/\\s+/g, '');
    const titleOk = title !== null && squish(title.value) === squish(${JSON.stringify(title)});
    const editorOk = editor !== null && editor.innerHTML.length > 0 && squish(editor.innerText) === squish(probe.textContent);
    const coverOk = ${
        cover === undefined
            ? 'true'
            : `(() => {
        const input = document.querySelector(${JSON.stringify(cover.selector)});
        return input !== null && input.files !== null && input.files.length === 1 && input.files[0].name === ${JSON.stringify(cover.fileName)};
    })()`
    };
    return JSON.stringify({ titleOk, editorOk, coverOk });
})()`;
}

/** Receipt-shaped URLs on screen (location + anchors) — the save-time baseline and fresh read. */
async function readReceiptUrls(page: Page): Promise<readonly string[]> {
    const raw = await page.evaluate(`(() => { // kk-sspai-receipt-urls
    const patterns = [${SSPAI_RECEIPT_URL_RES.map((re) => re.toString()).join(', ')}];
    const matches = (url) => patterns.some((re) => re.test(url));
    const urls = [];
    if (matches(location.href)) urls.push(location.href);
    for (const a of document.querySelectorAll('a[href]')) {
        if (matches(a.href) && !urls.includes(a.href)) urls.push(a.href);
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

/** Draft id from an observed receipt URL (shapes: `SSPAI_RECEIPT_URL_RES`, provisional). */
function articleIdFrom(url: string): string | undefined {
    return /(?:\/post\/|\/me\/drafts\/)(\d+)/.exec(url)?.[1];
}

/**
 * Pre-browser requested-cover gate: an optional local PNG/JPEG/WebP that must exist as a regular,
 * readable, nonempty file. Requested-but-absent or wrong-typed refuses here — never the source's
 * silent skip (sspai.js:17 makes the source's missing-input behavior explicit and this flow
 * refuses instead).
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
            error: `metadata.coverPath does not resolve to a readable nonempty local file (refusing, never a silent skip — sspai.js:17)`,
        };
    }
    return { path };
}

/**
 * Sspai browser transport on the shared rails (ADR-027): a headless session preflight, one headed
 * flow, and success only from a fresh persisted receipt plus persisted field state. Draft-only:
 * publishStatus absent or 'draft' saves a draft; 'public' and any unknown value refuse before the
 * browser (ladder in `src/index.ts` → `publish()`).
 */
export class SspaiBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: 'article';
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: 'article' = 'article',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as an sspai Matrix article draft.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed persisted draft receipt.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // The operation was resolved (and unknown names refused) before this transport existed;
        // the remaining ladder is all pre-browser: driver → publishStatus (draft-only) → title →
        // body → cover → unsupported fields → session preflight.
        if (this.driver !== 'script') {
            return fail(
                SSPAI_TARGET,
                `unsupported driver '${bounded(this.driver)}' for ${SSPAI_TARGET}: expected one of script (the sspai-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested === 'public') {
            return fail(
                SSPAI_TARGET,
                `sspai-pub saves drafts only: metadata.publishStatus 'public' is refused before any browser opens — final publication/submission on sspai is not evidenced (the source itself stops at preview, sspai.js:15-16); omit publishStatus or pass 'draft'`,
            );
        }
        if (requested !== undefined && requested !== 'draft') {
            return fail(
                SSPAI_TARGET,
                `unknown publishStatus '${bounded(requested)}' for ${SSPAI_TARGET}: expected 'draft' or absent (absent defaults to draft); 'public' is refused — this slice saves drafts only`,
            );
        }
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                SSPAI_TARGET,
                `sspai article requires a non-empty Content.title (the editor has an independent title textarea, sspai.js:26)`,
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                SSPAI_TARGET,
                'sspai article requires non-empty Content.body Markdown (the body is pasted as sanitized text/html, sspai.js:62)',
            );
        }
        const unsupported = unsupportedFields(payload);
        if (unsupported.length > 0) {
            return fail(
                SSPAI_TARGET,
                `unsupported field(s) ${unsupported.join(', ')} for sspai: this draft-only flow implements title/body/cover only, and sspai.js implements none of images/tags/categories`,
            );
        }
        const cover = await resolveCoverPath(payload.content.metadata?.coverPath ?? payload.options?.coverPath);
        if (cover.error !== undefined) return fail(SSPAI_TARGET, cover.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(SSPAI_TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(SSPAI_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                SSPAI_TARGET,
                `${SSPAI_TARGET} session preflight refused — run: ${SSPAI_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: SSPAI_EDIT_URL,
                    isAuthenticated: isSspaiAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runArticleFlow(page, title, body, cover.path, profileDir),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                SSPAI_TARGET,
                needsLogin(error)
                    ? `${SSPAI_TARGET} session failed — run: ${SSPAI_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The live article flow on the already-navigated editor page (`SSPAI_EDIT_URL`): read-only
     * capability probe → title fill with strict value readback (native value + input events,
     * sspai.js:53-55) → optional cover assignment with readback (sspai.js:32-41, but verified —
     * never the source's silent skip) → sanitized text/html paste with strict readback
     * (sspai.js:62-65) → the provisional exact-visible draft save → fresh-receipt confirmation.
     * The preview control (sspai.js:68) is probed read-only and never clicked.
     */
    private async runArticleFlow(
        page: Page,
        title: string,
        body: string,
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = {
            operation: this.operation,
            driver: this.driver,
            publishStatus: 'draft' as const,
            profileDir,
        };

        // Read-only capability probe: the grounded pair must attach (else the page is wrong or
        // logged out — sspai.js:60 reads the missing editor as 未登录).
        const grounded: Record<string, boolean> = {};
        const resolved: Partial<Record<keyof typeof SSPAI_ARTICLE_SELECTORS, string>> = {};
        for (const key of ['titleInput', 'bodyEditor'] as const) {
            try {
                resolved[key] = await resolveSelector(page, SSPAI_ARTICLE_SELECTORS[key], {
                    timeoutMs: this.stepTimeoutMs,
                    label: `sspai ${key}`,
                });
            } catch (error) {
                return stageFail(
                    SSPAI_TARGET,
                    `sspai grounded editor control ${key} never attached on ${SSPAI_EDIT_URL}: ${errorMessage(error)} — run: ${SSPAI_LOGIN_INSTRUCTION}`,
                    'editor-readiness',
                    metadata,
                );
            }
            grounded[key] = (
                await trySelectors(page, [resolved[key] as string], { visible: true, timeout: this.stepTimeoutMs })
            ).found;
        }
        if (!grounded.titleInput || !grounded.bodyEditor) {
            return stageFail(
                SSPAI_TARGET,
                `sspai grounded editor controls found but not visible on ${SSPAI_EDIT_URL} — run: ${SSPAI_LOGIN_INSTRUCTION}`,
                'editor-readiness',
                metadata,
                `grounded visible: ${JSON.stringify(grounded)}`,
            );
        }
        const titleSelector = resolved.titleInput as string;
        const editorSelector = resolved.bodyEditor as string;
        const html = sanitizeArticleHtml(markdownToHtml(body));

        // Title: native value fill with real input events, then strict readback (sspai.js:53-55).
        try {
            await page.locator(titleSelector).first().fill(title);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(inputValueScript(titleSelector)))) === normalizeText(title)
                        ? 'title read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'sspai title readback' },
            );
            if (!readback.ok)
                return stageFail(
                    SSPAI_TARGET,
                    `sspai title readback failed — the editor did not retain the requested title — ${readback.error}`,
                    'title-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                SSPAI_TARGET,
                `sspai title fill failed — ${errorMessage(error)}`,
                'title-readback',
                metadata,
            );
        }

        // Cover: only when requested. setInputFiles on the editor-scoped input (sspai.js:32-41)
        // plus a verified assignment readback — requested cover absent/unverified is a typed
        // failure, never the source-style silent skip (sspai.js:17, 43-45).
        let coverReadback: { selector: string; fileName: string } | undefined;
        if (coverPath !== undefined) {
            try {
                const coverSelector = await resolveSelector(page, SSPAI_ARTICLE_SELECTORS.coverInput, {
                    timeoutMs: this.stepTimeoutMs,
                    label: 'sspai cover file input',
                });
                await uploadFile(page, coverSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
                coverReadback = { selector: coverSelector, fileName: basename(coverPath) };
                const readback = await expectOutcome(
                    async () => {
                        const raw = String(
                            await page.evaluate(
                                `(() => { // kk-sspai-cover-assigned
    const input = document.querySelector(${JSON.stringify(coverSelector)});
    if (input === null || input.files === null) return JSON.stringify({ assigned: false });
    return JSON.stringify({ assigned: input.files.length === 1 && input.files[0].name === ${JSON.stringify(basename(coverPath))} });
})()`,
                            ),
                        );
                        return JSON.parse(raw).assigned === true ? 'cover assignment read back' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'sspai cover assignment readback' },
                );
                if (!readback.ok)
                    return stageFail(
                        SSPAI_TARGET,
                        `sspai cover assignment could not be verified on the editor-scoped file input — refusing rather than claiming an unverified cover`,
                        'cover-attach',
                        metadata,
                    );
            } catch (error) {
                return stageFail(
                    SSPAI_TARGET,
                    `sspai cover attach failed — ${errorMessage(error)}`,
                    'cover-attach',
                    metadata,
                );
            }
        }

        // Body: Markdown → sanitized HTML pasted as text/html into the contenteditable editor
        // (the source's simulatePaste mechanism, sspai.js:62-65), then strict readback.
        try {
            await pasteHtml(page, editorSelector, html, { timeoutMs: this.stepTimeoutMs });
            const readback = await expectOutcome(
                async () => {
                    const raw = String(await page.evaluate(editorReadbackScript(editorSelector, html)));
                    return JSON.parse(raw).ok === true ? 'editor html read back' : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'sspai body paste readback' },
            );
            if (!readback.ok)
                return stageFail(
                    SSPAI_TARGET,
                    `sspai body readback failed — the editor did not retain the pasted article — ${readback.error}`,
                    'body-paste-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                SSPAI_TARGET,
                `sspai body paste failed — ${errorMessage(error)}`,
                'body-paste-readback',
                metadata,
            );
        }

        // Draft save: only the exact-visible provisional 保存草稿|保存 candidate (no broad
        // fallback). The grounded preview control (sspai.js:68) is probed read-only for capability
        // evidence and NEVER clicked; missing current save control = typed failure, never a
        // manufactured draft (the archived guide documents draft saving historically only).
        let saveSelector: string;
        try {
            saveSelector = await resolveSelector(page, SSPAI_ARTICLE_SELECTORS.draftSave, {
                timeoutMs: this.stepTimeoutMs,
                label: 'sspai draft-save control',
            });
        } catch (error) {
            return stageFail(
                SSPAI_TARGET,
                `sspai draft-save control never attached: ${errorMessage(error)} — draft saving is documented historically only, so a missing current control is a typed failure, not a manufactured draft`,
                'draft-save',
                metadata,
            );
        }
        const visible = (await trySelectors(page, [saveSelector], { visible: true, timeout: this.stepTimeoutMs }))
            .found;
        if (!visible)
            return stageFail(
                SSPAI_TARGET,
                'sspai draft-save control attached but not visible; refusing to save through a hidden control',
                'draft-save',
                metadata,
            );
        const previewPresent = (
            await trySelectors(page, SSPAI_ARTICLE_SELECTORS.previewButton, { visible: false, timeout: 2_000 })
        ).found;
        const saveButton = page.locator(saveSelector).first();
        const enabled = await expectOutcome(async () => ((await saveButton.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'sspai draft-save control enabled',
        });
        if (!enabled.ok)
            return stageFail(
                SSPAI_TARGET,
                `sspai draft-save control never became clickable — ${enabled.error}`,
                'draft-save',
                metadata,
            );

        // Draft receipt: baseline before the click (fresh-signal rule), then only a FRESH
        // draft-id URL plus persisted title/body/cover state confirms. Stale, toast-only or
        // preview-only never passes.
        const beforeReceipts = new Set(await readReceiptUrls(page));
        await saveButton.click();
        const confirmed = await expectOutcome(
            async () => {
                const url = (await readReceiptUrls(page)).find((candidate) => !beforeReceipts.has(candidate));
                if (url === undefined) return null;
                const raw = String(
                    await page.evaluate(
                        persistedStateScript(titleSelector, title, editorSelector, html, coverReadback),
                    ),
                );
                const state = JSON.parse(raw) as { titleOk: boolean; editorOk: boolean; coverOk: boolean };
                if (!state.titleOk || !state.editorOk || !state.coverOk) {
                    return `stale-state: ${url}`; // a receipt whose fields no longer match is not success
                }
                return url;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'sspai draft-receipt confirmation' },
        );
        if (!confirmed.ok) {
            return stageFail(
                SSPAI_TARGET,
                `sspai draft-receipt not confirmed — no fresh draft-id receipt with persisted title/body/cover state appeared; preview or fill alone is never a saved draft`,
                'draft-receipt',
                metadata,
                `still on ${page.url()}; ${beforeReceipts.size} pre-existing receipt-shaped url(s); preview button ${previewPresent ? 'present (not clicked)' : 'absent'}`,
            );
        }
        if (confirmed.evidence.startsWith('stale-state: ')) {
            return stageFail(
                SSPAI_TARGET,
                'sspai draft-receipt appeared but the persisted title/body/cover state no longer matches the requested content; refusing to claim success',
                'draft-receipt',
                metadata,
                confirmed.evidence,
            );
        }
        const url = confirmed.evidence;
        return ResultSchema.parse({
            ok: true,
            target: SSPAI_TARGET,
            id: articleIdFrom(url),
            url,
            message: `sspai article draft saved in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: 'draft-receipt', previewButtonObserved: previewPresent },
        });
    }
}

/**
 * Unsupported requested fields for this flow: images/tags/categories are not implemented
 * (sspai.js implements none of them), so any of them — in options or metadata — is a typed
 * unsupported-field refusal, never a silent claim of applied. `coverPath` is implemented and
 * validated in `resolveCoverPath`.
 */
function unsupportedFields(payload: PublishTransportPayload): readonly string[] {
    const refused: string[] = [];
    for (const [container, keys] of [
        ['options', ['images', 'tags', 'categories'] as const],
        ['metadata', ['images', 'tags', 'categories'] as const],
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
