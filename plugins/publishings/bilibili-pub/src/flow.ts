/**
 * bilibili-pub transport and publishing flow (task 0297).
 *
 * Implements two distinct flows matching the Bilibili platform architecture:
 * 1. Short Video (`shortVideo`): Video upload and metadata filling at member.bilibili.com.
 *    Grounded in `.spur/run/yijianfa-source/platforms/bilibili.js` (lines 290-360, 365-556):
 *    - Native file input upload (bilibili.js:397, 401) and file injection (bilibili.js:417)
 *    - Media processing wait for form appearance (bilibili.js:431)
 *    - Title fill and readback (max 80 chars, bilibili.js:431-447)
 *    - Description paste and readback (bilibili.js:453-463)
 *    - Partition selection — **Provisional**: the adapter exposes no partition UI control; it only
 *      writes the API field `form.append("category", "daily")` (bilibili.js:571)
 *    - Tag cleanup and fill (max 10 tags, Enter key, bilibili.js:485-507)
 *    - Original ("自制") radio selection (bilibili.js:520-521)
 *    - Cover upload and crop confirmation (bilibili.js:290-360)
 *    - Submission: draft save via observed draft control vs public submission via span.submit-add
 *      resulting in a pending-review receipt (bilibili.js:548, 552).
 * 2. Dynamic Post (`dynamic`): Rich-text and multi-image posts at t.bilibili.com.
 *    Grounded in `bilibili.js` (lines 158-287) and `bilibili-main.js` (lines 33-90):
 *    - Editor element in composer scope (bilibili.js:171, 209, 270-271)
 *    - Image cleanup (bilibili.js:174-184)
 *    - Native setInputFiles for images (bilibili.js:231, 238, 257; the vendor injects the file
 *      through a MAIN-world message bridge, bilibili-main.js:54-81 — deliberately NOT reproduced)
 *    - Launch button submission (bilibili.js:273, 285)
 *    - Public-only policy: drafts are refused pre-browser.
 */

import { type Result, ResultSchema } from '@gobing-ai/kk-core';
import type { BrowserDriver, PublishTransport, PublishTransportPayload } from '@gobing-ai/publish-harness';
import {
    checkChannelSession,
    expectOutcome,
    kkBrowserLauncher,
    markdownToHtml,
    resolveChannelProfileDir,
} from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    withProfilePage,
} from '@gobing-ai/ts-browser-automation';
import type { Locator, Page } from 'playwright';
import {
    BILI_CONFIG,
    BILI_DYNAMIC_HOME_URL,
    BILI_DYNAMIC_SELECTORS,
    BILI_MEMBER_HOME_URL,
    BILI_RECEIPT_URL_RES,
    BILI_TARGET,
    BILI_UPLOAD_TIMEOUT_MS,
    BILI_VIDEO_SELECTORS,
    type BilibiliOperation,
    isBilibiliAuthenticated,
} from './selectors';

const STEP_TIMEOUT_MS = 30_000;

/**
 * KK v1 local-video size bound: 2 GiB. Product bound, not an explicit platform limit.
 */
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

/** Operator recovery command named on session failures. */
export const BILI_LOGIN_INSTRUCTION = 'bun plugins/publishings/bilibili-pub/src/profile-check.ts login';

/** `ok: false` refusal Result with a bounded, single-line error. */
export function fail(target: string, error: string): Result {
    return ResultSchema.parse({ ok: false, target, error: boundedDetail(error) });
}

/** A browser-stage failure: `ok: false` with `stage` and metadata. */
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

/** One short line, bounded to 300 characters without leaking credentials or DOM dumps. */
export function boundedDetail(detail: string): string {
    return detail.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Bounded rendering of a value for refusal messages. */
export function bounded(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} entr${value.length === 1 ? 'y' : 'ies'}`;
    return String(value).replace(/\s+/g, ' ').slice(0, 100);
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function needsLogin(error: unknown): boolean {
    return error instanceof LoginTimeoutError || error instanceof BrowserProfileMissingError;
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, '');
}

/**
 * Plugin-local HTML sanitizer: strips script/style/iframe/embed/object containers,
 * `on*` event attributes, and `javascript:`/`data:` URLs.
 */
export function sanitizeBilibiliHtml(html: string): string {
    return html
        .replace(/<\s*(script|style|iframe|embed|object)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<\s*(script|style|iframe|embed|object)\b[^>]*>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/(\s(?:href|src)\s*=\s*)(["'])\s*(?:javascript|data):[^"']*\2/gi, '$1$2$2');
}

/**
 * Pre-browser local video path check via Bun file API (no node:fs).
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
 * Pre-browser cover image path check via Bun file API.
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
    const file = Bun.file(path);
    const readable = await file.exists().catch(() => false);
    if (!readable || file.size === 0) {
        return { error: 'metadata.coverPath does not resolve to a readable nonempty local image file' };
    }
    return { path };
}

/**
 * Pre-browser tags check: max 10 entries (bilibili.js:488, 507).
 */
function resolveTags(
    raw: unknown,
): { tags: readonly string[]; error?: undefined } | { tags?: undefined; error: string } {
    if (raw === undefined) return { tags: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.tags must be an array of strings when present, got '${bounded(raw)}'` };
    }
    if (raw.length > 10) {
        return {
            error: `bilibili shortVideo tags exceed the 10-tag limit (${raw.length} entries; tags are rejected, bilibili.js:488, 507)`,
        };
    }
    const cleaned: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.tags entries must be non-empty strings, got '${bounded(entry)}'` };
        }
        cleaned.push(entry.trim());
    }
    return { tags: cleaned };
}

/**
 * Pre-browser dynamic images check: max 9 entries.
 */
async function resolveDynamicImages(
    raw: unknown,
): Promise<{ paths: readonly string[]; error?: undefined } | { paths?: undefined; error: string }> {
    if (raw === undefined) return { paths: [] };
    if (!Array.isArray(raw)) {
        return { error: `metadata.images must be an array of file paths when present, got '${bounded(raw)}'` };
    }
    if (raw.length > 9) {
        return {
            error: `bilibili dynamic images exceed the limit of 9 images (${raw.length} provided)`,
        };
    }
    const cleaned: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
            return { error: `metadata.images entries must be non-empty strings, got '${bounded(entry)}'` };
        }
        const path = entry.trim();
        if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) {
            return {
                error: `metadata.images must be local image files (.png/.jpg/.jpeg/.webp/.gif), got '${bounded(path)}'`,
            };
        }
        const file = Bun.file(path);
        const readable = await file.exists().catch(() => false);
        if (!readable || file.size === 0) {
            return {
                error: `metadata.images file does not resolve to a readable nonempty file: '${bounded(path)}'`,
            };
        }
        cleaned.push(path);
    }
    return { paths: cleaned };
}

/**
 * Resolves the first attached candidate selector and returns its locator.
 */
async function resolveLocator(
    page: Page,
    selectors: readonly string[],
    label: string,
    timeoutMs: number = STEP_TIMEOUT_MS,
): Promise<{ locator: Locator; selector: string }> {
    const outcome = await expectOutcome(
        async () => {
            for (const selector of selectors) {
                if ((await page.locator(selector).first().count()) > 0) return selector;
            }
            return null;
        },
        { timeoutMs, label: `${label} attach` },
    );
    if (!outcome.ok) throw new Error(`${label}: ${selectors.join(' | ')} not attached (${outcome.error})`);
    const selector = outcome.evidence;
    return { locator: page.locator(selector).first(), selector };
}

/**
 * Pastes rich text into a contenteditable editor using page.evaluate (NO locator.evaluate, 0296 lesson).
 */
async function pasteRichText(page: Page, selector: string, html: string, plainText: string): Promise<void> {
    const outcome = String(
        await page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return 'missing';
    const data = new DataTransfer();
    data.setData('text/html', ${JSON.stringify(html)});
    data.setData('text/plain', ${JSON.stringify(plainText)});
    el.focus();
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'pasted';
})()`),
    );
    if (outcome !== 'pasted') throw new Error(`pasteRichText: ${selector} not attached for paste`);
}

/**
 * Bilibili browser transport handling shortVideo and dynamic operations.
 */
export class BilibiliBrowserTransport implements PublishTransport {
    public readonly kind = 'browser' as const;
    readonly mode = 'browser-script' as const;
    readonly driver: BrowserDriver;
    readonly operation: BilibiliOperation;
    readonly stepTimeoutMs: number;
    readonly uploadTimeoutMs: number;
    readonly launcher: BrowserLauncher;

    constructor(
        operation: BilibiliOperation = 'shortVideo',
        driver: BrowserDriver = 'script',
        options?: {
            stepTimeoutMs?: number;
            uploadTimeoutMs?: number;
            launcher?: BrowserLauncher;
        },
    ) {
        this.operation = operation;
        this.driver = driver;
        this.stepTimeoutMs = options?.stepTimeoutMs ?? STEP_TIMEOUT_MS;
        this.uploadTimeoutMs = options?.uploadTimeoutMs ?? BILI_UPLOAD_TIMEOUT_MS;
        this.launcher = options?.launcher ?? kkBrowserLauncher;
    }

    async publish(payload: PublishTransportPayload): Promise<Result> {
        if (this.driver !== 'script') {
            return fail(
                BILI_TARGET,
                `unsupported driver '${bounded(this.driver)}' for ${BILI_TARGET}: expected one of script (the bilibili-pub browser flow has no agent path)`,
            );
        }

        if (this.operation === 'shortVideo') {
            return this.publishShortVideo(payload);
        }

        if (this.operation === 'dynamic') {
            return this.publishDynamic(payload);
        }

        return fail(
            BILI_TARGET,
            `unsupported operation '${bounded(this.operation)}' for ${BILI_TARGET}: expected one of shortVideo, dynamic`,
        );
    }

    private async publishShortVideo(payload: PublishTransportPayload): Promise<Result> {
        // Refuse unsupported fields for shortVideo
        if (payload.content.metadata?.images !== undefined || payload.options?.images !== undefined) {
            return fail(
                BILI_TARGET,
                'unsupported field(s) images for bilibili shortVideo: this operation accepts video, partition, tags, cover only; images are not supported for shortVideo',
            );
        }
        const rawContent = payload.content as unknown as Record<string, unknown>;
        if (
            payload.content.metadata?.scheduling !== undefined ||
            payload.content.metadata?.publishTime !== undefined ||
            rawContent.publishTime !== undefined ||
            payload.options?.scheduling !== undefined ||
            payload.options?.publishTime !== undefined
        ) {
            return fail(
                BILI_TARGET,
                'unsupported field(s) scheduling/publishTime for bilibili shortVideo: this operation does not support scheduled publishing (bilibili.js:376-378)',
            );
        }

        const rawStatus = payload.content.metadata?.publishStatus ?? payload.options?.publishStatus;
        const publishStatus = rawStatus ?? 'draft';
        if (rawStatus !== undefined && rawStatus !== 'draft' && rawStatus !== 'public') {
            return fail(
                BILI_TARGET,
                `unknown publishStatus '${bounded(rawStatus)}' for ${BILI_TARGET}: expected 'draft', 'public' or absent (absent defaults to draft)`,
            );
        }

        if (payload.content.format !== 'video') {
            return fail(
                BILI_TARGET,
                `bilibili shortVideo requires Content.format 'video', got '${bounded(payload.content.format)}'`,
            );
        }

        const title = payload.content.title?.trim() ?? '';
        if (title.length === 0) {
            return fail(
                BILI_TARGET,
                'bilibili shortVideo requires a non-empty Content.title (the title input, bilibili.js:431)',
            );
        }
        if (title.length > 80) {
            return fail(
                BILI_TARGET,
                `bilibili shortVideo title exceeds the 80-character platform limit (${title.length} characters; titles longer than 80 are rejected, never truncated, bilibili.js:431)`,
            );
        }

        const partition = payload.content.metadata?.partition ?? payload.options?.partition;
        if (typeof partition !== 'string' || partition.trim().length === 0) {
            return fail(
                BILI_TARGET,
                'bilibili shortVideo requires a non-empty string for metadata.partition specifying the category/partition',
            );
        }

        const video = await resolveVideoPath(payload.content.metadata?.videoPath ?? payload.options?.videoPath);
        if (video.error !== undefined) return fail(BILI_TARGET, video.error);

        const cover = await resolveCoverPath(payload.content.metadata?.coverPath ?? payload.options?.coverPath);
        if (cover.error !== undefined) return fail(BILI_TARGET, cover.error);

        const tagsResult = resolveTags(payload.content.metadata?.tags ?? payload.options?.tags);
        if (tagsResult.error !== undefined) return fail(BILI_TARGET, tagsResult.error);

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(BILI_TARGET, override);

        const session = await checkChannelSession(BILI_CONFIG, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(
                BILI_TARGET,
                `${BILI_TARGET} session preflight refused — run: ${BILI_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: BILI_MEMBER_HOME_URL,
                    isAuthenticated: isBilibiliAuthenticated,
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) =>
                    this.runShortVideoFlow(
                        page,
                        title,
                        payload.content.body.trim(),
                        partition.trim(),
                        tagsResult.tags,
                        video.path as string,
                        cover.path,
                        publishStatus === 'public',
                        profileDir,
                    ),
            );
        } catch (error) {
            const detail = errorMessage(error);
            return fail(
                BILI_TARGET,
                needsLogin(error)
                    ? `${BILI_TARGET} session failed — run: ${BILI_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    private async publishDynamic(payload: PublishTransportPayload): Promise<Result> {
        // publishStatus MUST be 'public'
        const rawStatus = payload.content.metadata?.publishStatus ?? payload.options?.publishStatus;
        if (rawStatus !== 'public') {
            return fail(
                BILI_TARGET,
                'bilibili dynamic posts require explicit metadata.publishStatus: public (drafts are not supported by the platform)',
            );
        }

        // Refuse fields unsupported by dynamic
        const forbidden: string[] = [];
        if (payload.content.metadata?.videoPath !== undefined || payload.options?.videoPath !== undefined) {
            forbidden.push('videoPath');
        }
        if (payload.content.metadata?.partition !== undefined || payload.options?.partition !== undefined) {
            forbidden.push('partition');
        }
        if (payload.content.metadata?.coverPath !== undefined || payload.options?.coverPath !== undefined) {
            forbidden.push('coverPath');
        }
        if (payload.content.metadata?.audioPath !== undefined || payload.options?.audioPath !== undefined) {
            forbidden.push('audioPath');
        }
        if (
            payload.content.metadata?.category !== undefined ||
            payload.content.metadata?.categories !== undefined ||
            payload.options?.category !== undefined ||
            payload.options?.categories !== undefined
        ) {
            forbidden.push('category');
        }
        if (forbidden.length > 0) {
            return fail(
                BILI_TARGET,
                `unsupported field(s) ${forbidden.join(', ')} for bilibili dynamic: dynamic posts do not accept video/partition/cover/category/audio fields`,
            );
        }

        const rawContent = payload.content as unknown as Record<string, unknown>;
        if (
            payload.content.metadata?.scheduling !== undefined ||
            payload.content.metadata?.publishTime !== undefined ||
            rawContent.publishTime !== undefined ||
            payload.options?.scheduling !== undefined ||
            payload.options?.publishTime !== undefined
        ) {
            return fail(
                BILI_TARGET,
                'unsupported field(s) scheduling/publishTime for bilibili dynamic: this operation does not support scheduled publishing (bilibili.js:158-160)',
            );
        }

        if (payload.content.format !== 'article' && payload.content.format !== 'text') {
            return fail(
                BILI_TARGET,
                `bilibili dynamic requires Content.format 'article' or 'text', got '${bounded(payload.content.format)}'`,
            );
        }

        const body = payload.content.body.trim();
        const imagesResult = await resolveDynamicImages(payload.content.metadata?.images ?? payload.options?.images);
        if (imagesResult.error !== undefined) return fail(BILI_TARGET, imagesResult.error);

        if (body.length === 0 && imagesResult.paths.length === 0) {
            return fail(
                BILI_TARGET,
                'bilibili dynamic requires non-empty Content.body or at least one image in metadata.images',
            );
        }

        const override = typeof payload.options?.profileDir === 'string' ? payload.options.profileDir : undefined;
        const profileDir = resolveChannelProfileDir(BILI_TARGET, override);

        const dynamicConfig = {
            ...BILI_CONFIG,
            homeUrl: BILI_DYNAMIC_HOME_URL,
        };

        const session = await checkChannelSession(dynamicConfig, {
            profileDir,
            launcher: this.launcher,
            headedFallback: false,
            timeoutMs: this.stepTimeoutMs,
        });
        if (session.status !== 'verified') {
            return fail(
                BILI_TARGET,
                `${BILI_TARGET} session preflight refused — run: ${BILI_LOGIN_INSTRUCTION} — detail: ${session.detail}`,
            );
        }

        try {
            return await withProfilePage(
                {
                    profileDir,
                    url: BILI_DYNAMIC_HOME_URL,
                    isAuthenticated: isBilibiliAuthenticated,
                    headless: payload.options?.headless === true,
                    launcher: this.launcher,
                    timeoutMs: this.stepTimeoutMs,
                },
                async ({ page }) => this.runDynamicFlow(page, body, imagesResult.paths, profileDir),
            );
        } catch (error) {
            const detail = errorMessage(error);
            return fail(
                BILI_TARGET,
                needsLogin(error)
                    ? `${BILI_TARGET} session failed — run: ${BILI_LOGIN_INSTRUCTION} — detail: ${detail}`
                    : detail,
            );
        }
    }

    /**
     * Executes the shortVideo flow at member.bilibili.com.
     */
    private async runShortVideoFlow(
        page: Page,
        title: string,
        body: string,
        partition: string,
        tags: readonly string[],
        videoPath: string,
        coverPath: string | undefined,
        publishPublic: boolean,
        profileDir: string,
    ): Promise<Result> {
        const publishStatus = publishPublic ? ('public' as const) : ('draft' as const);
        const metadata: Record<string, unknown> = {
            operation: 'shortVideo',
            driver: this.driver,
            publishStatus,
            profileDir,
            partition,
        };

        // 1. Upload video (bilibili.js:397, 401)
        try {
            const videoInput = await resolveLocator(
                page,
                BILI_VIDEO_SELECTORS.videoInput,
                'bilibili video file input',
                this.stepTimeoutMs,
            );
            await videoInput.locator.setInputFiles(videoPath);
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili video upload failed — ${errorMessage(error)}`,
                'video-upload',
                metadata,
            );
        }

        // 2. Wait for editing form appearance (bilibili.js:431)
        let titleLocator: Locator;
        try {
            const titleResolved = await resolveLocator(
                page,
                BILI_VIDEO_SELECTORS.titleInput,
                'bilibili video title input',
                this.uploadTimeoutMs,
            );
            titleLocator = titleResolved.locator;
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili media processing timed out — editing form did not appear within ${this.uploadTimeoutMs}ms — ${errorMessage(error)}`,
                'media-processing',
                metadata,
            );
        }

        // 3. Fill title (bilibili.js:431-447)
        try {
            await titleLocator.fill(title);
            const readback = await expectOutcome(
                async () => {
                    const val = await titleLocator.inputValue().catch(() => '');
                    return val === title ? 'title read back' : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'bilibili title readback' },
            );
            if (!readback.ok) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili title readback failed — title input did not retain target title — ${readback.error}`,
                    'title-fill',
                    metadata,
                );
            }
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili title fill failed — ${errorMessage(error)}`,
                'title-fill',
                metadata,
            );
        }

        // 4. Fill description if present (bilibili.js:453-463)
        if (body.length > 0) {
            try {
                const descResolved = await resolveLocator(
                    page,
                    BILI_VIDEO_SELECTORS.descriptionEditor,
                    'bilibili description editor',
                    this.stepTimeoutMs,
                );
                const html = sanitizeBilibiliHtml(markdownToHtml(body));
                await pasteRichText(page, descResolved.selector, html, body);
                const readback = await expectOutcome(
                    async () => {
                        const text = await descResolved.locator.innerText().catch(() => '');
                        return normalizeText(text).includes(normalizeText(body)) ? 'description read back' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili description readback' },
                );
                if (!readback.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili description readback failed — editor did not retain content — ${readback.error}`,
                        'description-fill',
                        metadata,
                    );
                }
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili description fill failed — ${errorMessage(error)}`,
                    'description-fill',
                    metadata,
                );
            }
        }

        // 5. Select partition — Provisional: the adapter has no partition control (bilibili.js:571
        // only writes the API field `category`), so a missing chooser is a typed refusal.
        try {
            const partitionResult = (await page.evaluate(`(() => {
                const targetPartition = ${JSON.stringify(partition)};
                const items = Array.from(
                    document.querySelectorAll(
                        'div.select-item, div.category-item, div.drop-cascader-item, div.video-type-item, .select-controller, .partition-item',
                    ),
                );
                const match = items.find((el) => el.textContent && el.textContent.trim().includes(targetPartition));
                if (match) {
                    match.click();
                    return { found: true, text: match.textContent.trim() };
                }
                const spans = Array.from(document.querySelectorAll('.partition-wrp span, .select-box span'));
                const spanMatch = spans.find((el) => el.textContent && el.textContent.trim() === targetPartition);
                if (spanMatch) {
                    spanMatch.click();
                    return { found: true, text: spanMatch.textContent.trim() };
                }
                return { found: false };
            })()`)) as { found: boolean; text?: string };

            const readback = await expectOutcome(
                async () => {
                    const selectedText = String(
                        await page.evaluate(`(() => {
                        const selected = document.querySelector(
                            'div.select-item.selected, div.category-item.active, .drop-cascader-item.active, .select-controller .selected-item',
                        );
                        return selected && selected.textContent ? selected.textContent.trim() : '';
                    })()`),
                    );
                    return selectedText.includes(partition) || partitionResult.found ? 'partition selected' : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'bilibili partition selection' },
            );
            if (!readback.ok && !partitionResult.found) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili partition selection failed — could not find or select partition '${partition}' — ${readback.error}`,
                    'partition-select',
                    metadata,
                );
            }
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili partition select failed — ${errorMessage(error)}`,
                'partition-select',
                metadata,
            );
        }

        // 6. Clean existing tags and fill new tags (fill grounded in bilibili.js:485, 488, 501-507)
        if (tags.length > 0) {
            try {
                // Clean existing tags — the adapter never clears the field, so this removal step is
                // plugin-side (label-item-v2-container, bilibili.js:503).
                await page.evaluate(`(() => {
                    const existTags = document.querySelectorAll('div.tag-pre-wrp > div.label-item-v2-container');
                    for (const tagEl of Array.from(existTags)) {
                        tagEl.click();
                    }
                })()`);

                const tagInputResolved = await resolveLocator(
                    page,
                    BILI_VIDEO_SELECTORS.tagInput,
                    'bilibili tag input',
                    this.stepTimeoutMs,
                );

                for (const tag of tags.slice(0, 10)) {
                    await tagInputResolved.locator.fill(tag);
                    await tagInputResolved.locator.press('Enter');
                }

                const readback = await expectOutcome(
                    async () => {
                        const labels = String(
                            await page.evaluate(`(() => {
                            const els = document.querySelectorAll('div.tag-pre-wrp > div.label-item-v2-container');
                            return Array.from(els)
                                .map((el) => (el.textContent ? el.textContent.trim() : ''))
                                .join(' ');
                        })()`),
                        );
                        return tags.every((t) => labels.includes(t)) ? 'tags read back' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili tags readback' },
                );
                if (!readback.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili tags readback failed — page did not read back all tags — ${readback.error}`,
                        'tags-fill',
                        metadata,
                    );
                }
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili tags fill failed — ${errorMessage(error)}`,
                    'tags-fill',
                    metadata,
                );
            }
        }

        // 7. Click "自制" original radio (bilibili.js:520-521)
        try {
            await page.evaluate(`(() => {
                const radios = document.querySelectorAll('span.check-radio-v2-name');
                for (const radio of Array.from(radios)) {
                    if (radio.textContent && radio.textContent.trim() === '自制') {
                        radio.click();
                    }
                }
            })()`);
        } catch {
            // non-blocking
        }

        // 8. Attach cover if requested (bilibili.js:290-360)
        if (coverPath !== undefined) {
            try {
                await resolveLocator(
                    page,
                    [BILI_VIDEO_SELECTORS.coverMain],
                    'bilibili cover main area',
                    this.stepTimeoutMs,
                );

                const beforePreview = String(
                    await page.evaluate(`(() => {
                    const main = document.querySelector('div.cover-main');
                    const slot = main ? main.querySelector('.cover-slot') : null;
                    const image = slot ? slot.querySelector('.cover-img') : null;
                    const imgEl = image ? image.querySelector('img') : null;
                    return (image && image.style ? image.style.backgroundImage : '') || (imgEl ? imgEl.currentSrc : '') || '';
                })()`),
                );

                const entryClicked = Boolean(
                    await page.evaluate(`(() => {
                    const main = document.querySelector('div.cover-main');
                    if (!main) return false;
                    const spans = Array.from(main.querySelectorAll('span'));
                    const entry = spans.find(
                        (el) =>
                            el.textContent && (
                                el.textContent.includes('更换封面') ||
                                el.textContent.includes('封面设置') ||
                                el.textContent.includes('添加封面')
                            ),
                    );
                    if (entry) {
                        entry.click();
                        return true;
                    }
                    return false;
                })()`),
                );
                if (!entryClicked) {
                    return stageFail(
                        BILI_TARGET,
                        'bilibili cover entry not found (更换封面/封面设置/添加封面, bilibili.js:302-308)',
                        'cover-attach',
                        metadata,
                    );
                }

                const coverInputResolved = await resolveLocator(
                    page,
                    BILI_VIDEO_SELECTORS.coverFileInput,
                    'bilibili cover file input',
                    this.stepTimeoutMs,
                );
                await coverInputResolved.locator.setInputFiles(coverPath);

                const doneBtnOutcome = await expectOutcome(
                    async () => {
                        const res = await page.evaluate(`(() => {
                            const btns = Array.from(document.querySelectorAll('div.submit, button.submit'));
                            const done = btns.find((el) => el.textContent && el.textContent.trim() === '完成');
                            if (done) {
                                done.click();
                                return 'done clicked';
                            }
                            return null;
                        })()`);
                        return res ? 'done clicked' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili cover modal done button' },
                );
                if (!doneBtnOutcome.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili cover modal done button not found (bilibili.js:343-346) — ${doneBtnOutcome.error}`,
                        'cover-attach',
                        metadata,
                    );
                }

                const previewChanged = await expectOutcome(
                    async () => {
                        const currentPreview = String(
                            await page.evaluate(`(() => {
                            const main = document.querySelector('div.cover-main');
                            const slot = main ? main.querySelector('.cover-slot') : null;
                            const image = slot ? slot.querySelector('.cover-img') : null;
                            const imgEl = image ? image.querySelector('img') : null;
                            return (image && image.style ? image.style.backgroundImage : '') || (imgEl ? imgEl.currentSrc : '') || '';
                        })()`),
                        );
                        return currentPreview.length > 0 && currentPreview !== beforePreview ? 'preview changed' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili cover preview changed' },
                );
                if (!previewChanged.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili cover preview did not change after upload (bilibili.js:348-356) — ${previewChanged.error}`,
                        'cover-attach',
                        metadata,
                    );
                }
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili cover attach failed — ${errorMessage(error)}`,
                    'cover-attach',
                    metadata,
                );
            }
        }

        // 9. Draft Save vs Public Submission
        if (publishPublic) {
            try {
                const submitResolved = await resolveLocator(
                    page,
                    BILI_VIDEO_SELECTORS.submitAdd,
                    'bilibili video submit button',
                    this.stepTimeoutMs,
                );
                await submitResolved.locator.click();

                const receiptOutcome = await expectOutcome(
                    async () => {
                        const currentUrl = page.url();
                        for (const re of BILI_RECEIPT_URL_RES) {
                            if (re.test(currentUrl)) return currentUrl;
                        }
                        const pageState = await page.evaluate(`(() => {
                            const successEl = document.querySelector('.submit-success, .upload-success, .success-wrp');
                            if (successEl && successEl.textContent) return successEl.textContent.trim();
                            return null;
                        })()`);
                        return typeof pageState === 'string' ? pageState : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili video submit receipt' },
                );

                if (!receiptOutcome.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili video submission unconfirmed — no receipt URL or success state observed — ${receiptOutcome.error}`,
                        'publish-receipt',
                        metadata,
                    );
                }

                const url =
                    typeof receiptOutcome.evidence === 'string' && receiptOutcome.evidence.startsWith('http')
                        ? receiptOutcome.evidence
                        : undefined;
                const bvMatch = url ? /BV[0-9a-zA-Z]+/.exec(url) : null;
                const bvid = bvMatch ? bvMatch[0] : undefined;

                return ResultSchema.parse({
                    ok: true,
                    target: BILI_TARGET,
                    ...(url ? { url } : {}),
                    metadata: {
                        ...metadata,
                        publishStatus: 'public',
                        status: 'pending-review',
                        stage: 'publish-receipt',
                        ...(bvid ? { bvid } : {}),
                    },
                });
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili video submit failed — ${errorMessage(error)}`,
                    'publish-receipt',
                    metadata,
                );
            }
        }

        // Draft mode requires an observed save control AND a fresh id-bearing draft receipt: a toast
        // or an unchanged URL is not a persisted save (assignment/fill is never success).
        const draftBaselineUrl = page.url();
        try {
            const draftControl = (await page.evaluate(`(() => {
                const candidates = Array.from(document.querySelectorAll('span, button'));
                const saveBtn = candidates.find((el) => {
                    const text = el.textContent ? el.textContent.trim() : '';
                    return text === '存草稿' || text === '保存草稿' || (el.className && String(el.className).includes('submit-draft'));
                });
                if (saveBtn) {
                    saveBtn.click();
                    return { clicked: true };
                }
                return { clicked: false };
            })()`)) as { clicked: boolean };

            if (!draftControl.clicked) {
                return stageFail(
                    BILI_TARGET,
                    'bilibili shortVideo draft save control not found (platform UI missing draft button)',
                    'draft-save',
                    metadata,
                );
            }

            const draftReceipt = await expectOutcome(
                async () => {
                    const currentUrl = page.url();
                    if (currentUrl !== draftBaselineUrl && BILI_RECEIPT_URL_RES.some((re) => re.test(currentUrl))) {
                        return currentUrl;
                    }
                    return null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'bilibili video draft receipt' },
            );

            if (!draftReceipt.ok) {
                return stageFail(
                    BILI_TARGET,
                    'bilibili shortVideo draft unconfirmed — the save control was clicked but no fresh id-bearing draft receipt appeared within 15s; refusing to claim a saved draft (a toast or an unchanged URL is not a persisted draft)',
                    'draft-receipt',
                    metadata,
                );
            }

            return ResultSchema.parse({
                ok: true,
                target: BILI_TARGET,
                url: draftReceipt.evidence as string,
                metadata: {
                    ...metadata,
                    publishStatus: 'draft',
                    stage: 'draft-receipt',
                    receipt: draftReceipt.evidence,
                },
            });
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili draft save failed — ${errorMessage(error)}`,
                'draft-save',
                metadata,
            );
        }
    }

    /**
     * Executes the dynamic post flow at t.bilibili.com.
     */
    private async runDynamicFlow(
        page: Page,
        body: string,
        images: readonly string[],
        profileDir: string,
    ): Promise<Result> {
        const metadata: Record<string, unknown> = {
            operation: 'dynamic',
            driver: this.driver,
            publishStatus: 'public',
            profileDir,
        };

        // 1. Resolve editor inside composer scope (bilibili.js:171, 209, 270-271)
        let editorResolved: { locator: Locator; selector: string };
        try {
            editorResolved = await resolveLocator(
                page,
                BILI_DYNAMIC_SELECTORS.editor,
                'bilibili dynamic editor',
                this.stepTimeoutMs,
            );
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili dynamic editor attach failed — ${errorMessage(error)}`,
                'composer-attach',
                metadata,
            );
        }

        // 2. Remove existing images (bilibili.js:174-184)
        try {
            await page.evaluate(`(() => {
                let n = 20;
                while (n-- > 0) {
                    const removeBtn = document.querySelector('div.bili-pics-uploader__item__remove');
                    if (!removeBtn) break;
                    removeBtn.click();
                }
            })()`);
        } catch {
            // non-blocking
        }

        // 3. Fill text content (bilibili.js:208-223)
        if (body.length > 0) {
            try {
                const html = sanitizeBilibiliHtml(markdownToHtml(body));
                await pasteRichText(page, editorResolved.selector, html, body);
                const readback = await expectOutcome(
                    async () => {
                        const text = await editorResolved.locator.innerText().catch(() => '');
                        return normalizeText(text).includes(normalizeText(body)) ? 'text read back' : null;
                    },
                    { timeoutMs: this.stepTimeoutMs, label: 'bilibili dynamic text readback' },
                );
                if (!readback.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili dynamic text readback failed — editor did not retain content — ${readback.error}`,
                        'text-fill',
                        metadata,
                    );
                }
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili dynamic text fill failed — ${errorMessage(error)}`,
                    'text-fill',
                    metadata,
                );
            }
        }

        // 4. Upload images if requested (bilibili.js:231, 238, 257; the vendor's MAIN-world
        //    message bridge, bilibili-main.js:54-81, is deliberately not reproduced)
        if (images.length > 0) {
            try {
                // Ensure image upload entry is displayed (bilibili.js:231)
                await page.evaluate(`(() => {
                    const imageUploadEntry = document.querySelector('div.bili-dyn-publishing__image-upload');
                    if (imageUploadEntry) imageUploadEntry.style.display = 'block';
                })()`);

                const fileInputResolved = await resolveLocator(
                    page,
                    BILI_DYNAMIC_SELECTORS.imageInput,
                    'bilibili dynamic image file input',
                    this.stepTimeoutMs,
                );
                await fileInputResolved.locator.setInputFiles([...images]);

                const previewReady = await expectOutcome(
                    async () => {
                        const count = Number(
                            await page.evaluate(`(() => {
                            return document.querySelectorAll(
                                '.bili-pics-uploader__item, .bili-dyn-publishing__image-item',
                            ).length;
                        })()`),
                        );
                        return count >= images.length ? `${count} previews ready` : null;
                    },
                    { timeoutMs: 30_000, label: 'bilibili dynamic image previews' },
                );
                if (!previewReady.ok) {
                    return stageFail(
                        BILI_TARGET,
                        `bilibili dynamic image previews did not appear within 30s (bilibili.js:238, 257) — ${previewReady.error}`,
                        'images-upload',
                        metadata,
                    );
                }
            } catch (error) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili dynamic image upload failed — ${errorMessage(error)}`,
                    'images-upload',
                    metadata,
                );
            }
        }

        // 5. Submit dynamic post (bilibili.js:268-285)
        const initialUrl = page.url();
        try {
            const launchResolved = await resolveLocator(
                page,
                BILI_DYNAMIC_SELECTORS.launchButton,
                'bilibili dynamic launch button',
                this.stepTimeoutMs,
            );

            const isDisabled = Boolean(
                await page.evaluate(`(() => {
                const btn = document.querySelector(${JSON.stringify(launchResolved.selector)});
                return Boolean(btn && (btn.disabled || btn.getAttribute('aria-disabled') === 'true'));
            })()`),
            );

            if (isDisabled) {
                return stageFail(
                    BILI_TARGET,
                    'bilibili dynamic launch button is disabled (bilibili.js:281)',
                    'publish-click',
                    metadata,
                );
            }

            // Baseline BEFORE the click: a card or toast already on screen must never confirm a submit
            // (the vendor reads no receipt at all — bilibili.js:552 returns unknown).
            const dynamicBaseline = JSON.parse(
                String(
                    await page.evaluate(`(() => {
                        const patterns = ${JSON.stringify(BILI_RECEIPT_URL_RES.map((re) => ({ source: re.source, flags: re.flags })))};
                        const matches = (href) => patterns.some((p) => new RegExp(p.source, p.flags).test(href));
                        const anchors = Array.from(document.querySelectorAll('a[href]'))
                            .map((a) => a.href)
                            .filter((href) => matches(href));
                        const toast = document.querySelector('.bili-toast, .toast, .bili-dyn-publishing__success');
                        const toastText = toast && toast.textContent ? toast.textContent.trim() : '';
                        return JSON.stringify({
                            anchors,
                            toastVisible: Boolean(toastText) && (toastText.includes('发布成功') || toastText.includes('成功')),
                        });
                    })()`),
                ),
            ) as { anchors: string[]; toastVisible: boolean };

            await launchResolved.locator.click();

            const receiptOutcome = await expectOutcome(
                async () => {
                    const currentUrl = page.url();
                    if (currentUrl !== initialUrl && BILI_RECEIPT_URL_RES.some((re) => re.test(currentUrl))) {
                        return currentUrl;
                    }
                    const fresh = String(
                        await page.evaluate(`(() => {
                        const patterns = ${JSON.stringify(BILI_RECEIPT_URL_RES.map((re) => ({ source: re.source, flags: re.flags })))};
                        const baseline = ${JSON.stringify(dynamicBaseline)};
                        const matches = (href) => patterns.some((p) => new RegExp(p.source, p.flags).test(href));
                        const toast = document.querySelector('.bili-toast, .toast, .bili-dyn-publishing__success');
                        const toastText = toast && toast.textContent ? toast.textContent.trim() : '';
                        const toastVisible = Boolean(toastText) && (toastText.includes('发布成功') || toastText.includes('成功'));
                        if (toastVisible && !baseline.toastVisible) return toastText;
                        const freshLink = Array.from(document.querySelectorAll('a[href]'))
                            .map((a) => a.href)
                            .find((href) => matches(href) && !baseline.anchors.includes(href));
                        return freshLink || '';
                    })()`),
                    );
                    return fresh.length > 0 ? fresh : null;
                },
                { timeoutMs: this.stepTimeoutMs, label: 'bilibili dynamic publish receipt' },
            );

            if (!receiptOutcome.ok) {
                return stageFail(
                    BILI_TARGET,
                    `bilibili dynamic publication unconfirmed — no receipt signal observed — ${receiptOutcome.error}`,
                    'publish-receipt',
                    metadata,
                );
            }

            const url =
                typeof receiptOutcome.evidence === 'string' && receiptOutcome.evidence.startsWith('http')
                    ? receiptOutcome.evidence
                    : undefined;

            return ResultSchema.parse({
                ok: true,
                target: BILI_TARGET,
                ...(url ? { url } : {}),
                metadata: {
                    ...metadata,
                    stage: 'publish-receipt',
                    publishStatus: 'public',
                    ...(receiptOutcome.evidence ? { receipt: receiptOutcome.evidence } : {}),
                },
            });
        } catch (error) {
            return stageFail(
                BILI_TARGET,
                `bilibili dynamic publish failed — ${errorMessage(error)}`,
                'publish-receipt',
                metadata,
            );
        }
    }
}
