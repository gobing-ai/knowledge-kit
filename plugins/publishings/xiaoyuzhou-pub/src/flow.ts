/**
 * xiaoyuzhou-pub transport + flow (task 0295).
 *
 * The live podcast flow in `runPodcastFlow`, stage-typed on every `Result.metadata.stage`:
 * browser-precondition → show-verify → audio-upload → title-readback → shownotes-paste-readback →
 * cover-attach (when requested) → draft-save → draft-receipt. This slice saves drafts ONLY:
 * publishStatus absent or 'draft' (the frozen default) activates the exact-visible
 * 保存草稿|保存 candidate; 'public' and any unknown value refuse before the browser (the source
 * itself never publishes — 不点发布按钮， xiaoyuzhou.js:6, 18-19).
 *
 * Mechanism (xiaoyuzhou.js:3-6): the local audio is attached via CDP `setInputFiles` on the
 * grounded `input#upload` — never the source's in-page DataTransfer/blob fetch (xiaoyuzhou.js:38,
 * 46-50), which would move file bytes through the page; processing readiness is then verified (a
 * file assignment alone is never success, xiaoyuzhou.js:51-52). The title is filled natively with
 * input/change events — the source's bare `.value` write is flagged TODO(逆向存疑) by the source
 * itself (xiaoyuzhou.js:57-58). Shownotes Markdown is rendered to HTML, sanitized here first
 * (script/style/iframe/embed/object, `on*` attributes, `javascript:`/`data:` URLs stripped —
 * closing task 0294's P3 sanitizer gap; code/list/heading markup preserved) and pasted into the
 * Draft.js editor as `text/html` (xiaoyuzhou.js:72-74). Success is confirmed only by a FRESH
 * persisted receipt (an episode-id URL that was not on screen before the click) plus re-read
 * persisted title/audio/shownotes(/cover) state — never a stale assignment or a toast.
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
    isXiaoyuzhouAuthenticated,
    XYZF_AUDIO_SELECTORS,
    XYZF_CONFIG,
    XYZF_HOME_URL,
    XYZF_RECEIPT_URL_RES,
    XYZF_TARGET,
    XYZF_UNSUPPORTED_URL_RE,
    XYZF_UPLOAD_TIMEOUT_MS,
} from './selectors';

const STEP_TIMEOUT_MS = 30_000;
/**
 * KK v1 local-audio size bound (task 0295 Design freeze): 500 MiB. A project-scoped product
 * bound, not a platform limit — the studio's own ceiling is unpinned.
 */
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** Operator recovery command every session failure names — never a cookie, DOM dump or stack. */
export const XYZF_LOGIN_INSTRUCTION = 'bun plugins/publishings/xiaoyuzhou-pub/src/profile-check.ts login';

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

/** One short line, bounded: no DOM dump, cookie, token, stack or leaked audio path ever reaches the Result. */
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

/** Input `value` property readback (title input). */
function inputValueScript(selector: string): string {
    return `(() => { // kk-xyzf-input-value
    const el = document.querySelector(${JSON.stringify(selector)});
    return el === null ? '' : String(el.value ?? '');
})()`;
}

/**
 * Plugin-local HTML sanitizer (task 0295 Design freeze — no new dependency): strips
 * script/style/iframe/embed/object containers, `on*` event attributes and `javascript:`/`data:`
 * URLs while preserving code/list/heading markup, before any paste reaches the editor. The
 * `data:` arm closes the sanitizer gap task 0294 review logged (P3) for sspai.
 */
export function sanitizeXiaoyuzhouHtml(html: string): string {
    return html
        .replace(/<\s*(script|style|iframe|embed|object)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|style|iframe|embed|object)\b[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(\s(?:href|src)\s*=\s*)(["'])\s*(?:javascript|data):[^"']*\2/gi, '$1$2$2')
        .replace(/(\s(?:href|src)\s*=\s*)(?:javascript|data):[^\s>]*/gi, '$1""');
}

/**
 * Shownotes paste readback: the Draft.js editor still holds non-empty markup whose text equals the
 * sanitized HTML's text (whitespace-insensitive) — a dropped or transformed paste refuses before
 * any save.
 */
function editorReadbackScript(selector: string, html: string): string {
    return `(() => { // kk-xyzf-editor-readback
    const editor = document.querySelector(${JSON.stringify(selector)});
    if (editor === null) return JSON.stringify({ ok: false });
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const squish = (v) => String(v ?? '').replace(/\\s+/g, '');
    return JSON.stringify({ ok: editor.innerHTML.length > 0 && squish(editor.innerText) === squish(probe.textContent) });
})()`;
}

/**
 * Audio processing-ready probe: a media record appears in the form — an `audio` preview player or
 * the uploaded file name rendered in the page. The bare file assignment (xiaoyuzhou.js:51) is
 * explicitly NOT success (task 0295 Design freeze); this is the provisional readiness evidence,
 * and its absence at the ceiling is a typed upload failure, never an assumed upload.
 */
function audioReadyScript(fileName: string): string {
    return `(() => { // kk-xyzf-audio-ready
    const audio = document.querySelector('audio');
    if (audio !== null) return JSON.stringify({ ready: true, by: 'audio-player' });
    const text = String(document.body?.innerText ?? '');
    return JSON.stringify({ ready: text.includes(${JSON.stringify(fileName)}) });
})()`;
}

/**
 * Persisted-state readback for save confirmation: the title input and Draft.js editor still hold
 * the requested content, the audio record is still on screen, and, when a cover was requested, the
 * scoped file input still carries exactly that file assignment (frozen success rule — a fresh id
 * alone never confirms).
 */
function persistedStateScript(
    titleSelector: string,
    title: string,
    editorSelector: string,
    html: string,
    audio: { fileName: string },
    cover: { selector: string; fileName: string } | undefined,
): string {
    return `(() => { // kk-xyzf-persisted
    const title = document.querySelector(${JSON.stringify(titleSelector)});
    const editor = document.querySelector(${JSON.stringify(editorSelector)});
    const probe = document.createElement('div');
    probe.innerHTML = ${JSON.stringify(html)};
    const squish = (v) => String(v ?? '').replace(/\\s+/g, '');
    const titleOk = title !== null && squish(title.value) === squish(${JSON.stringify(title)});
    const editorOk = editor !== null && editor.innerHTML.length > 0 && squish(editor.innerText) === squish(probe.textContent);
    const bodyText = String(document.body?.innerText ?? '');
    const audioOk = document.querySelector('audio') !== null || bodyText.includes(${JSON.stringify(audio.fileName)});
    const coverOk = ${
        cover === undefined
            ? 'true'
            : `(() => {
        const input = document.querySelector(${JSON.stringify(cover.selector)});
        return input !== null && input.files !== null && input.files.length === 1 && input.files[0].name === ${JSON.stringify(cover.fileName)};
    })()`
    };
    return JSON.stringify({ titleOk, editorOk, audioOk, coverOk });
})()`;
}

/** Receipt-shaped URLs on screen (location + anchors) — the save-time baseline and fresh read. */
async function readReceiptUrls(page: Page): Promise<readonly string[]> {
    const raw = await page.evaluate(`(() => { // kk-xyzf-receipt-urls
    const patterns = [${XYZF_RECEIPT_URL_RES.map((re) => re.toString()).join(', ')}];
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

/** Episode id from an observed receipt URL (shape: `/episode/<id>`, provisional). */
function episodeIdFrom(url: string): string | undefined {
    return /\/episode\/([0-9a-zA-Z]+)/.exec(url)?.[1];
}

/**
 * Pre-browser required-audio gate: `metadata.audioPath` (falling back to `metadata.mp3Path`) must
 * name an existing, regular, readable, nonempty local MP3/M4A/WAV under the KK v1 500 MiB cap.
 * Probed through the Bun file API (repo rule no-direct-fs-io) — never node:fs.
 */
async function resolveAudioPath(
    raw: unknown,
): Promise<{ path?: string; error?: undefined } | { path?: undefined; error: string }> {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return {
            error: `metadata.audioPath (or metadata.mp3Path) must be a non-empty local audio file path, got '${bounded(raw)}'`,
        };
    }
    const path = raw.trim();
    if (!/\.(mp3|m4a|wav)$/i.test(path)) {
        return {
            error: `metadata.audioPath (or metadata.mp3Path) must be a local MP3/M4A/WAV file, got unsupported extension in '${bounded(path)}'`,
        };
    }
    // no-direct-fs-io: probe the file through the Bun API instead of node:fs.
    const file = Bun.file(path);
    const readable = await file.exists().catch(() => false);
    if (!readable || file.size === 0) {
        return {
            error: 'metadata.audioPath (or metadata.mp3Path) does not resolve to a readable nonempty local audio file',
        };
    }
    if (file.size > MAX_AUDIO_BYTES) {
        return {
            error: `metadata.audioPath (or metadata.mp3Path) exceeds the KK v1 local audio cap of 500 MiB (${file.size} bytes)`,
        };
    }
    return { path };
}

/**
 * Pre-browser required-show gate: `metadata.podcastId` is REQUIRED — a non-empty string naming
 * the target show. The flow verifies the studio's currently selected show against it
 * (show-verify stage) and never assumes the first/default show.
 */
function resolvePodcastId(raw: unknown): { id?: string; error?: undefined } | { id?: undefined; error: string } {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
        return {
            error: `metadata.podcastId is required for xiaoyuzhou podcast publish: a non-empty show id naming the target show — the flow verifies the studio's selected show against it and never uploads to a first/default show`,
        };
    }
    return { id: raw.trim() };
}

/** Pre-browser provenance gate: `metadata.duration`, when present, is a positive finite number. */
function resolveDuration(raw: unknown): { error?: string } {
    if (raw === undefined) return {};
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
        return {
            error: `metadata.duration must be a positive finite number (seconds, provenance only), got '${bounded(raw)}'`,
        };
    }
    return {};
}

/**
 * Pre-browser requested-cover gate: an optional local PNG/JPEG/WebP that must exist as a regular,
 * readable, nonempty file. Requested-but-absent or wrong-typed refuses here — a requested cover is
 * never silently skipped (the vendor does not handle covers at all, xiaoyuzhou.js:17).
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
 * Xiaoyuzhou browser transport on the shared rails (ADR-027): a headless session preflight, one
 * headed flow, and success only from a fresh persisted receipt plus persisted field state.
 * Draft-only: publishStatus absent or 'draft' saves a draft; 'public' and any unknown value refuse
 * before the browser (ladder in `src/index.ts` → `publish()`).
 */
export class XiaoyuzhouBrowserTransport implements PublishTransport {
    public readonly kind = 'browser';
    public readonly driver: BrowserDriver;
    private readonly operation: 'podcast';
    private readonly launcher: BrowserLauncher;
    private readonly stepTimeoutMs: number;
    constructor(
        operation: 'podcast' = 'podcast',
        driver: BrowserDriver = 'script',
        deps: { launcher?: BrowserLauncher; stepTimeoutMs?: number } = {},
    ) {
        this.operation = operation;
        this.driver = driver;
        this.launcher = deps.launcher ?? kkBrowserLauncher;
        this.stepTimeoutMs = deps.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    }

    /**
     * Publishes one Content as a xiaoyuzhou podcast episode draft.
     * @param payload - Target content plus per-call options.
     * @returns The publish `Result`, `ok: true` only from an observed persisted draft receipt.
     */
    public async publish(payload: PublishTransportPayload): Promise<Result> {
        // The operation was resolved (and unknown names refused) before this transport existed;
        // the remaining ladder is all pre-browser: driver → publishStatus (draft-only) → format →
        // title → body → audio file → podcastId → duration → cover → unsupported fields → session
        // preflight.
        if (this.driver !== 'script') {
            return fail(
                XYZF_TARGET,
                `unsupported driver '${bounded(this.driver)}' for ${XYZF_TARGET}: expected one of script (the xiaoyuzhou-pub browser flow has no agent path)`,
            );
        }
        const requested = payload.content.metadata?.publishStatus;
        if (requested === 'public') {
            return fail(
                XYZF_TARGET,
                `xiaoyuzhou-pub saves drafts only: metadata.publishStatus 'public' is refused before any browser opens — final publication on the studio is not evidenced (the source itself stops before publish, xiaoyuzhou.js:6, 18-19); omit publishStatus or pass 'draft'`,
            );
        }
        if (requested !== undefined && requested !== 'draft') {
            return fail(
                XYZF_TARGET,
                `unknown publishStatus '${bounded(requested)}' for ${XYZF_TARGET}: expected 'draft' or absent (absent defaults to draft); 'public' is refused — this slice saves drafts only`,
            );
        }
        if (payload.content.format !== 'audio') {
            return fail(
                XYZF_TARGET,
                `xiaoyuzhou podcast requires Content.format 'audio', got '${bounded(payload.content.format)}'`,
            );
        }
        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                XYZF_TARGET,
                'xiaoyuzhou podcast requires a non-empty Content.title (episode title input, xiaoyuzhou.js:55)',
            );
        }
        const body = payload.content.body.trim();
        if (body.length === 0) {
            return fail(
                XYZF_TARGET,
                'xiaoyuzhou podcast requires non-empty Content.body Markdown (the shownotes are pasted as sanitized text/html, xiaoyuzhou.js:72)',
            );
        }
        const audio = await resolveAudioPath(payload.content.metadata?.audioPath ?? payload.content.metadata?.mp3Path);
        if (audio.error !== undefined) return fail(XYZF_TARGET, audio.error);
        const show = resolvePodcastId(payload.content.metadata?.podcastId);
        if (show.error !== undefined) return fail(XYZF_TARGET, show.error);
        const duration = resolveDuration(payload.content.metadata?.duration);
        if (duration.error !== undefined) return fail(XYZF_TARGET, duration.error);
        const cover = await resolveCoverPath(payload.content.metadata?.coverPath ?? payload.options?.coverPath);
        if (cover.error !== undefined) return fail(XYZF_TARGET, cover.error);
        const unsupported = unsupportedFields(payload);
        if (unsupported.length > 0) {
            return fail(
                XYZF_TARGET,
                `unsupported field(s) ${unsupported.join(', ')} for xiaoyuzhou: this draft-only flow implements title/shownotes/audio/podcastId/cover only, and xiaoyuzhou.js implements none of images/tags/categories`,
            );
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(XYZF_TARGET, override);

        // ADR-025 preflight: an unauthenticated or absent profile must never produce a headed visit,
        // so the read-only headless check runs first and a refusal stays a fast refusal.
        const session = await checkChannelSession(XYZF_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            // The recovery command leads the message: `fail()` bounds the line, and the operator's
            // next action must never be the part that gets truncated.
            return fail(
                XYZF_TARGET,
                `${XYZF_TARGET} session preflight refused — run: ${XYZF_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: XYZF_HOME_URL,
                    isAuthenticated: isXiaoyuzhouAuthenticated,
                    // Headed by default; the headless preflight above is the unattended pass and
                    // `options.headless === true` the opt-in.
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    // The session is already preflight-verified, so the post-goto confirmation is a
                    // bounded step like every other one, not the 180s interactive login wait.
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runPodcastFlow(
                        page,
                        title,
                        body,
                        audio.path as string,
                        show.id as string,
                        cover.path,
                        profileDir,
                    ),
            );
        } catch (error) {
            // Same ordering rule as the preflight refusal: the recovery command is never the tail
            // that a bounded message drops.
            const detail = errorMessage(error);
            return fail(
                XYZF_TARGET,
                needsLogin(error)
                    ? `${XYZF_TARGET} session failed — run: ${XYZF_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * The live podcast flow on the already-navigated studio page (`XYZF_HOME_URL`): the
     * unsupported-browser environment precondition → show-verify against `metadata.podcastId` →
     * audio attach with processing-ready verification (never a bare file assignment,
     * xiaoyuzhou.js:51-52) → title fill with readback (input/change events, never the source's
     * bare `.value`, xiaoyuzhou.js:57-58) → sanitized text/html shownotes paste with readback
     * (xiaoyuzhou.js:72-74) → optional verified cover attach → the provisional exact-visible
     * draft save → fresh-receipt confirmation.
     */
    private async runPodcastFlow(
        page: Page,
        title: string,
        body: string,
        audioPath: string,
        podcastId: string,
        coverPath: string | undefined,
        profileDir: string,
    ): Promise<Result> {
        const metadata = {
            operation: this.operation,
            driver: this.driver,
            publishStatus: 'draft' as const,
            podcastId,
            profileDir,
        };

        // Environment precondition BEFORE any upload: the studio officially requires desktop
        // Chrome 147+ and serves an unsupported-browser page otherwise. Chromium 155.0.8059.40 is
        // observed-only; the operator recovery is KK_BROWSER_CHANNEL=chrome via the existing
        // kkBrowserLauncher (no Playwright pin change).
        if (XYZF_UNSUPPORTED_URL_RE.test(page.url())) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou studio served an unsupported-browser page (${page.url()}): the podcaster studio officially requires desktop Chrome 147+ — rerun with KK_BROWSER_CHANNEL=chrome (the kkBrowserLauncher reads it; the Playwright pin is unchanged; the observed bundled Chromium 155.0.8059.40 is observed-only)`,
                'browser-precondition',
                metadata,
            );
        }

        // Show-verify BEFORE upload: the studio's currently selected show must carry the requested
        // podcastId (URL or page text). Never the first/default show — an unconfirmable identity
        // is a typed refusal, and the operator opens the target show in the studio themselves.
        const showOk = await expectOutcome(
            async () => {
                if (page.url().includes(podcastId)) return `show id in url: ${page.url()}`;
                const text = String(await page.evaluate('String(document.body?.innerText ?? "")'));
                return text.includes(podcastId) ? 'show id on page' : null;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'xiaoyuzhou show-verify' },
        );
        if (!showOk.ok) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou show-verify failed: the requested podcastId '${bounded(podcastId)}' was not observable on ${page.url()} — open the target show in the studio first; the flow never uploads to a first/default show`,
                'show-verify',
                metadata,
            );
        }

        // Audio attach: CDP setInputFiles of the local file on the grounded input#upload — never
        // the source's in-page DataTransfer/blob fetch (xiaoyuzhou.js:38, 46-50). Then processing
        // readiness at the 600s media ceiling: a media record (audio player or the file name) must
        // appear; the bare assignment is never success (xiaoyuzhou.js:51-52). The source's fixed
        // 1s settle sleeps (xiaoyuzhou.js:29, 52) are subsumed by this polled verification.
        const fileName = basename(audioPath);
        let audioSelector: string;
        try {
            audioSelector = await resolveSelector(page, XYZF_AUDIO_SELECTORS.audioInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'xiaoyuzhou audio file input',
            });
        } catch (error) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou audio file input never attached on ${page.url()}: ${errorMessage(error)} (the source reads a missing input as maybe-unlogged, xiaoyuzhou.js:27-28) — run: ${XYZF_LOGIN_INSTRUCTION}`,
                'upload-timeout',
                metadata,
            );
        }
        try {
            await uploadFile(page, audioSelector, audioPath, { timeoutMs: this.stepTimeoutMs });
        } catch (error) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou audio attach failed: ${errorMessage(error)}`,
                'upload-timeout',
                metadata,
            );
        }
        const processed = await expectOutcome(
            async () => {
                const raw = String(await page.evaluate(audioReadyScript(fileName)));
                return JSON.parse(raw).ready === true ? `audio media record observed (${JSON.parse(raw).by})` : null;
            },
            { timeoutMs: XYZF_UPLOAD_TIMEOUT_MS, label: 'xiaoyuzhou audio processing' },
        );
        if (!processed.ok) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou audio processing not confirmed within the ${XYZF_UPLOAD_TIMEOUT_MS}ms ceiling — the file was assigned but no media record (audio player or file name) appeared; refusing to claim an uploaded episode`,
                'upload-processing',
                metadata,
            );
        }

        // Title: native fill with real input/change events (Playwright fill dispatches both) —
        // never the source's bare `.value` write that the source itself flags suspect
        // (xiaoyuzhou.js:57-58) — then a normalized value readback. The selectors are hoisted
        // because the receipt readback re-probes the persisted state through them; the flow can
        // only reach the receipt after both stages resolved and read back.
        let titleSelector: string | undefined;
        try {
            const resolvedTitle = await resolveSelector(page, XYZF_AUDIO_SELECTORS.titleInput, {
                timeoutMs: this.stepTimeoutMs,
                label: 'xiaoyuzhou title input',
            });
            titleSelector = resolvedTitle;
            await page.locator(resolvedTitle).first().fill(title);
            const readback = await expectOutcome(
                async () =>
                    normalizeText(String(await page.evaluate(inputValueScript(resolvedTitle)))) === normalizeText(title)
                        ? 'title read back'
                        : null,
                { timeoutMs: this.stepTimeoutMs, label: 'xiaoyuzhou title readback' },
            );
            if (!readback.ok)
                return stageFail(
                    XYZF_TARGET,
                    `xiaoyuzhou title readback failed — the editor did not retain the requested title — ${readback.error}`,
                    'title-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou title fill failed — ${errorMessage(error)}`,
                'title-readback',
                metadata,
            );
        }

        // Shownotes: Markdown → sanitized HTML pasted as text/html into the Draft.js editor (the
        // source's simulatePaste mechanism, xiaoyuzhou.js:72-74) plus the source's input/change
        // dispatch, then a strict text readback.
        const html = sanitizeXiaoyuzhouHtml(markdownToHtml(body));
        let editorSelector: string | undefined;
        try {
            const resolvedEditor = await resolveSelector(page, XYZF_AUDIO_SELECTORS.shownotesEditor, {
                timeoutMs: this.stepTimeoutMs,
                label: 'xiaoyuzhou shownotes editor',
            });
            editorSelector = resolvedEditor;
            await pasteHtml(page, resolvedEditor, html, { timeoutMs: this.stepTimeoutMs });
            await page.evaluate(
                `(() => { // kk-xyzf-editor-events
    const editor = document.querySelector(${JSON.stringify(resolvedEditor)});
    if (editor === null) return;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
})()`,
            );
            const readback = await expectOutcome(
                async () => {
                    const raw = String(await page.evaluate(editorReadbackScript(resolvedEditor, html)));
                    return JSON.parse(raw).ok === true ? 'editor html read back' : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'xiaoyuzhou shownotes paste readback' },
            );
            if (!readback.ok)
                return stageFail(
                    XYZF_TARGET,
                    `xiaoyuzhou shownotes readback failed — the editor did not retain the pasted shownotes — ${readback.error}`,
                    'shownotes-paste-readback',
                    metadata,
                );
        } catch (error) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou shownotes paste failed — ${errorMessage(error)}`,
                'shownotes-paste-readback',
                metadata,
            );
        }

        // Cover: only when requested, on the provisional scoped control — a missing control is a
        // typed failure, never the vendor-style silent absence (xiaoyuzhou.js:17), and the
        // attached preview must be observed before it counts.
        let coverReadback: { selector: string; fileName: string } | undefined;
        if (coverPath !== undefined) {
            try {
                const coverSelector = await resolveSelector(page, XYZF_AUDIO_SELECTORS.coverInput, {
                    timeoutMs: this.stepTimeoutMs,
                    label: 'xiaoyuzhou cover file input',
                });
                await uploadFile(page, coverSelector, coverPath, { timeoutMs: this.stepTimeoutMs });
                coverReadback = { selector: coverSelector, fileName: basename(coverPath) };
                const readback = await expectOutcome(
                    async () => {
                        const raw = String(
                            await page.evaluate(
                                `(() => { // kk-xyzf-cover-assigned
    const input = document.querySelector(${JSON.stringify(coverSelector)});
    if (input === null || input.files === null) return JSON.stringify({ assigned: false });
    const assigned = input.files.length === 1 && input.files[0].name === ${JSON.stringify(basename(coverPath))};
    const preview = assigned && document.querySelector('form:has(div[data-contents="true"]) img') !== null;
    return JSON.stringify({ assigned, preview });
})()`,
                            ),
                        );
                        const state = JSON.parse(raw) as { assigned: boolean; preview: boolean };
                        return state.assigned && state.preview ? 'cover assignment and preview read back' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'xiaoyuzhou cover readback' },
                );
                if (!readback.ok)
                    return stageFail(
                        XYZF_TARGET,
                        'xiaoyuzhou cover attach could not be verified (assignment or preview missing on the scoped control) — refusing rather than claiming an unverified cover',
                        'cover-attach',
                        metadata,
                    );
            } catch (error) {
                return stageFail(
                    XYZF_TARGET,
                    `xiaoyuzhou cover attach failed — ${errorMessage(error)}`,
                    'cover-attach',
                    metadata,
                );
            }
        }

        // Draft save: only the exact-visible provisional 保存草稿|保存 candidate (no broad
        // fallback). Missing current save control = typed failure, never a manufactured draft
        // (the source never saves, xiaoyuzhou.js:6, 18-19).
        let saveSelector: string;
        try {
            saveSelector = await resolveSelector(page, XYZF_AUDIO_SELECTORS.saveButton, {
                timeoutMs: this.stepTimeoutMs,
                label: 'xiaoyuzhou draft-save control',
            });
        } catch (error) {
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou draft-save control never attached: ${errorMessage(error)} — the source never saves, so a missing current control is a typed failure, not a manufactured draft`,
                'draft-save',
                metadata,
            );
        }
        const visible = (await trySelectors(page, [saveSelector], { visible: true, timeout: this.stepTimeoutMs }))
            .found;
        if (!visible)
            return stageFail(
                XYZF_TARGET,
                'xiaoyuzhou draft-save control attached but not visible; refusing to save through a hidden control',
                'draft-save',
                metadata,
            );
        const saveButton = page.locator(saveSelector).first();
        const enabled = await expectOutcome(async () => ((await saveButton.isEnabled()) ? 'enabled' : null), {
            timeoutMs: this.stepTimeoutMs,
            label: 'xiaoyuzhou draft-save control enabled',
        });
        if (!enabled.ok)
            return stageFail(
                XYZF_TARGET,
                `xiaoyuzhou draft-save control never became clickable — ${enabled.error}`,
                'draft-save',
                metadata,
            );

        // Draft receipt: baseline before the click (fresh-signal rule), then only a FRESH
        // episode-id URL plus persisted title/audio/shownotes/cover state confirms. Stale,
        // ambiguous (disagreeing fresh ids) or contradictory never passes.
        const beforeReceipts = new Set(await readReceiptUrls(page));
        await saveButton.click();
        const confirmed = await expectOutcome(
            async () => {
                const fresh = (await readReceiptUrls(page)).filter((candidate) => !beforeReceipts.has(candidate));
                if (fresh.length === 0) return null;
                const ids = new Set(fresh.map(episodeIdFrom).filter((id): id is string => id !== undefined));
                if (ids.size === 0) return `ambiguous-receipt: ${fresh[0] ?? ''}`; // no id-bearing episode URL
                if (ids.size > 1) return `ambiguous-receipt: ${ids.size} disagreeing fresh episode ids`;
                const url = fresh.find((candidate) => episodeIdFrom(candidate) !== undefined);
                if (url === undefined) return `ambiguous-receipt: ${fresh[0] ?? ''}`;
                const raw = String(
                    await page.evaluate(
                        persistedStateScript(
                            titleSelector as string,
                            title,
                            editorSelector as string,
                            html,
                            { fileName },
                            coverReadback,
                        ),
                    ),
                );
                const state = JSON.parse(raw) as {
                    titleOk: boolean;
                    editorOk: boolean;
                    audioOk: boolean;
                    coverOk: boolean;
                };
                if (!state.titleOk || !state.editorOk || !state.audioOk || !state.coverOk) {
                    return `stale-state: ${url ?? ''}`; // a receipt whose fields no longer match is not success
                }
                return url;
            },
            { timeoutMs: this.stepTimeoutMs, label: 'xiaoyuzhou draft-receipt confirmation' },
        );
        if (!confirmed.ok) {
            return stageFail(
                XYZF_TARGET,
                'xiaoyuzhou draft-receipt not confirmed — no fresh episode-id receipt with persisted title/audio/shownotes/cover state appeared; fill alone is never a saved draft',
                'draft-receipt',
                metadata,
                `still on ${page.url()}; ${beforeReceipts.size} pre-existing receipt-shaped url(s)`,
            );
        }
        if (confirmed.evidence.startsWith('stale-state: ') || confirmed.evidence.startsWith('ambiguous-receipt: ')) {
            return stageFail(
                XYZF_TARGET,
                confirmed.evidence.startsWith('stale-state: ')
                    ? 'xiaoyuzhou draft-receipt appeared but the persisted title/audio/shownotes/cover state no longer matches the requested content; refusing to claim success'
                    : 'xiaoyuzhou draft-receipt is ambiguous (no single id-bearing episode URL among the fresh receipts); refusing to claim success',
                'draft-receipt',
                metadata,
                confirmed.evidence,
            );
        }
        const url = confirmed.evidence;
        return ResultSchema.parse({
            ok: true,
            target: XYZF_TARGET,
            id: episodeIdFrom(url),
            url,
            message: `xiaoyuzhou podcast draft saved in profile ${profileDir}`,
            metadata: { ...metadata, confirmedBy: 'draft-receipt' },
        });
    }
}

/**
 * Unsupported requested fields for this flow: images/tags/categories are not implemented
 * (xiaoyuzhou.js implements none of them), so any of them — in options or metadata — is a typed
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
