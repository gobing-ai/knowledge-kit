/**
 * shipinhao-pub offline unit suite (0296) — mirrors the xiaoyuzhou-pub unit suite (0295) layer by
 * layer, adapted to the shipinhao (channels.weixin.qq.com) short-video flow contract.
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
import { SHP_LOGIN_INSTRUCTION, ShipinhaoBrowserTransport, sanitizeShipinhaoHtml, stageFail } from '../src/flow';
import { getPublishTransport, main, processPublishIO, resolveOperation, SHP_OPERATIONS } from '../src/index';
import {
    isShipinhaoAuthenticated,
    readRootSnapshot,
    SHP_CONFIG,
    SHP_COVER_PREVIEW_WAIT_MS,
    SHP_COVER_SAVE_WAIT_MS,
    SHP_FORM_WAIT_MS,
    SHP_HOME_URL,
    SHP_LOGIN_TIMEOUT_MS,
    SHP_LOGIN_URL_RE,
    SHP_PROCESSING_WAIT_MS,
    SHP_RECEIPT_URL_RES,
    SHP_ROOT_WAIT_MS,
    SHP_TARGET,
    SHP_UPLOAD_TIMEOUT_MS,
    SHP_VIDEO_SELECTORS,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.tmp-test-shipinhao-pub-main');
const VIDEO_PATH = join(TMP_DIR, 'video.mp4');
const COVER_PATH = join(TMP_DIR, 'cover.png');
const BIG_PATH = join(TMP_DIR, 'big.mp4');
const PROFILE_OVERRIDE_DIR = join(TMP_DIR, 'profile-flag-override');
const DEFAULT_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'shipinhao');
const SIGNIN_URL = 'https://open.weixin.qq.com/connect/qrconnect?appid=fixture';
const DRAFT_URL = 'https://channels.weixin.qq.com/platform/record/detail/shp26001';
const SECOND_DRAFT_URL = 'https://channels.weixin.qq.com/platform/record/detail/shp26002';
const PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/video/pub0777';

const { videoInput, titleInput, descriptionEditor, saveButton, publishButton, coverDialog } = SHP_VIDEO_SELECTORS;
const VIDEO_INPUT = videoInput[0];
const TITLE_INPUT = titleInput[0];
const EDITOR = descriptionEditor[0];
const SAVE = saveButton[0];
const PUBLISH = publishButton[0];
const COVER_DIALOG = coverDialog[0];

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
    let videoAssigned = false;
    let titleValue = '';
    let editorHtml = '';
    let coverDescriptor = 'base';
    let coverDialogOpen = false;
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
        if (videoInput.includes(base)) return options.missingVideoInput ? 0 : 1;
        if (titleInput.includes(base)) return videoAssigned && !options.missingTitleInput ? 1 : 0;
        if (descriptionEditor.includes(base)) return videoAssigned && !options.missingEditor ? 1 : 0;
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
                        directFileInputs: 1,
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
                    shadowFileInputs: ready ? 1 : 0,
                    shadowTextEvidence: ready ? 2 : 0,
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
                return JSON.stringify({ ready: videoAssigned && !options.missingTitleInput });
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
                    if (publishButton.includes(base)) url = PUBLISH_URL;
                    if (saveButton.includes(base)) {
                        if (options.onSaveClick === 'draftReceipt') url = DRAFT_URL;
                        if (options.onSaveClick === 'twoIds') freshAnchors.push(DRAFT_URL, SECOND_DRAFT_URL);
                    }
                },
                setInputFiles: async (files: string | readonly string[]) => {
                    if (options.uploadThrows) throw new Error('detached during upload');
                    shared.calls.push(`setInputFiles:${selector}|${String(files)}`);
                    const base = baseSelector(selector);
                    if (videoInput.includes(base)) videoAssigned = true;
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
): ShipinhaoBrowserTransport =>
    new ShipinhaoBrowserTransport('shortVideo', driver, { launcher: fake.launcher, stepTimeoutMs: 250 });

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
                'coverConfirmFooter',
                'coverConfirmLabels',
                'coverDialog',
                'coverDialogFileInputSuffix',
                'coverEditEntry',
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
        expect(SHP_HOME_URL).toBe('https://channels.weixin.qq.com/platform/post/video');
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
        expect([...SHP_OPERATIONS]).toEqual(['shortVideo']);
        expect(resolveOperation(undefined, undefined)).toEqual({ operation: 'shortVideo' });
        expect(resolveOperation({ operation: 'shortVideo' }, undefined).operation).toBe('shortVideo');
        expect(resolveOperation(undefined, draftContent({ operation: 'shortVideo' })).operation).toBe('shortVideo');
        // options.operation wins over content.metadata.operation.
        expect(resolveOperation({ operation: 'shortVideo' }, draftContent({ operation: 'article' })).operation).toBe(
            'shortVideo',
        );
        expect(resolveOperation({ operation: 'podcast' }, undefined).error).toContain(
            "unsupported operation 'podcast' for shipinhao: expected one of shortVideo",
        );
        expect(resolveOperation(undefined, draftContent({ operation: 'article' })).error).toContain(
            "unsupported operation 'article' for shipinhao",
        );
        expect(resolveOperation({ operation: 'article' }, draftContent({ operation: 'shortVideo' })).error).toContain(
            "unsupported operation 'article' for shipinhao",
        );
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
});

describe('3. sanitizer chain and paste-script construction', () => {
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
        console.log('LATE-RESULT:', result);
        expect(result.ok).toBe(true);
        const paste = fake.calls.find((call) => call.startsWith('paste:'));
        expect(paste).toBeDefined();
        expect((paste ?? '').startsWith('paste:wujie|')).toBe(true);
        const pastedHtml = (paste ?? '').slice((paste ?? '').indexOf('|') + 1);
        expect(pastedHtml).toBe(sanitizeShipinhaoHtml(markdownToHtml('Fixture 描述正文。')));
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
    test('a login redirect refuses before any flow work with a single headless pass', async () => {
        const fake = makeFakeLauncher({ groundedMissing: true, landedUrl: SIGNIN_URL });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('shipinhao session preflight refused — run:');
        expect(result.error).toContain(SHP_LOGIN_INSTRUCTION);
        expect(fake.requests).toEqual([{ profileDir: DEFAULT_DIR, headless: true }]);
        expect(fake.close()).toBe(1);
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
        expect(src).toContain('refusing to claim an uploaded video');
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
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a missing description editor is a typed upload-processing failure, never a silent skip', async () => {
        const fake = makeFakeLauncher({ missingEditor: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'upload-processing' });
        expect(result.error).toContain('media processing not confirmed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a paste the editor never receives is refused before any submit control is touched', async () => {
        const fake = makeFakeLauncher({ pasteReportsMissing: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'description-paste-readback' });
        expect(result.error).toContain('description paste failed');
        expect(result.error).toContain('not attached for paste');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a dropped paste is refused at the description readback before any save control is clicked', async () => {
        const fake = makeFakeLauncher({ bodyReadbackDrops: true });
        const result = await transport(fake).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'description-paste-readback' });
        expect(result.error).toContain('description readback failed');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a missing 声明原创 entry checkbox refuses the requested declaration', async () => {
        const fake = makeFakeLauncher({ originalFlow: true, originalEntryMissing: true });
        const result = await transport(fake).publish({
            content: draftContent({ videoPath: VIDEO_PATH, original: true }),
        });
        expect(result.ok).toBe(false);
        expect(result.metadata).toMatchObject({ stage: 'original-declare' });
        expect(result.error).toContain('entry checkbox not found');
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
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
        expect(fake.calls.some((call) => call.startsWith('click:'))).toBe(false);
    });

    test('a hidden or never-clickable submit control refuses at its own leg, before any click', async () => {
        const hidden = makeFakeLauncher({ submitInvisible: true });
        const hiddenResult = await transport(hidden).publish({ content: draftContent({ videoPath: VIDEO_PATH }) });
        expect(hiddenResult.ok).toBe(false);
        expect(hiddenResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(hiddenResult.error).toContain('attached but not visible');
        expect(hidden.calls.some((call) => call.startsWith('click:'))).toBe(false);

        const disabled = makeFakeLauncher({ submitNeverEnabled: true, onSaveClick: 'draftReceipt' });
        const disabledResult = await transport(disabled).publish({
            content: draftContent({ videoPath: VIDEO_PATH }),
        });
        expect(disabledResult.ok).toBe(false);
        expect(disabledResult.metadata).toMatchObject({ stage: 'draft-save' });
        expect(disabledResult.error).toContain('never became clickable');
        expect(disabled.calls.some((call) => call.startsWith('click:'))).toBe(false);
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
        expect(sites).toHaveLength(7); // video input, form title, form editor, paste editor, cover input, submit, title fill
        for (const site of sites) {
            const tail = flow.slice(site.index ?? 0);
            const catchIdx = tail.indexOf('} catch');
            expect(catchIdx).toBeGreaterThan(0);
            expect(catchIdx).toBeLessThan(1500);
            expect(tail.slice(catchIdx, catchIdx + 500)).toMatch(/stageFail\(|failCover\(/);
        }
    });

    test('the title is filled natively and the only awaited click is the resolved submit control', async () => {
        const flow = await readFile(join(import.meta.dir, '..', 'src', 'flow.ts'), 'utf-8');
        expect(flow).toContain('.fill(title)');
        // Every `.value` occurrence in the flow is a readback read; never a bare write.
        expect(flow).not.toMatch(/\.value\s*=[^=]/);
        // The only awaited locator click is the submit rail (draft save or 发表).
        expect(flow.match(/await [A-Za-z.]+\.click\(/g)).toHaveLength(1);
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
