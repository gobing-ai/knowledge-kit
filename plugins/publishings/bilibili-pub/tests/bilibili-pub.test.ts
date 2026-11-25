/**
 * bilibili-pub offline unit test suite (task 0297 chunk C2).
 *
 * Implements deterministic offline tests for the Bilibili video and dynamic publish plugin:
 * 1. surface/manifest — plugin.json metadata, exports inventory, packed entry/check files,
 *    BILIBILI_OPERATIONS list, resolveOperation precedence, fake-vs-real transport selection.
 * 2. pre-browser refusals — shortVideo and dynamic validation ladder, all with zero browser launches.
 * 3. sanitizer chain — sanitizeBilibiliHtml direct tag/attribute/protocol stripping and rich-text
 *    paste script generation.
 * 4. payload/IO + main() exit semantics — processPublishIO --in/--out contract, ResultSchema compliance,
 *    and main() CLI exit codes.
 * 5. session preflight — missing browser profile, passport login redirect, creator surface authentication
 *    predicates, and mid-flow session expiry.
 * 6. flow stages — fake page running the real evaluate scripts for shortVideo and dynamic flows,
 *    persisted draft and public review receipts, and typed stageFail failure contracts.
 * 7. source hygiene — no node:fs in src, no eval/new Function, no in-page base64/DataTransfer file upload,
 *    no locator.evaluate in flow.ts, every stage failure wrapped in typed stageFail, and profile-check.ts
 *    asserted via source-text only without importing.
 * 8. environment restoration — restores process.env, process.argv, and scratch files.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Content, ContentSchema, ResultSchema } from '@gobing-ai/kk-core';
import { FakeBrowserTransport } from '@gobing-ai/publish-harness';
import { markdownToHtml } from '@gobing-ai/publish-harness/browser';
import {
    type BrowserLauncher,
    BrowserProfileMissingError,
    LoginTimeoutError,
    type ProfileLaunchRequest,
} from '@gobing-ai/ts-browser-automation';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import type { BrowserContext, Page } from 'playwright';
import {
    BILI_LOGIN_INSTRUCTION,
    BilibiliBrowserTransport,
    bounded,
    boundedDetail,
    errorMessage,
    fail,
    sanitizeBilibiliHtml,
    stageFail,
} from '../src/flow';
import {
    BILIBILI_OPERATIONS,
    type BilibiliOperation,
    getPublishTransport,
    main,
    processPublishIO,
    resolveOperation,
} from '../src/index';
import {
    BILI_CONFIG,
    BILI_DYNAMIC_HOME_URL,
    BILI_DYNAMIC_SELECTORS,
    BILI_LOGIN_TIMEOUT_MS,
    BILI_LOGIN_URL_RE,
    BILI_MEMBER_HOME_URL,
    BILI_RECEIPT_URL_RES,
    BILI_TARGET,
    BILI_UPLOAD_TIMEOUT_MS,
    BILI_VIDEO_SELECTORS,
    isBilibiliAuthenticated,
} from '../src/selectors';

const TMP_DIR = join(process.cwd(), '.works/tmp/test-bilibili-pub-unit');
const VIDEO_PATH = join(TMP_DIR, 'test-video.mp4');
const COVER_PATH = join(TMP_DIR, 'test-cover.png');
const IMAGE_PATH = join(TMP_DIR, 'test-image.png');
const BIG_VIDEO_PATH = join(TMP_DIR, 'test-big.mp4');
const EMPTY_VIDEO_PATH = join(TMP_DIR, 'test-empty.mp4');
const EMPTY_COVER_PATH = join(TMP_DIR, 'test-empty-cover.png');
const EMPTY_IMAGE_PATH = join(TMP_DIR, 'test-empty-img.png');
const DEFAULT_PROFILE_DIR = join(homedir(), '.config', 'kk', 'browser-profiles', 'bilibili');

const REAL_VIDEO_RECEIPT_URL = 'https://member.bilibili.com/video/BV1xx411c7mD';
/** Persisted draft receipt URL — the only thing that may confirm a draft save (0297 review P2-a). */
const REAL_DRAFT_RECEIPT_URL = 'https://member.bilibili.com/platform/upload-manager/article?aid=123456';
const REAL_DYNAMIC_RECEIPT_URL = 'https://t.bilibili.com/opus/987654321';
/** A pre-existing feed card that must never confirm a submit on its own (0297 review P2-b). */
const PRE_EXISTING_DYNAMIC_CARD = 'https://t.bilibili.com/opus/111111111';
const PASSPORT_LOGIN_URL = 'https://passport.bilibili.com/login';
const ACCOUNT_LOGIN_URL = 'https://account.bilibili.com/login';
const MEMBER_SIGNIN_URL = 'https://member.bilibili.com/signin';

const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
);
const FAKE_MP4_BYTES = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34,
    0x32, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65,
]);

/** Saved environment variables. */
const originalEnv = {
    bilibiliDir: process.env.BILIBILI_PROFILE_DIR,
    sharedDir: process.env.KK_BROWSER_PROFILE_DIR,
    transport: process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT,
    argv: [...process.argv],
};

function makeVideoContent(
    metadata: Record<string, unknown> = {},
    overrides: Partial<Pick<Content, 'title' | 'body' | 'format'>> = {},
): Content {
    return ContentSchema.parse({
        title: overrides.title ?? '测试视频标题',
        body: overrides.body ?? '测试视频描述正文。',
        format: overrides.format ?? 'video',
        metadata: {
            videoPath: VIDEO_PATH,
            partition: '知识',
            ...metadata,
        },
    });
}

function makeDynamicContent(
    metadata: Record<string, unknown> = {},
    overrides: Partial<Pick<Content, 'title' | 'body' | 'format'>> = {},
): Content {
    return ContentSchema.parse({
        title: overrides.title ?? '测试动态标题',
        body: overrides.body ?? '想和大家分享今天的新动态。',
        format: overrides.format ?? 'article',
        metadata: {
            publishStatus: 'public',
            ...metadata,
        },
    });
}

interface FakePageOptions {
    landedUrl?: string;
    authenticated?: boolean;
    isLoginPage?: boolean;
    missingVideoInput?: boolean;
    uploadThrows?: boolean;
    missingTitleInput?: boolean;
    titleReadbackDrops?: boolean;
    titleReadbackRejects?: boolean;
    missingDescriptionEditor?: boolean;
    pasteReportsMissing?: boolean;
    descriptionReadbackDrops?: boolean;
    descriptionReadbackRejects?: boolean;
    partitionMissing?: boolean;
    partitionReadbackDrops?: boolean;
    missingTagInput?: boolean;
    tagsReadbackDrops?: boolean;
    missingCoverMain?: boolean;
    coverEntryMissing?: boolean;
    missingCoverFileInput?: boolean;
    coverDoneMissing?: boolean;
    coverPreviewUnchanged?: boolean;
    missingSubmitAdd?: boolean;
    publicReceiptMissing?: boolean;
    draftButtonMissing?: boolean;
    draftReceiptMissing?: boolean;
    missingDynamicEditor?: boolean;
    dynamicTextReadbackDrops?: boolean;
    missingDynamicImageInput?: boolean;
    dynamicImagesPreviewFails?: boolean;
    missingDynamicLaunchButton?: boolean;
    dynamicLaunchDisabled?: boolean;
    dynamicReceiptMissing?: boolean;
    /** A feed card that already existed BEFORE the launch click (must never confirm on its own). */
    dynamicBaselineCard?: string;
}

interface FakeLauncherOptions extends FakePageOptions {
    error?: (request: ProfileLaunchRequest) => Error;
    expireAfterPreflight?: boolean;
}

interface LauncherHandle {
    launcher: BrowserLauncher;
    requests: ProfileLaunchRequest[];
    calls: string[];
    closeCount: () => number;
}

function makeFakePage(options: FakePageOptions, calls: string[]): Page {
    let currentUrl = options.landedUrl ?? BILI_MEMBER_HOME_URL;
    let titleValue = '';
    let editorText = '';
    const tagsList: string[] = [];
    let coverPreviewCount = 0;
    let assignedImagesCount = 0;

    const countOf = (selector: string): number => {
        if (BILI_VIDEO_SELECTORS.videoInput.includes(selector)) {
            return options.missingVideoInput ? 0 : 1;
        }
        if (BILI_VIDEO_SELECTORS.titleInput.includes(selector)) {
            return options.missingTitleInput ? 0 : 1;
        }
        if (BILI_VIDEO_SELECTORS.descriptionEditor.includes(selector)) {
            return options.missingDescriptionEditor ? 0 : 1;
        }
        if (BILI_VIDEO_SELECTORS.tagInput.includes(selector)) {
            return options.missingTagInput ? 0 : 1;
        }
        if (selector === BILI_VIDEO_SELECTORS.coverMain) {
            return options.missingCoverMain ? 0 : 1;
        }
        if (BILI_VIDEO_SELECTORS.coverFileInput.includes(selector)) {
            return options.missingCoverFileInput ? 0 : 1;
        }
        if (BILI_VIDEO_SELECTORS.submitAdd.includes(selector)) {
            return options.missingSubmitAdd ? 0 : 1;
        }
        if (BILI_DYNAMIC_SELECTORS.editor.includes(selector)) {
            return options.missingDynamicEditor ? 0 : 1;
        }
        if (BILI_DYNAMIC_SELECTORS.imageInput.includes(selector)) {
            return options.missingDynamicImageInput ? 0 : 1;
        }
        if (BILI_DYNAMIC_SELECTORS.launchButton.includes(selector)) {
            return options.missingDynamicLaunchButton ? 0 : 1;
        }
        return 1;
    };

    const page = {
        url: () => currentUrl,
        goto: async (url: string) => {
            calls.push(`goto:${url}`);
            currentUrl = options.landedUrl ?? url;
        },
        close: async () => {
            calls.push('close');
        },
        locator: (selector: string) => {
            const leaf = {
                first: () => leaf,
                count: async () => countOf(selector),
                setInputFiles: async (files: string | readonly string[]) => {
                    calls.push(`setInputFiles:${selector}|${String(files)}`);
                    if (options.uploadThrows) {
                        throw new Error('upload bridge failed');
                    }
                    if (Array.isArray(files)) {
                        assignedImagesCount = files.length;
                    } else if (typeof files === 'string') {
                        assignedImagesCount = 1;
                    }
                },
                fill: async (text: string) => {
                    calls.push(`fill:${selector}|${text}`);
                    if (BILI_VIDEO_SELECTORS.titleInput.includes(selector)) {
                        titleValue = text;
                    } else if (BILI_VIDEO_SELECTORS.tagInput.includes(selector)) {
                        tagsList.push(text);
                    }
                },
                inputValue: async () => {
                    if (options.titleReadbackRejects) throw new Error('title locator detached');
                    return options.titleReadbackDrops ? '' : titleValue;
                },
                innerText: async () => {
                    if (options.descriptionReadbackRejects) throw new Error('editor locator detached');
                    if (options.descriptionReadbackDrops || options.dynamicTextReadbackDrops) {
                        return '';
                    }
                    return editorText;
                },
                press: async (key: string) => {
                    calls.push(`press:${selector}|${key}`);
                },
                click: async () => {
                    calls.push(`click:${selector}`);
                    if (BILI_VIDEO_SELECTORS.submitAdd.includes(selector) && !options.publicReceiptMissing) {
                        currentUrl = REAL_VIDEO_RECEIPT_URL;
                    }
                    if (BILI_DYNAMIC_SELECTORS.launchButton.includes(selector) && !options.dynamicReceiptMissing) {
                        currentUrl = REAL_DYNAMIC_RECEIPT_URL;
                    }
                },
            };
            return leaf;
        },
        evaluate: async (expression: string): Promise<unknown> => {
            calls.push(`evaluate:${expression.slice(0, 48).replace(/\n/g, ' ')}`);

            // 1. Authentication check
            if (expression.includes('isLoginPage') || expression.includes('.header-entry-avatar')) {
                if (options.isLoginPage) return false;
                if (options.authenticated === false) return false;
                return true;
            }

            // 2. Rich text paste
            if (expression.includes("ClipboardEvent('paste'")) {
                calls.push(`paste:${expression}`);
                if (options.pasteReportsMissing) return 'missing';
                const match = /data\.setData\('text\/plain',\s*("(?:[^"\\]|\\.)*")\)/.exec(expression);
                const text = match?.[1] ? (JSON.parse(match[1]) as string) : '';
                editorText = text;
                return 'pasted';
            }

            // 3. Partition selection
            if (expression.includes('targetPartition')) {
                if (options.partitionMissing) return { found: false };
                return { found: true, text: '知识' };
            }
            if (expression.includes('div.select-item.selected, div.category-item.active')) {
                if (options.partitionReadbackDrops) return '';
                return '知识';
            }

            // 4. Tags cleanup and readback
            if (expression.includes('existTags')) {
                return undefined;
            }
            if (expression.includes('div.tag-pre-wrp > div.label-item-v2-container')) {
                if (options.tagsReadbackDrops) return '';
                return tagsList.length > 0 ? tagsList.join(' ') : '科技 数码';
            }

            // 5. Original radio button
            if (expression.includes('span.check-radio-v2-name')) {
                return undefined;
            }

            // 6. Cover operations
            if (expression.includes('div.cover-main') && expression.includes('.cover-slot')) {
                coverPreviewCount += 1;
                if (coverPreviewCount === 1) {
                    return options.coverPreviewUnchanged ? 'cover-same.png' : 'cover-initial.png';
                }
                return options.coverPreviewUnchanged ? 'cover-same.png' : 'cover-updated.png';
            }
            if (expression.includes('更换封面') || expression.includes('封面设置')) {
                if (options.coverEntryMissing) return false;
                return true;
            }
            if (expression.includes("el.textContent.trim() === '完成'")) {
                if (options.coverDoneMissing) return null;
                return 'done clicked';
            }

            // 7. Video submit receipts
            if (expression.includes('.submit-success, .upload-success')) {
                if (options.publicReceiptMissing) return null;
                return '投稿成功';
            }
            if (expression.includes('存草稿') || expression.includes('submit-draft')) {
                if (options.draftButtonMissing) return { clicked: false };
                // A persisted draft is observable only as a fresh id-bearing URL (P2-a).
                if (!options.draftReceiptMissing) currentUrl = REAL_DRAFT_RECEIPT_URL;
                return { clicked: true };
            }

            // 8. Dynamic operations
            if (expression.includes('bili-pics-uploader__item__remove')) {
                return undefined;
            }
            if (expression.includes('bili-dyn-publishing__image-upload')) {
                return undefined;
            }
            if (expression.includes('.bili-pics-uploader__item, .bili-dyn-publishing__image-item')) {
                if (options.dynamicImagesPreviewFails) return 0;
                return assignedImagesCount > 0 ? assignedImagesCount : 1;
            }
            if (expression.includes('aria-disabled')) {
                return Boolean(options.dynamicLaunchDisabled);
            }
            // Fresh-signal probe (P2-b): only a link absent from the baseline confirms.
            if (expression.includes('baseline.anchors.includes(href)')) {
                if (options.dynamicReceiptMissing) return '';
                return REAL_DYNAMIC_RECEIPT_URL;
            }
            // Pre-click baseline snapshot (P2-b).
            if (expression.includes('toastVisible:') && expression.includes('a[href]')) {
                return JSON.stringify({
                    anchors: options.dynamicBaselineCard ? [options.dynamicBaselineCard] : [],
                    toastVisible: false,
                });
            }

            return '';
        },
    };

    return page as unknown as Page;
}

function makeFakeLauncher(options: FakeLauncherOptions = {}): LauncherHandle {
    const requests: ProfileLaunchRequest[] = [];
    const calls: string[] = [];
    let closes = 0;
    let launchCount = 0;

    const launcher: BrowserLauncher = {
        async launch(request: ProfileLaunchRequest) {
            requests.push(request);
            launchCount += 1;
            if (options.error) {
                throw options.error(request);
            }
            if (options.expireAfterPreflight && launchCount > 1) {
                throw new LoginTimeoutError(request.profileDir, 100);
            }
            const page = makeFakePage(options, calls);
            const context = {
                pages: () => [page],
                newPage: async () => page,
                close: async () => {
                    closes += 1;
                },
            };
            return context as unknown as BrowserContext;
        },
    };

    return {
        launcher,
        requests,
        calls,
        closeCount: () => closes,
    };
}

function makeTransport(
    fake: LauncherHandle,
    operation: BilibiliOperation = 'shortVideo',
    stepTimeoutMs = 150,
): BilibiliBrowserTransport {
    return new BilibiliBrowserTransport(operation, 'script', {
        launcher: fake.launcher,
        stepTimeoutMs,
        uploadTimeoutMs: stepTimeoutMs,
    });
}

beforeAll(async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(VIDEO_PATH, FAKE_MP4_BYTES);
    await writeFile(COVER_PATH, PNG_1PX);
    await writeFile(IMAGE_PATH, PNG_1PX);
    await writeFile(EMPTY_VIDEO_PATH, '');
    await writeFile(EMPTY_COVER_PATH, '');
    await writeFile(EMPTY_IMAGE_PATH, '');

    // Sparse 2 GiB + 1 byte file for cap test
    await writeFile(BIG_VIDEO_PATH, 'hdr');
    await truncate(BIG_VIDEO_PATH, 2 * 1024 ** 3 + 1);
});

afterAll(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});

afterEach(() => {
    process.argv = [...originalEnv.argv];
    if (originalEnv.bilibiliDir === undefined) delete process.env.BILIBILI_PROFILE_DIR;
    else process.env.BILIBILI_PROFILE_DIR = originalEnv.bilibiliDir;
    if (originalEnv.sharedDir === undefined) delete process.env.KK_BROWSER_PROFILE_DIR;
    else process.env.KK_BROWSER_PROFILE_DIR = originalEnv.sharedDir;
    if (originalEnv.transport === undefined) delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
    else process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = originalEnv.transport;
});

describe('1. surface/manifest', () => {
    test('plugin.json declares kind=publish, entry, check, and bilibili browserSession', async () => {
        const raw = await readFile(join(import.meta.dir, '..', 'plugin.json'), 'utf-8');
        const manifest = JSON.parse(raw) as Record<string, unknown>;
        expect(manifest.name).toBe('bilibili-pub');
        expect(manifest.kind).toBe('publish');
        expect(manifest.entry).toBe('./src/index.ts');
        expect(manifest.check).toBe('./src/profile-check.ts');
        expect(manifest.browserSession).toEqual({
            profileName: 'bilibili',
            homeUrl: 'https://member.bilibili.com/',
        });
    });

    test('exports inventory covers index.ts, flow.ts, and selectors.ts interfaces', () => {
        // index.ts exports
        expect(BILIBILI_OPERATIONS).toEqual(['shortVideo', 'dynamic']);
        expect(typeof resolveOperation).toBe('function');
        expect(typeof getPublishTransport).toBe('function');
        expect(typeof processPublishIO).toBe('function');
        expect(typeof main).toBe('function');

        // flow.ts exports
        expect(typeof fail).toBe('function');
        expect(typeof stageFail).toBe('function');
        expect(typeof boundedDetail).toBe('function');
        expect(typeof bounded).toBe('function');
        expect(typeof errorMessage).toBe('function');
        expect(typeof sanitizeBilibiliHtml).toBe('function');
        expect(typeof BilibiliBrowserTransport).toBe('function');
        expect(BILI_LOGIN_INSTRUCTION).toBe('bun plugins/publishings/bilibili-pub/src/profile-check.ts login');

        // selectors.ts exports
        expect(BILI_TARGET).toBe('bilibili');
        expect(BILI_MEMBER_HOME_URL).toBe('https://member.bilibili.com/');
        expect(BILI_DYNAMIC_HOME_URL).toBe('https://t.bilibili.com/');
        expect(BILI_UPLOAD_TIMEOUT_MS).toBe(600_000);
        expect(BILI_LOGIN_TIMEOUT_MS).toBe(180_000);
        expect(BILI_LOGIN_URL_RE).toBeInstanceOf(RegExp);
        expect(BILI_RECEIPT_URL_RES.length).toBeGreaterThan(0);
        expect(BILI_CONFIG.channel).toBe('bilibili');
        expect(BILI_CONFIG.homeUrl).toBe('https://member.bilibili.com/');
        expect(BILI_CONFIG.isAuthenticated).toBe(isBilibiliAuthenticated);
    });

    test('packed entry and check files exist and resolve on disk', async () => {
        const entryPath = join(import.meta.dir, '..', 'src', 'index.ts');
        const checkPath = join(import.meta.dir, '..', 'src', 'profile-check.ts');
        expect(await Bun.file(entryPath).exists()).toBe(true);
        expect(await Bun.file(checkPath).exists()).toBe(true);
    });

    test('resolveOperation precedence: options.operation > metadata.operation > shortVideo default', () => {
        // 1. options wins over metadata
        const r1 = resolveOperation({ operation: 'dynamic' }, makeVideoContent({ operation: 'shortVideo' }));
        expect(r1).toEqual({ operation: 'dynamic' });

        // 2. metadata wins when options is absent
        const r2 = resolveOperation(undefined, makeVideoContent({ operation: 'dynamic' }));
        expect(r2).toEqual({ operation: 'dynamic' });

        // 3. default is shortVideo when neither is provided
        const r3 = resolveOperation();
        expect(r3).toEqual({ operation: 'shortVideo' });

        // 4. unsupported operation returns error
        const r4 = resolveOperation({ operation: 'unsupported-op' });
        expect(r4.error).toContain("unsupported operation 'unsupported-op' for bilibili");
        expect(r4.error).toContain('expected one of shortVideo, dynamic');
    });

    test('getPublishTransport resolves FakeBrowserTransport when env=fake, otherwise BilibiliBrowserTransport', () => {
        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        const fake = getPublishTransport('shortVideo');
        expect(fake).toBeInstanceOf(FakeBrowserTransport);
        expect(fake.driver).toBe('script');

        delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
        const real = getPublishTransport('dynamic');
        expect(real).toBeInstanceOf(BilibiliBrowserTransport);
        expect((real as BilibiliBrowserTransport).operation).toBe('dynamic');
    });
});

describe('2. pre-browser refusals', () => {
    test('shortVideo: format != video is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({}, { format: 'article' as const }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("bilibili shortVideo requires Content.format 'video', got 'article'");
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: missing videoPath is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: undefined }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('metadata.videoPath must be a non-empty local video file path');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: empty string videoPath is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: '   ' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('metadata.videoPath must be a non-empty local video file path');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: non-existent videoPath is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: join(TMP_DIR, 'ghost.mp4') }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not resolve to a readable nonempty local video file');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: empty file videoPath is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: EMPTY_VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('does not resolve to a readable nonempty local video file');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: unsupported video extension is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: join(TMP_DIR, 'clip.avi') }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('metadata.videoPath must be a local MP4/MOV file');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: sparse file exceeding 2 GiB cap is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ videoPath: BIG_VIDEO_PATH }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('exceeds the KK v1 local video cap of 2 GiB');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: missing title is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({}, { title: '' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('bilibili shortVideo requires a non-empty Content.title');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: title > 80 chars is rejected without truncation and with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const longTitle = 'a'.repeat(81);
        const result = await t.publish({ content: makeVideoContent({}, { title: longTitle }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            'bilibili shortVideo title exceeds the 80-character platform limit (81 characters; titles longer than 80 are rejected, never truncated, bilibili.js:431)',
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: missing or empty partition is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const r1 = await t.publish({ content: makeVideoContent({ partition: undefined }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain('requires a non-empty string for metadata.partition');

        const r2 = await t.publish({ content: makeVideoContent({ partition: '   ' }) });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('requires a non-empty string for metadata.partition');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: tags non-array, >10 tags, or empty tag string are refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');

        const r1 = await t.publish({ content: makeVideoContent({ tags: 'not-array' as unknown as string[] }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain('metadata.tags must be an array of strings when present');

        const r2 = await t.publish({
            content: makeVideoContent({ tags: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] }),
        });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('bilibili shortVideo tags exceed the 10-tag limit (11 entries');

        const r3 = await t.publish({ content: makeVideoContent({ tags: ['科技', ''] }) });
        expect(r3.ok).toBe(false);
        expect(r3.error).toContain('metadata.tags entries must be non-empty strings');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: coverPath non-file, unsupported ext, or empty file are refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');

        const r1 = await t.publish({ content: makeVideoContent({ coverPath: 123 as unknown as string }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain('metadata.coverPath must be a non-empty local file path');

        const r2 = await t.publish({ content: makeVideoContent({ coverPath: join(TMP_DIR, 'cover.txt') }) });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('metadata.coverPath must be a local PNG/JPEG/WebP file');

        const r3 = await t.publish({ content: makeVideoContent({ coverPath: EMPTY_COVER_PATH }) });
        expect(r3.ok).toBe(false);
        expect(r3.error).toContain('metadata.coverPath does not resolve to a readable nonempty local image file');
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: driver != script is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const agentTransport = new BilibiliBrowserTransport('shortVideo', 'agent' as unknown as 'script', {
            launcher: fake.launcher,
        });
        const result = await agentTransport.publish({ content: makeVideoContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported driver 'agent' for bilibili: expected one of script");
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: unknown publishStatus is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent({ publishStatus: 'scheduled' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            "unknown publishStatus 'scheduled' for bilibili: expected 'draft', 'public' or absent",
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('shortVideo: unsupported fields (images, scheduling) are refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');

        const r1 = await t.publish({ content: makeVideoContent({ images: [COVER_PATH] }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain('unsupported field(s) images for bilibili shortVideo');

        const r2 = await t.publish({ content: makeVideoContent({ scheduling: true }) });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('unsupported field(s) scheduling/publishTime for bilibili shortVideo');
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: format != article/text is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');
        const result = await t.publish({ content: makeDynamicContent({}, { format: 'video' as const }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain("bilibili dynamic requires Content.format 'article' or 'text', got 'video'");
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: empty body AND empty images is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');
        const result = await t.publish({ content: makeDynamicContent({ images: [] }, { body: '   ' }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain(
            'bilibili dynamic requires non-empty Content.body or at least one image in metadata.images',
        );
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: >9 images is refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');
        const tenImages = Array.from({ length: 10 }, () => IMAGE_PATH);
        const result = await t.publish({ content: makeDynamicContent({ images: tenImages }) });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('bilibili dynamic images exceed the limit of 9 images (10 provided)');
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: images non-array, empty string, bad ext, or empty file are refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');

        const r1 = await t.publish({ content: makeDynamicContent({ images: 'not-array' as unknown as string[] }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain('metadata.images must be an array of file paths');

        const r2 = await t.publish({ content: makeDynamicContent({ images: [''] }) });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('metadata.images entries must be non-empty strings');

        const r3 = await t.publish({ content: makeDynamicContent({ images: [join(TMP_DIR, 'pic.txt')] }) });
        expect(r3.ok).toBe(false);
        expect(r3.error).toContain('metadata.images must be local image files');

        const r4 = await t.publish({ content: makeDynamicContent({ images: [EMPTY_IMAGE_PATH] }) });
        expect(r4.ok).toBe(false);
        expect(r4.error).toContain('metadata.images file does not resolve to a readable nonempty file');
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: publishStatus absent or draft is refused (drafts not supported) with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');

        const r1 = await t.publish({ content: makeDynamicContent({ publishStatus: undefined }) });
        expect(r1.ok).toBe(false);
        expect(r1.error).toContain(
            'bilibili dynamic posts require explicit metadata.publishStatus: public (drafts are not supported by the platform)',
        );

        const r2 = await t.publish({ content: makeDynamicContent({ publishStatus: 'draft' }) });
        expect(r2.ok).toBe(false);
        expect(r2.error).toContain('bilibili dynamic posts require explicit metadata.publishStatus: public');
        expect(fake.requests).toHaveLength(0);
    });

    test('dynamic: unaccepted fields (partition, cover, video, audio, category, scheduling) refused with zero launches', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'dynamic');

        const fields = [
            { partition: '知识' },
            { coverPath: COVER_PATH },
            { videoPath: VIDEO_PATH },
            { audioPath: join(TMP_DIR, 'audio.mp3') },
            { category: 'tech' },
            { categories: ['tech'] },
        ];

        for (const meta of fields) {
            const result = await t.publish({ content: makeDynamicContent(meta) });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('unsupported field(s)');
            expect(result.error).toContain('dynamic posts do not accept video/partition/cover/category/audio fields');
        }

        const schedResult = await t.publish({ content: makeDynamicContent({ scheduling: true }) });
        expect(schedResult.ok).toBe(false);
        expect(schedResult.error).toContain('unsupported field(s) scheduling/publishTime for bilibili dynamic');
        expect(fake.requests).toHaveLength(0);
    });
});

describe('3. sanitizer chain', () => {
    test('unquoted javascript:/data: attribute values are stripped too', () => {
        const sanitized = sanitizeBilibiliHtml('<a href=javascript:alert(1)>a</a><img src=data:text/html,x>');
        expect(sanitized).not.toMatch(/javascript:|data:text/i);
    });
    test('sanitizeBilibiliHtml strips script, style, iframe, embed, and object blocks', () => {
        const dirty =
            '<div>Safe<script>alert(1)</script><style>body{color:red;}</style><iframe>evil</iframe><embed src="x"/><object data="y"></object></div>';
        const clean = sanitizeBilibiliHtml(dirty);
        expect(clean).toBe('<div>Safe</div>');
    });

    test('sanitizeBilibiliHtml strips on* event handlers and javascript:/data: URLs', () => {
        const dirty =
            '<a href="javascript:alert(1)" onclick="steal()" ONLOAD="evil()" onmouseover="bad()"><img src="data:image/svg+xml;base64,123" />Text</a>';
        const clean = sanitizeBilibiliHtml(dirty);
        expect(clean).toContain('href=""');
        expect(clean).toContain('src=""');
        expect(clean).not.toContain('onclick');
        expect(clean).not.toContain('ONLOAD');
        expect(clean).not.toContain('onmouseover');
        expect(clean).toContain('Text');
    });

    test('sanitizeBilibiliHtml preserves valid article markup', () => {
        const md = '# 标题\n\n**加粗** *斜体* `代码`\n\n- 列表项1\n- 列表项2\n\n> 引用内容';
        const html = sanitizeBilibiliHtml(markdownToHtml(md));
        expect(html).toContain('<h1>标题</h1>');
        expect(html).toContain('<strong>加粗</strong>');
        expect(html).toContain('<code>代码</code>');
        expect(html).toContain('<li>列表项1</li>');
        expect(html).toContain('<blockquote>');
    });

    test('paste script construction wraps sanitized html and plain text in DataTransfer events', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL });
        const t = makeTransport(fake, 'dynamic');
        const md = '动态内容含危险代码 <script>alert("xss")</script> 正常文本';
        await t.publish({ content: makeDynamicContent({}, { body: md }) });

        const pasteCall = fake.calls.find((c) => c.startsWith('paste:'));
        expect(pasteCall).toBeDefined();
        if (pasteCall) {
            expect(pasteCall).toContain('text/html');
            expect(pasteCall).toContain('text/plain');
            expect(pasteCall).not.toContain('<script>alert("xss")</script>');
            expect(pasteCall).toContain('动态内容含危险代码');
            expect(pasteCall).toContain('正常文本');
        }
    });
});

describe('4. payload/IO + main() exit semantics', () => {
    test('processPublishIO --in/--out writes valid ResultSchema output with fake transport', async () => {
        const inFile = join(TMP_DIR, 'io-in.json');
        const outFile = join(TMP_DIR, 'io-out.json');
        await writeFile(inFile, JSON.stringify(makeVideoContent()));

        process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
        await processPublishIO(inFile, outFile);

        const outText = await readFile(outFile, 'utf-8');
        const result = ResultSchema.parse(JSON.parse(outText));
        expect(result.ok).toBe(true);
        expect(result.target).toBeDefined();
    });

    test('processPublishIO writes ok:false ResultSchema and throws on invalid Content JSON', async () => {
        const inFile = join(TMP_DIR, 'bad-content.json');
        const outFile = join(TMP_DIR, 'bad-content-out.json');
        await writeFile(inFile, JSON.stringify({ notAValidContent: true }));

        let threw = false;
        try {
            await processPublishIO(inFile, outFile);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);

        const outText = await readFile(outFile, 'utf-8');
        const result = ResultSchema.parse(JSON.parse(outText));
        expect(result.ok).toBe(false);
        expect(result.error).toContain('Invalid Content input');
    });

    test('processPublishIO writes ok:false ResultSchema and throws on unsupported operation', async () => {
        const inFile = join(TMP_DIR, 'bad-op.json');
        const outFile = join(TMP_DIR, 'bad-op-out.json');
        await writeFile(
            inFile,
            JSON.stringify({
                ...makeVideoContent(),
                options: { operation: 'unsupported-op' },
            }),
        );

        let threw = false;
        try {
            await processPublishIO(inFile, outFile);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);

        const outText = await readFile(outFile, 'utf-8');
        const result = ResultSchema.parse(JSON.parse(outText));
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported operation 'unsupported-op'");
    });

    test('processPublishIO writes ok:false ResultSchema and throws on unsupported driver', async () => {
        const inFile = join(TMP_DIR, 'bad-driver.json');
        const outFile = join(TMP_DIR, 'bad-driver-out.json');
        await writeFile(
            inFile,
            JSON.stringify({
                ...makeVideoContent(),
                options: { driver: 'agent' },
            }),
        );

        let threw = false;
        try {
            await processPublishIO(inFile, outFile);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);

        const outText = await readFile(outFile, 'utf-8');
        const result = ResultSchema.parse(JSON.parse(outText));
        expect(result.ok).toBe(false);
        expect(result.error).toContain("unsupported driver 'agent'");
    });

    test('main() exits 0 on valid --in/--out, 1 on missing args, 1 on refusal', async () => {
        const errTarget = createBufferTarget();
        const restoreOutputs = setDefaultOutputTargets({ stderr: errTarget });

        const inFile = join(TMP_DIR, 'main-in.json');
        const outFile = join(TMP_DIR, 'main-out.json');
        await writeFile(inFile, JSON.stringify(makeVideoContent()));

        try {
            // 1. Missing args exits 1
            process.argv = ['bun', 'index.ts'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Missing required arguments');

            // 2. Invalid args exits 1
            process.argv = ['bun', 'index.ts', '--invalid-flag'];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('Invalid arguments');

            // 3. Valid args with fake transport exits 0
            process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT = 'fake';
            process.argv = ['bun', 'index.ts', '--in', inFile, '--out', outFile];
            expect(await main()).toBe(0);
            const res = ResultSchema.parse(JSON.parse(await readFile(outFile, 'utf-8')));
            expect(res.ok).toBe(true);

            // 4. Pre-browser refusal with real transport exits 1
            delete process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT;
            const refusedIn = join(TMP_DIR, 'refused-in.json');
            const refusedOut = join(TMP_DIR, 'refused-out.json');
            await writeFile(refusedIn, JSON.stringify(makeVideoContent({ publishStatus: 'scheduled' })));
            process.argv = ['bun', 'index.ts', '--in', refusedIn, '--out', refusedOut];
            expect(await main()).toBe(1);
            expect(errTarget.text()).toContain('bilibili-pub failed:');
            const refRes = ResultSchema.parse(JSON.parse(await readFile(refusedOut, 'utf-8')));
            expect(refRes.ok).toBe(false);
        } finally {
            restoreOutputs();
        }
    });
});

describe('5. session preflight', () => {
    test('missing browser profile refuses with the login instruction in one line', async () => {
        const fake = makeFakeLauncher({
            error: (req) => new BrowserProfileMissingError(req.profileDir),
        });
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('bilibili session preflight refused — run:');
        expect(result.error).toContain(BILI_LOGIN_INSTRUCTION);
        expect(result.error).toContain(`no bilibili browser profile at ${DEFAULT_PROFILE_DIR}`);
        expect(result.error?.split('\n')).toHaveLength(1);
        expect(fake.requests).toHaveLength(1);
    });

    test('passport and account login redirects refuse before any flow work', async () => {
        const fake = makeFakeLauncher({ landedUrl: PASSPORT_LOGIN_URL, isLoginPage: true });
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('bilibili session preflight refused — run:');
        expect(result.error).toContain(BILI_LOGIN_INSTRUCTION);
        expect(fake.requests).toHaveLength(1);
        expect(fake.calls.some((c) => c.startsWith('click:'))).toBe(false);
    });

    test('isBilibiliAuthenticated returns false immediately on login gateway URLs', async () => {
        const fakeLoginPages = [
            makeFakePage({ landedUrl: PASSPORT_LOGIN_URL }, []),
            makeFakePage({ landedUrl: ACCOUNT_LOGIN_URL }, []),
            makeFakePage({ landedUrl: MEMBER_SIGNIN_URL }, []),
        ];
        for (const p of fakeLoginPages) {
            const auth = await isBilibiliAuthenticated(p);
            expect(auth).toBe(false);
        }
    });

    test('isBilibiliAuthenticated returns true on authenticated member and dynamic pages', async () => {
        const memberPage = makeFakePage({ landedUrl: BILI_MEMBER_HOME_URL, authenticated: true }, []);
        expect(await isBilibiliAuthenticated(memberPage)).toBe(true);

        const dynamicPage = makeFakePage({ landedUrl: BILI_DYNAMIC_HOME_URL, authenticated: true }, []);
        expect(await isBilibiliAuthenticated(dynamicPage)).toBe(true);
    });

    test('session expiry between preflight and flow fails cleanly with login instruction', async () => {
        const fake = makeFakeLauncher({ expireAfterPreflight: true });
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({ content: makeVideoContent() });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('bilibili session failed — run:');
        expect(result.error).toContain(BILI_LOGIN_INSTRUCTION);
        // Preflight verified, flow failed on second launch
        expect(fake.requests).toHaveLength(2);
        expect(fake.closeCount()).toBe(1);
    });
});

describe('6. flow stages (fake page running real evaluate scripts)', () => {
    test('shortVideo happy draft: video assigned, fields filled, cover attached, draft saved', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({
            content: makeVideoContent({
                tags: ['科技', '数码'],
                coverPath: COVER_PATH,
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.metadata?.publishStatus).toBe('draft');
        expect(result.metadata?.stage).toBe('draft-receipt');
        // Only the persisted draft URL confirms: the toast alone is never the receipt (P2-a).
        expect(result.metadata?.receipt).toBe(REAL_DRAFT_RECEIPT_URL);
        expect(result.url).toBe(REAL_DRAFT_RECEIPT_URL);
        expect(fake.requests).toHaveLength(2); // preflight + flow
        expect(fake.calls).toContain(`setInputFiles:${BILI_VIDEO_SELECTORS.videoInput[0]}|${VIDEO_PATH}`);
        expect(fake.calls).toContain(`fill:${BILI_VIDEO_SELECTORS.titleInput[0]}|测试视频标题`);
        expect(fake.calls).toContain(`fill:${BILI_VIDEO_SELECTORS.tagInput[0]}|科技`);
        expect(fake.calls).toContain(`fill:${BILI_VIDEO_SELECTORS.tagInput[0]}|数码`);
        expect(fake.calls).toContain(`setInputFiles:${BILI_VIDEO_SELECTORS.coverFileInput[0]}|${COVER_PATH}`);
    });

    test('shortVideo happy public: submitAdd clicked, BV URL returned with pending-review status', async () => {
        const fake = makeFakeLauncher();
        const t = makeTransport(fake, 'shortVideo');
        const result = await t.publish({
            content: makeVideoContent({
                publishStatus: 'public',
                tags: ['科技'],
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(REAL_VIDEO_RECEIPT_URL);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.metadata?.status).toBe('pending-review');
        expect(result.metadata?.stage).toBe('publish-receipt');
        expect(result.metadata?.bvid).toBe('BV1xx411c7mD');
        expect(fake.calls).toContain(`click:${BILI_VIDEO_SELECTORS.submitAdd[0]}`);
    });

    test('shortVideo video upload failure -> typed video-upload stageFail', async () => {
        const fake = makeFakeLauncher({ missingVideoInput: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('video-upload');
        expect(result.error).toContain('bilibili video upload failed');
    });

    test('shortVideo media processing timeout -> typed media-processing stageFail', async () => {
        const fake = makeFakeLauncher({ missingTitleInput: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('media-processing');
        expect(result.error).toContain('bilibili media processing timed out');
    });

    test('shortVideo title readback failure -> typed title-fill stageFail', async () => {
        const fake = makeFakeLauncher({ titleReadbackDrops: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('title-fill');
        expect(result.error).toContain('bilibili title readback failed');
    });

    test('shortVideo description readback failure -> typed description-fill stageFail', async () => {
        const fake = makeFakeLauncher({ descriptionReadbackDrops: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({}, { body: '有实际描述' }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('description-fill');
        expect(result.error).toContain('bilibili description readback failed');
    });

    test.each([
        { options: { titleReadbackRejects: true }, stage: 'title-fill', field: 'title' },
        { options: { descriptionReadbackRejects: true }, stage: 'description-fill', field: 'description' },
    ])(
        'shortVideo refuses submit when the $field locator detaches during readback',
        async ({ options, stage, field }) => {
            const fake = makeFakeLauncher(options);
            const result = await makeTransport(fake, 'shortVideo', 50).publish({
                content: makeVideoContent({ publishStatus: 'public' }, { body: '有实际描述' }),
            });
            expect(result.ok).toBe(false);
            expect(result.metadata?.stage).toBe(stage);
            expect(result.error).toContain(`${field} readback failed`);
            expect(fake.calls).not.toContain(`click:${BILI_VIDEO_SELECTORS.submitAdd[0]}`);
        },
    );

    test('shortVideo partition selection failure -> typed partition-select stageFail', async () => {
        const fake = makeFakeLauncher({ partitionMissing: true, partitionReadbackDrops: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('partition-select');
        expect(result.error).toContain('bilibili partition selection failed');
    });

    test('shortVideo tags readback failure -> typed tags-fill stageFail', async () => {
        const fake = makeFakeLauncher({ tagsReadbackDrops: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ tags: ['科技'] }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('tags-fill');
        expect(result.error).toContain('bilibili tags readback failed');
    });

    test('shortVideo cover entry missing -> typed cover-attach stageFail', async () => {
        const fake = makeFakeLauncher({ coverEntryMissing: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ coverPath: COVER_PATH }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('cover-attach');
        expect(result.error).toContain('bilibili cover entry not found');
    });

    test('shortVideo cover modal done button missing -> typed cover-attach stageFail', async () => {
        const fake = makeFakeLauncher({ coverDoneMissing: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ coverPath: COVER_PATH }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('cover-attach');
        expect(result.error).toContain('bilibili cover modal done button not found');
    });

    test('shortVideo cover preview unchanged -> typed cover-attach stageFail', async () => {
        const fake = makeFakeLauncher({ coverPreviewUnchanged: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ coverPath: COVER_PATH }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('cover-attach');
        expect(result.error).toContain('bilibili cover preview did not change after upload');
    });

    test('shortVideo draft save control missing -> typed draft-save stageFail', async () => {
        const fake = makeFakeLauncher({ draftButtonMissing: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ publishStatus: 'draft' }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('draft-save');
        expect(result.error).toContain('bilibili shortVideo draft save control not found');
    });

    test('shortVideo public submit receipt missing/unconfirmed -> typed publish-receipt stageFail', async () => {
        const fake = makeFakeLauncher({ publicReceiptMissing: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent({ publishStatus: 'public' }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('publish-receipt');
        expect(result.error).toContain('bilibili video submission unconfirmed');
    });

    test('dynamic happy public: text paste, image upload, launch click -> fresh opus receipt', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL });
        const t = makeTransport(fake, 'dynamic');
        const result = await t.publish({
            content: makeDynamicContent({
                images: [IMAGE_PATH],
            }),
        });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(REAL_DYNAMIC_RECEIPT_URL);
        expect(result.metadata?.publishStatus).toBe('public');
        expect(result.metadata?.stage).toBe('publish-receipt');
        expect(fake.calls).toContain(`setInputFiles:${BILI_DYNAMIC_SELECTORS.imageInput[0]}|${IMAGE_PATH}`);
        expect(fake.calls).toContain(`click:${BILI_DYNAMIC_SELECTORS.launchButton[0]}`);
    });

    test('dynamic composer attach failure -> typed composer-attach stageFail', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL, missingDynamicEditor: true });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('composer-attach');
        expect(result.error).toContain('bilibili dynamic editor attach failed');
    });

    test('dynamic text readback failure -> typed text-fill stageFail', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL, dynamicTextReadbackDrops: true });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('text-fill');
        expect(result.error).toContain('bilibili dynamic text readback failed');
    });

    test('dynamic image upload failure -> typed images-upload stageFail', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL, missingDynamicImageInput: true });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent({ images: [IMAGE_PATH] }) });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('images-upload');
        expect(result.error).toContain('bilibili dynamic image upload failed');
    });

    test('dynamic launch button disabled -> typed publish-click stageFail', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL, dynamicLaunchDisabled: true });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('publish-click');
        expect(result.error).toContain('bilibili dynamic launch button is disabled');
    });

    test('dynamic publish receipt unconfirmed -> typed publish-receipt stageFail', async () => {
        const fake = makeFakeLauncher({ landedUrl: BILI_DYNAMIC_HOME_URL, dynamicReceiptMissing: true });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('publish-receipt');
        expect(result.error).toContain('bilibili dynamic publication unconfirmed');
    });

    test('dynamic pre-existing feed card never confirms a submit (0297 review P2-b)', async () => {
        const fake = makeFakeLauncher({
            landedUrl: BILI_DYNAMIC_HOME_URL,
            dynamicReceiptMissing: true,
            dynamicBaselineCard: PRE_EXISTING_DYNAMIC_CARD,
        });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('publish-receipt');
        expect(result.error).toContain('bilibili dynamic publication unconfirmed');
    });

    test('dynamic confirms only on a link that was absent before the launch click (0297 review P2-b)', async () => {
        const fake = makeFakeLauncher({
            landedUrl: BILI_DYNAMIC_HOME_URL,
            dynamicBaselineCard: PRE_EXISTING_DYNAMIC_CARD,
        });
        const t = makeTransport(fake, 'dynamic', 50);
        const result = await t.publish({ content: makeDynamicContent() });

        expect(result.ok).toBe(true);
        expect(result.url).toBe(REAL_DYNAMIC_RECEIPT_URL);
    });

    test('shortVideo draft receipt missing -> typed draft-receipt stageFail, no claimed save (0297 review P2-a)', async () => {
        const fake = makeFakeLauncher({ draftReceiptMissing: true });
        const t = makeTransport(fake, 'shortVideo', 50);
        const result = await t.publish({ content: makeVideoContent() });

        expect(result.ok).toBe(false);
        expect(result.metadata?.stage).toBe('draft-receipt');
        expect(result.error).toContain('bilibili shortVideo draft unconfirmed');
        expect(result.error).not.toContain('草稿已保存');
    });
});

describe('7. source hygiene', () => {
    test('no node:fs or bare fs in src/ files (Bun file API used)', async () => {
        const srcFiles = ['flow.ts', 'selectors.ts', 'index.ts', 'profile-check.ts'];
        for (const f of srcFiles) {
            const content = await Bun.file(join(import.meta.dir, '..', 'src', f)).text();
            expect(content).not.toMatch(/from\s+['"]node:fs(\/promises)?['"]/);
            expect(content).not.toMatch(/from\s+['"]fs(\/promises)?['"]/);
            expect(content).not.toMatch(/require\(['"]node:fs(\/promises)?['"]\)/);
        }
    });

    test('no eval or new Function in src/ files', async () => {
        const srcFiles = ['flow.ts', 'selectors.ts', 'index.ts', 'profile-check.ts'];
        for (const f of srcFiles) {
            const content = await Bun.file(join(import.meta.dir, '..', 'src', f)).text();
            expect(content).not.toMatch(/\beval\s*\(/);
            expect(content).not.toMatch(/new\s+Function\s*\(/);
        }
    });

    test('no in-page base64/DataTransfer file upload in src/flow.ts (uses Playwright setInputFiles)', async () => {
        const content = await Bun.file(join(import.meta.dir, '..', 'src', 'flow.ts')).text();
        expect(content).not.toContain('readAsDataURL');
        expect(content).not.toContain('base64');
        expect(content).toContain('setInputFiles');
    });

    test('no locator.evaluate in src/flow.ts (uses page.evaluate per 0296 lesson)', async () => {
        const content = await Bun.file(join(import.meta.dir, '..', 'src', 'flow.ts')).text();
        expect(content).not.toContain('.locator.evaluate');
        expect(content).not.toMatch(/\blocator\([^)]*\)\.evaluate/);
    });

    test('profile-check.ts source-text-only asserts (not imported, prevents coverage drops)', async () => {
        const content = await Bun.file(join(import.meta.dir, '..', 'src', 'profile-check.ts')).text();
        expect(content).toContain("import { runProfileCli } from '@gobing-ai/publish-harness/browser'");
        expect(content).toContain("import { BILI_CONFIG } from './selectors'");
        expect(content).toContain('if (import.meta.main)');
        expect(content).toContain('runProfileCli(BILI_CONFIG, Bun.argv.slice(2))');
    });
});

describe('8. environment restoration', () => {
    test('restores environment variables, argv, and scratch files clean', () => {
        expect(process.argv).toEqual(originalEnv.argv);
        expect(process.env.BILIBILI_PROFILE_DIR).toBe(originalEnv.bilibiliDir);
        expect(process.env.KK_BROWSER_PROFILE_DIR).toBe(originalEnv.sharedDir);
        expect(process.env.KNOWLEDGE_KIT_PUBLISH_TRANSPORT).toBe(originalEnv.transport);
    });
});
