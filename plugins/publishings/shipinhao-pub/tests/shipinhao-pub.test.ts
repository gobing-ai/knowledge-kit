/**
 * shipinhao-pub offline unit suite (0296; four operations since 2026-11-10) — mirrors the
 * xiaoyuzhou-pub unit suite (0295) layer by layer, adapted to the shipinhao (channels.weixin.qq.com)
 * post flow contract (shortVideo 视频, audio 音频, music 音乐, image 图文).
 *
 * Eight describes:
 *   1. Declared surface — selector table, constants, config, operations, manifest,
 *      fake-vs-real transport, session predicate, profile CLI source text.
 *   2. Pre-browser refusals — the full ladder, with zero browser launches.
 *   3. Sanitizer chain — direct strip/survive checks plus the exact HTML captured at paste.
 *   4. Payload/IO + main() exit semantics — offline, using the real FS in a temp dir.
 *   5. Session preflight — login redirect, missing profile, mid-flow expiry.
 *   6. Flow stages — the REAL `page.evaluate` scripts from src/flow.ts executed against an
 *      in-memory fake page (upload, title, paste readback, original, cover, submit rail,
 *      fresh-receipt confirmation, typed stage failures).
 *   7. Source hygiene — no eval/fs/network; paste via page.evaluate; setInputFiles media;
 *      typed root-resolve wrappers; Provisional labels.
 *   8. Environment restoration.
 *
 * Deterministic + offline: no network, no browser, no production-budget waits — typed failures
 * are asserted directly and the flow's step timeout is injected at 250ms (the one slow arm, the
 * 15s readiness poll, is labeled with its own timeout).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ContentSchema, type Result, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { markdownToHtml } from '@gobing-ai/publish-harness/browser';
import {
    type BrowserContext,
    type BrowserLauncher,
    BrowserProfileMissingError,
    type Page,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { buildAudioDescription, clipAudioTitle } from '../src/audio-flow';
import {
    buildShipinhaoDescription,
    SHP_LOGIN_INSTRUCTION,
    ShipinhaoBrowserTransport,
    sanitizeShipinhaoHtml,
    stageFail,
} from '../src/flow';
import { getPublishTransport, main, processPublishIO, resolveOperation, SHP_OPERATIONS } from '../src/index';
import {
    isShipinhaoAuthenticated,
    readRootSnapshot,
    SHP_AUDIO_SELECTORS,
    SHP_CONFIG,
    SHP_COVER_PREVIEW_WAIT_MS,
    SHP_COVER_SAVE_WAIT_MS,
    SHP_CREATE_ENTRY_SELECTORS,
    SHP_DESCRIPTION_MAX_CHARS,
    SHP_FORM_WAIT_MS,
    SHP_HOME_URL,
    SHP_HOME_URL_BY_OPERATION,
    SHP_IMAGE_SELECTORS,
    SHP_LOGIN_TIMEOUT_MS,
    SHP_LOGIN_URL_RE,
    SHP_MUSIC_SELECTORS,
    SHP_PROCESSING_WAIT_MS,
    SHP_RECEIPT_URL_RES,
    SHP_ROOT_WAIT_MS,
    SHP_TARGET,
    SHP_UPLOAD_TIMEOUT_MS,
    SHP_VIDEO_SELECTORS,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-shipinhao-pub-main');
const VIDEO_PATH = join(TMP_DIR, 'video.mp4');
const AUDIO_PATH = join(TMP_DIR, 'episode.mp3');
const IMAGE_PATHS = [join(TMP_DIR, 'card-1.jpg'), join(TMP_DIR, 'card-2.webp')];
const COVER_PATH = join(TMP_DIR, 'cover.png');
const BIG_PATH = join(TMP_DIR, 'big.mp4');
const PROFILE_OVERRIDE_DIR = join(TMP_DIR, 'profile-flag-override');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'shipinhao');
const SIGNIN_URL = 'https://open.weixin.qq.com/connect/qrconnect?appid=fixture';
const DRAFT_URL = 'https://channels.weixin.qq.com/platform/record/detail/shp26001';
const SECOND_DRAFT_URL = 'https://channels.weixin.qq.com/platform/record/detail/shp26002';
const PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/video/pub0777';

const { videoInput, titleInput, descriptionEditor, saveButton, publishButton, coverDialog, createEntry } =
    SHP_VIDEO_SELECTORS;
const VIDEO_INPUT = videoInput[0];
const AUDIO_INPUT = SHP_AUDIO_SELECTORS.audioInput[0];
const IMAGES_INPUT = SHP_IMAGE_SELECTORS.imagesInput[0];
const TITLE_INPUT = titleInput[0];
const EDITOR = descriptionEditor[0];
const SAVE = saveButton[0];
const PUBLISH = publishButton[0];
const COVER_DIALOG = coverDialog[0];
/** Every operation's media file-input ladder — the fake counts all of them the same way. */
const MEDIA_INPUT_LADDER: readonly string[] = [
    ...videoInput,
    ...SHP_AUDIO_SELECTORS.audioInput,
    ...SHP_IMAGE_SELECTORS.imagesInput,
];

/** Original env, captured before any beforeEach mutates it (restored by describe 8). */
const originalChannelDir = process.env.SHP_PROFILE_DIR;
const originalSharedDir = process.env.KK_BROWSER_PROFILE_DIR;
const originalFake = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;

/** Whitespace-insensitive comparison — mirrors the flow's `normalizeText` exactly. */
const normalizeText = (text: string): string => text.replace(/\s+/g, '');

/** First embedded JSON string literal in an `evaluate` expression (0295 helper). */
const jsonArg = (expression: string, anchor: RegExp): string | null => {
    const match = anchor.exec(expression);
    return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
};

const draftContent = (
    metadata: Record<string, unknown> = {},
    overrides: Partial<Pick<Content, 'title' | 'body' | 'format'>> = {},
): Content =>
    ContentSchema.parse({
        title: overrides.title ?? 'Fixture 短标题',
        body: overrides.body ?? 'Fixture 描述正文。',
        format: overrides.format ?? 'video',
        metadata,
    });

interface FakePageOptions {
    /** Root layout: shadow-DOM `wujie-app` host or `direct` document inputs. */
    root?: 'wujie' | 'direct' | 'late';
    groundedMissing?: boolean;
    landedUrl?: string;
    missingVideoInput?: boolean;
    uploadThrows?: boolean;
    missingTitleInput?: boolean;
    titleReadbackDrops?: boolean;
    missingEditor?: boolean;
    pasteReportsMissing?: boolean;
    bodyReadbackDrops?: boolean;
    originalFlow?: boolean;
    originalEntryMissing?: boolean;
    originalEntryAmbiguous?: boolean;
    originalAgreementMissing?: boolean;
    originalConfirmAmbiguous?: boolean;
    coverSlotMissing?: boolean;
    coverDialogNever?: boolean;
    coverDialogNoFileInput?: boolean;
    coverConfirmMissing?: boolean;
    submitMissing?: boolean;
    submitInvisible?: boolean;
    submitNeverEnabled?: boolean;
    onSaveClick?: 'draftReceipt' | 'none' | 'twoIds';
    /** The 定时发表 draft-save confirm dialog (保存/不保存) appears after the 保存草稿 click. */
    draftConfirmDialog?: boolean;
    existingReceiptUrl?: string;
    /** Toast text present on the page — must never rescue a publish (this flow reads no toasts). */
    existingToasts?: string[];
    persistedStateDrifts?: boolean;
}

interface FakePageShared {
    calls: string[];
    originalityQueries: number;
    coverQueries: number;
}

/**
 * Builds the fake `Page` used by every flow test. The evaluate handler implements the exact
 * script contracts src/flow.ts sends (same markers, same JSON reply shapes), so the REAL scripts
 * in src/flow.ts are what actually execute; only the DOM behind them is faked.
 */
const makeFakePage = (shared: FakePageShared, options: FakePageOptions): Page => {
    let rootReads = 0;
    let url = 'about:blank';
    let mediaAssigned = false;
    // Dashboard → create-surface model (recon-Grounded 2026-11-11): the flow lands on the
    // dashboard (no file input), clicks 发表视频, and only then does the media file input exist.
    let createOpened = false;
    let titleValue = '';
    let editorHtml = '';
    let coverDescriptor = 'base';
    let coverDialogOpen = false;
    let draftConfirmOpen = false;
    let originalEntryChecked = false;
    let originalAgreementChecked = false;
    let originalWrapperPresent = false;
    const baselineAnchors: string[] = [];
    const freshAnchors: string[] = [];
    if (options.existingReceiptUrl !== undefined) baselineAnchors.push(options.existingReceiptUrl);
    if (options.existingToasts !== undefined) baselineAnchors.push(...options.existingToasts);

    const baseSelector = (selector: string): string =>
        selector.startsWith('wujie-app ') ? selector.slice('wujie-app '.length) : selector;

    const countOf = (selector: string): number => {
        const base = baseSelector(selector);
        if (base === 'wujie-app') return options.groundedMissing ? 0 : 1;
        if (createEntry.includes(base)) return 1;
        if (MEDIA_INPUT_LADDER.includes(base)) return createOpened && !options.missingVideoInput ? 1 : 0;
        if (titleInput.includes(base)) return mediaAssigned && !options.missingTitleInput ? 1 : 0;
        if (descriptionEditor.includes(base)) return mediaAssigned && !options.missingEditor ? 1 : 0;
        if (saveButton.includes(base) || publishButton.includes(base)) return options.submitMissing ? 0 : 1;
        if (base === `${COVER_DIALOG} input[type="file"]`)
            return coverDialogOpen && !options.coverDialogNoFileInput ? 1 : 0;
        return 0;
    };

    const visibleOf = (selector: string): boolean => {
        const base = baseSelector(selector);
        if ((saveButton.includes(base) || publishButton.includes(base)) && options.submitInvisible) return false;
        return true;
    };

    const page = {
        url: () => url,
        goto: async (target: string) => {
            url = options.landedUrl ?? target;
        },
        close: async () => undefined,
        evaluate: async (expression: string): Promise<unknown> => {
            shared.calls.push(`evaluate:${expression.slice(0, 44).replace(/\n/g, ' ')}`);
            if (expression.includes('kk-shp-root-snapshot')) {
                rootReads += 1;
                if (options.groundedMissing)
                    return JSON.stringify({
                        wujiePresent: false,
                        shadowRootReady: false,
                        directFileInputs: 0,
                        directTextEvidence: 0,
                        shadowFileInputs: 0,
                        shadowTextEvidence: 0,
                    });
                const mode = options.root ?? 'wujie';
                if (mode === 'direct')
                    return JSON.stringify({
                        wujiePresent: false,
                        shadowRootReady: false,
                        directFileInputs: createOpened ? 1 : 0,
                        directTextEvidence: 2,
                        shadowFileInputs: 0,
                        shadowTextEvidence: 0,
                    });
                const ready = mode !== 'late' || rootReads >= 2;
                return JSON.stringify({
                    wujiePresent: true,
                    shadowRootReady: ready,
                    directFileInputs: 0,
                    directTextEvidence: 0,
                    shadowFileInputs: createOpened ? 1 : 0,
                    shadowTextEvidence: 2,
                });
            }
            if (expression.includes('kk-shp-receipt-urls')) {
                const urls: string[] = [];
                if (receiptShaped(url)) urls.push(url);
                for (const anchor of [...baselineAnchors, ...freshAnchors])
                    if (receiptShaped(anchor) && !urls.includes(anchor)) urls.push(anchor);
                return JSON.stringify(urls);
            }
            if (expression.includes('coverUnknown')) {
                // Persisted-state verify: mirror the real comparison (norm(text) === norm(html text)).
                const wantedTitle = jsonArg(expression, /norm\(("(?:[^"\\]|\\.)*")\)/) ?? '';
                const wantedHtml = jsonArg(expression, /probe\.innerHTML = ("(?:[^"\\]|\\.)*");/) ?? '';
                const healthy = options.persistedStateDrifts !== true;
                const editorText = editorHtml.replace(/<[^>]*>/g, '');
                const wantedText = wantedHtml.replace(/<[^>]*>/g, '');
                return JSON.stringify({
                    titleOk: healthy && normalizeText(titleValue) === normalizeText(wantedTitle),
                    editorOk: healthy && normalizeText(editorText) === normalizeText(wantedText),
                    originalOk: originalWrapperPresent === false,
                    coverUnknown: false,
                });
            }
            if (expression.includes('{ ready:'))
                return JSON.stringify({ ready: mediaAssigned && !options.missingTitleInput });
            if (expression.includes("String(el.value ?? '')")) return titleValue;
            if (expression.includes("String(el.innerText ?? el.textContent ?? '')"))
                return options.bodyReadbackDrops ? '' : editorHtml.replace(/<[^>]*>/g, ' ');
            if (expression.includes("ClipboardEvent('paste'")) {
                if (options.pasteReportsMissing) return 'missing';
                const html = jsonArg(expression, /data\.setData\('text\/html', ("(?:[^"\\]|\\.)*")\)/) ?? '';
                const mode = expression.includes("querySelector('wujie-app')") ? 'wujie' : 'direct';
                shared.calls.push(`paste:${mode}|${html}`);
                editorHtml = html;
                return 'pasted';
            }
            if (expression.includes('const scored')) {
                shared.originalityQueries += 1;
                if (options.originalEntryMissing || !options.originalFlow)
                    return JSON.stringify({ ok: false, reason: 'missing' });
                if (options.originalEntryAmbiguous) return JSON.stringify({ ok: false, reason: 'ambiguous', count: 2 });
                if (/if \(true && !checked\)/.test(expression)) {
                    originalEntryChecked = true;
                    return JSON.stringify({ ok: true, checked: true, clicked: true });
                }
                return JSON.stringify({ ok: true, checked: originalEntryChecked, clicked: false });
            }
            if (expression.includes('ant-checkbox-input')) {
                shared.originalityQueries += 1;
                if (options.originalAgreementMissing) return JSON.stringify({ ok: false, reason: 'missing' });
                if (/if \(true && !checked\)/.test(expression)) {
                    originalAgreementChecked = true;
                    originalWrapperPresent = true;
                    return JSON.stringify({ ok: true, checked: true, clicked: true });
                }
                return JSON.stringify({ ok: true, checked: originalAgreementChecked, clicked: false });
            }
            if (expression.includes('=== "声明原创"')) {
                shared.originalityQueries += 1;
                if (options.originalConfirmAmbiguous)
                    return JSON.stringify({ ok: false, reason: 'ambiguous', count: 2 });
                originalWrapperPresent = false;
                return JSON.stringify({ ok: true });
            }
            if (expression.includes('{ closed:')) return JSON.stringify({ closed: !originalWrapperPresent });
            if (expression.includes('getAttributeNames')) {
                shared.coverQueries += 1;
                if (options.coverSlotMissing) return JSON.stringify({ found: false });
                return JSON.stringify({ found: true, descriptor: coverDescriptor });
            }
            if (expression.includes('entry.click()')) {
                shared.coverQueries += 1;
                if (options.coverSlotMissing || options.coverDialogNever)
                    return JSON.stringify({ ok: false, reason: 'missing' });
                coverDialogOpen = true;
                shared.calls.push('cover:entry');
                return JSON.stringify({ ok: true });
            }
            if (expression.includes('hasFileInput')) {
                shared.coverQueries += 1;
                if (!coverDialogOpen) return JSON.stringify({ found: false });
                return JSON.stringify({
                    found: true,
                    selector: COVER_DIALOG,
                    hasFileInput: options.coverDialogNoFileInput !== true,
                });
            }
            if (expression.includes("reason: 'missing-control'")) {
                shared.coverQueries += 1;
                if (options.coverConfirmMissing) return JSON.stringify({ ok: false, reason: 'missing-confirm' });
                coverDialogOpen = false;
                coverDescriptor = 'committed:1|/cover/committed.png';
                shared.calls.push('cover:confirm');
                return JSON.stringify({ ok: true });
            }
            if (expression.includes('kk-shp-draft-confirm')) {
                if (options.draftConfirmDialog !== true || draftConfirmOpen === false)
                    return JSON.stringify({ ok: false, reason: 'absent' });
                draftConfirmOpen = false; // one-shot: clicking 保存 closes the dialog
                shared.calls.push('draft:confirm');
                return JSON.stringify({ ok: true });
            }
            return '';
        },
        locator: (selector: string) => {
            const leaf = {
                first: () => leaf,
                locator: (sub: string) => page.locator(`${selector} ${sub}`),
                count: async () => countOf(selector),
                isVisible: async () => visibleOf(selector),
                isEnabled: async () => options.submitNeverEnabled !== true,
                fill: async (text: string) => {
                    shared.calls.push(`fill:${selector}|${text}`);
                    if (titleInput.includes(baseSelector(selector)) && !options.titleReadbackDrops) titleValue = text;
                },
                click: async () => {
                    const base = baseSelector(selector);
                    shared.calls.push(`click:${selector}`);
                    if (createEntry.includes(base)) {
                        createOpened = true;
                        shared.calls.push('entry:open');
                    }
                    if (publishButton.includes(base)) url = PUBLISH_URL;
                    if (saveButton.includes(base)) {
                        if (options.onSaveClick === 'draftReceipt') url = DRAFT_URL;
                        if (options.onSaveClick === 'twoIds') freshAnchors.push(DRAFT_URL, SECOND_DRAFT_URL);
                        if (options.draftConfirmDialog === true) draftConfirmOpen = true;
                    }
                },
                setInputFiles: async (files: string | readonly string[]) => {
                    if (options.uploadThrows) throw new Error('detached during upload');
                    shared.calls.push(`setInputFiles:${selector}|${String(files)}`);
                    const base = baseSelector(selector);
                    if (MEDIA_INPUT_LADDER.includes(base)) mediaAssigned = true;
                    if (base === `${COVER_DIALOG} input[type="file"]`) shared.calls.push('cover:attach');
                },
            };
            return leaf;
        },
    };
    return page as unknown as Page;
};

const receiptShaped = (url: string): boolean => SHP_RECEIPT_URL_RES.some((re) => re.test(url));

type FakeLauncherOptions = FakePageOptions & {
    error?: (request: ProfileLaunchRequest) => Error;
    /** Launch 1 (the headless preflight) stays grounded; every later launch loses the session. */
    expireAfterPreflight?: boolean;
};

/** Fake `BrowserLauncher`: records every launch request and hands out fake pages. */
const makeFakeLauncher = (options: FakeLauncherOptions = {}) => {
    const shared: FakePageShared = { calls: [], originalityQueries: 0, coverQueries: 0 };
    const requests: ProfileLaunchRequest[] = [];
    let closeCount = 0;
    let launchCount = 0;
    const launcher: BrowserLauncher = {
        async launch(request: ProfileLaunchRequest): Promise<BrowserContext> {
            requests.push(request);
            launchCount += 1;
            if (options.error) throw options.error(request);
            let pageOptions: FakePageOptions = options;
            if (launchCount === 1 && options.root === 'late') pageOptions = { ...options, root: 'wujie' };
            if (options.expireAfterPreflight === true && launchCount >= 2)
                pageOptions = { ...options, groundedMissing: true, landedUrl: SIGNIN_URL };
            const page = makeFakePage(shared, pageOptions);
            return {
                pages: () => [page],
                newPage: async () => page,
                close: async () => {
                    closeCount += 1;
                },
            } as unknown as BrowserContext;
        },
    };
    return { launcher, requests, calls: shared.calls, close: () => closeCount, shared };
};

/** Shipinhao transport wired to the fake launcher with a fast injected step timeout. */
const transport = (
    fake: ReturnType<typeof makeFakeLauncher>,
    driver: 'script' | 'agent' = 'script',
    operation: 'shortVideo' | 'audio' | 'music' | 'image' = 'shortVideo',
): ShipinhaoBrowserTransport =>
    new ShipinhaoBrowserTransport(operation, driver, {
        launcher: fake.launcher,
        stepTimeoutMs: 250,
        preflightTimeoutMs: 250,
    });

/** Fails unless the comment block directly above `anchor` carries the Provisional label. */
const expectProvisionalLabel = (source: string, anchor: string): void => {
    const head = source.slice(0, Math.max(0, source.indexOf(anchor)));
    const end = head.lastIndexOf('*/');
    expect(end).toBeGreaterThan(0);
    const block = head.slice(head.lastIndexOf('/**', end), end);
    expect(block).toContain('Provisional');
};

/** Fails unless the comment block directly above `anchor` is Grounded (never provisional). */
const expectGroundedLabel = (source: string, anchor: string): void => {
    const head = source.slice(0, Math.max(0, source.indexOf(anchor)));
    const end = head.lastIndexOf('*/');
    expect(end).toBeGreaterThan(0);
    const block = head.slice(head.lastIndexOf('/**', end), end);
    expect(block).toContain('Grounded');
    expect(block).not.toContain('Provisional');
};

beforeEach(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(VIDEO_PATH, 'fake-mp4-bytes-for-flow-tests');
    await writeFile(AUDIO_PATH, 'fake-mp3-bytes-for-flow-tests');
    await writeFile(IMAGE_PATHS[0] as string, 'fake-jpg-bytes-for-flow-tests');
    await writeFile(IMAGE_PATHS[1] as string, 'fake-webp-bytes-for-flow-tests');
    await writeFile(COVER_PATH, 'fake-png-bytes-for-flow-tests');
    delete process.env.SHP_PROFILE_DIR;
    delete process.env.KK_BROWSER_PROFILE_DIR;
    delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
});

afterEach(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});

describe('1. declared surface (selectors, constants, config, operations, manifest)', () => {
    test('selector table keys and pinned leading candidates', () => {
        expect(Object.keys(SHP_VIDEO_SELECTORS).sort()).toEqual(
            [
                'collectionEntry',
                'collectionLabel',
                'coverConfirmFooter',
                'coverConfirmLabels',
                'coverDialog',
                'coverDialogFileInputSuffix',
                'coverEditEntry',
                'createEntry',
                'descriptionEditor',
                'originalAgreementCheckbox',
                'originalConfirmLabel',
                'publishButton',
                'saveButton',
                'titleInput',
                'videoInput',
            ].sort(),
        );
        expect(VIDEO_INPUT).toBe('input[type="file"][accept*="video"]');
        expect(videoInput.at(-1)).toBe('input[type="file"]');
        expect(TITLE_INPUT).toBe('input[placeholder*="短标题"]');
        expect(EDITOR).toBe('[data-placeholder^="添加描述"]');
        expect(SAVE).toBe('button:text-is("保存草稿")');
        expect(PUBLISH).toBe('button:text-is("发表")');
        expect(COVER_DIALOG).toBe('div.cover-control-wrap');
        expect(SHP_VIDEO_SELECTORS.coverDialogFileInputSuffix).toBe('input[type="file"]');
        expect(SHP_VIDEO_SELECTORS.originalAgreementCheckbox).toBe(
            'div.declare-body-wrapper input[type="checkbox"].ant-checkbox-input',
        );
        expect(SHP_VIDEO_SELECTORS.originalConfirmLabel).toBe('声明原创');
        expect(SHP_VIDEO_SELECTORS.coverEditEntry.length).toBeGreaterThan(0);
        expect(SHP_VIDEO_SELECTORS.coverConfirmFooter.length).toBeGreaterThan(0);
        expect(SHP_VIDEO_SELECTORS.coverConfirmLabels).toHaveLength(5);
    });

    test('URL / regex / timeout constants match the vendor surface contract', () => {
        expect(SHP_TARGET).toBe('shipinhao');
        expect(SHP_HOME_URL).toBe('https://channels.weixin.qq.com/platform');
        expect(SHP_CREATE_ENTRY_SELECTORS).toEqual(['button:text-is("发表视频")']);
        expect(SHP_DESCRIPTION_MAX_CHARS).toBe(100);
        expect(SHP_LOGIN_URL_RE.source).toContain('open\\.weixin\\.qq\\.com');
        expect(SHP_LOGIN_URL_RE.test(SIGNIN_URL)).toBe(true);
        expect(SHP_LOGIN_URL_RE.test(SHP_HOME_URL)).toBe(false);
        for (const re of SHP_RECEIPT_URL_RES) expect(re.source).toContain('channels\\.weixin\\.qq\\.com');
        expect(SHP_RECEIPT_URL_RES.some((re) => re.test(DRAFT_URL))).toBe(true);
        expect(SHP_RECEIPT_URL_RES.some((re) => re.test(PUBLISH_URL))).toBe(true);
        expect(SHP_RECEIPT_URL_RES.some((re) => re.test(SHP_HOME_URL))).toBe(false);
        expect(SHP_UPLOAD_TIMEOUT_MS).toBe(600_000);
        expect(SHP_PROCESSING_WAIT_MS).toBe(120_000);
        expect(SHP_FORM_WAIT_MS).toBe(90_000);
        expect(SHP_ROOT_WAIT_MS).toBe(30_000);
        expect(SHP_LOGIN_TIMEOUT_MS).toBe(180_000);
        expect(SHP_COVER_PREVIEW_WAIT_MS).toBe(30_000);
        expect(SHP_COVER_SAVE_WAIT_MS).toBe(60_000);
        expect(SHP_LOGIN_INSTRUCTION).toContain('profile-check.ts');
        expect(SHP_LOGIN_INSTRUCTION.toLowerCase()).toContain('shipinhao');
    });

    test('SHP_CONFIG wires the channel, home URL, predicate, and headed login policy', () => {
        expect(SHP_CONFIG.channel).toBe('shipinhao');
        expect(SHP_CONFIG.homeUrl).toBe(SHP_HOME_URL);
        expect(SHP_CONFIG.loginTimeoutMs).toBe(SHP_LOGIN_TIMEOUT_MS);
        expect(SHP_CONFIG.checkHeadedOnly).toBe(false);
        expect(SHP_CONFIG.isAuthenticated).toBe(isShipinhaoAuthenticated);
    });

    test('operations table and resolveOperation precedence/unknown handling', () => {
        expect([...SHP_OPERATIONS]).toEqual(['shortVideo', 'audio', 'image', 'music']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'shortVideo' });
        expect(resolveOperation({ operation: 'shortVideo' }, undefined).operation).toBe('shortVideo');
        expect(resolveOperation({ operation: 'audio' }, undefined).operation).toBe('audio');
        expect(resolveOperation(undefined, draftContent({ operation: 'image' })).operation).toBe('image');
        expect(resolveOperation({ operation: 'music' }, undefined).operation).toBe('music');
        expect(resolveOperation(undefined, draftContent({ operation: 'shortVideo' })).operation).toBe('shortVideo');
        // options.operation wins over content.metadata.operation.
        expect(resolveOperation({ operation: 'shortVideo' }, draftContent({ operation: 'article' })).operation).toBe(
            'shortVideo',
        );
        expect(resolveOperation({ operation: 'podcast' }, undefined).error).toContain(
            "unsupported operation 'podcast' for shipinhao: expected one of shortVideo, audio, image, music",
        );
        expect(resolveOperation(undefined, draftContent({ operation: 'article' })).error).toContain(
            "unsupported operation 'article' for shipinhao",
        );
        expect(resolveOperation({ operation: 'article' }, draftContent({ operation: 'shortVideo' })).error).toContain(
            "unsupported operation 'article' for shipinhao",
        );
    });

    test('per-operation selector tables and home URLs (four post kinds)', () => {
        // The per-op tables reuse the video rails verbatim (spread) plus their own input ladder;
        // the flow reads only the per-op ladder key.
        expect(Object.keys(SHP_AUDIO_SELECTORS).sort()).toEqual(
            [...Object.keys(SHP_VIDEO_SELECTORS), 'audioInput'].sort(),
        );
        expect(SHP_AUDIO_SELECTORS.audioInput).toEqual(['input[type="file"][accept*="video"]', 'input[type="file"]']);
        expect(Object.keys(SHP_MUSIC_SELECTORS)).toEqual(Object.keys(SHP_AUDIO_SELECTORS));
        expect(Object.keys(SHP_IMAGE_SELECTORS).sort()).toEqual(
            [...Object.keys(SHP_VIDEO_SELECTORS), 'imagesInput'].sort(),
        );
        expect(SHP_IMAGE_SELECTORS.imagesInput[0]).toBe('input[type="file"][multiple]');
        expect(SHP_HOME_URL_BY_OPERATION).toEqual({
            shortVideo: SHP_HOME_URL,
            audio: SHP_HOME_URL,
            image: SHP_HOME_URL,
            music: SHP_HOME_URL,
        });
    });

    test('plugin.json manifest declares the shipinhao browser session and packed entry/check', async () => {
        const manifest = JSON.parse(await readFile(join(import.meta.dir, '..', 'plugin.json'), 'utf8')) as Record<
            string,
            unknown
        >;
        expect(manifest.name).toBe('shipinhao-pub');
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        const session = manifest.browserSession as Record<string, unknown>;
        expect(session.profileName).toBe('shipinhao');
        expect(session.homeUrl).toBe(SHP_HOME_URL);
        expect(await Bun.file(join(import.meta.dir, '..', 'src', 'index.ts')).exists()).toBe(true);
        expect(await Bun.file(join(import.meta.dir, '..', 'src', 'profile-check.ts')).exists()).toBe(true);
    });

    test('KNOWLEDGE_KIT_PUBLISH_TRANSPORT=fake selects the offline fake; the default is the real transport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport();
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect((fake as FakeBrowserTransport).driver).toBe('script');
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        const real = getPublishTransport();
        expect(real).toBeInstanceOf(ShipinhaoBrowserTransport);
        expect((real as ShipinhaoBrowserTransport).driver).toBe('script');
    });

    test('the readiness predicate passes only on grounded creator-form evidence, never on a login redirect', async () => {
        const ready = makeFakePage({ calls: [], originalityQueries: 0, coverQueries: 0 }, {});
        await ready.goto(SHP_HOME_URL);
        expect(await isShipinhaoAuthenticated(ready)).toBe(true);
        // A login/passport redirect refuses immediately — the regex gate runs before the poll.
        const signin = makeFakePage(
            { calls: [], originalityQueries: 0, coverQueries: 0 },
            { groundedMissing: true, landedUrl: SIGNIN_URL },
        );
        await signin.goto(SHP_HOME_URL);
        expect(await isShipinhaoAuthenticated(signin)).toBe(false);
    });

    test('an evidence-less page refuses after the production 15s readiness poll', async () => {
        const loggedOut = makeFakePage(
            { calls: [], originalityQueries: 0, coverQueries: 0 },
            { groundedMissing: true },
        );
        await loggedOut.goto(SHP_HOME_URL);
        expect(await isShipinhaoAuthenticated(loggedOut)).toBe(false);
    }, 30_000);

    test('readRootSnapshot degrades evaluate failures to a zeroed snapshot', async () => {
        const snapshot = await readRootSnapshot({
            evaluate: async () => {
                throw new Error('navigation raced the probe');
            },
        });
        expect(snapshot).toEqual({
            wujiePresent: false,
            shadowRootReady: false,
            directFileInputs: 0,
            directTextEvidence: 0,
            shadowFileInputs: 0,
            shadowTextEvidence: 0,
        });
    });

    test('profile-check.ts is a pure profile CLI shim over runProfileCli(SHP_CONFIG) (source text, never imported)', async () => {
        const source = await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'), 'utf8');
        expect(source).toContain('if (import.meta.main)');
        expect(source).toContain('process.exit(await runProfileCli(SHP_CONFIG, Bun.argv.slice(2)))');
        expect(source).not.toContain('kkBrowserLauncher');
    });
});

describe('2. pre-browser refusals (zero browser launches)', () => {
    test('a non-script transport driver refuses before any browser work', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'agent').publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            "unsupported driver 'agent' for shipinhao: expected one of script (the shipinhao-pub browser flow has no agent path)",
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('an unknown publishStatus refuses before any browser work', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, publishStatus: 'scheduled' }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            "unknown publishStatus 'scheduled' for shipinhao: expected 'draft', 'public' or absent (absent defaults to draft)",
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('a non-video Content.format refuses before any browser work', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH }, { format: 'audio' }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("requires Content.format 'video', got 'audio'");
        expect(fake.requests).toHaveLength(0);
    });

    test.each([
        ['empty title', { title: '   ' }, /requires a non-empty Content\.title/],
        ['empty body', { body: '   ' }, /requires non-empty Content\.body Markdown/],
    ])('%s refuses before any browser work', async (_name, overrides, pattern) => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH }, overrides),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(pattern);
        expect(fake.requests).toHaveLength(0);
    });

    test('videoPath refusals: missing, non-string, nonexistent, empty file', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake);
        const publish = (metadata: Record<string, unknown>) => t.publish({ content: draftContent(metadata) });

        expect((await publish({})).error).toContain('metadata.videoPath must be a non-empty local video file path');
        expect((await publish({ videoPath: 42 })).error).toContain(
            'metadata.videoPath must be a non-empty local video file path',
        );
        expect((await publish({ videoPath: join(TMP_DIR, 'nope.mp4') })).error).toContain(
            'metadata.videoPath does not resolve to a readable nonempty local video file',
        );
        await writeFile(VIDEO_PATH, '');
        expect((await publish({ videoPath: VIDEO_PATH })).error).toContain(
            'metadata.videoPath does not resolve to a readable nonempty local video file',
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('videoPath refusals: only MP4/MOV extensions are accepted', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake);
        const avi = await t.publish({ content: draftContent({ videoPath: join(TMP_DIR, 'clip.avi') }) });
        expect(avi.error).toContain('metadata.videoPath must be a local MP4/MOV file');
        expect(avi.error).toContain('unsupported extension in');
        const noExt = await t.publish({ content: draftContent({ videoPath: join(TMP_DIR, 'clip') }) });
        expect(noExt.error).toContain('metadata.videoPath must be a local MP4/MOV file');
        expect(fake.requests).toHaveLength(0);
    });

    test('videoPath refusals: the 2 GiB local-file cap is enforced (sparse file, no real write)', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake);
        await writeFile(BIG_PATH, 'hdr');
        await truncate(BIG_PATH, 2 * 1024 * 1024 * 1024 + 1);
        try {
            const result = await t.publish({ content: draftContent({ videoPath: BIG_PATH }) });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('metadata.videoPath exceeds the KK v1 local video cap of 2 GiB');
            expect(fake.requests).toHaveLength(0);
        } finally {
            await rm(BIG_PATH, { force: true });
        }
    });

    test('coverPath refusals: wrong extension, missing, empty, non-string — never a silent skip', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake);
        const publish = (metadata: Record<string, unknown>) =>
            t.publish({ content: draftContent({ videoPath: VIDEO_PATH, ...metadata }) });

        const gif = await publish({ coverPath: join(TMP_DIR, 'cover.gif') });
        expect(gif.error).toContain('metadata.coverPath must be a local PNG/JPEG/WebP file');
        const missing = await publish({ coverPath: join(TMP_DIR, 'nope.png') });
        expect(missing.error).toContain(
            'metadata.coverPath does not resolve to a readable nonempty local file (refusing, never a silent skip)',
        );
        await writeFile(COVER_PATH, '');
        expect((await publish({ coverPath: COVER_PATH })).error).toContain(
            'metadata.coverPath does not resolve to a readable nonempty local file',
        );
        expect((await publish({ coverPath: 42 })).error).toContain(
            'metadata.coverPath must be a non-empty local file path when present',
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('tags refusals: non-array, empty entry, non-string entry', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake);
        const publish = (options: Record<string, unknown>) =>
            t.publish({ content: draftContent({ videoPath: VIDEO_PATH }), options });

        expect((await publish({ tags: 'rock' })).error).toContain(
            'metadata.tags must be an array of nonempty topic strings',
        );
        expect((await publish({ tags: ['ok', '  '] })).error).toContain(
            'metadata.tags must contain only nonempty topic strings',
        );
        expect((await publish({ tags: [42] })).error).toContain(
            'metadata.tags must contain only nonempty topic strings',
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('original refusals: only booleans are accepted', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: 'yes' }),
        });
        expect(result.error).toContain('metadata.original must be a boolean when present');
        expect(fake.requests).toHaveLength(0);
    });

    test('unported vendor enhancements (images/scheduling/publishTime) refuse with the full unsupported list', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, images: [], publishTime: '2030-01-01T00:00:00Z' }),
            options: { categories: [], scheduling: { at: 'soon' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('unsupported field(s)');
        expect(result.error).toContain('options.categories');
        expect(result.error).toContain('options.scheduling');
        expect(result.error).toContain('metadata.images');
        expect(result.error).toContain('metadata.publishTime');
        expect(result.error).toContain('scheduling/publishTime is an unported vendor enhancement');
        expect(fake.requests).toHaveLength(0);
    });

    test('合集 (collection) is implemented for audio only; the other three kinds refuse it by name', async () => {
        // 2026-11-16 operator requirement: the daily episode belongs to 合集 每日AI乱炖 — AUDIO only,
        // so 视频/图文/音乐 keep their exact current behaviour and a collection request on them is a
        // typed unsupported field, never a silent drop.
        const cases = [
            { operation: 'shortVideo' as const, media: { videoPath: VIDEO_PATH }, format: 'video' as const },
            { operation: 'music' as const, media: { audio: AUDIO_PATH }, format: 'audio' as const },
            { operation: 'image' as const, media: { images: IMAGE_PATHS }, format: 'image' as const },
        ];
        for (const entry of cases) {
            const fake = makeFakeLauncher();
            const result = await transport(fake, 'script', entry.operation).publish({
                content: draftContent(entry.media, { format: entry.format }),
                options: { collection: '每日AI乱炖' },
            });
            expect(result.ok, entry.operation).toBe(false);
            expect(result.error, entry.operation).toContain('options.collection');
            expect(fake.requests, entry.operation).toHaveLength(0);
        }
    });

    test('合集: a non-string collection refuses for audio before any browser work', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake, 'script', 'audio');
        const result = await t.publish({
            content: draftContent({ audio: AUDIO_PATH }, { format: 'audio' }),
            options: { collection: 42 },
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("collection must be a nonempty string when present, got '42'");
        expect(fake.requests).toHaveLength(0);
    });

    test('audio refusals: missing, non-string, nonexistent, and unsupported extensions', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake, 'script', 'audio');
        const publish = (metadata: Record<string, unknown>) =>
            t.publish({ content: draftContent(metadata, { format: 'audio' }) });

        expect((await publish({})).error).toContain('must be a non-empty local audio file path');
        expect((await publish({ audio: 42 })).error).toContain('must be a non-empty local audio file path');
        expect((await publish({ audio: join(TMP_DIR, 'nope.mp3') })).error).toContain(
            'does not resolve to a readable nonempty local audio file',
        );
        const txt = await publish({ audio: join(TMP_DIR, 'note.txt') });
        expect(txt.error).toContain('must be a local MP3/M4A/WAV/AAC/FLAC file');
        expect(txt.error).toContain('unsupported extension in');
        expect(fake.requests).toHaveLength(0);
    });

    test('images refusals: missing, non-array, and per-entry extension gates', async () => {
        const fake = makeFakeLauncher();
        const t = transport(fake, 'script', 'image');
        const publish = (metadata: Record<string, unknown>) =>
            t.publish({ content: draftContent(metadata, { format: 'image' }) });

        expect((await publish({})).error).toContain(
            'metadata.images must be a non-empty array of local image file paths',
        );
        expect((await publish({ images: 'card.png' })).error).toContain(
            'metadata.images must be a non-empty array of local image file paths',
        );
        expect((await publish({ images: [] })).error).toContain(
            'metadata.images must be a non-empty array of local image file paths',
        );
        const bad = await publish({ images: [join(TMP_DIR, 'card.tiff')] });
        expect(bad.error).toContain('metadata.images[] must be a local PNG/JPEG/WebP file');
        expect(fake.requests).toHaveLength(0);
    });

    test('images entries may be plain paths or { path } objects (the cards-variant spelling)', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake, 'script', 'image').publish({
            content: draftContent({ images: [{ path: IMAGE_PATHS[0] }, IMAGE_PATHS[1]] }, { format: 'image' }),
        });
        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:wujie-app ${IMAGES_INPUT}|${IMAGE_PATHS[0]},${IMAGE_PATHS[1]}`);
    });

    test('cross-kind fields refuse per operation: videoPath on audio, coverPath on 图文', async () => {
        const fake = makeFakeLauncher();
        const audioResult = await transport(fake, 'script', 'audio').publish({
            content: draftContent({ videoPath: VIDEO_PATH, audio: AUDIO_PATH }, { format: 'audio' }),
        });
        expect(audioResult.error).toContain('unsupported field(s)');
        expect(audioResult.error).toContain('metadata.videoPath');

        const imageResult = await transport(fake, 'script', 'image').publish({
            content: draftContent({ images: IMAGE_PATHS, coverPath: COVER_PATH }, { format: 'image' }),
        });
        expect(imageResult.error).toContain('unsupported field(s)');
        expect(imageResult.error).toContain('metadata.coverPath');
        expect(fake.requests).toHaveLength(0);
    });
});

describe('3. sanitizer chain and paste-script construction', () => {
    test('unquoted javascript:/data: attribute values are stripped too', () => {
        const sanitized = sanitizeShipinhaoHtml('<a href=javascript:alert(1)>a</a><img src=data:text/html,x>');
        expect(sanitized).not.toMatch(/javascript:|data:text/i);
    });
    const dirtyBody = [
        '# Shipinhao Fixture',
        '',
        'Real **bold** paragraph with [link](https://example.com/a).',
        '',
        '<script>alert(1)</script>',
        '<iframe src="https://evil.example"></iframe>',
        '<embed src="x"></embed>',
        '<object data="y"></object>',
        '<img src="https://example.com/cover.png" onerror="alert(2)">',
        '',
        '- item one',
        '- item two',
        '',
        '```ts',
        'const answer = 42;',
        '```',
        '',
        '[bad](javascript:alert(3)) and [worse](data:text/html,hi)',
    ].join('\n');

    test('sanitizer strips scripts, event handlers, and javascript:/data: URLs', () => {
        const html = sanitizeShipinhaoHtml(markdownToHtml(dirtyBody));
        expect(html).not.toMatch(/<script|<iframe|<embed|<object/i);
        expect(html).not.toMatch(/onerror=/i);
        expect(html).not.toMatch(/javascript:|data:text\/html/i);
        expect(html).toContain('bold');
        expect(html).toContain('item one');
        expect(html).toContain('const answer');
    });

    test('sanitizer keeps the headings, lists, code, and images the publish body needs', () => {
        const html = sanitizeShipinhaoHtml(markdownToHtml(dirtyBody));
        expect(html).toMatch(/<h1|<h2/);
        expect(html).toContain('<li>');
        expect(html).toMatch(/<code|<pre/);
        expect(html).toContain('<img');
        expect(html).toContain('https://example.com/a');
    });

    test('the HTML captured at paste time is exactly sanitize(markdownToHtml(body))', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(true);
        const paste = fake.calls.find((call) => call.startsWith('paste:'));
        expect(paste).toBeDefined();
        expect((paste ?? '').startsWith('paste:wujie|')).toBe(true);
        const pastedHtml = (paste ?? '').slice((paste ?? '').indexOf('|') + 1);
        expect(pastedHtml).toBe(sanitizeShipinhaoHtml(markdownToHtml('Fixture 描述正文。')));
    });

    test('a long body is pasted as the clipped plain description with topics kept whole', async () => {
        const longBody = `# 标题\n\n${'很长的节目内容。'.repeat(30)}`;
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, tags: ['AI', '播客'] }, { body: longBody }),
        });
        expect(result.ok).toBe(true);
        const paste = fake.calls.find((call) => call.startsWith('paste:')) ?? '';
        const pastedHtml = paste.slice(paste.indexOf('|') + 1);
        const { description } = buildShipinhaoDescription(longBody, ['AI', '播客']);
        expect(pastedHtml).toBe(sanitizeShipinhaoHtml(markdownToHtml(description)));
        expect(description.endsWith('\n#AI #播客')).toBe(true);
    });

    test('buildShipinhaoDescription clips plain text to the 100-char editor cap and strips markdown', () => {
        const { description } = buildShipinhaoDescription(
            `## 一${'很长的节目内容。'.repeat(30)}[来源：x](https://example.com/a)`,
            ['AI'],
        );
        expect(description.endsWith('#AI')).toBe(true);
        expect(Array.from(description).length).toBeLessThanOrEqual(100);
        expect(description).not.toContain('##');
        expect(description).not.toContain('http');
        const short = buildShipinhaoDescription('短正文。', ['AI', '播客']);
        expect(short.description).toBe('短正文。\n#AI #播客');
        const bare = buildShipinhaoDescription('短正文。', []);
        expect(bare.description).toBe('短正文。');
    });
});

describe('4. payload/IO + main() exit semantics', () => {
    test('processPublishIO parses stdin-shape Content JSON, writes the Result envelope, and validates ResultSchema', async () => {
        await mkdir(join(TMP_DIR, 'out', 'nested'), { recursive: true });
        const outFile = join(TMP_DIR, 'out', 'nested', 'result.json');
        const inputPath = join(TMP_DIR, 'input.json');
        await writeFile(inputPath, JSON.stringify({ ...draftContent({ videoPath: VIDEO_PATH }), options: {} }));
        await processPublishIO(inputPath, outFile, new FakeBrowserTransport('script'));
        const envelope = JSON.parse(await readFile(outFile, 'utf8')) as Result;
        expect(ResultSchema.safeParse(envelope).success).toBe(true);
        expect(envelope.ok).toBe(true);
        expect(envelope.metadata).toMatchObject({ driver: 'script' });
    });

    test('processPublishIO refuses malformed input with a single-line error and an ok:false envelope', async () => {
        const inputPath = join(TMP_DIR, 'bad.json');
        const outFile = join(TMP_DIR, 'bad-out.json');
        await writeFile(inputPath, JSON.stringify({ title: 42 }));
        await expect(processPublishIO(inputPath, outFile, new FakeBrowserTransport('script'))).rejects.toThrow(
            /Invalid Content input/,
        );
        const envelope = JSON.parse(await readFile(outFile, 'utf8')) as Result;
        expect(envelope.ok).toBe(false);
        expect(envelope.error).toContain('Invalid Content input');
    });

    test('processPublishIO refuses unknown operations offline', async () => {
        const inputPath = join(TMP_DIR, 'op.json');
        const outFile = join(TMP_DIR, 'op-out.json');
        await writeFile(inputPath, JSON.stringify({ ...draftContent(), options: { operation: 'podcast' } }));
        await expect(processPublishIO(inputPath, outFile, new FakeBrowserTransport('script'))).rejects.toThrow(
            /unsupported operation 'podcast' for shipinhao/,
        );
        const envelope = JSON.parse(await readFile(outFile, 'utf8')) as Result;
        expect(envelope.ok).toBe(false);
    });

    test('processPublishIO refuses non-script drivers offline even with a fake transport injected', async () => {
        const inputPath = join(TMP_DIR, 'driver.json');
        await writeFile(inputPath, JSON.stringify({ ...draftContent(), options: { driver: 'agent' } }));
        await expect(
            processPublishIO(
                join(TMP_DIR, 'driver.json'),
                join(TMP_DIR, 'driver-out.json'),
                new FakeBrowserTransport('script'),
            ),
        ).rejects.toThrow(/unsupported driver 'agent' for shipinhao/);
    });

    test('main() exits 1 on missing/invalid usage, 0 on a fake-transport success, 1 on invalid input', async () => {
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        const outFile = join(TMP_DIR, 'main.json');
        const inputPath = join(TMP_DIR, 'main-in.json');
        await writeFile(inputPath, JSON.stringify(draftContent({ videoPath: VIDEO_PATH })));
        const previousArgv = process.argv;
        const previousEnv = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        try {
            process.argv = ['bun', 'index.ts'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');

            process.argv = ['bun', 'index.ts', '--bogus'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid arguments');

            process.argv = ['bun', 'index.ts', '--in', inputPath, '--out', outFile];
            expect(await main()).toBe(0);
            const envelope = ResultSchema.parse(JSON.parse(await readFile(outFile, 'utf8'))) as Result;
            expect(envelope.ok).toBe(true);

            const badPath = join(TMP_DIR, 'main-bad.json');
            await writeFile(badPath, JSON.stringify({ body: 7 }));
            process.argv = ['bun', 'index.ts', '--in', badPath, '--out', outFile];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid Content input');
        } finally {
            restore();
            process.argv = previousArgv;
            if (previousEnv === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = previousEnv;
        }
    });

    test('main() writes an ok:false envelope and exits 1 for a publish refusal (offline, real transport)', async () => {
        const errTarget = createBufferTarget();
        const restore = setDefaultOutputTargets({ stderr: errTarget });
        const outFile = join(TMP_DIR, 'refused.json');
        const inputPath = join(TMP_DIR, 'refused-in.json');
        await writeFile(inputPath, JSON.stringify(draftContent({ videoPath: VIDEO_PATH, publishStatus: 'scheduled' })));
        const previousArgv = process.argv;
        const previousEnv = process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        try {
            process.argv = ['bun', 'index.ts', '--in', inputPath, '--out', outFile];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('shipinhao-pub failed:');
            const envelope = JSON.parse(await readFile(outFile, 'utf8')) as Result;
            expect(envelope.ok).toBe(false);
            expect(envelope.error).toContain("unknown publishStatus 'scheduled' for shipinhao");
        } finally {
            restore();
            process.argv = previousArgv;
            if (previousEnv === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = previousEnv;
        }
    });
});

describe('5. session preflight', () => {
    test('a login redirect refuses before any flow work after one headless and one headed pass', async () => {
        const fake = makeFakeLauncher({ groundedMissing: true, landedUrl: SIGNIN_URL });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('shipinhao session preflight refused — run:');
        expect(result.error).toContain(SHP_LOGIN_INSTRUCTION);
        // Two read-only passes (headless, then the headed fallback the shipped probe has always
        // used); still no flow work, no click, and both contexts closed.
        expect(fake.requests).toEqual([
            { profileDir: DEFAULT_DIR, headless: true },
            { profileDir: DEFAULT_DIR, headless: false },
        ]);
        expect(fake.close()).toBe(2);
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a missing browser profile refuses with the login command in one line', async () => {
        const fake = makeFakeLauncher({
            error: (request) => new BrowserProfileMissingError(request.profileDir),
        });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('session preflight refused');
        expect(result.error).toContain(`no shipinhao browser profile at ${DEFAULT_DIR}`);
        expect(result.error).toContain(SHP_LOGIN_INSTRUCTION);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(fake.requests).toHaveLength(1);
    });

    test('session expiry between preflight and the flow fails with the login instruction, not a corrupt publish', async () => {
        const fake = makeFakeLauncher({ expireAfterPreflight: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('shipinhao session failed — run:');
        expect(result.error).toContain(SHP_LOGIN_INSTRUCTION);
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.close()).toBe(2);
        expect(fake.calls.some((call) => call.startsWith('setInputFiles:'))).toBe(false);
    });
});

describe('6. flow stages (offline fake page running the real evaluate scripts)', () => {
    test('the 定时发表 draft-confirm dialog is clicked through 保存 before the receipt', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt', draftConfirmDialog: true });
        // Own transport: the confirm click spends one extra poll round before the receipt read.
        const t = new ShipinhaoBrowserTransport('shortVideo', 'script', {
            launcher: fake.launcher,
            stepTimeoutMs: 3000,
        });
        const result = await t.publish({ content: draftContent({ videoPath: VIDEO_PATH }) });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_URL);
        expect(fake.calls).toContain('draft:confirm');
        expect(fake.calls.indexOf('draft:confirm')).toBeGreaterThan(fake.calls.indexOf(`click:wujie-app ${SAVE}`));
    });

    test('a fresh receipt with full persisted readback confirms the draft', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_URL);
        expect(result.id).toBe('shp26001');
        expect(result.message).toContain('shipinhao shortVideo draft confirmed in profile');
        expect(result.metadata).toMatchObject({
            operation: 'shortVideo',
            driver: 'script',
            publishStatus: 'draft',
            profileDir: DEFAULT_DIR,
            confirmedBy: 'draft-receipt',
        });
        expect(fake.calls).toContain(`fill:wujie-app ${TITLE_INPUT}|Fixture 短标题`);
        expect(fake.calls.some((call) => call.startsWith('paste:wujie|'))).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:wujie-app ${VIDEO_INPUT}|${VIDEO_PATH}`);
        expect(fake.calls).toContain(`click:wujie-app ${SAVE}`);
        // Two contexts: the read-only headless preflight, then the headed flow.
        expect(fake.requests.map((request) => request.headless)).toEqual([true, false]);
        expect(fake.close()).toBe(2);
    });

    test('an explicit draft publishStatus saves through the same pinned control', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, publishStatus: 'draft' }),
        });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(DRAFT_URL);
        expect(result.metadata).toMatchObject({ publishStatus: 'draft' });
        expect(fake.calls).toContain(`click:wujie-app ${SAVE}`);
    });

    test('a public publishStatus clicks 发表 and confirms only on a fresh works receipt', async () => {
        const fake = makeFakeLauncher();
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, publishStatus: 'public' }),
        });
        expect(result.ok).toBe(true);
        expect(result.url).toBe(PUBLISH_URL);
        expect(result.id).toBe('pub0777');
        expect(result.message).toContain('shipinhao shortVideo public confirmed in profile');
        expect(result.metadata).toMatchObject({ publishStatus: 'public', confirmedBy: 'publish-receipt' });
        expect(fake.calls).toContain(`click:wujie-app ${PUBLISH}`);
        expect(fake.calls.some((call) => saveButton.some((s) => call.includes(`click:${s}`)))).toBe(false);
    });

    test('the requested-only 声明原创 declaration commits through entry, agreement, and confirm', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt', originalFlow: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata).toMatchObject({ original: true, confirmedBy: 'draft-receipt' });
        // entry ensure+probe, agreement ensure+probe, confirm, closed probe — the real scripts.
        expect(fake.shared.originalityQueries).toBeGreaterThanOrEqual(4);
    });

    test('a requested cover is attached, confirmed through the dialog ladder, and verified by the slot descriptor', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, coverPath: COVER_PATH }),
        });
        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`setInputFiles:wujie-app ${COVER_DIALOG} input[type="file"]|${COVER_PATH}`);
        expect(fake.calls).toContain('cover:entry');
        expect(fake.calls).toContain('cover:confirm');
        expect(fake.shared.coverQueries).toBeGreaterThanOrEqual(3);
    });

    test('an options.profileDir override names that profile in the Result metadata', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH }),
            options: { profileDir: PROFILE_OVERRIDE_DIR },
        });
        expect(result.ok).toBe(true);
        expect(result.metadata?.profileDir).toBe(PROFILE_OVERRIDE_DIR);
    });

    test('a late wujie root is polled to readiness, never slept past or refused early', async () => {
        const fake = makeFakeLauncher({ root: 'late', onSaveClick: 'draftReceipt' });
        const t = new ShipinhaoBrowserTransport('shortVideo', 'script', {
            launcher: fake.launcher,
            stepTimeoutMs: 2000,
        });
        const result = await t.publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(true);
        expect(fake.calls).toContain(`click:wujie-app ${SAVE}`);
    });

    test('a missing video file input is a typed upload-timeout refusal carrying every candidate', async () => {
        const fake = makeFakeLauncher({ missingVideoInput: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-timeout' });
        expect(result.error).toContain('shipinhao video file input/attach failed');
        expect(result.error).toContain(VIDEO_INPUT);
        expect(fake.calls.some((call) => call.startsWith('paste:'))).toBe(false);
    });

    test('a rejected file assignment is a typed upload-timeout failure without the login hint', async () => {
        const fake = makeFakeLauncher({ uploadThrows: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-timeout' });
        expect(result.error).toContain('shipinhao video file input/attach failed');
        expect(result.error).toContain('detached during upload');
        expect(result.error).not.toContain(SHP_LOGIN_INSTRUCTION);
    });

    test('the 600s media ceiling stays a typed branch — asserted at the source, never waited in tests', async () => {
        const src = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        // The processing poll is bounded by the module-level media ceiling, not the step timeout.
        expect(src).toContain('timeoutMs: SHP_UPLOAD_TIMEOUT_MS');
        expect(src).toContain("'upload-processing'");
        expect(src).toContain(`refusing to claim an uploaded \${spec.mediaLabel}`);
        // The typed branch the deadline returns: single line, staged, no claimed upload.
        const typed = stageFail(
            SHP_TARGET,
            `shipinhao media processing not confirmed within the ${SHP_UPLOAD_TIMEOUT_MS}ms ceiling — the file was assigned but no editing form appeared; refusing to claim an uploaded video`,
            'upload-processing',
            { operation: 'shortVideo', driver: 'script', publishStatus: 'draft', profileDir: DEFAULT_DIR },
        );
        expect(typed.ok).toBe(false);
        expect(typed.metadata).toMatchObject({ stage: 'upload-processing' });
        expect(typed.error).toContain('600000ms ceiling');
        expect(typed.error?.split('\n')).toHaveLength(1);
    });

    test('a file assigned but no post-upload editing form is a typed upload-processing refusal', async () => {
        const fake = makeFakeLauncher({ missingTitleInput: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-processing' });
        expect(result.error).toContain('media processing not confirmed');
        expect(result.error).toContain('the file was assigned');
        expect(fake.calls.some((call) => call.startsWith('fill:'))).toBe(false);
    });

    test('a dropped title is refused at the title-readback stage, never pasted forward or saved', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'title-readback' });
        expect(result.error).toContain('title readback failed');
        expect(fake.calls.some((call) => call.startsWith('paste:'))).toBe(false);
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('a missing description editor is a typed upload-processing failure, never a silent skip', async () => {
        const fake = makeFakeLauncher({ missingEditor: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-processing' });
        expect(result.error).toContain('media processing not confirmed');
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('a paste the editor never receives is refused before any submit control is touched', async () => {
        const fake = makeFakeLauncher({ pasteReportsMissing: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'description-paste-readback' });
        expect(result.error).toContain('description paste failed');
        expect(result.error).toContain('not attached for paste');
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('a dropped paste is refused at the description readback before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'description-paste-readback' });
        expect(result.error).toContain('description readback failed');
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('a missing 声明原创 entry checkbox refuses the requested declaration', async () => {
        const fake = makeFakeLauncher({ originalFlow: true, originalEntryMissing: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'original-declare' });
        expect(result.error).toContain('entry checkbox not found');
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('an ambiguous 声明原创 entry refuses rather than guessing which 原创 control', async () => {
        const fake = makeFakeLauncher({ originalFlow: true, originalEntryAmbiguous: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'original-declare' });
        expect(result.error).toContain('entry checkbox is ambiguous');
    });

    test('a missing declare-body-wrapper agreement checkbox refuses the requested declaration', async () => {
        const fake = makeFakeLauncher({ originalFlow: true, originalAgreementMissing: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'original-declare' });
        expect(result.error).toContain('agreement checkbox');
        expect(result.error).toContain('never appeared');
    });

    test('an ambiguous 声明原创 confirm refuses rather than clicking the wrong button', async () => {
        const fake = makeFakeLauncher({ originalFlow: true, originalConfirmAmbiguous: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'original-declare' });
        expect(result.error).toContain('confirm ambiguous');
    });

    test('a missing vertical cover slot refuses the requested cover before the dialog opens', async () => {
        const fake = makeFakeLauncher({ coverSlotMissing: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, coverPath: COVER_PATH }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-open' });
        expect(result.error).toContain('vertical cover slot');
        expect(result.error).toContain('not found');
        expect(fake.calls).not.toContain('cover:entry');
    });

    test('a missing cover edit entry is a typed cover-open failure, never a silent skip', async () => {
        const fake = makeFakeLauncher({ coverDialogNever: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, coverPath: COVER_PATH }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-open' });
        expect(result.error).toContain('cover edit entry click failed');
    });

    test('a cover dialog without a file input refuses the attach as unverifiable', async () => {
        const fake = makeFakeLauncher({ coverDialogNoFileInput: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, coverPath: COVER_PATH }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-open' });
        expect(result.error).toContain('exposes no input[type=file]');
    });

    test('a cover dialog with no labeled confirm is a typed cover-attach failure', async () => {
        const fake = makeFakeLauncher({ coverConfirmMissing: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, coverPath: COVER_PATH }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'cover-attach' });
        expect(result.error).toContain('cover commit unverifiable');
    });

    test('a missing save control is a typed draft-save failure, never a manufactured draft', async () => {
        const fake = makeFakeLauncher({ submitMissing: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-save' });
        expect(result.error).toContain('draft-save control never attached');
        expect(result.error).toContain('not a manufactured draft');
        expect(fake.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('a hidden or never-clickable submit control refuses at its own leg, before any click', async () => {
        const hidden = makeFakeLauncher({ submitInvisible: true });
        const hiddenResult = await transport(hidden).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(hiddenResult.ok).toBe(false);
        expect(hiddenResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(hiddenResult.error).toContain('attached but not visible');
        expect(hidden.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);

        const disabled = makeFakeLauncher({ submitNeverEnabled: true, onSaveClick: 'draftReceipt' });
        const disabledResult = await transport(disabled).publish({
            content: draftContent({ videoPath: VIDEO_PATH }),
        });
        expect(disabledResult.ok).toBe(false);
        expect(disabledResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(disabledResult.error).toContain('never became clickable');
        expect(disabled.calls.some((call) => call.includes(SAVE) || call.includes(PUBLISH))).toBe(false);
    });

    test('an idless state (stale receipt on screen, no fresh gain) is a typed draft-receipt failure', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'none', existingReceiptUrl: DRAFT_URL });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('draft-receipt not confirmed');
        expect(result.metadata?.evidence).toContain('1 pre-existing receipt-shaped url(s)');
        expect(fake.calls).toContain(`click:wujie-app ${SAVE}`);
    });

    test('a toast-only signal (which this flow never reads) never confirms the save', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'none', existingToasts: ['保存成功'] });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('draft-receipt not confirmed');
        expect(result.error).toContain('fill alone is never a saved draft');
    });

    test('a fresh receipt whose persisted state no longer matches refuses instead of claiming success', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt', persistedStateDrifts: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('no longer matches the requested content');
        expect(result.metadata?.evidence).toContain('stale-state: ');
    });

    test('a fresh receipt without a single id-bearing works URL is an ambiguous typed failure', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'twoIds' });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'draft-receipt' });
        expect(result.error).toContain('receipt is ambiguous');
        expect(result.metadata?.evidence).toContain('2 disagreeing fresh works ids');
    });

    test('音频 has no draft rail: a draft request is refused by name, not approximated', async () => {
        // Recon 2026-11-16: /platform/post/createAudio offers exactly one submit — 发表音频. The old
        // behaviour drove the VIDEO form (发表视频) and could never persist an audio post.
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake, 'script', 'audio').publish({
            content: draftContent({ audio: AUDIO_PATH }, { format: 'audio' }),
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('shipinhao 音频 has no draft rail');
    });

    test('音频 requires a cover: the form refuses to submit without one (「请上传封面」)', async () => {
        // Live recon 2026-11-16: submitting the 音频 form with no 封面 fails client-side validation
        // and produces no works row — the trap that made every earlier audio publish `unknown`.
        // The cover-less request must get past the pre-browser gate and fail on the surface instead.
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'script', 'audio').publish({
            content: draftContent({ audio: AUDIO_PATH, publishStatus: 'public' }, { format: 'audio' }),
        });
        expect(result.ok).toBe(false);
        expect(result.error ?? '').not.toContain('1:1 cover rail');
    });

    test('the audio payload may spell the file as metadata.audioFile (publish-prep contract)', async () => {
        // The resolver still honours both spellings: the request must get past the media gate and
        // fail only where the (fake) page cannot serve the audio surface.
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'script', 'audio').publish({
            content: draftContent({ audioFile: AUDIO_PATH, publishStatus: 'public' }, { format: 'audio' }),
        });
        expect(result.ok).toBe(false);
        expect(result.error ?? '').not.toContain('must be a non-empty local audio file path');
    });

    test('音频 takes its 封面 from metadata.coverImage when the matrix stripped options (daily wiring)', async () => {
        // The publish matrix builds the payload through ContentSchema, which drops the variant's
        // top-level `options` (audioFile/coverPath). A daily episode therefore arrives with
        // metadata.coverImage only — and the 音频 form refuses to submit without a 封面, so this
        // fallback is what lets `kk news generate --publish` ship the episode without a preset path.
        const fake = makeFakeLauncher();
        const result = await transport(fake, 'script', 'audio').publish({
            content: {
                body: 'episode body',
                title: '每日AI乱炖 · 2026-11-16',
                format: 'audio',
                metadata: {
                    publishStatus: 'public',
                    audioFile: AUDIO_PATH,
                    coverImage: COVER_PATH,
                    collection: '每日AI乱炖',
                },
            },
        });
        // It must get past the media/cover gates and fail only on the (fake) page not serving the
        // real 音频 surface — never on a missing cover.
        expect(result.error ?? '').not.toContain('requires a cover');
        expect(result.error ?? '').not.toContain('coverPath does not resolve');
    });

    test('音频 helpers: the 标题 is clipped to 40 and the 描述 carries the topic tags inside 3000', () => {
        expect(clipAudioTitle('每日AI乱炖 · 2026-11-15')).toBe('每日AI乱炖 · 2026-11-15');
        expect(clipAudioTitle('字'.repeat(60))).toHaveLength(40);
        const description = buildAudioDescription('body text', ['ai-news', '#daily']);
        expect(description).toBe('body text\n\n#ai-news #daily');
        expect(buildAudioDescription('x'.repeat(4_000), []).length).toBe(3_000);
    });

    test('a music post (音乐) uses the same audio ladder plus cover rails', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake, 'script', 'music').publish({
            content: draftContent({ audio: AUDIO_PATH, coverPath: COVER_PATH }, { format: 'audio' }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata).toMatchObject({ operation: 'music' });
        expect(fake.calls).toContain(`setInputFiles:wujie-app ${AUDIO_INPUT}|${AUDIO_PATH}`);
        expect(fake.calls).toContain('cover:confirm');
    });

    test('an image post (图文) attaches the image array in one setInputFiles and never touches the cover', async () => {
        const fake = makeFakeLauncher({ onSaveClick: 'draftReceipt' });
        const result = await transport(fake, 'script', 'image').publish({
            content: draftContent({ images: IMAGE_PATHS }, { format: 'image' }),
        });
        expect(result.ok).toBe(true);
        expect(result.metadata).toMatchObject({ operation: 'image' });
        expect(fake.calls).toContain(`setInputFiles:wujie-app ${IMAGES_INPUT}|${IMAGE_PATHS[0]},${IMAGE_PATHS[1]}`);
        expect(fake.calls.some((call) => call.startsWith('cover:'))).toBe(false);
    });
});

describe('7. source hygiene (no eval, one evaluate paste, setInputFiles media, native fills)', () => {
    test('no eval/new Function, no node:fs imports and no network calls in src', async () => {
        const sources = [
            await readFile(join(import.meta.dir, '..', 'src', 'index.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8'),
            await readFile(join(import.meta.dir, '..', 'src', 'profile-check.ts'), 'utf-8'),
        ];
        for (const src of sources) {
            expect(src).not.toMatch(/\beval\(|new Function/);
            expect(src).not.toMatch(/from 'node:fs/);
            expect(src).not.toMatch(/fetch\(|XMLHttpRequest/i);
        }
    });

    test('exactly one paste site and it is the sanitize(markdownToHtml) chain via page.evaluate', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        // pasteRichText is defined once and called once; the synthetic ClipboardEvent paste is
        // the only text/html route into the editor.
        expect(flow.match(/pasteRichText\(/g)).toHaveLength(2);
        expect(flow.match(/new ClipboardEvent\('paste'/g)).toHaveLength(1);
        expect(flow).toContain('sanitizeShipinhaoHtml(');
        expect(flow).toContain('markdownToHtml(');
        expect(flow).toContain("new Event('input', { bubbles: true })");
        expect(flow).toContain("new Event('change', { bubbles: true })");
    });

    test('video and cover travel through setInputFiles only — no base64/blob upload path', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        expect(flow.match(/\.setInputFiles\(/g)).toHaveLength(2);
        expect(flow).not.toMatch(/atob\(|btoa\(/);
        // The single DataTransfer belongs to the synthetic paste event, never a file upload.
        expect(flow.match(/new DataTransfer\(/g)).toHaveLength(1);
    });

    test('every resolveRootLocator call site is wrapped in a catch arm returning a typed stageFail', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        const sites = [...flow.matchAll(/await resolveRootLocator\(/g)];
        expect(sites).toHaveLength(8); // create entry, video input, form title, form editor, paste editor, cover input, submit, title fill
        for (const site of sites) {
            const tail = flow.slice(site.index ?? 0);
            const catchIdx = tail.indexOf('} catch');
            expect(catchIdx).toBeGreaterThan(0);
            expect(catchIdx).toBeLessThan(1500);
            expect(tail.slice(catchIdx, catchIdx + 500)).toMatch(/stageFail\(|failCover\(/);
        }
    });

    test('the title is filled natively and the awaited clicks are the entry and the resolved submit control', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        expect(flow).toContain('.fill(title)');
        // Every `.value` occurrence in the flow is a readback read; never a bare write.
        expect(flow).not.toMatch(/\.value\s*=[^=]/);
        // The awaited locator clicks are the dashboard entry rail and the submit rail (draft save or 发表).
        expect(flow.match(/await [A-Za-z.]+\.click\(/g)).toHaveLength(2);
        expect(flow).toContain('await entry.click()');
        expect(flow).toContain('await submitLocator.click()');
    });

    test('the provisional selectors and URLs carry their Provisional labels; grounded ones do not', async () => {
        const selectors = await readFile(join(import.meta.dir, '..', 'src', 'selectors.ts'), 'utf-8');
        expectProvisionalLabel(selectors, 'export const SHP_LOGIN_URL_RE');
        expectProvisionalLabel(selectors, 'export const SHP_RECEIPT_URL_RES');
        expectProvisionalLabel(selectors, 'saveButton: [');
        expectGroundedLabel(selectors, 'originalAgreementCheckbox:');
        expectGroundedLabel(selectors, 'originalConfirmLabel:');
    });
});

describe('8. environment restoration', () => {
    test('no shipinhao profile/transport env leaks between suites', () => {
        expect(process.env.SHP_PROFILE_DIR).toBe(originalChannelDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalSharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalFake);
    });
});
