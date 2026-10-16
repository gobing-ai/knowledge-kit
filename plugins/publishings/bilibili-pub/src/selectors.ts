/**
 * bilibili-pub selectors — selector/URL/regex/timeout constants for Bilibili video uploads and
 * dynamic posts (task 0297).
 *
 * Grounding: the recovered Bilibili platform adapters
 * `.spur/run/yijianfa-source/platforms/bilibili.js` (810 lines) and
 * `.spur/run/yijianfa-source/platforms/bilibili-main.js` (86 lines) pin the creator mechanics cited
 * below:
 * - Dynamic post composer at t.bilibili.com (bilibili.js:158-287, bilibili-main.js:33-86):
 *   the contenteditable editor (bilibili.js:171, 209), image cleanup (bilibili.js:174-184),
 *   image upload entry and preview readback (bilibili.js:231, 238, 257; the vendor injects the file
 *   through a MAIN-world message bridge, bilibili-main.js:54-81 — deliberately NOT reproduced),
 *   and the launch button (bilibili.js:273).
 * - Video cover dialog (bilibili.js:290-360):
 *   div.cover-main entry (bilibili.js:292-293), file input in modal (bilibili.js:312), modal
 *   " 完成 " submit button (bilibili.js:342-346), and preview change detection (bilibili.js:296-301,
 *   348-356).
 * - Short video upload at member.bilibili.com (bilibili.js:365-556):
 *   video file input (bilibili.js:397, 401) and its file injection (bilibili.js:417), title input up
 *   to 80 chars (bilibili.js:431), description editor (bilibili.js:454), tags input and readback
 *   (bilibili.js:485, 488, 501-507), "自制" radio button (bilibili.js:520), and submit button
 *   (bilibili.js:548).
 * The partition/category chooser has NO source control: the adapter only ever writes the API field
 * `form.append("category", "daily")` (bilibili.js:571), and no partition/dropdown selector appears
 * anywhere in the recovered file — the partition selectors below are therefore Provisional and fail
 * closed.
 * Anything the evidence does not pin is Provisional and fails closed: a missing control is a loud
 * typed refusal, never a silent no-op or broad fallback.
 */

import type { ChannelBrowserConfig } from '@gobing-ai/publish-harness/browser';
import { waitUntil } from '@gobing-ai/publish-harness/browser';
import type { IsAuthenticatedPredicate } from '@gobing-ai/ts-browser-automation';

/** Site-owned target slug; also the profile channel key (`BILIBILI_PROFILE_DIR`). */
export const BILI_TARGET = 'bilibili';

/**
 * Fixed member home entry (task 0297 Design freeze): Bilibili Creator Studio.
 * Grounded entry for shortVideo operation.
 */
export const BILI_MEMBER_HOME_URL = 'https://member.bilibili.com/';

/**
 * Fixed dynamic home entry (task 0297 Design freeze): Bilibili Dynamic Feed.
 * Grounded entry for dynamic operation.
 */
export const BILI_DYNAMIC_HOME_URL = 'https://t.bilibili.com/';

/**
 * Login/passport redirect marker.
 * Matches passport login or account authentication gateways.
 */
export const BILI_LOGIN_URL_RE = /(passport\.bilibili\.com\/login|account\.bilibili\.com\/login|\/(signin|login))/;

/**
 * Supported operations for bilibili-pub (task 0297 Design freeze).
 * 'shortVideo' publishes to member.bilibili.com; 'dynamic' publishes to t.bilibili.com.
 */
export const BILIBILI_OPERATIONS = ['shortVideo', 'dynamic'] as const;
export type BilibiliOperation = (typeof BILIBILI_OPERATIONS)[number];

/**
 * Video upload form selectors (bilibili.js:290-360, 365-556).
 */
export const BILI_VIDEO_SELECTORS = {
    /** Video file input candidates (bilibili.js:397, 401). */
    videoInput: [
        'input[type="file"][accept*="video"]',
        'input[type="file"][accept*=".mp4"]',
        'input[type="file"][accept*=".mov"]',
        'input[type="file"]',
    ],
    /** Video title input candidates: max 80 chars (bilibili.js:431). */
    titleInput: ['input[maxlength="80"][type="text"]', 'input[placeholder*="标题"]'],
    /** Video description editor (bilibili.js:454). */
    descriptionEditor: ['div.ql-editor[contenteditable="true"]', '[contenteditable="true"].ql-editor'],
    /**
     * Partition / category selection candidates — **Provisional**: the recovered adapter has no
     * partition UI control at all; it only writes the API field `form.append("category", "daily")`
     * (bilibili.js:571). These candidates are probed read-only and a missing chooser is a typed
     * refusal, never a silently skipped partition.
     */
    partitionCandidates: [
        'div.select-item',
        'div.category-item',
        'div.drop-cascader-item',
        'div.video-type-item',
        'div.select-controller',
        'div.radio-item',
    ],
    /** Tag input candidates (bilibili.js:485). */
    tagInput: ['input[placeholder="按回车键Enter创建标签"]', 'input[placeholder*="创建标签"]'],
    /** Tag elements container / labels for cleanup and readback (bilibili.js:479, 503). */
    tagItems: 'div.tag-pre-wrp > div.label-item-v2-container',
    /** "自制" (original) radio button (bilibili.js:520). */
    originalRadio: 'span.check-radio-v2-name',
    /** Cover main container (bilibili.js:292-293). */
    coverMain: 'div.cover-main',
    coverSlot: '.cover-slot',
    coverImg: '.cover-img',
    coverEntries: ['更换封面', '封面设置', '添加封面'],
    /** Cover upload file input inside modal (bilibili.js:312). */
    coverFileInput: [
        "div.bcc-upload-wrapper > input[type='file'][accept='image/png, image/jpeg']",
        "div.bcc-upload-wrapper input[type='file']",
        "input[type='file'][accept*='image']",
    ],
    /** Cover modal completion submit button (bilibili.js:342-346). */
    coverSubmit: 'div.submit',
    /** Public video submission button (bilibili.js:548). */
    submitAdd: [
        'span.submit-add',
        'button.submit-add',
        'span:text-is("立即投稿")',
        'button:text-is("立即投稿")',
        'span:text-is("投稿")',
        'button:text-is("投稿")',
    ],
    /** Save draft button for draft status (provisional — draft requires observed save draft control). */
    saveDraft: [
        'span.submit-draft',
        'button.submit-draft',
        'button:text-is("存草稿")',
        'button:text-is("保存草稿")',
        'span:text-is("存草稿")',
        'span:text-is("保存草稿")',
    ],
} as const;

/**
 * Dynamic post composer selectors (bilibili.js:158-287, bilibili-main.js:33-86).
 */
export const BILI_DYNAMIC_SELECTORS = {
    /** Dynamic composer container (bilibili.js:270-271). */
    composer: '.bili-dyn-publishing',
    /** Dynamic text editor (bilibili.js:171, 209). */
    editor: [
        'div[placeholder="有什么想和大家分享的？"][contenteditable="true"]',
        'div.bili-dyn-publishing div[contenteditable="true"]',
    ],
    /** Optional title input for dynamic posts (bilibili.js:187). */
    titleInput: 'input[maxlength="20"][placeholder="好的标题更容易获得支持，选填20字"]',
    /** Remove button for existing images (bilibili.js:178). */
    removeImageBtn: 'div.bili-pics-uploader__item__remove',
    /** Image upload entry container (bilibili.js:231). */
    imageUploadEntry: 'div.bili-dyn-publishing__image-upload',
    /** Native file input for dynamic images (bilibili-main.js:54-81). */
    imageInput: [
        'div.bili-dyn-publishing__image-upload input[type="file"]',
        '.bili-pics-uploader input[type="file"]',
        'input[type="file"][name="upload"]',
        'input[type="file"][accept*="image"]',
    ],
    /** Add image button (bilibili-main.js:75). */
    imageAddBtn: '.bili-pics-uploader__add',
    /** Preview items for dynamic images (bilibili.js:238, 257). */
    imagePreviews: '.bili-pics-uploader__item, .bili-dyn-publishing__image-item',
    /** Publish / Launch button for dynamic posts (bilibili.js:273). */
    launchButton: ['button.bili-dyn-publishing__action__launch', 'button:text-is("发布")'],
} as const;

/**
 * Receipt-shaped URLs for shortVideo and dynamic publishing.
 * shortVideo pending-review receipt matches upload manager or video BV URL.
 * dynamic receipt matches opus / t.bilibili.com post URL.
 */
export const BILI_RECEIPT_URL_RES = [
    /member\.bilibili\.com\/platform\/upload-manager\/article/,
    /member\.bilibili\.com\/video\/BV[0-9a-zA-Z]+/,
    /bilibili\.com\/video\/BV[0-9a-zA-Z]+/,
    /member\.bilibili\.com\/platform\/upload\/video\/success/,
    /t\.bilibili\.com\/[0-9]+/,
    /t\.bilibili\.com\/opus\/[0-9]+/,
    /bilibili\.com\/opus\/[0-9]+/,
] as const;

/** Upload and media processing timeout ceiling (600 seconds = 10 minutes). */
export const BILI_UPLOAD_TIMEOUT_MS = 600_000;

/** Login timeout for profile CLI checks. */
export const BILI_LOGIN_TIMEOUT_MS = 180_000;

/**
 * Checks whether the current page session is authenticated for Bilibili creator surfaces.
 * Returns false if redirected to passport login; checks for creator navigation/avatar or
 * composer presence within 15 seconds.
 */
export const isBilibiliAuthenticated: IsAuthenticatedPredicate = async (page) => {
    if (BILI_LOGIN_URL_RE.test(page.url())) return false;
    return waitUntil(
        async () => {
            if (BILI_LOGIN_URL_RE.test(page.url())) return false;
            const authenticated = await page.evaluate(`(() => {
                const isLoginPage = Boolean(
                    document.querySelector('.login-box, .bili-mini-login, .login-container') ||
                        window.location.href.includes('passport.bilibili.com'),
                );
                if (isLoginPage) return false;
                return Boolean(
                    document.querySelector(
                        '.header-entry-avatar, .nav-user-info, .bili-avatar, a[href*="space.bilibili.com"], .bili-dyn-publishing, div[placeholder="有什么想和大家分享的？"], input[type="file"]',
                    ),
                );
            })()`);
            return Boolean(authenticated);
        },
        15_000,
        500,
    );
};

/**
 * Site-owned config for shared session check and operator CLI (ADR-032).
 */
export const BILI_CONFIG: ChannelBrowserConfig = {
    channel: BILI_TARGET,
    homeUrl: BILI_MEMBER_HOME_URL,
    isAuthenticated: isBilibiliAuthenticated,
    loginTimeoutMs: BILI_LOGIN_TIMEOUT_MS,
    checkHeadedOnly: false,
};
